"""
가상자산(auto_upbit 편입) 자동매매 현황 조회 도구.

CLAUDE.md의 "가상자산·스테이블코인 연계 확장" 3방향 중 A(준비금 자동매매 운용) —
고객에게 매매를 권유하거나 개인 자금을 연결하는 게 아니라, 회사 준비금 일부를
검증된 알고리즘(../crypto_trading, auto_upbit 편입)으로 운용한 실적을 투명하게
공시하는 용도로 시작했다. bot_id를 처음부터 매개변수로 열어둔 덕분에, 이후 추가된
개인별 자동매매(B/C 방향)도 같은 함수를 그대로 재사용한다 — orchestrator.py의
get_personal_trading_status 디스패치가 세션에 등록된 bot_id로 이 함수를 호출한다.

blockchain_tool.py는 blockchain-dental이 Node.js(ethers.js) 스택이라 subprocess로
query-*.js를 호출했지만, crypto_trading은 이미 같은 Python이라 그 장벽이 없다 —
health_risk_tool.py처럼 파일을 직접 읽는 게 더 자연스럽다(불필요한 subprocess 계층을
추가하지 않음). crypto_trading/scheduler.py가 매 사이클(60초)마다 실제 업비트
잔고·현재가로 갱신해 남기는 data/status_snapshot_<bot_id>.json을 그대로 읽는다.
개인별 봇의 dry_run 필드는 scheduler.py가 매 사이클 data/personal_bots.json의
approved 플래그를 반영해 쓰므로, 이 스냅샷만 읽어도 실거래 승인 여부가 정확하다.
"""
from __future__ import annotations

import json
import os
from datetime import datetime

_CRYPTO_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "crypto_trading")
)

_STALE_AFTER_SEC = 300  # 스케줄러 주기(60초)의 5배 — 이보다 오래됐으면 "꺼져있을 수 있음"으로 안내


def _snapshot_path(bot_id: str) -> str:
    return os.path.join(_CRYPTO_DIR, "data", f"status_snapshot_{bot_id}.json")


def get_crypto_reserve_status(bot_id: str = "default") -> str:
    """
    회사 준비금 일부를 운용 중인 가상자산 자동매매(auto_upbit 편입) 봇의 실시간 현황을
    조회합니다. 잔고·평가손익·DRY_RUN(실주문 여부) 등을 실제 업비트 데이터 기준으로
    보여줍니다. '준비금 가상자산 운용 실적 어때?', '코인 자동매매 지금 수익 나고 있어?'
    같은 질문에 사용하세요. bot_id="default"(기본값)는 회사가 운용하는 단일 준비금
    계좌이고, 고객 개인별 자동매매 조회는 이 함수가 아니라 별도 도구
    get_personal_trading_status(orchestrator.py)를 거쳐 세션에 등록된 개인 bot_id로
    이 함수가 호출된다 — 이 함수 자체는 어느 bot_id든 스냅샷 형식이 동일하므로
    구분 없이 그대로 처리한다.

    Args:
        bot_id: 조회할 봇 식별자. "default"(회사 준비금) 또는 개인별 자동매매의
            "personal_*" bot_id.
    """
    path = _snapshot_path(bot_id)
    if not os.path.exists(path):
        return json.dumps({
            "ok": False,
            "error": (
                "가상자산 자동매매 스케줄러가 아직 한 번도 기동되지 않았습니다. "
                "관리자가 스케줄러를 먼저 실행해야 조회할 수 있다고 안내하세요."
            ),
        }, ensure_ascii=False)

    try:
        with open(path, encoding="utf-8") as f:
            snapshot = json.load(f)
    except Exception as e:
        return json.dumps({
            "ok": False,
            "error": f"상태 스냅샷 파일을 읽는 중 오류가 발생했습니다: {e}",
        }, ensure_ascii=False)

    stale = False
    updated_at = snapshot.get("updated_at")
    if updated_at:
        try:
            age_sec = (datetime.now() - datetime.fromisoformat(updated_at)).total_seconds()
            stale = age_sec > _STALE_AFTER_SEC
        except (TypeError, ValueError):
            pass

    result = dict(snapshot)
    result["ok"] = True
    result["stale"] = stale
    if stale:
        result["stale_warning"] = (
            "마지막 갱신이 5분 이상 지났습니다 — 스케줄러가 꺼져 있을 수 있습니다. "
            "답변에 이 가능성을 함께 안내하세요."
        )
    return json.dumps(result, ensure_ascii=False, indent=2, default=str)
