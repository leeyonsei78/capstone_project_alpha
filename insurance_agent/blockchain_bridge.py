"""
블록체인 덴탈보험(라이나생명 블록체인치아보험) 가입 자동화 브릿지.

보험상담 AI 어시스턴트에서 '블록체인 덴탈보험' 가입을 요청하면,
../blockchain-dental (run.bat과 동일한 순서)의 프로세스를 자동으로 기동하고
관리자용(Chrome) / 고객용(Edge) 화면 2개를 자동으로 연다.
"""

import os
import socket
import subprocess
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKCHAIN_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "blockchain-dental"))
FRONTEND_DIR = os.path.join(BLOCKCHAIN_DIR, "frontend")
CONFIG_JSON = os.path.join(FRONTEND_DIR, "config.json")

HARDHAT_PORT = 8545
FRONTEND_PORT = 3000
MAILPIT_SMTP_PORT = 1025

# run.bat의 [5/12]~[12/12]과 동일한 백그라운드 서비스 목록.
SERVICE_PROCESSES = [
    ("4-Maturity Watcher", "scripts/maturity-watcher.js"),
    ("5-Oracle Service", "scripts/oracle-service.js"),
    ("6-Premium Scheduler", "scripts/premium-scheduler.js"),
    ("7-Slack Notifier", "scripts/slack-notifier.js"),
    ("8-Application Review", "scripts/application-review-service.js"),
    ("9-Certificate Service", "scripts/certificate-service.js"),
    ("10-Reserve Monitor", "scripts/reserve-monitor.js"),
    ("11-Email Service", "scripts/email-service.js"),
    ("12-AltInvest Watcher", "scripts/altinvest-watcher.js"),
]

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


