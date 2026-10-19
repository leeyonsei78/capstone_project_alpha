"""
헤드리스 자동매매 스케줄러 (app.py의 Streamlit UI 루프를 대체).

app.py는 브라우저 탭이 열려 있는 동안만 st.rerun()으로 폴링하는 1인용 루프였다.
이 스크립트는 그 루프를 UI 없이 콘솔 프로세스로 빼서, blockchain-dental의
premium-scheduler.js 등 백그라운드 서비스와 동일한 방식(항상 켜져 있는 상태로
insurance_agent/crypto_bridge.py가 idempotent하게 기동·감시)으로 돌아가게 한다.

⚠️ DRY_RUN — 잔고·현재가·평가손익 조회는 실제 업비트 데이터 그대로 쓰고, 오직
매수/매도 "주문 체결"만 막는다. 자세한 내용은 trade_bot.py의
_place_buy_order/_place_sell_order 주석 참고.

## 멀티테넌트 — 회사 준비금 봇("default") + 고객별 개인 자동매매("personal_*")
- "default"(bot_id) 하나는 config.json 기준으로 항상 존재 — 회사 준비금 운용.
- data/personal_bots.json(웹 등록 UI → insurance_agent/web_app.py의
  /api/crypto/personal/register가 기록)에 있는 항목마다 별도 TradingBot 인스턴스를
  만들어 같은 사이클에서 함께 처리한다. 이 파일은 매 사이클 다시 읽어(hot-reload)
  재시작 없이도 신규 등록·승인 여부 변경이 바로 반영된다.
- ⚠️ **개인별 봇은 등록만으로는 절대 실거래되지 않는다** — `approved: true`가 레지스트리에
  없으면 매 사이클 강제로 DRY_RUN=True로 덮어쓴다. `approved`는 챗봇(LLM)이 호출할 수
  있는 도구가 아니라 insurance_agent/web_app.py의 별도 라우트
  (/api/crypto/personal/approve, 고객 본인의 명시적 버튼 클릭 전제)로만 켤 수 있다 —
  대화만으로 실거래가 켜지는 일이 없도록 의도적으로 분리함.
"""

import sys
import os

# [Windows cp949 대응] trade_bot.py 안에는 이모지가 섞인 print()가 다수 있다.
# insurance_agent/web_app.py에서 이미 한 번 "print()에 이모지 → 콘솔이 cp949일 때
# UnicodeEncodeError로 프로세스 자체가 죽는" 문제를 겪었다(CLAUDE.md 기록). 이 스크립트는
# 새 콘솔 프로세스로 기동되므로 같은 문제를 그대로 물려받는다 — 이모지를 일일이 걷어내는
# 대신, 이 프로세스의 stdout/stderr 인코딩 자체를 UTF-8(대체 문자 허용)로 재설정해 원천 차단.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import copy
import json
import signal
import time
from datetime import datetime

import pyupbit
import config as bot_config
import slack_notify
from trade_bot import TradingBot

LOOP_INTERVAL_SEC = 60  # app.py 원본과 동일한 폴링 주기
BOT_ID = "default"  # 회사 준비금 봇 — config.json 기준, 항상 존재.

_stop_requested = False


def _personal_bots_path():
    state_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(state_dir, exist_ok=True)
    return os.path.join(state_dir, "personal_bots.json")


def _load_personal_bots_registry():
    """insurance_agent/web_app.py가 기록한 개인별 봇 등록 정보를 읽는다.
    파일이 없거나 깨졌으면 빈 dict — 개인별 봇이 하나도 없는 것으로 취급하고
    회사 준비금 봇("default")만 정상적으로 계속 돈다(전체 스케줄러가 죽지 않음)."""
    path = _personal_bots_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[scheduler] personal_bots.json 읽기 실패(개인별 봇 없이 계속 진행): {e}")
        return {}


