"""보험료 이상치 보정 — 실시간 수집/엑셀 파싱 오류로 비현실적인 월 보험료가 챗봇 답변에 그대로 나가는 것을 막는다.

예) 보험다모아 실시간 수집에서 라이나다이렉트치아보험Ⅲ의 월 보험료가 2,212,326원으로 들어온 적이 있음
(헤더 매칭 실패 시 '원'이 든 첫 칸을 보험료로 쓰는 폴백이 만기환급금 등 다른 칸을 집은 것으로 추정).
"""

# 보험 종류별 월 보험료 상식 상한(원). 상한을 넘으면 파싱 오류로 보고 상한값으로 낮춰 "확인 필요"를 붙인다.
MAX_PLAUSIBLE_MONTHLY = {
    "치아보험": 500_000,
}


def _is_dental(insurance_type: str, subtype: str = "") -> bool:
    return "치아" in (insurance_type or "") or "치아" in (subtype or "") or "덴탈" in (insurance_type or "")


def cap_premium(premium: int, insurance_type: str = "", subtype: str = "") -> tuple[int, bool]:
    """(보정된 보험료, 확인 필요 여부)"""
    if premium and _is_dental(insurance_type, subtype) and premium > MAX_PLAUSIBLE_MONTHLY["치아보험"]:
        return MAX_PLAUSIBLE_MONTHLY["치아보험"], True
    return premium, False


def format_premium(premium: int, needs_check: bool = False) -> str:
    """확인 필요면 '50만원(확인 필요)', 아니면 '12,345원'."""
    if needs_check:
        return f"{premium // 10000}만원(확인 필요)"
    return f"{premium:,}원"
