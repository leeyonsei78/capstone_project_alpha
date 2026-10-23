"""
보험 영역 시나리오 18 — 종합 병력(질병·치료이력·수술) 정밀 심사.

기존 assess_* 도구들(cancer_survivor_tool.py 등)은 "암 완치자", "용종 절제" 처럼
병력을 한 건씩 미리 정해둔 시나리오 하나로만 다룬다. 실제 상담에서는 고객이
"고혈압 치료 중이고 2년 전에 담낭 수술도 받았어요"처럼 여러 질병·치료·수술 이력을
한 번에 말하는 경우가 많아, 이를 종합해서 심사하는 전용 도구가 없었다 — 이 도구가
그 공백을 메운다.

점수 체계는 data/credit_model.py의 assess_adverse_selection_risk(AASI)와 동일한
가산점 + 4단계 밴드(정상<15, 경계15~34, 중위험35~59, 고위험≥60) 방식을 그대로
재사용한다 — run_underwriting_review 서브에이전트가 최종적으로 제출하는
submit_underwriting_decision의 tier 값(정상/경계/중위험/고위험)과 밴드 이름이
그대로 일치해야, 서브에이전트가 이 도구의 결과를 보고 바로 tier를 판단할 수 있다.

⚠️ 윤리 원칙: 질병·치료·수술 이력에 따라 보험료 할증·인수 거절 판단이 달라지는 것은
  보험 언더라이팅의 정상적인 기능(동일 위험집단 내 형평성)이며, 건강 데이터를 신용·대출
  영역에서 "가산점으로만 쓰고 감점 금지"하는 health_credit_tool.py 등의 원칙과는 다르다.
  다만 다음은 지킨다 — ① 과거에 완치되어 수년 지난 경미한 이력만으로 과도하게 불리한
  판정을 내리지 않도록 시간 경과·완치 여부를 반영해 점수를 낮춘다, ② 최종 처리 경로
  (route)는 이 도구가 아니라 코드의 tier→route 매핑이 강제하므로, "고위험"이어도 자동
  거절이 아니라 항상 사람(전문 언더라이터)의 수동심사로만 이어진다.
"""
from __future__ import annotations

import json

# ── 치료가 지속적이고 부담이 큰 치료 유형 (고위험 가산) ──────────────────
_HIGH_BURDEN_TREATMENTS = {
    "항암치료", "방사선치료", "투석", "인공신장", "장기이식", "산소치료", "인공호흡",
}

_DISEASE_STATUS_POINTS = {
    "완치": 5,
    "관찰중": 10,
    "치료중": None,  # severity로 분기
}
_SEVERITY_POINTS = {"경증": 12, "중등증": 20, "중증": 35}

_SURGERY_OUTCOME_POINTS = {"완치": 2, "경과관찰": 10, "합병증": 25}


def _score_disease(d: dict) -> tuple[int, str]:
    name = d.get("name", "미상 질환")
    status = d.get("status", "치료중")
    years_ago = d.get("diagnosed_years_ago", 0) or 0
    severity = d.get("severity", "중등증")

    if status == "완치":
        points = 2 if years_ago >= 5 else _DISEASE_STATUS_POINTS["완치"]
        note = f"{name} — 완치({years_ago}년 경과)"
    elif status == "관찰중":
        points = _DISEASE_STATUS_POINTS["관찰중"]
        note = f"{name} — 관찰중"
    else:  # 치료중
        points = _SEVERITY_POINTS.get(severity, _SEVERITY_POINTS["중등증"])
        note = f"{name} — 치료중({severity})"
    return points, note


def _score_surgery(s: dict) -> tuple[int, str]:
    name = s.get("name", "미상 수술")
    years_ago = s.get("years_ago", 0) or 0
    outcome = s.get("outcome", "완치")

    points = _SURGERY_OUTCOME_POINTS.get(outcome, _SURGERY_OUTCOME_POINTS["완치"])
    if outcome == "완치" and years_ago < 2:
        points = 6  # 완치됐지만 경과 기간이 짧아 소폭 가산
    note = f"{name} — {years_ago}년 전, {outcome}"

    if years_ago < 0.5:
        points += 10
        note += " (최근 6개월 이내 수술 — 회복 모니터링 필요)"
    return points, note


