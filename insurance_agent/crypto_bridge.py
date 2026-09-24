"""
가상자산(auto_upbit 편입) 자동매매 헤드리스 스케줄러 기동 브릿지.

blockchain_bridge.py와 같은 목적 — idempotent 기동(이미 떠 있으면 재사용, 죽어 있으면만
재기동) — 을 ../crypto_trading/scheduler.py 하나에 대해 수행한다. Hardhat 노드 기동이나
컨트랙트 배포 같은 선행 단계가 없어 blockchain_bridge.py보다 훨씬 단순하다.

⚠️ DRY_RUN — crypto_trading/config.json(또는 config.example.json 기본값)의 DRY_RUN=True인
동안은 실제 매수/매도 주문이 나가지 않는다(잔고·현재가 조회는 실제 데이터 그대로).
자세한 내용은 crypto_trading/trade_bot.py, scheduler.py 상단 주석 참고.
"""

import json
import os
import secrets
import subprocess
import threading
import time
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CRYPTO_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "crypto_trading"))
SCHEDULER_SCRIPT = "scheduler.py"
PERSONAL_BOTS_PATH = os.path.join(CRYPTO_DIR, "data", "personal_bots.json")

_personal_lock = threading.Lock()

_lock = threading.Lock()
_status = {"state": "idle", "message": "", "updated": time.time()}


def _set_status(state, message):
    with _lock:
        _status["state"] = state
        _status["message"] = message
        _status["updated"] = time.time()


def get_status():
    with _lock:
        return dict(_status)


def _crypto_project_exists():
    return os.path.isdir(CRYPTO_DIR) and os.path.isfile(os.path.join(CRYPTO_DIR, SCHEDULER_SCRIPT))


def _is_scheduler_running():
    """psutil로 scheduler.py가 이미 살아있는 python 프로세스인지 확인.

    psutil이 없으면 None(판별 불가)을 반환한다 — blockchain_bridge.py의
    _find_running_services()와 동일한 관례(모르면 매번 새로 기동을 시도).
    """
    try:
        import psutil
    except ImportError:
        return None

    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            name = (proc.info["name"] or "").lower()
            if "python" not in name:
                continue
            cmdline = " ".join(proc.info["cmdline"] or "").replace("\\", "/")
            if SCHEDULER_SCRIPT in cmdline:
                return True
        except Exception:
            # psutil.NoSuchProcess / AccessDenied 등 — 해당 프로세스만 건너뛴다
            continue
    return False


def _start_console(title, command, cwd):
    """run.bat/blockchain_bridge.py와 동일하게 새 콘솔 창에서 실행 — 로그를 눈으로 바로 확인 가능."""
    subprocess.Popen('start "{}" cmd /k "{}"'.format(title, command), cwd=cwd, shell=True)


def ensure_crypto_scheduler():
    """이미 떠 있으면 아무것도 하지 않고 True, 없으면 새 콘솔에서 기동한다.

    반환값은 "기동을 시도했다/이미 떠 있다"는 뜻이지 "실제 업비트 연결에 성공했다"는
    뜻이 아니다 — 연결 실패(API 키 미설정 등) 여부는 새 콘솔 창의 scheduler.py 로그로
    확인해야 한다(아직 이 브릿지가 그 결과를 폴링해 web_app.py로 돌려주지는 않음 —
    blockchain_bridge.py의 get_status() 폴링 패턴을 그대로 재사용해 다음 단계에서 연결).
    """
    if not _crypto_project_exists():
        _set_status("error", f"가상자산 자동매매 프로젝트(crypto_trading)를 찾을 수 없습니다: {CRYPTO_DIR}")
        return False

    running = _is_scheduler_running()
    if running:
        _set_status("running", "이미 실행 중인 스케줄러를 재사용합니다.")
        return True
    if running is None:
        _set_status("starting", "psutil 미설치 — 실행 여부를 확인할 수 없어 매번 새로 기동을 시도합니다.")
    else:
        _set_status("starting", "가상자산 자동매매 스케줄러를 시작하는 중입니다...")

    config_path = os.path.join(CRYPTO_DIR, "config.json")
    if not os.path.exists(config_path):
        _set_status(
            "error",
            "crypto_trading/config.json이 없습니다 — config.example.json을 복사해 "
            "ACCESS_KEY/SECRET_KEY를 채운 뒤 다시 시도하세요. (DRY_RUN 기본값 True이므로 "
            "채워도 실제 주문은 나가지 않습니다.)",
        )
        return False

    _start_console("Crypto Trading Scheduler", "python scheduler.py", CRYPTO_DIR)
    _set_status("running", "스케줄러를 새 콘솔 창에서 기동했습니다.")
    return True


_IN_PROGRESS_STATES = {"starting"}


