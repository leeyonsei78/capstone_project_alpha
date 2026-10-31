"""
poc_jev_thin_filer_compare.py — 씬파일러 신용보완 유연납입 심사(시나리오 17)를
기존 규칙기반 Python 로직과 Jev(TypeSafe AI) 판단으로 나란히 돌려 비교하는 1회성 PoC 스크립트.

⚠️ 이 스크립트도, 그리고 호출하는 tools/jev_flexible_payment_poc.py도 전부 실험용이다.
실제 챗봇(agents/orchestrator.py의 TOOLS/UNDERWRITING_TOOLS)에는 등록돼 있지 않으므로
실행해도 챗봇 동작에는 아무 영향이 없다. 롤백하려면 이 두 파일만 지우면 된다.

실행:
  cd insurance_agent
  python scripts/poc_jev_thin_filer_compare.py

사전 준비 (Jev 쪽 결과를 실제로 보려면):
  .env 에 AI_GATEWAY_API_KEY=<Vercel AI Gateway 키> 또는 TYPESAFE_API_KEY=<TypeSafe 직접 키> 추가
  (추가 pip 설치 불필요 — requests만 사용. 키가 없으면 기존 규칙기반 결과만 나오고
   Jev 쪽은 "미설정" 사유로 표시됨 — 크래시하지 않음)
"""
import json
import os
import sys

# [Windows cp949 대응] 이 스크립트는 이모지/em-dash 등 cp949 밖 문자를 콘솔에 직접 출력하는데,
# Windows 콘솔 기본 인코딩(cp949)은 이를 인코딩하지 못해 print() 자체가 죽는다(CLAUDE.md에 기록된
# 기존 web_app.py 이슈와 동일 원인 — crypto_trading/scheduler.py가 쓴 것과 같은 해법 적용).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # insurance_agent/ 루트

from dotenv import load_dotenv
load_dotenv()

from tools.health_credit_tool import assess_flexible_payment_eligibility
from tools.jev_flexible_payment_poc import assess_flexible_payment_eligibility_jev

# 기존 함수가 실제로 갈리는 경계 지점들 위주로 테스트 페르소나 구성
# (양호 / 씬파일러 / 저신용 / 저소득 / 복합 케이스 / 경계값 바로 위·아래)
TEST_CASES = [
    {"name": "양호(플래그 없음)",           "age": 45, "gender": "남", "credit_score": 780, "has_credit_history": True,  "monthly_income_10k": 500},
    {"name": "씬파일러(CB 이력 없음)",       "age": 28, "gender": "여", "credit_score": None, "has_credit_history": False, "monthly_income_10k": 300},
    {"name": "저신용(599점)",               "age": 50, "gender": "남", "credit_score": 599, "has_credit_history": True,  "monthly_income_10k": 400},
    {"name": "저신용 경계(600점, 미권장이어야 함)", "age": 50, "gender": "남", "credit_score": 600, "has_credit_history": True,  "monthly_income_10k": 400},
    {"name": "저소득(199만원)",              "age": 33, "gender": "여", "credit_score": 720, "has_credit_history": True,  "monthly_income_10k": 199},
    {"name": "소득 경계(200만원, 미권장이어야 함)", "age": 33, "gender": "여", "credit_score": 720, "has_credit_history": True,  "monthly_income_10k": 200},
    {"name": "복합(씬파일러+저소득)",         "age": 26, "gender": "남", "credit_score": None, "has_credit_history": False, "monthly_income_10k": 150},
]


def run_existing(case: dict) -> bool:
    result = json.loads(assess_flexible_payment_eligibility(
        age=case["age"], gender=case["gender"], credit_score=case["credit_score"],
        has_credit_history=case["has_credit_history"], monthly_income_10k=case["monthly_income_10k"],
    ))
    return result["flexible_payment_analysis"]["recommend_checkbox"]


def main():
    print("=" * 100)
    print("  씬파일러 신용보완 유연납입 심사 — 기존 규칙기반 vs Jev(TypeSafe AI) 비교 PoC")
    print("=" * 100)

    if not (os.environ.get("AI_GATEWAY_API_KEY") or os.environ.get("TYPESAFE_API_KEY")):
        print("[안내] AI_GATEWAY_API_KEY / TYPESAFE_API_KEY 둘 다 미설정 — Jev 쪽은 모든 케이스에서 '미설정' 사유만 출력됩니다.")
        print("       insurance_agent/.env 에 둘 중 하나를 추가한 뒤 다시 실행하세요.\n")

    rows = []
    mismatch_count = 0
    ok_count = 0
    total_ms = 0.0

    for case in TEST_CASES:
        existing_recommend = run_existing(case)
        jev_result = assess_flexible_payment_eligibility_jev(
            age=case["age"], gender=case["gender"], credit_score=case["credit_score"],
            has_credit_history=case["has_credit_history"], monthly_income_10k=case["monthly_income_10k"],
        )

        if jev_result["ok"]:
            ok_count += 1
            total_ms += jev_result["ms"]
            jev_recommend = jev_result["recommend"]
            match = "✅ 일치" if jev_recommend == existing_recommend else "⚠️ 불일치"
            if jev_recommend != existing_recommend:
                mismatch_count += 1
            jev_desc = (
                f"{jev_recommend} (확률 {jev_result['recommend_probability']:.2f}, "
                f"{jev_result['ms']}ms, 리스크등급={jev_result['credit_risk_legend']})"
            )
        else:
            match = "❌ 호출실패"
            jev_desc = jev_result["error"]

        rows.append((case["name"], existing_recommend, jev_desc, match))

    name_w = max(len(r[0]) for r in rows) + 2
    print(f"{'케이스':<{name_w}} {'기존(규칙기반)':<18} {'Jev 판단':<55} 비교")
    print("-" * 100)
    for name, existing, jev_desc, match in rows:
        print(f"{name:<{name_w}} {str(existing):<18} {jev_desc:<55} {match}")

    print("-" * 100)
    if ok_count > 0:
        print(f"Jev 호출 성공: {ok_count}/{len(TEST_CASES)}건 | 평균 응답시간: {total_ms/ok_count:.1f}ms | "
              f"기존 로직과 불일치: {mismatch_count}건")
    else:
        print("Jev 호출이 한 건도 성공하지 못했습니다 (API 키/SDK 설치 상태를 확인하세요).")
    print("=" * 100)


if __name__ == "__main__":
    main()