def _score_treatment(t: dict) -> tuple[int, str]:
    ttype = t.get("type", "약물치료")
    ongoing = t.get("ongoing", True)
    if not ongoing:
        return 0, f"{ttype} — 종료됨(현재 영향 없음)"
    points = 30 if ttype in _HIGH_BURDEN_TREATMENTS else 8
    note = f"{ttype} — 현재 진행중"
    return points, note


def assess_medical_history(
    age: int,
    gender: str,
    diseases: list[dict] | None = None,
    surgeries: list[dict] | None = None,
    treatments: list[dict] | None = None,
) -> str:
    """
    시나리오 18 — 질병·치료이력·수술 정보를 종합해 계약심사 위험도를 산출.

    AASI(assess_adverse_selection_risk)와 동일한 가산점+4단계 밴드 체계를 쓰므로,
    이 결과의 band를 submit_underwriting_decision의 tier에 그대로 반영할 수 있다.

    Args:
        age: 나이
        gender: '남' 또는 '여'
        diseases: 질병 이력 목록. 각 항목 예:
            {"name": "고혈압", "status": "치료중", "diagnosed_years_ago": 3, "severity": "경증"}
            status는 '완치'/'관찰중'/'치료중' 중 하나, severity는 '경증'/'중등증'/'중증' 중 하나
            (status가 '치료중'일 때만 의미 있음).
        surgeries: 수술 이력 목록. 각 항목 예:
            {"name": "담낭절제술", "years_ago": 2, "outcome": "완치"}
            outcome은 '완치'/'경과관찰'/'합병증' 중 하나.
        treatments: 현재 진행 중인 치료(투약·시술 등) 목록. 각 항목 예:
            {"type": "항암치료", "ongoing": true}
            type이 항암치료/방사선치료/투석/인공신장/장기이식/산소치료/인공호흡이면
            고부담 치료로 간주해 가산점이 커짐.
    """
    diseases = diseases or []
    surgeries = surgeries or []
    treatments = treatments or []

    score = 0
    reasons: list[str] = []

    for d in diseases:
        pts, note = _score_disease(d)
        score += pts
        reasons.append(f"{note} (+{pts}점)" if pts else note)

    for s in surgeries:
        pts, note = _score_surgery(s)
        score += pts
        reasons.append(f"{note} (+{pts}점)" if pts else note)

    for t in treatments:
        pts, note = _score_treatment(t)
        score += pts
        if pts:
            reasons.append(f"{note} (+{pts}점)")
        else:
            reasons.append(note)

    item_count = len(diseases) + len(surgeries)
    if item_count >= 3:
        score += 10
        reasons.append(f"질병·수술 이력 {item_count}건 동시 보유 — 복합 이환(comorbidity) 가산 (+10점)")

    if score >= 60:
        band = "고위험"
        recommendation = "정밀 심사 필요 — 의료 소견서·진단서 추가 제출 요청, 전문 언더라이터 수동심사"
    elif score >= 35:
        band = "중위험"
        recommendation = "보완 정보 요청 권장 — 최근 치료 경과·진단서 등 확인 후 재심사"
    elif score >= 15:
        band = "경계"
        recommendation = "조건부 인수 가능 — 할증 또는 일부 부담보 조건 검토, 자동승인 후 사후 샘플감사"
    else:
        band = "정상"
        recommendation = "표준 심사 진행 — 특이 병력 없음 또는 영향 미미"

    if not reasons:
        reasons.append("보고된 질병·치료·수술 이력 없음")

    return json.dumps({
        "scenario": "시나리오 18 — 종합 병력(질병·치료이력·수술) 정밀 심사",
        "persona_summary": (
            f"{age}세 {gender}성 / 질병 {len(diseases)}건 · 수술 {len(surgeries)}건 · "
            f"진행중 치료 {sum(1 for t in treatments if t.get('ongoing', True))}건"
        ),
        "before": "병력 신고 즉시 과거 질병 코드 유무만으로 일률 할증·거절",
        "after": f"항목별 가산점 종합 {score}점({band}) → {recommendation}",
        "medical_risk_assessment": {
            "score": score,
            "band": band,
            "recommendation": recommendation,
            "items": reasons,
        },
        "impact": {
            "consumer": "병력이 있어도 완치 여부·경과 기간을 반영해 과도한 일률 할증을 피함",
            "insurer": "복합 이환·최근 수술 같은 실제 리스크 요인을 놓치지 않고 선별 인수",
        },
    }, ensure_ascii=False, indent=2)
