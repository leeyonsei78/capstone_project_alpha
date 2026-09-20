"""
블록체인 실시간 조회 도구 (덴탈보험 증권 + 대체투자 포지션).

blockchain-dental 스마트컨트랙트를 챗봇이 직접 읽어 자연어로 답변할 수 있게
한다. Python에 web3 등 새 의존성을 추가하지 않고, 이미 이 프로젝트에 있는
ethers.js 스택을 그대로 재사용하기 위해 blockchain-dental/scripts/query-*.js
(읽기 전용)를 subprocess로 호출한다.
"""

from __future__ import annotations
import json
import re
import socket
import subprocess

import blockchain_bridge

DENTAL_QUERY_SCRIPT = "scripts/query-policy.js"
ALTINVEST_QUERY_SCRIPT = "scripts/query-altinvest.js"
PARAMETRIC_QUERY_SCRIPT = "scripts/query-parametric.js"
WELLNESS_ORACLE_SCRIPT = "scripts/wellness-oracle.js"
_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _is_stack_running() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", blockchain_bridge.HARDHAT_PORT), timeout=1.0):
            return True
    except OSError:
        return False


def _run_query_script(script_path: str, wallet_address: str) -> str:
    """
    query-*.js 스크립트를 subprocess로 실행하고 마지막 줄의 JSON을 그대로
    반환한다. 지갑 주소 형식 검증·스택 실행 여부 확인은 호출자가 먼저 하고
    넘겨준다고 가정한다 (도구마다 에러 메시지 문구가 다를 수 있어 이 함수는
    그 부분엔 관여하지 않음).
    """
    try:
        result = subprocess.run(
            ["node", script_path, wallet_address],
            cwd=blockchain_bridge.BLOCKCHAIN_DIR,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
    except Exception as e:
        return json.dumps({"ok": False, "error": f"블록체인 조회 스크립트 실행 실패: {e}"}, ensure_ascii=False)

    stdout = (result.stdout or "").strip()
    if not stdout:
        detail = (result.stderr or "알 수 없는 오류").strip()[-500:]
        return json.dumps({"ok": False, "error": f"블록체인 조회 결과가 비어 있습니다: {detail}"}, ensure_ascii=False)

    try:
        # 스크립트는 항상 마지막 줄에 결과 JSON 한 줄을 출력한다 (혹시 모를 추가 로그 대비)
        data = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return json.dumps({"ok": False, "error": "블록체인 조회 결과를 해석하지 못했습니다."}, ensure_ascii=False)

    return json.dumps(data, ensure_ascii=False)


def _validate_wallet(wallet_address: str) -> str | None:
    """검증 실패 시 에러 JSON 문자열을, 통과하면 None을 반환한다."""
    if not wallet_address:
        return json.dumps({
            "ok": False,
            "error": (
                "지갑 주소가 없습니다. 사용자에게 MetaMask 지갑 주소(0x로 시작하는 42자)를 "
                "물어보거나, 화면의 '지갑 주소 등록' 입력창에 먼저 등록해달라고 안내하세요."
            ),
        }, ensure_ascii=False)

    if not _ADDRESS_RE.match(wallet_address):
        return json.dumps({
            "ok": False,
            "error": (
                "유효한 지갑 주소 형식이 아닙니다 (0x로 시작하는 42자 주소여야 합니다). "
                "개인키(Private Key)는 여기 입력하면 안 되며, 필요하지도 않습니다."
            ),
        }, ensure_ascii=False)

    if not _is_stack_running():
        return json.dumps({
            "ok": False,
            "error": (
                "블록체인 앱이 아직 실행 중이 아닙니다. 먼저 블록체인 가입 절차를 "
                "시작해 노드를 켜야 조회할 수 있다고 안내하세요."
            ),
        }, ensure_ascii=False)

    return None


def get_blockchain_dental_status(wallet_address: str = "") -> str:
    """
    특정 지갑 주소의 블록체인 덴탈보험 실시간 현황(증권/보험료납입/보험금청구/
    약관대출/만기환급)을 조회합니다. USDC 계약 기준입니다 — KRW는 별개의
    독립된 계약이라(서로 동기화되지 않음) 혼란을 피하기 위해 조회 대상에서
    제외합니다.

    Args:
        wallet_address: 조회할 MetaMask 지갑 주소(0x로 시작). 비어 있으면
            시스템에 등록된 값을 사용하며, 그것도 없으면 오류를 반환합니다.
    """
    err = _validate_wallet(wallet_address)
    if err:
        return err
    return _run_query_script(DENTAL_QUERY_SCRIPT, wallet_address)


def get_blockchain_altinvest_status(wallet_address: str = "") -> str:
    """
    특정 지갑 주소의 블록체인 대체투자(AltInvestmentFund) 포지션 실시간 현황을
    조회합니다. 펀드별 원금, 예상 잔액(이자 포함), 락업 해제 시각을 반환합니다.
    USDC 계약 기준입니다 — KRW는 별개의 독립된 계약이라(서로 동기화되지 않음)
    혼란을 피하기 위해 조회 대상에서 제외합니다. 이미 대체투자에 투자한
    사용자의 실제 포지션 조회 전용이며, 일반 상품 추천에는 사용하지 마세요.

    Args:
        wallet_address: 조회할 MetaMask 지갑 주소(0x로 시작). 비어 있으면
            시스템에 등록된 값을 사용하며, 그것도 없으면 오류를 반환합니다.
    """
    err = _validate_wallet(wallet_address)
    if err:
        return err
    return _run_query_script(ALTINVEST_QUERY_SCRIPT, wallet_address)


def get_blockchain_parametric_status(wallet_address: str = "") -> str:
    """
    특정 지갑 주소의 블록체인 파라메트릭(자동집행형) 보험 커버리지 실시간 현황을
    조회합니다. 청구 절차 없이 오라클이 조건 충족 여부를 판정해 자동으로
    지급/만료 처리하는 상품(항공편 지연·폭염특보 보장 등)의 가입 내역을
    반환합니다. USDC 계약 기준입니다 — KRW는 별개의 독립된 계약이라(서로
    동기화되지 않음) 혼란을 피하기 위해 조회 대상에서 제외합니다.

    Args:
        wallet_address: 조회할 MetaMask 지갑 주소(0x로 시작). 비어 있으면
            시스템에 등록된 값을 사용하며, 그것도 없으면 오류를 반환합니다.
    """
    err = _validate_wallet(wallet_address)
    if err:
        return err
    return _run_query_script(PARAMETRIC_QUERY_SCRIPT, wallet_address)


def apply_wellness_premium_adjustment(policy_id: int, new_amount: int, reason: str, currency: str = "USDC") -> str:
    """
    웰니스(건강개선) 연동 보험료 조정을 실제로 온체인에 반영합니다 — 오라클
    서명 트랜잭션이므로 조회 전용 함수(_run_query_script)와 달리 상태를
    변경합니다. 최초 보험료의 ±20% 범위를 벗어나면 컨트랙트가 거절합니다.

    Args:
        policy_id: 증권 ID
        new_amount: 새 보험료 (해당 통화의 최소 단위 정수 — USDC는 6자리, KRW는 0자리)
        reason: 조정 사유
        currency: "USDC" 또는 "KRW" (기본 USDC)
    """
    if not _is_stack_running():
        return json.dumps({
            "ok": False,
            "error": "블록체인 앱이 아직 실행 중이 아닙니다. 먼저 블록체인 가입 절차를 시작해 노드를 켜야 합니다.",
        }, ensure_ascii=False)

    try:
        result = subprocess.run(
            ["node", WELLNESS_ORACLE_SCRIPT, str(policy_id), str(new_amount), reason, currency],
            cwd=blockchain_bridge.BLOCKCHAIN_DIR,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
    except Exception as e:
        return json.dumps({"ok": False, "error": f"웰니스 보험료 조정 스크립트 실행 실패: {e}"}, ensure_ascii=False)

    stdout = (result.stdout or "").strip()
    if not stdout:
        detail = (result.stderr or "알 수 없는 오류").strip()[-500:]
        return json.dumps({"ok": False, "error": f"웰니스 보험료 조정 결과가 비어 있습니다: {detail}"}, ensure_ascii=False)

    try:
        data = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return json.dumps({"ok": False, "error": "웰니스 보험료 조정 결과를 해석하지 못했습니다."}, ensure_ascii=False)

    return json.dumps(data, ensure_ascii=False)
