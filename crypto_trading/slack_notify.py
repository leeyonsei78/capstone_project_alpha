"""
가상자산 자동매매 매수/매도 Slack 승인 플로우.

DRY_RUN=False(실거래) + SLACK_APPROVAL_REQUIRED=True(기본값)인 봇은 실제 주문을 내기
전에 항상 이 모듈로 Slack 승인을 요청하고, 사용자가 Slack 메시지의 버튼을 눌러
승인해야만 실제로 주문이 나간다. 거절하거나 SLACK_APPROVAL_TIMEOUT_SEC 안에 응답이
없으면 자동 취소된다 — 즉 Slack 앱의 Interactivity(아래 참고)가 아직 설정되지
않았거나 webhook이 비어 있어도 "그냥 실거래가 되어버리는" 방향으로는 절대 실패하지
않고, 항상 "거래가 안 나가는" 쪽으로 안전하게 막힌다.

승인 요청 생성(이 파일, POST to SLACK_WEBHOOK_URL)과 버튼 클릭 수신은 서로 다른
프로세스다 — crypto_trading(이 파일, scheduler.py가 매 사이클 호출)은 요청을 만들고
Slack에 메시지를 보내는 쪽, insurance_agent/web_app.py의 /api/slack/interactive
라우트(별도 Flask 프로세스, Slack이 직접 호출할 수 있는 공인 URL 필요)가 버튼 클릭을
받아 이 폴더의 data/pending_trades.json에 승인/거절을 기록하는 쪽이다. 두 프로세스가
이 JSON 파일 하나를 매개로 통신한다 — personal_bots.json과 동일한 패턴.

## Slack App 설정 (수동, 사용자가 직접 해야 함)
1. blockchain-dental/.env의 SLACK_WEBHOOK_URL을 그대로 재사용해도 되고, 새 Incoming
   Webhook을 만들어도 된다 — crypto_trading/config.json의 SLACK_WEBHOOK_URL에 설정.
2. 버튼 클릭을 받으려면 같은 Slack App에 "Interactivity & Shortcuts"를 켜고 Request URL을
   https://<공인 주소>/api/slack/interactive 로 등록해야 한다(insurance_agent/web_app.py의
   기존 /api/slack/commands와 동일하게 ngrok 등 외부 터널링 필요 — CLAUDE.md 참고).
3. Interactivity가 설정되지 않았다면 버튼을 눌러도 아무 일도 안 일어나고, 결국
   SLACK_APPROVAL_TIMEOUT_SEC 후 자동 만료(=거래 취소)된다 — 안전한 실패 방향.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta

import requests

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_PENDING_PATH = os.path.join(_DATA_DIR, "pending_trades.json")


def _key(bot_id: str, ticker: str) -> str:
    return f"{bot_id}:{ticker}"


def _load() -> dict:
    if not os.path.exists(_PENDING_PATH):
        return {}
    try:
        with open(_PENDING_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save(data: dict) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_PENDING_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_pending_for_ticker(bot_id: str, ticker: str):
    """이 (bot_id, ticker) 조합에 걸려있는 요청을 반환(없으면 None).

    상태가 "pending"인데 만료 시각을 넘겼으면 여기서 "expired"로 바꿔 반환한다 —
    실제 파일 기록은 호출자가 clear_pending()으로 정리한다(읽기 전용 조회와 상태
    변경을 분리)."""
    data = _load()
    entry = data.get(_key(bot_id, ticker))
    if not entry:
        return None
    if entry.get("status") == "pending":
        try:
            if datetime.now() > datetime.fromisoformat(entry["expires_at"]):
                entry = dict(entry, status="expired")
        except (KeyError, ValueError):
            pass
    return entry


def clear_pending(bot_id: str, ticker: str) -> None:
    data = _load()
    if data.pop(_key(bot_id, ticker), None) is not None:
        _save(data)


def request_trade_approval(webhook_url: str, bot_id: str, ticker: str, side: str,
                            reason: str = "", price: float | None = None,
                            amount_krw: float | None = None, volume: float | None = None,
                            timeout_sec: int = 600) -> None:
    """새 승인 요청을 만들고 Slack에 버튼 메시지를 보낸다.

    호출 전 get_pending_for_ticker()로 이미 진행 중인 요청이 없는지 확인하는 것은
    호출자(trade_bot.py) 책임 — 이 함수는 무조건 덮어쓴다."""
    key = _key(bot_id, ticker)
    now = datetime.now()
    entry = {
        "bot_id": bot_id, "ticker": ticker, "side": side,
        "amount_krw": amount_krw, "volume": volume, "price_hint": price, "reason": reason,
        "status": "pending",
        "requested_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=timeout_sec)).isoformat(),
    }
    data = _load()
    data[key] = entry
    _save(data)

    if not webhook_url:
        print(f"[slack_notify] SLACK_WEBHOOK_URL 미설정 — {key} 승인 요청을 콘솔에만 남깁니다: {entry}")
        return

    side_label = "매수" if side == "buy" else "매도"
    amount_line = f"{amount_krw:,.0f}원" if amount_krw else (f"{volume:.8f}개" if volume else "-")
    price_line = f"{price:,.0f}원" if price else "-"
    text = (
        f"🪙 *[{bot_id}] {ticker} {side_label} 승인 요청*\n"
        f"수량/금액: {amount_line} | 참고가: {price_line}\n"
        f"사유: {reason or '-'}\n"
        f"⏰ {timeout_sec // 60}분 내 응답이 없으면 자동 취소됩니다."
    )
    payload = {
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": text}},
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✅ 승인", "emoji": True},
                        "style": "primary",
                        "action_id": "crypto_trade_approve",
                        "value": key,
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "❌ 거절", "emoji": True},
                        "style": "danger",
                        "action_id": "crypto_trade_reject",
                        "value": key,
                    },
                ],
            },
        ]
    }
    try:
        requests.post(webhook_url, json=payload, timeout=10)
    except Exception as e:
        print(f"[slack_notify] Slack 전송 실패(요청 자체는 저장됨 — 결국 시간 초과로 취소됨): {e}")


def notify_resolution(webhook_url: str, bot_id: str, ticker: str, side: str, status: str) -> None:
    """승인/거절/만료/오류 결과를 후속 메시지로 알린다(원본 메시지의 버튼은 그대로 남지만,
    pending_trades.json에서 이미 지워졌으므로 다시 눌러도 처리되지 않는다)."""
    if not webhook_url:
        return
    side_label = "매수" if side == "buy" else "매도"
    msg = {
        "approved": f"✅ [{bot_id}] {ticker} {side_label} 승인 완료 — 주문을 실행했습니다.",
        "rejected": f"❌ [{bot_id}] {ticker} {side_label} 요청이 거절되어 취소되었습니다.",
        "expired": f"⏰ [{bot_id}] {ticker} {side_label} 요청이 시간 초과로 취소되었습니다.",
        "error": f"⚠️ [{bot_id}] {ticker} {side_label} 승인 후 주문 실행 중 오류가 발생했습니다.",
    }.get(status)
    if not msg:
        return
    try:
        requests.post(webhook_url, json={"text": msg}, timeout=10)
    except Exception:
        pass