def _is_port_open(port, host="127.0.0.1", timeout=1.0):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _wait_for_port(port, timeout=45, interval=1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _is_port_open(port):
            return True
        time.sleep(interval)
    return False


def _start_console(title, command, cwd):
    """run.bat의 start "제목" cmd /k "명령" 과 동일하게 새 콘솔 창에서 실행."""
    subprocess.Popen('start "{}" cmd /k "{}"'.format(title, command), cwd=cwd, shell=True)


def _find_running_services():
    """blockchain-dental 백그라운드 서비스 중 지금 실제로 살아있는 것을 [(script, proc)]로 반환.

    psutil이 없어 프로세스를 확인할 수 없으면 None(판별 불가)을 반환한다.
    """
    try:
        import psutil
    except ImportError:
        return None

    found = []
    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            if "node" not in (proc.info["name"] or "").lower():
                continue
            cmdline = " ".join(proc.info["cmdline"] or "").replace("\\", "/")
            for _, script in SERVICE_PROCESSES:
                if script in cmdline:
                    found.append((script, proc))
                    break
        except Exception:
            # psutil.NoSuchProcess / AccessDenied 등 — 해당 프로세스만 건너뛴다
            continue
    return found


def _terminate_stale_services(found):
    """노드를 새로 띄웠을 때 남아있는 이전 세션 서비스(옛 컨트랙트 주소를 바라봄)를 정리."""
    for _, proc in found:
        try:
            if os.path.normcase(proc.cwd()) != os.path.normcase(BLOCKCHAIN_DIR):
                continue  # 다른 프로젝트의 동명 스크립트 — 건드리지 않는다
            proc.terminate()
        except Exception:
            continue


def _blockchain_project_exists():
    return os.path.isdir(BLOCKCHAIN_DIR) and os.path.isfile(
        os.path.join(BLOCKCHAIN_DIR, "hardhat.config.js")
    )


def ensure_blockchain_stack():
    """run.bat과 동일한 순서로 블록체인 스택을 idempotent하게 기동한 뒤 화면 2개를 연다."""
    if not _blockchain_project_exists():
        _set_status("error", "블록체인 프로젝트(blockchain-dental)를 찾을 수 없습니다: " + BLOCKCHAIN_DIR)
        return False

    try:
        # 이메일 발송용 Mailpit(로컬 SMTP 캐처, docker-compose.yml)은 Docker가 없거나
        # 꺼져 있어도 전체 가입 흐름을 막으면 안 되는 선택 기능 — 실패해도 계속 진행.
        if not _is_port_open(MAILPIT_SMTP_PORT):
            _set_status("starting_mailpit", "이메일 발송용 Mailpit(Docker)을 시작하는 중입니다...")
            try:
                subprocess.run(
                    "docker compose up -d mailpit",
                    cwd=BLOCKCHAIN_DIR,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    errors="replace",
                )
                _wait_for_port(MAILPIT_SMTP_PORT, timeout=20)
            except Exception:
                pass  # Docker 미설치/미실행 — 증권 발급 이메일만 안 갈 뿐, 나머지는 정상 진행

        node_already_running = _is_port_open(HARDHAT_PORT)

        if not node_already_running:
            _set_status("starting_node", "[1/4] 블록체인 노드(Hardhat)를 시작하는 중입니다...")
            _start_console("1-Hardhat Node", "npx hardhat node", BLOCKCHAIN_DIR)
            if not _wait_for_port(HARDHAT_PORT, timeout=40):
                _set_status("error", "블록체인 노드 시작에 실패했습니다 (8545 포트 응답 없음).")
                return False
            # 노드가 막 올라온 직후 RPC 준비 시간을 살짝 확보
            time.sleep(2)

        need_deploy = (not node_already_running) or (not os.path.exists(CONFIG_JSON))
        if need_deploy:
            _set_status("deploying", "[2/4] 스마트 컨트랙트를 배포하는 중입니다...")
            result = subprocess.run(
                "npx hardhat run scripts/deploy.js --network localhost",
                cwd=BLOCKCHAIN_DIR,
                shell=True,
                capture_output=True,
                text=True,
                timeout=120,
                errors="replace",
            )
            if result.returncode != 0:
                tail = (result.stderr or result.stdout or "")[-800:]
                _set_status("error", "컨트랙트 배포에 실패했습니다: " + tail)
                return False

        # 서비스는 '실제로 살아있는 node 프로세스'를 기준으로 판단한다.
        # (예전에는 .services_started 마커 파일을 썼는데, 마커가 디스크에 남아있으면
        #  재부팅·창 종료로 서비스가 전부 죽은 뒤에도 영원히 skip되는 문제가 있었다.)
        running = _find_running_services()
        if running is None:
            # psutil 미설치 → 확인 불가. 노드를 새로 띄운 경우에만 서비스도 새로 기동.
            to_start = [] if node_already_running else list(SERVICE_PROCESSES)
        elif not node_already_running:
            # 노드를 새로 띄웠다면 이전 세션 서비스는 옛 컨트랙트 주소를 바라보는 좀비 → 정리 후 전부 재기동
            _terminate_stale_services(running)
            to_start = list(SERVICE_PROCESSES)
        else:
            alive = {script for script, _ in running}
            to_start = [s for s in SERVICE_PROCESSES if s[1] not in alive]

        if to_start:
            _set_status(
                "starting_services",
                "[3/4] 만기환급·오라클·자동납부·슬랙알림·청약심사AI·증권발급·준비금감시 "
                "서비스 {}개를 시작하는 중입니다...".format(len(to_start)),
            )
            for title, script in to_start:
                _start_console(title, "node " + script, BLOCKCHAIN_DIR)

        if not _is_port_open(FRONTEND_PORT):
            _set_status("starting_frontend", "[4/4] 가입 화면(프론트엔드)을 시작하는 중입니다...")
            _start_console("3-Frontend UI", "npx serve -l 3000 .", FRONTEND_DIR)
            if not _wait_for_port(FRONTEND_PORT, timeout=30):
                _set_status("error", "프론트엔드 서버 시작에 실패했습니다 (3000 포트 응답 없음).")
                return False

        _set_status("opening_windows", "관리자(Chrome)·고객(Edge) 가입 화면 2개를 여는 중입니다...")
        url = "http://localhost:{}".format(FRONTEND_PORT)
        subprocess.Popen('start chrome {}'.format(url), cwd=BLOCKCHAIN_DIR, shell=True)
        subprocess.Popen('start msedge {}'.format(url), cwd=BLOCKCHAIN_DIR, shell=True)

        _set_status("ready", "블록체인 덴탈보험 가입 화면이 준비되었습니다. (Chrome=관리자, Edge=고객)")
        return True

    except subprocess.TimeoutExpired:
        _set_status("error", "컨트랙트 배포가 시간 초과되었습니다.")
        return False
    except Exception as exc:
        _set_status("error", "블록체인 서비스 시작 중 오류가 발생했습니다: {}".format(exc))
        return False


_IN_PROGRESS_STATES = {
    "starting_mailpit", "starting_node", "deploying", "starting_services", "starting_frontend", "opening_windows",
}


def start_enrollment_async():
    """이미 진행 중이 아니면 백그라운드 스레드로 블록체인 스택 기동을 시작."""
    with _lock:
        in_progress = _status["state"] in _IN_PROGRESS_STATES
    if in_progress:
        return get_status()

    _set_status("starting_node", "블록체인 덴탈보험 가입 절차를 준비하는 중입니다...")
    threading.Thread(target=ensure_blockchain_stack, daemon=True).start()
    return get_status()
