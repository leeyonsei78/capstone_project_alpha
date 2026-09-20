"""
웰니스(건강개선) 연동 동적 보험료 — 블록체인 치아보험(dental_005) 가입자가
후속 건강검진 결과를 챗봇에 알려주면, 이전 체크인 대비 위험도가 개선된 경우
온체인 보험료를 실제로 할인 조정한다.

- 위험 점수 계산은 tools/health_risk_tool.py의 assess_health_risk를 그대로
  재사용한다 (로직 중복 금지 — 이 프로젝트 전반의 설계 원칙과 동일).
- 체크인 이력은 data/wellness_checkins.json에 지갑주소별로 append 저장한다
  (DB가 없는 이 프로젝트의 기존 JSON 캐시 관례, 예: insmarket_excel_cache.json).
- 실제 온체인 반영은 tools/blockchain_tool.py의 apply_wellness_premium_adjustment가
  blockchain-dental/scripts/wellness-oracle.js를 subprocess로 호출해 수행한다.
"""
from __future__ import annotations

import json
import os
import re
import time

from tools.health_risk_tool import assess_health_risk
from tools.blockchain_tool import get_blockchain_dental_status, apply_wellness_premium_adjustment

_CHECKIN_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "wellness_checkins.json"
)

MAX_DISCOUNT_PCT = 20        # DentalInsurance.sol의 baselinePremiumAmount 기준 ±20% 상한과 일치
IMPROVEMENT_THRESHOLD = 0.02  # 위험점수(0~1)가 이만큼 이상 개선돼야 보험료 조정 실행


def _load_checkins() -> dict:
    if not os.path.exists(_CHECKIN_PATH):
        return {}
    try:
        with open(_CHECKIN_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_checkins(data: dict) -> None:
    with open(_CHECKIN_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def submit_wellness_checkin(
    wallet_address: str,
    age: int,
    gender: str,
    height: float = None,
    weight: float = None,
    sbp: float = None,
    dbp: float = None,
    triglyceride: float = None,
    hdl: float = None,
    ggt: float = None,
    smoke: int = None,
    drink: int = None,
) -> str:
    """
    건강검진 결과를 새로 등록해 이전 체크인 대비 위험도가 개선됐는지 확인하고,
    개선폭이 충분하면 블록체인 치아보험(dental_005) 증권의 보험료를 실제로
    할인 조정합니다 (온체인 트랜잭션). 최초 체크인은 비교 기준만 저장하고
    조정하지 않습니다.

    Args:
        wallet_address: 지갑 주소(0x로 시작). 이 값으로 온체인 증권을 찾습니다.
        age, gender, height, weight, sbp, dbp, triglyceride, hdl, ggt, smoke, drink:
            건강검진 수치 (assess_health_risk와 동일 의미)
    """
    if not wallet_address:
        return json.dumps({"ok": False, "error": "지갑 주소가 필요합니다."}, ensure_ascii=False)

    risk_raw = assess_health_risk(
        age=age, gender=gender, height=height, weight=weight,
        sbp=sbp, dbp=dbp, triglyceride=triglyceride, hdl=hdl, ggt=ggt,
        smoke=smoke, drink=drink, include_products=False,
    )
    risk_data = json.loads(risk_raw)
    new_score = risk_data["risk_assessment"]["risk_score"]

    checkins = _load_checkins()
    history = checkins.get(wallet_address, [])
    previous = history[-1] if history else None

    history.append({"timestamp": int(time.time()), "risk_score": new_score, "age": age, "gender": gender})
    checkins[wallet_address] = history
    _save_checkins(checkins)

    if previous is None:
        return json.dumps({
            "ok": True,
            "adjusted": False,
            "message": "최초 체크인이 등록되었습니다. 다음 체크인부터 위험도 개선 여부를 비교해 보험료 조정 여부를 판단합니다.",
            "riskScore": new_score,
        }, ensure_ascii=False)

    improvement = previous["risk_score"] - new_score  # 양수면 개선(위험 감소)
    if improvement < IMPROVEMENT_THRESHOLD:
        return json.dumps({
            "ok": True,
            "adjusted": False,
            "message": "이전 체크인 대비 위험도 개선폭이 보험료 조정 기준에 못 미쳐 이번엔 조정하지 않습니다.",
            "previousRiskScore": previous["risk_score"],
            "riskScore": new_score,
        }, ensure_ascii=False)

    status_raw = get_blockchain_dental_status(wallet_address)
    status = json.loads(status_raw)
    if not status.get("ok") or not status.get("policies"):
        return json.dumps({
            "ok": False,
            "error": "온체인 블록체인 치아보험 증권을 찾을 수 없어 보험료를 조정할 수 없습니다. "
                     "먼저 지갑 주소를 등록하고 블록체인 치아보험에 가입했는지 확인해주세요.",
        }, ensure_ascii=False)

    policy = status["policies"][0]  # 지갑당 블록체인 치아보험은 보통 1건
    policy_id = policy["policyId"]

    # 할인율: 위험도 개선폭에 비례하되 컨트랙트의 ±20% 상한을 넘지 않도록 제한
    discount_pct = max(1, min(MAX_DISCOUNT_PCT, round(improvement * 100)))

    current_str = policy["monthlyPremium"]  # 예: "$50.00" 또는 "₩70,000"
    is_krw = current_str.strip().startswith("₩")
    current_num = float(re.sub(r"[^0-9.]", "", current_str))
    unit = 1 if is_krw else 1_000_000
    new_amount = int(round(current_num * (100 - discount_pct) / 100 * unit))
    currency = "KRW" if is_krw else "USDC"

    reason = f"웰니스 체크인 위험도 개선 (risk_score {previous['risk_score']:.3f} -> {new_score:.3f})"
    result_raw = apply_wellness_premium_adjustment(policy_id, new_amount, reason, currency)
    result = json.loads(result_raw)

    if not result.get("ok"):
        return json.dumps({
            "ok": False,
            "error": f"위험도는 개선되었지만 온체인 보험료 조정에 실패했습니다: {result.get('error')}",
        }, ensure_ascii=False)

    return json.dumps({
        "ok": True,
        "adjusted": True,
        "policyId": policy_id,
        "currency": currency,
        "discountPct": discount_pct,
        "previousRiskScore": previous["risk_score"],
        "newRiskScore": new_score,
        "oldPremium": current_str,
        "txHash": result.get("txHash"),
        "message": f"건강 개선이 확인되어 보험료가 {discount_pct}% 할인 조정되었습니다 (온체인 반영 완료).",
    }, ensure_ascii=False)