def _build_personal_bot_config(entry):
    """등록 정보(API 키 + 리스크 등급)로부터 TradingBot용 설정을 새로 만든다.

    copy.deepcopy를 쓰는 이유: config.py 자체 주석에 이미 "DEFAULT_CONFIG.copy()가
    얕은 복사라 중첩 dict 오염 가능"이라고 기록된 기존 이슈가 있는데, 개인별 봇을
    여러 개 동시에 만드는 지금이 바로 그 위험이 실제로 발생할 수 있는 첫 상황이다
    (여러 TradingBot 인스턴스가 STRATEGY_WEIGHTS_BY_COIN 등 같은 중첩 dict 객체를
    공유하면 한 고객 봇의 내부 동작이 다른 고객 봇에 영향을 줄 수 있음) — 매 개인별
    봇마다 완전히 독립된 config 트리를 갖도록 얕은 복사 대신 깊은 복사를 쓴다.
    """
    tier = entry.get("risk_tier") or bot_config.DEFAULT_RISK_TIER
    preset = bot_config.RISK_TIER_PRESETS.get(tier, bot_config.RISK_TIER_PRESETS[bot_config.DEFAULT_RISK_TIER])
    cfg = copy.deepcopy(bot_config.DEFAULT_CONFIG)
    cfg["ACCESS_KEY"] = entry.get("access_key", "")
    cfg["SECRET_KEY"] = entry.get("secret_key", "")
    cfg["TICKERS"] = preset["tickers"]
    cfg["BUY_AMOUNT_KRW"] = preset["buy_amount_krw"]
    cfg["DRY_RUN"] = not bool(entry.get("approved", False))
    return cfg


def _handle_stop_signal(signum, frame):
    global _stop_requested
    print(f"[scheduler] 종료 신호({signum}) 수신 — 현재 사이클 완료 후 정상 종료합니다.")
    _stop_requested = True


def _status_snapshot_path(bot_id):
    state_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(state_dir, exist_ok=True)
    return os.path.join(state_dir, f"status_snapshot_{bot_id}.json")