def start_scheduler_async():
    """blockchain_bridge.start_enrollment_async()와 동일한 패턴 — 이미 진행 중이면 그대로
    현재 상태만 반환하고, 아니면 백그라운드 스레드로 기동을 시작한다.

    ensure_crypto_scheduler() 자체는 (Hardhat 노드처럼 포트가 열릴 때까지 기다리는 단계가
    없어) 거의 즉시 반환하지만, psutil 프로세스 스캔이 느려질 수 있는 상황을 대비해
    web_app.py 요청 스레드를 막지 않도록 동일하게 스레드로 분리해둔다.
    """
    with _lock:
        in_progress = _status["state"] in _IN_PROGRESS_STATES
    if in_progress:
        return get_status()

    _set_status("starting", "가상자산 자동매매 스케줄러 기동을 준비하는 중입니다...")
    threading.Thread(target=ensure_crypto_scheduler, daemon=True).start()
    return get_status()


# ── 개인별 자동매매 등록/승인 ──────────────────────────────────
# scheduler.py가 매 사이클(60초) data/personal_bots.json을 다시 읽으므로(hot-reload),
# 여기서 쓴 내용은 스케줄러 재시작 없이 다음 사이클부터 반영된다.
#
# ⚠️ 안전장치 — approved 플래그: register_personal_bot()은 항상 approved=False로
# 시작(재등록도 마찬가지로 False로 리셋)한다. True로 바꿀 수 있는 함수는
# approve_personal_bot() 하나뿐이고, 이건 web_app.py의 /api/crypto/personal/approve
# 라우트(고객 본인의 명시적 버튼 클릭 + confirm=true 전제)에서만 호출한다.
# 챗봇(agents/orchestrator.py의 TOOLS)에는 이 함수를 호출하는 도구를 절대 추가하지
# 않는다 — 대화만으로 실거래가 켜지면 안 되기 때문(사용자 요청으로 이렇게 분리함).

def _load_personal_bots():
    if not os.path.exists(PERSONAL_BOTS_PATH):
        return {}
    try:
        with open(PERSONAL_BOTS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_personal_bots(registry):
    os.makedirs(os.path.dirname(PERSONAL_BOTS_PATH), exist_ok=True)
    with open(PERSONAL_BOTS_PATH, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)


def register_personal_bot(access_key, secret_key, risk_tier=None, existing_bot_id=None):
    """개인별 자동매매를 등록(또는 기존 등록을 키/등급만 갱신)한다 — 항상 승인 대기
    (approved=False, 즉 DRY_RUN) 상태로 시작/리셋된다. bot_id를 반환한다."""
    if not access_key or not secret_key:
        raise ValueError("업비트 Open API 키(access_key/secret_key)가 필요합니다.")

    with _personal_lock:
        registry = _load_personal_bots()
        bot_id = existing_bot_id if (existing_bot_id and existing_bot_id in registry) else \
            f"personal_{secrets.token_hex(4)}"
        now = datetime.now().isoformat()
        registry[bot_id] = {
            "access_key": access_key,
            "secret_key": secret_key,
            "risk_tier": risk_tier or "중립형",
            "approved": False,  # 등록/재등록은 항상 미승인 상태로 — 실거래는 별도 승인 필요
            "created_at": registry.get(bot_id, {}).get("created_at", now),
            "updated_at": now,
        }
        _save_personal_bots(registry)
    return bot_id


def approve_personal_bot(bot_id):
    """고객 본인의 명시적 승인 — 이 함수가 호출된 이후에야 scheduler.py가 이 bot_id에
    대해 DRY_RUN=False(실거래)로 처리한다. web_app.py 라우트에서만 호출할 것."""
    with _personal_lock:
        registry = _load_personal_bots()
        if bot_id not in registry:
            raise KeyError(f"등록되지 않은 bot_id: {bot_id}")
        registry[bot_id]["approved"] = True
        registry[bot_id]["approved_at"] = datetime.now().isoformat()
        _save_personal_bots(registry)


def revoke_personal_bot(bot_id):
    """실거래 승인을 취소하고 다시 DRY_RUN(페이퍼) 상태로 되돌린다. 등록 자체는 유지."""
    with _personal_lock:
        registry = _load_personal_bots()
        if bot_id not in registry:
            raise KeyError(f"등록되지 않은 bot_id: {bot_id}")
        registry[bot_id]["approved"] = False
        _save_personal_bots(registry)


def get_personal_bot_info(bot_id):
    """등록 정보를 반환하되 API 키(access_key/secret_key)는 절대 포함하지 않는다
    (프론트엔드 상태 표시용 — 키를 다시 클라이언트로 흘려보낼 이유가 없음)."""
    registry = _load_personal_bots()
    entry = registry.get(bot_id)
    if not entry:
        return None
    return {
        "bot_id": bot_id,
        "risk_tier": entry.get("risk_tier"),
        "approved": entry.get("approved", False),
        "created_at": entry.get("created_at"),
        "updated_at": entry.get("updated_at"),
    }


if __name__ == "__main__":
    ensure_crypto_scheduler()
    print(get_status())
