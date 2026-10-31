"""
jev_flexible_payment_poc.py — 시나리오 17(씬파일러 신용보완 유연납입 적격 심사)을
TypeSafe AI의 Jev(System One) 모델로 시범 전환해보는 PoC 전용 모듈.

⚠️ 실험용 — orchestrator.py의 TOOLS/UNDERWRITING_TOOLS 어디에도 등록되어 있지 않다.
실제 챗봇(assess_flexible_payment_eligibility, health_credit_tool.py)은 전혀 건드리지
않았으므로, 이 파일 + scripts/poc_jev_thin_filer_compare.py 두 개를 지우기만 하면
그대로 롤백된다.

접속 경로 2가지 (둘 다 완전히 동일한 요청/응답 JSON 스키마 — Vercel AI Gateway가
"TypeSafe request and response shapes"를 그대로 구현):
  1) Vercel AI Gateway 경유 (현재 이 프로젝트가 쓰는 경로 — TypeSafe 자체 신규가입이
     2026-09-22부터 일시 중단된 상태라 이쪽이 실질적으로 유일하게 열려있는 경로였음)
     .env: AI_GATEWAY_API_KEY=...
     base_url: https://ai-gateway.vercel.sh/typesafe, model: "typesafe-ai/jev"
  2) TypeSafe 직접 (계정이 이미 있는 경우)
     .env: TYPESAFE_API_KEY=...
     base_url: https://api.typesafe.ai, model: "jev-latest"

SDK(typesafe-sdk) 대신 순수 requests로 직접 호출한다 — 신규 SDK라 응답 객체의 정확한
속성 구조가 문서로 확인이 덜 됐던 반면, 이 raw HTTP 스키마는 Vercel 공식 문서에서
필드명까지 정확히 확인됐다(추가 의존성도 필요 없음 — requirements.txt에 이미 있는
requests만 사용).
"""
from __future__ import annotations

import os
import time
from typing import Optional

import requests

_TIMEOUT_SEC = 20


def _resolve_endpoint():
    """AI_GATEWAY_API_KEY(Vercel 경유)를 우선하고, 없으면 TYPESAFE_API_KEY(직접)를 쓴다."""
    gateway_key = os.environ.get("AI_GATEWAY_API_KEY")
    if gateway_key:
        return {
            "url": "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
            "headers": {"Authorization": f"Bearer {gateway_key}", "Content-Type": "application/json"},
            "model": "typesafe-ai/jev",
        }
    typesafe_key = os.environ.get("TYPESAFE_API_KEY")
    if typesafe_key:
        return {
            "url": "https://api.typesafe.ai/v1/systemone",
            "headers": {"Authorization": f"Bearer {typesafe_key}", "Content-Type": "application/json"},
            "model": "jev-latest",
        }
    return None


def assess_flexible_payment_eligibility_jev(
    age: int,
    gender: str,
    credit_score: Optional[int] = None,
    has_credit_history: bool = True,
    monthly_income_10k: Optional[int] = None,
) -> dict:
    """
    기존 health_credit_tool.assess_flexible_payment_eligibility()와 동일한 입력을 받아,
    "유연납입 신청을 권장할지" 판단 부분만 Jev(Noul + Score 질문)로 대체한 버전.

    반환: {"ok": True, "ms": <응답시간 ms>, "recommend": bool, "recommend_probability": float,
           "credit_risk_score": float, "credit_risk_legend": {...}, "credit_risk_confidence": float,
           "usage": {...}}
        또는 실패 시 {"ok": False, "error": "..."}
    """
    endpoint = _resolve_endpoint()
    if endpoint is None:
        return {
            "ok": False,
            "error": "AI_GATEWAY_API_KEY 또는 TYPESAFE_API_KEY 둘 다 미설정 — "
                     "insurance_agent/.env에 하나를 추가해야 함",
        }

    state = {
        "age": age,
        "gender": gender,
        "credit_score": credit_score,
        "has_credit_history": has_credit_history,
        "monthly_income_10k": monthly_income_10k,
        "product_context": (
            "블록체인 치아보험(dental_005)의 '씬파일러 신용보완 유연납입' 옵션 — 가입 후 "
            "연체가 발생해도 2회차 납입부터는 해지환급금 한도 내에서 약관대출로 자동 대환 "
            "처리되어 증권이 실효되지 않는 기능. 신용 사각지대(씬파일러)이거나 저신용·소득이 "
            "불안정한 신청자에게 권장해야 한다."
        ),
    }

    payload = {
        "model": endpoint["model"],
        "state": state,
        "questions": {
            "recommend_flexible_payment": {
                "type": "noul",
                "instructions": "이 신청자에게 유연납입(신용보완 자동대환) 옵션 가입을 권장해야 하는가?",
                "criteria": {
                    "true": "신용 이력이 없거나(씬파일러), 신용점수가 낮거나(600 미만), 월 소득이 "
                            "불안정(200만원 미만)해 연체 위험이 있어 유연납입을 권장해야 함",
                    "false": "신용도가 양호하고 소득이 안정적이어서 일반 자동납부만으로 충분함",
                },
            },
            "credit_risk_level": {
                "type": "score",
                "instructions": "이 신청자의 신용/소득 리스크 수준은?",
                "criteria": ["낮음(우량)", "보통", "높음(신용 사각지대)"],
            },
        },
    }

    t0 = time.time()
    try:
        resp = requests.post(endpoint["url"], headers=endpoint["headers"], json=payload, timeout=_TIMEOUT_SEC)
    except requests.RequestException as e:
        return {"ok": False, "error": f"네트워크 오류: {type(e).__name__}: {e}"}
    ms = round((time.time() - t0) * 1000, 1)

    if resp.status_code != 200:
        return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:300]}"}

    try:
        data = resp.json()
        answers = data["answers"]
        noul_answer = answers["recommend_flexible_payment"]
        score_answer = answers["credit_risk_level"]
        recommend_probability = noul_answer["noul"]
        result = {
            "ok": True,
            "ms": ms,
            "recommend": bool(recommend_probability >= 0.5),
            "recommend_probability": recommend_probability,
            "credit_risk_score": score_answer["score"],
            "credit_risk_legend": score_answer.get("legend"),
            "credit_risk_confidence": score_answer.get("confidence"),
            "usage": data.get("usage"),
        }
    except (KeyError, ValueError, TypeError) as e:
        return {"ok": False, "error": f"응답 파싱 실패({type(e).__name__}: {e}) — 원본: {resp.text[:500]}"}

    return result