def _build_and_save_status_snapshot(bot):
    """insurance_agent/tools/crypto_reserve_tool.py(get_crypto_reserve_status)가 읽는
    조회용 스냅샷. run_once()는 매 사이클 티커 하나만 순환 처리하므로(round-robin),
    전체 종목의 "현재" 잔고·시세를 보려면 여기서 전 종목을 따로 다시 조회해야 한다.
    현재가 조회(pyupbit.get_current_price)는 인증이 필요 없는 순수 조회 API이고,
    잔고 조회(bot.get_balance)도 이미 실제 업비트 데이터를 쓰는 기존 메서드 그대로다
    — 즉 이 스냅샷도 "조회는 실제 데이터"라는 원칙을 그대로 따른다.
    """
    tickers = bot.config.get("TICKERS", [])
    prices = {}
    try:
        raw = pyupbit.get_current_price(tickers)
        if isinstance(raw, dict):
            prices = raw
        elif len(tickers) == 1 and raw is not None:
            prices = {tickers[0]: raw}
    except Exception as e:
        print(f"[scheduler] 현재가 스냅샷 조회 실패(치명적이지 않음): {e}")

    positions = []
    for ticker in tickers:
        pos = bot.positions.get(ticker, {})
        coin_code = ticker.split("-")[1]
        try:
            balance = bot.get_balance(coin_code) or 0
        except Exception:
            balance = 0
        price = prices.get(ticker)
        avg_price = pos.get("average_buy_price") or 0
        pnl_percent = pnl_krw = None
        if price and avg_price:
            pnl_percent = ((price - avg_price) / avg_price) * 100
            pnl_krw = (price - avg_price) * balance
        buy_time = pos.get("buy_time")
        pending = slack_notify.get_pending_for_ticker(bot.bot_id, ticker)
        positions.append({
            "ticker": ticker,
            "balance": balance,
            "average_buy_price": avg_price,
            "current_price": price,
            "unrealized_pnl_percent": pnl_percent,
            "unrealized_pnl_krw": pnl_krw,
            "highest_price": pos.get("highest_price"),
            "stop_loss_price": pos.get("stop_loss_price"),
            "target_price": pos.get("target_price"),
            "buy_time": buy_time.isoformat() if hasattr(buy_time, "isoformat") else buy_time,
            "pending_slack_approval": pending,  # None이면 대기 중인 매수/매도 승인 요청 없음
        })

    try:
        krw_balance = bot.get_balance("KRW") or 0
    except Exception:
        krw_balance = None

    snapshot = {
        "bot_id": bot.bot_id,
        "dry_run": bot.config.get("DRY_RUN", True),
        "slack_approval_required": bot.config.get("SLACK_APPROVAL_REQUIRED", True),
        "krw_balance": krw_balance,
        "daily_trade_count": bot.daily_trade_count,
        "max_trades_per_day": bot.config.get("MAX_TRADES_PER_DAY"),
        "positions": positions,
        "updated_at": datetime.now().isoformat(),
    }
    try:
        with open(_status_snapshot_path(bot.bot_id), "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[scheduler] 상태 스냅샷 저장 실패(치명적이지 않음): {e}")


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))  # config.json은 이 폴더 기준 상대경로

    signal.signal(signal.SIGINT, _handle_stop_signal)
    signal.signal(signal.SIGTERM, _handle_stop_signal)

    cfg = bot_config.get_config_data()
    dry_run = cfg.get("DRY_RUN", True)
    print("=" * 60)
    print(f"[scheduler] 가상자산 자동매매 헤드리스 스케줄러 시작 ({datetime.now()})")
    print(f"[scheduler] DRY_RUN = {dry_run} (True면 조회는 실제, 주문 체결만 억제)")
    print(f"[scheduler] TICKERS = {cfg.get('TICKERS')}")
    print("=" * 60)

    reserve_bot = TradingBot(cfg, bot_id=BOT_ID)

    if not reserve_bot.upbit:
        print("[scheduler] 업비트 연결 실패 — config.json의 ACCESS_KEY/SECRET_KEY를 확인하세요.")
        print("[scheduler] 연결 없이는 조회도 되지 않으므로 스케줄러를 종료합니다.")
        return

    bots = {BOT_ID: reserve_bot}
    bot_kinds = {BOT_ID: "reserve"}
    bot_risk_tiers = {}  # bot_id -> 마지막으로 인스턴스를 만들 때 쓴 risk_tier (재등록 감지용)
    _build_and_save_status_snapshot(reserve_bot)  # 첫 사이클 전에도 조회 도구가 쓸 데이터를 남김

    while not _stop_requested:
        cycle_start = time.time()

        # --- 개인별 봇 레지스트리 매 사이클 재로드 ---
        # (신규 등록·승인/승인취소가 스케줄러 재시작 없이 다음 사이클부터 바로 반영됨)
        registry = _load_personal_bots_registry()
        for bot_id, entry in registry.items():
            tier = entry.get("risk_tier") or bot_config.DEFAULT_RISK_TIER
            if bot_id not in bots:
                try:
                    personal_cfg = _build_personal_bot_config(entry)
                    new_bot = TradingBot(personal_cfg, bot_id=bot_id)
                except Exception as e:
                    print(f"[scheduler] 개인별 봇 {bot_id} 초기화 실패(다음 사이클에 재시도): {e}")
                    continue
                if not new_bot.upbit:
                    print(f"[scheduler] 개인별 봇 {bot_id} 업비트 연결 실패 — API 키를 확인해야 함(계속 재시도).")
                    continue
                bots[bot_id] = new_bot
                bot_kinds[bot_id] = "personal"
                bot_risk_tiers[bot_id] = tier
                print(f"[scheduler] 신규 개인별 봇 연결됨: {bot_id} (등급={entry.get('risk_tier')}, "
                      f"승인={entry.get('approved', False)})")
            elif bot_risk_tiers.get(bot_id) != tier:
                # 재등록으로 리스크 등급이 바뀜 — TICKERS/BUY_AMOUNT_KRW 등은 생성 시점에만
                # 고정되므로, 이미 떠 있는 인스턴스의 config만 고쳐서는 반영 안 됨. 인스턴스를
                # 버리고 새로 만든다(TradingBot.__init__이 실제 업비트 잔고 + 저장된 리스크
                # 상태 파일에서 그대로 복원하므로, 재생성해도 포지션/손절가 등은 유실되지 않음
                # — daily_trade_count만 0으로 리셋되는데, 등급 변경은 드문 수동 이벤트라 무해함).
                try:
                    personal_cfg = _build_personal_bot_config(entry)
                    new_bot = TradingBot(personal_cfg, bot_id=bot_id)
                except Exception as e:
                    print(f"[scheduler] 개인별 봇 {bot_id} 등급 변경 재생성 실패(다음 사이클에 재시도): {e}")
                    continue
                if not new_bot.upbit:
                    print(f"[scheduler] 개인별 봇 {bot_id} 등급 변경 재생성 중 업비트 연결 실패 — 기존 인스턴스 유지.")
                    continue
                bots[bot_id] = new_bot
                bot_risk_tiers[bot_id] = tier
                print(f"[scheduler] 개인별 봇 {bot_id} 리스크 등급 변경 반영: 인스턴스 재생성 "
                      f"(등급={tier}, TICKERS={new_bot.config.get('TICKERS')})")
            else:
                # 등급 변경 없이 이미 연결된 개인별 봇은 재연결하지 않고, 승인 플래그만 매
                # 사이클 최신값으로 덮어쓴다 — approved=False면 강제로 DRY_RUN=True(챗봇/대화로는
                # 절대 못 바꿈, insurance_agent/web_app.py의 /api/crypto/personal/approve
                # 라우트로만 True 가능).
                bots[bot_id].config["DRY_RUN"] = not bool(entry.get("approved", False))

        # 등록 해제된(레지스트리에서 사라진) 개인별 봇은 더 이상 처리하지 않음.
        for bot_id in [b for b, k in bot_kinds.items() if k == "personal" and b not in registry]:
            print(f"[scheduler] 등록 해제된 개인별 봇 정리: {bot_id}")
            bots.pop(bot_id, None)
            bot_kinds.pop(bot_id, None)
            bot_risk_tiers.pop(bot_id, None)

        # --- 이번 사이클에 연결된 봇 전부 처리 (한 봇의 오류/정지가 다른 봇에 영향 없음) ---
        for bot_id, bot in list(bots.items()):
            try:
                log_msg, trade_result, stop_bot, stop_reason = bot.run_once()
                if log_msg:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] [{bot_id}] {log_msg}")
                if trade_result:
                    print(f"  └ [{bot_id}] 체결 기록: {trade_result}")
                # 매 사이클 종료 시점에 리스크관리 상태(손절가/익절가/최고가/매수시각)를 저장.
                # trade_bot.py 내부 여러 return 지점을 일일이 쫓는 대신, 사이클 단위로 한 번만
                # 저장하는 쪽이 훨씬 단순하고 안전하다(최악의 경우도 최근 60초 분만 유실).
                bot._save_risk_state()
                _build_and_save_status_snapshot(bot)
                if stop_bot:
                    # 이 봇 하나만 목록에서 빼고 나머지 봇들은 계속 정상 처리 —
                    # 예전(단일 봇) 동작은 "전체 종료"였지만, 멀티테넌트에서 고객 A의
                    # 봇 정지 조건이 고객 B·회사 준비금 봇까지 멈추면 안 된다.
                    print(f"[scheduler] [{bot_id}] 봇 정지 조건 도달: {stop_reason} — 이 봇만 중단합니다.")
                    bots.pop(bot_id, None)
                    bot_kinds.pop(bot_id, None)
            except Exception as e:
                # 원본 auto_upbit CLAUDE.md에 기록된 미해결 버그들이 있으므로, 사이클 하나가
                # 예외로 죽더라도 스케줄러 프로세스(그리고 다른 봇들)는 살아남아 다음
                # 사이클을 계속 시도한다.
                print(f"[scheduler] [{bot_id}] run_once() 사이클 중 오류(다음 사이클에 재시도): {e}")

        if BOT_ID not in bots:
            print("[scheduler] 회사 준비금 봇이 정지되어 스케줄러를 종료합니다.")
            break

        elapsed = time.time() - cycle_start
        sleep_for = max(0.0, LOOP_INTERVAL_SEC - elapsed)
        for _ in range(int(sleep_for)):
            if _stop_requested:
                break
            time.sleep(1)

    print(f"[scheduler] 정상 종료 ({datetime.now()})")


if __name__ == "__main__":
    main()
