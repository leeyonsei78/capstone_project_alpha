"""
가상자산 투자성향 진단 도구 (개인별 투자자문 ②단계 — 등급 진단).

health_credit_tool.py의 "질문 → 점수 → 등급" 패턴을 그대로 재사용한 점수제 진단.
학습된 ML 모델이 아니라 health_credit_tool.py의 assess_health_credit()과 동일한
수준의 규칙 기반 가중합 — 여기서는 "위험 감수 성향"을 등급화해 실제 개인별
자동매매(crypto_trading/scheduler.py의 멀티테넌트 처리, data/personal_bots.json)에
연결할 때 티어별 기본 종목·매수금액(config.py의 RISK_TIER_PRESETS)을 정한다.

이 진단 자체는 API 키를 받지 않는다 — 실제 등록은 챗봇이 아니라 화면의 "개인별
가상자산 자동매매" 패널(/api/crypto/personal/register)에서 고객이 직접 본인의
업비트 Open API 키를 입력해야 한다. 등록 직후에는 항상 페이퍼(DRY_RUN) 상태이며,
실거래는 그 패널의 별도 "실거래 승인" 버튼(/api/crypto/personal/approve, confirm=true
필수)을 고객이 직접 눌러야만 켜진다 — 챗봇 도구로는 승인을 켤 수 없도록 의도적으로
분리했다(사용자 요청: "개인별 자동매매는 사용자의 승인으로 변경").
"""
from __future__ import annotations

import json


def assess_crypto_investment_profile(
    age: int,
    investment_horizon_years: int = 3,
    loss_tolerance: str = "중",
    investment_experience: str = "중",
    monthly_investable_krw: int = 100000,
    income_stability: str = "중",
) -> str:
    """
    간단한 문답으로 가상자산 투자성향(리스크 티어)을 진단합니다. '나 코인 투자 어느 정도가
    맞을까?', '투자성향 진단해줘', '공격적으로 해도 될까?' 같은 요청에 사용하세요.

    Args:
        age: 나이
        investment_horizon_years: 투자 목표 기간(년). 길수록 변동성을 감수할 여력이 큼
        loss_tolerance: 원금손실 감수 정도 — '상'(상당 부분 손실 감수) / '중' / '하'(원금보전 우선)
        investment_experience: 가상자산 투자 경험 — '상'(경험 많음) / '중'(약간 있음) / '하'(처음)
        monthly_investable_krw: 월 투자 가능 금액(원)
        income_stability: 소득 안정성 — '상'(정규소득 안정) / '중' / '하'(불안정)
    """
    horizon_pts = min(investment_horizon_years * 5, 25)
    loss_pts = {"상": 40, "중": 25, "하": 10}.get(loss_tolerance, 25)
    exp_pts = {"상": 20, "중": 12, "하": 5}.get(investment_experience, 12)
    income_pts = {"상": 15, "중": 8, "하": 0}.get(income_stability, 8)

    total_score = horizon_pts + loss_pts + exp_pts + income_pts  # 최대 100점

    if total_score >= 70:
        tier = "공격투자형"
        tier_desc = "변동성이 큰 소형 코인 비중까지 포함해 적극적으로 회전매매하는 전략에 적합"
        recommended_tickers = ["KRW-BTC", "KRW-ETH", "KRW-SOL", "KRW-XRP"]
        recommended_buy_amount_krw = min(monthly_investable_krw, 15000)
    elif total_score >= 40:
        tier = "중립형"
        tier_desc = "대형 코인 중심으로 기본 설정(4종목, 표준 손절·익절 폭)을 그대로 적용하는 전략에 적합"
        recommended_tickers = ["KRW-BTC", "KRW-ETH", "KRW-SOL"]
        recommended_buy_amount_krw = min(monthly_investable_krw, 10000)
    else:
        tier = "안정추구형"
        tier_desc = "BTC·ETH 등 대형 코인 위주로, 손절 폭을 좁히고 매매 빈도를 낮추는 보수적 전략에 적합"
        recommended_tickers = ["KRW-BTC", "KRW-ETH"]
        recommended_buy_amount_krw = min(monthly_investable_krw, 5000)

    return json.dumps({
        "tool": "assess_crypto_investment_profile",
        "persona_summary": f"{age}세 / 투자기간 {investment_horizon_years}년 / 손실감수 {loss_tolerance} / 경험 {investment_experience}",
        "score_breakdown": {
            "투자기간_점수": horizon_pts,
            "손실감수_점수": loss_pts,
            "투자경험_점수": exp_pts,
            "소득안정성_점수": income_pts,
            "총점_100점_만점": total_score,
        },
        "risk_tier": tier,
        "risk_tier_description": tier_desc,
        "reference_only_config": {
            "note": "실제로 개인별 자동매매를 등록하면 이 등급에 맞는 종목·매수금액이 자동 적용됩니다.",
            "recommended_tickers": recommended_tickers,
            "recommended_buy_amount_krw": recommended_buy_amount_krw,
        },
        "how_to_start": (
            "실제로 시작하려면 화면의 '개인별 가상자산 자동매매' 패널에서 본인의 업비트 "
            "Open API 키(access_key/secret_key)를 직접 등록하세요 — 챗봇이 대신 등록해줄 "
            "수 없습니다. 등록 직후에는 항상 페이퍼(모의, DRY_RUN) 상태이며, 실제 주문이 "
            "나가려면 그 패널의 별도 '실거래 승인' 버튼을 고객 본인이 직접 눌러야 합니다."
        ),
    }, ensure_ascii=False, indent=2)
