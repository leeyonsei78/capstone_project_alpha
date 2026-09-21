"""
가스리스(경량 Relayer) 온보딩 — 고객이 MetaMask 설치나 가스비(ETH) 마련 없이
챗봇 대화만으로 블록체인 덴탈보험에 가입할 수 있게 한다.

Python에 web3 등 새 의존성을 추가하지 않고, 이미 있는 ethers.js 스택을 그대로
재사용하기 위해 blockchain-dental/scripts/relay-wallet.js를 subprocess로
호출한다 (tools/blockchain_tool.py의 query-*.js 재사용 패턴과 동일).

호출 1회로 완결되는 흐름이라(세션 간에 지갑을 이어 쓸 필요가 없음) 별도의
"세션 ID → 지갑" 매핑은 두지 않는다 — 매 가입 요청마다 새 커스터디얼 지갑을
만들고, 그 자리에서 곧바로 청약까지 제출한 뒤 새로 생긴 지갑 주소를 고객에게
알려준다(이후 조회는 그 주소로 get_blockchain_dental_status를 부르면 됨).
data/relay_wallets.json에는 감사(audit) 목적으로만 기록을 남긴다.
"""
from __future__ import annotations

import json
import os
import subprocess
import time

import blockchain_bridge

RELAY_SCRIPT = "scripts/relay-wallet.js"
_WALLETS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "relay_wallets.json")


def _load() -> list[dict]:
    if not os.path.exists(_WALLETS_PATH):
        return []
    try:
        with open(_WALLETS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(records: list[dict]) -> None:
    with open(_WALLETS_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def _run_node(subcommand: str, payload: dict) -> dict:
    result = subprocess.run(
        ["node", RELAY_SCRIPT, subcommand],
        cwd=blockchain_bridge.BLOCKCHAIN_DIR,
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    stdout = (result.stdout or "").strip()
    if not stdout:
        detail = (result.stderr or "알 수 없는 오류").strip()[-500:]
        return {"ok": False, "error": f"relay-wallet.js({subcommand}) 실행 결과가 비어 있습니다: {detail}"}
    try:
        return json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return {"ok": False, "error": f"relay-wallet.js({subcommand}) 결과를 해석하지 못했습니다."}


def create_and_enroll(
    applicant_name: str,
    age: int,
    monthly_premium: int,
    coverage_limit: int,
    maturity_days: int,
    maturity_refund_rate: int,
    coverage_count: int,
    flexible_payment: bool = False,
    currency: str = "USDC",
) -> dict:
    """새 커스터디얼 지갑을 생성·가스비 충전한 뒤, 그 지갑으로 곧바로 청약을
    제출한다. 실패 시 어느 단계에서 실패했는지 구분해 반환한다."""
    created = _run_node("create", {})
    if not created.get("ok"):
        return {"ok": False, "step": "wallet_create", "error": created.get("error", "지갑 생성 실패")}

    applied = _run_node("apply", {
        "privateKey": created.get("privateKey"),
        "applicantName": applicant_name,
        "age": age,
        "monthlyPremium": monthly_premium,
        "coverageLimit": coverage_limit,
        "maturityDays": maturity_days,
        "maturityRefundRate": maturity_refund_rate,
        "coverageCount": coverage_count,
        "flexiblePayment": flexible_payment,
        "currency": currency,
    })
    if not applied.get("ok"):
        return {
            "ok": False, "step": "submit_application", "error": applied.get("error", "청약 제출 실패"),
            "address": created["address"],
            "note": "지갑은 생성되어 가스비가 충전된 상태입니다 — 이 주소로 재시도할 수 있습니다.",
        }

    records = _load()
    records.append({
        "address": created["address"],
        "applicant_name": applicant_name,
        "currency": currency,
        "created_at": int(time.time()),
        "app_id": applied.get("application", {}).get("appId") if applied.get("application") else None,
    })
    _save(records)

    return {
        "ok": True,
        "address": created["address"],
        "txHash": applied.get("txHash"),
        "application": applied.get("application"),
    }
