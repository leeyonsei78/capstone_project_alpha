"""
챗봇 도구: 지갑 없이(가스리스) 블록체인 덴탈보험 간편 가입.

MetaMask 설치나 가스비(ETH) 마련이 부담스러운 고객을 위해, 회사가 대신
지갑을 만들고 가스비를 대납해 청약까지 대신 제출해준다 — 실제 청약/증권
소유권은 그 자리에서 새로 생성된 고객 전용 지갑 주소에 귀속된다(회사나
관리자 명의로 대리 가입하는 게 아님). 세부 구현은 tools/relay_wallet.py.
"""
from __future__ import annotations

import json

import blockchain_bridge
from tools import relay_wallet


def start_gasless_dental_enrollment(
    applicant_name: str,
    age: int,
    monthly_premium: int,
    coverage_limit: int,
    maturity_days: int,
    maturity_refund_rate: int,
    coverage_count: int,
    flexible_payment: bool = False,
    currency: str = "USDC",
) -> str:
    """지갑(MetaMask)이 없거나 가스비가 부담스러운 고객을 위해, 블록체인
    덴탈보험(dental_005)에 지갑 없이 곧바로 가입시킨다. 회사가 고객 전용
    지갑을 새로 만들고 가스비를 대납한 뒤, 그 지갑으로 청약을 제출한다.

    사용 시점: 고객이 "지갑이 없어요", "메타마스크 설치가 어려워요",
    "그냥 간편하게 가입하고 싶어요" 등 블록체인 지갑 준비에 부담을 느낄 때만
    제안하세요. 이미 지갑을 등록했거나 직접 서명하길 원하는 고객에게는
    기존 "⛓️ 블록체인 가입 시작" 버튼(MetaMask) 절차를 그대로 안내하세요.

    결과로 받은 지갑 주소는 고객에게 반드시 안내하고, 이후 조회 시
    get_blockchain_dental_status의 wallet_address 인자로 그대로 재사용할 수
    있다고 알려주세요 — 이 주소를 잃어버리면 본인 확인 수단이 없습니다.

    Args:
        applicant_name: 신청자 이름
        age: 나이
        monthly_premium: 월 보험료 (currency의 최소 단위 정수 — USDC는 6자리, KRW는 0자리)
        coverage_limit: 보장한도 (currency의 최소 단위 정수)
        maturity_days: 만기까지 일수
        maturity_refund_rate: 만기환급률 (0~100)
        coverage_count: 선택한 담보 개수 (2개=즉시자동승인, 7개 전체=즉시거절, 그 외=관리자심사대기)
        flexible_payment: 씬파일러 신용보완 유연납입 신청 여부 (기본 False)
        currency: "USDC" 또는 "KRW" (기본 USDC)
    """
    import socket
    try:
        with socket.create_connection(("127.0.0.1", blockchain_bridge.HARDHAT_PORT), timeout=1.0):
            pass
    except OSError:
        return json.dumps({
            "ok": False,
            "error": "블록체인 앱이 아직 실행 중이 아닙니다. 먼저 블록체인 가입 절차(노드 기동)를 시작해야 합니다.",
        }, ensure_ascii=False)

    result = relay_wallet.create_and_enroll(
        applicant_name=applicant_name,
        age=age,
        monthly_premium=monthly_premium,
        coverage_limit=coverage_limit,
        maturity_days=maturity_days,
        maturity_refund_rate=maturity_refund_rate,
        coverage_count=coverage_count,
        flexible_payment=flexible_payment,
        currency=currency,
    )
    return json.dumps(result, ensure_ascii=False)
