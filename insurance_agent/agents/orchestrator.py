"""
보험 상담 오케스트레이터 에이전트 (v2 - 벡터 RAG + FSS API + 덴탈/암보험)

다중 에이전트 파이프라인:
  1. Orchestrator (gpt-4o): 사용자 의도 파악 + 도구 호출 (TOOLS, 11종)
  2. Sub-agent (gpt-4o): 개인화 추천 생성 (get_personalized_recommendation)
  3. Sub-agent (gpt-4o): 언더라이팅 정밀심사 (run_underwriting_review → UNDERWRITING_TOOLS, 17종)
     자체 tool-calling 루프로 assess_* 도구를 직접 선택·실행 후 결과를 종합해 반환한다.
  4. 도구들: 상품 검색/비교/견적, 벡터 RAG 지식 검색, FSS API 실시간 조회
"""

from __future__ import annotations

import json
import re as _re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import openai
from tools.product_tools import (
    search_products,
    compare_products,
    get_premium_estimate,
    fetch_fss_realtime,
)
from tools.rag_tools import retrieve_insurance_knowledge
from tools.web_search_tool import search_web
from tools.web_fetch_tool import fetch_webpage
from tools.excel_search_tool import search_insmarket_products
from tools.credit_score_tool import get_credit_score
from tools.health_risk_tool import assess_health_risk
from tools.cancer_risk_tool import assess_cancer_risk
from tools.cancer_survivor_tool import (
    assess_cancer_survivor,
    assess_low_risk_discount,
    assess_pacs_no_extra,
    assess_dynamic_discount,
    assess_chronic_disease_rate,
    assess_healthy_body_discount,
    assess_polyp_removal_eligibility,
)
from tools.health_credit_tool import (
    assess_health_credit,
    assess_sme_health_loan,
    assess_rental_approval,
    assess_early_care,
    assess_default_prevention,
    assess_healthy_body_loan,
    assess_health_secured_loan,
    assess_adverse_selection_score,
    assess_thin_filer_adverse_selection,
    assess_flexible_payment_eligibility,
)
from tools.blockchain_tool import (
    get_blockchain_dental_status, get_blockchain_altinvest_status, get_blockchain_parametric_status,
)
from tools.wellness_tool import submit_wellness_checkin
from tools.crypto_reserve_tool import get_crypto_reserve_status
from tools.crypto_risk_tool import assess_crypto_investment_profile
from tools.gasless_enrollment_tool import start_gasless_dental_enrollment

# ───────────────────────────────────────────
# 도구 정의 (OpenAI 형식)
# ───────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_insurance_products",
            "description": (
                "보험 상품을 검색합니다. 보험 유형, 예산, 나이, 필요 조건으로 필터링 가능합니다. "
                "사용자가 보험 상품을 물어보거나 추천을 요청할 때 사용하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "insurance_type": {
                        "type": "string",
                        "enum": ["생명보험", "실손의료보험", "덴탈보험"],
                        "description": "보험 유형",
                    },
                    "budget_min": {"type": "integer", "description": "월 최소 보험료 (원)"},
                    "budget_max": {"type": "integer", "description": "월 최대 보험료 (원)"},
                    "age": {"type": "integer", "description": "가입자 나이"},
                    "needs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "필요 태그. 예: ['임플란트', '비갱신', '면역항암', '저렴']",
                    },
                    "subtype": {
                        "type": "string",
                        "description": "세부 유형. 예: '종신보험', '정기보험', '4세대실손', '암보험', '치과보험'",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_insurance_products",
            "description": (
                "2~4개의 보험 상품을 상세 비교합니다. "
                "검색 결과에서 특정 상품들을 비교할 때 사용하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "비교할 상품 ID 목록. 예: ['dental_001', 'dental_002']",
                    },
                },
                "required": ["product_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_premium_estimate",
            "description": (
                "특정 보험 상품의 예상 보험료를 나이와 성별에 따라 조회합니다. "
                "사용자가 특정 상품의 보험료가 얼마인지 물어볼 때 사용하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string", "description": "상품 ID"},
                    "age": {"type": "integer", "description": "나이"},
                    "gender": {"type": "string", "enum": ["남", "여"], "description": "성별"},
                },
                "required": ["product_id", "age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "retrieve_insurance_knowledge",
            "description": (
                "보험 관련 지식을 시맨틱 검색으로 조회합니다 (ChromaDB 벡터 검색). "
                "보험 용어, 종류 비교, 가입 가이드, 덴탈/암보험 상세 안내, "
                "절약 방법 등 일반적인 보험 지식이 필요할 때 사용하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "검색할 질문 또는 키워드. "
                        "예: '임플란트 치과보험 대기기간', '암보험 면역항암 보장', '실손보험 3세대 4세대 차이'",
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "반환할 문서 수 (기본 2, 최대 3)",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_fss_realtime_products",
            "description": (
                "금융감독원(FSS) API에서 실시간 보험 상품 정보를 조회합니다. "
                "최신 공시 데이터나 연금저축보험 상품이 필요할 때 사용하세요. "
                "FSS_API_KEY가 없으면 자동으로 로컬 데이터로 전환됩니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_type": {
                        "type": "string",
                        "enum": ["annuity"],
                        "description": "조회 유형: 'annuity' (연금저축보험)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_insmarket_products",
            "description": (
                "보험다모아 공시 엑셀 데이터에서 보험 상품을 검색합니다. "
                "실제 보험사별 보험료와 보장 내용이 담긴 공식 데이터입니다. "
                "간병보험·치매보험·종신보험·치아보험·실손보험·질병보험·상해보험·저축보험 등 "
                "로컬 DB에 없는 상품을 검색할 때 이 도구를 우선 사용하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "insurance_type": {
                        "type": "string",
                        "enum": ["실손의료보험", "간병·치매보험", "치아보험", "종신보험", "질병보험", "상해보험", "저축보험"],
                        "description": "보험 유형",
                    },
                    "company": {
                        "type": "string",
                        "description": "보험사 이름 일부 (예: '롯데', '한화', 'DB', '하나')",
                    },
                    "gender": {
                        "type": "string",
                        "enum": ["남", "여"],
                        "description": "성별",
                    },
                    "age_group": {
                        "type": "string",
                        "enum": ["30대", "40대", "50대", "60대"],
                        "description": "연령대",
                    },
                    "keyword": {
                        "type": "string",
                        "description": "상품명·보장명 내 검색 키워드 (예: '비갱신', '무해지', '간병인')",
                    },
                    "top_n": {
                        "type": "integer",
                        "description": "반환할 최대 상품 수 (기본 10)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_webpage",
            "description": (
                "특정 URL의 웹페이지 본문 전체를 가져옵니다. "
                "search_web으로 찾은 결과의 URL 중 보험사 상품 정보나 비교 정보가 있는 페이지를 "
                "구체적으로 읽어야 할 때 사용하세요. "
                "스니펫만으로 정보가 부족할 때 이 도구로 실제 페이지 본문을 읽으세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "읽어올 페이지의 전체 URL",
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "반환할 최대 글자 수 (기본 4000)",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "실시간 웹 검색으로 최신 보험 정보를 조회합니다. "
                "로컬 데이터에 없는 특정 보험사 상품, 연금보험, 최신 공시이율, "
                "특정 보험사 연락처, 최신 뉴스 등이 필요할 때 사용하세요. "
                "연금보험 보험료 질문 시 반드시 이 도구로 검색하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "검색 쿼리. 구체적일수록 좋습니다. "
                        "예: '한화생명 연금보험 2024 공시이율', '삼성생명 연금저축보험 50대 납입 기준'",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "반환할 결과 수 (기본 5, 최대 10)",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_credit_score",
            "description": (
                "사용자의 NICE 또는 KCB 신용점수를 실시간 조회합니다. "
                "Chrome CDP 연결로 이미 로그인된 나이스지키미/올크레딧 페이지에서 점수를 가져옵니다. "
                "포트폴리오 추천 시 신용점수 기반 맞춤 조정에 사용합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cdp_url": {
                        "type": "string",
                        "description": "CDP 주소 (기본: http://localhost:9222)",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_personalized_recommendation",
            "description": (
                "사용자 프로필을 바탕으로 개인화된 보험 포트폴리오를 추천합니다. "
                "실손의료보험·암보험·치아보험·간병·치매보험·종신보험·연금보험·대체투자연계보험을 종합적으로 제안합니다. "
                "보험다모아 공시 엑셀 데이터를 우선 활용하여 실제 보험료 기반으로 추천합니다. "
                "나이, 성별, 예산, 니즈가 파악된 후 호출하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer", "description": "나이"},
                    "gender": {"type": "string", "enum": ["남", "여"], "description": "성별"},
                    "monthly_budget": {"type": "integer", "description": "월 보험료 예산 (원)"},
                    "family_situation": {
                        "type": "string",
                        "description": "가족 상황. 예: '미혼', '결혼/자녀 2명', '부부만', '노부모 부양'",
                    },
                    "health_status": {
                        "type": "string",
                        "description": "건강 상태. 예: '건강함', '고혈압', '치과치료 예정', '부모 간병 경험'",
                    },
                    "primary_needs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "주요 니즈. 예: ['사망보장', '암보장', '임플란트', '간병', '노후준비', '치매예방']",
                    },
                    "existing_insurance": {
                        "type": "string",
                        "description": "기존 보험. 예: '실손보험만 있음', '보험 없음', '종신보험·실손 보유'",
                    },
                    "occupation": {
                        "type": "string",
                        "description": "직업/직종. 예: '사무직', '자영업', '주부', '은퇴'",
                    },
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_underwriting_review",
            "description": (
                "언더라이팅(보험 인수심사) 전문 서브에이전트를 호출합니다. "
                "암 완치자 재가입 심사, 건강검진 기반 할인/할증, 만성질환자 요율, "
                "씬파일러 신용보완, 유병자·고령층 대출/렌탈 승인, 역선택 탐지 등 "
                "'가입 가능한지', '보험료가 왜 이렇게 산정되는지', '대출 승인이 되는지'를 "
                "구체적인 건강·금융 수치나 병력을 근거로 정밀 심사해야 하는 질문에 사용하세요. "
                "일반 상품 추천/비교/견적에는 사용하지 마세요 (그런 경우 get_personalized_recommendation 등 사용)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "request": {
                        "type": "string",
                        "description": (
                            "사용자의 심사 관련 질문을 대화 맥락을 포함해 자기완결적으로 정리한 요청문. "
                            "나이·성별과 언급된 구체적 건강·금융 수치·병력을 빠짐없이 포함하세요. "
                            "예: '52세 남성, 3년 전 위암 2기 완치, 최근 건강검진 정상. "
                            "지금 보험 가입 가능한지와 할증 여부를 알려줘'"
                        ),
                    },
                },
                "required": ["request"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_blockchain_dental_status",
            "description": (
                "사용자가 이미 가입한 블록체인 덴탈보험(라이나생명 블록체인치아보험)의 "
                "실시간 온체인 현황을 조회합니다. 계약(증권) 상태, 보험료 납입 여부, "
                "보험금 청구 처리/지급 상태, 약관대출 여부, 만기환급 시점 등 "
                "'내 블록체인 보험 어떻게 됐어?', '보험금 지급됐어?', '이번 달 보험료 냈나?', "
                "'만기 언제야?' 같은 질문에 사용하세요. 일반 보험 상품 추천/비교에는 사용하지 마세요 "
                "— 이 도구는 이미 블록체인으로 가입한 사용자의 실제 계약 데이터 조회 전용입니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "wallet_address": {
                        "type": "string",
                        "description": (
                            "조회할 MetaMask 지갑 주소(0x로 시작하는 42자). "
                            "사용자가 대화 중 알려줬다면 그 값을 사용하고, 모르면 비워두세요 "
                            "(시스템에 등록된 주소가 있으면 자동으로 사용됩니다)."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_blockchain_altinvest_status",
            "description": (
                "사용자가 이미 투자한 블록체인 대체투자(AltInvestmentFund) 포지션의 "
                "실시간 온체인 현황을 조회합니다. 펀드별 투자 원금, 예상 잔액(이자 포함), "
                "락업 해제 시점 등 '내 대체투자 얼마나 벌었어?', '락업 언제 풀려?', "
                "'그린인프라 펀드에 투자한 거 지금 얼마야?' 같은 질문에 사용하세요. "
                "일반 상품 추천/비교에는 사용하지 마세요 — 이 도구는 이미 블록체인으로 "
                "투자한 사용자의 실제 포지션 데이터 조회 전용입니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "wallet_address": {
                        "type": "string",
                        "description": (
                            "조회할 MetaMask 지갑 주소(0x로 시작하는 42자). "
                            "사용자가 대화 중 알려줬다면 그 값을 사용하고, 모르면 비워두세요 "
                            "(시스템에 등록된 주소가 있으면 자동으로 사용됩니다)."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_blockchain_parametric_status",
            "description": (
                "사용자가 이미 가입한 블록체인 파라메트릭(자동집행형) 보험(항공편 지연·폭염특보 "
                "보장 등)의 실시간 온체인 현황을 조회합니다. 청구 절차 없이 오라클이 조건 충족 "
                "여부를 판정해 자동 지급/만료 처리하는 상품입니다. '내 항공편 지연 보험 지급됐어?', "
                "'폭염특보 보장 아직 유효해?' 같은 질문에 사용하세요. 일반 상품 추천/비교에는 "
                "사용하지 마세요 — 이미 가입한 사용자의 실제 커버리지 데이터 조회 전용입니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "wallet_address": {
                        "type": "string",
                        "description": (
                            "조회할 MetaMask 지갑 주소(0x로 시작하는 42자). "
                            "사용자가 대화 중 알려줬다면 그 값을 사용하고, 모르면 비워두세요 "
                            "(시스템에 등록된 주소가 있으면 자동으로 사용됩니다)."
                        ),
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_wellness_checkin",
            "description": (
                "블록체인 치아보험(dental_005) 가입자가 최신 건강검진 결과를 알려줄 때 사용합니다. "
                "이전 체크인 대비 위험도가 개선됐으면 온체인 보험료를 실제로 할인 조정합니다 "
                "(최대 20%). 최초 체크인은 비교 기준만 저장하고 조정하지 않습니다. "
                "'건강검진 결과 좋아졌어, 보험료 좀 깎아줘', '살 빼고 금연했는데 보험료 조정 되나요?' "
                "같은 요청에 사용하세요. 지갑 주소가 등록되어 있어야 합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "wallet_address": {
                        "type": "string",
                        "description": "지갑 주소(0x로 시작). 시스템에 등록된 값이 있으면 비워둬도 자동 사용됩니다.",
                    },
                    "age": {"type": "integer", "description": "나이"},
                    "gender": {"type": "string", "description": "'남' 또는 '여'"},
                    "height": {"type": "number", "description": "키(cm)"},
                    "weight": {"type": "number", "description": "몸무게(kg)"},
                    "sbp": {"type": "number", "description": "수축기 혈압"},
                    "dbp": {"type": "number", "description": "이완기 혈압"},
                    "triglyceride": {"type": "number", "description": "중성지방"},
                    "hdl": {"type": "number", "description": "HDL 콜레스테롤"},
                    "ggt": {"type": "number", "description": "감마지티피(간수치)"},
                    "smoke": {"type": "integer", "description": "1=비흡연, 2=과거흡연, 3=현재흡연"},
                    "drink": {"type": "integer", "description": "0=비음주, 1=음주"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_crypto_reserve_status",
            "description": (
                "회사 준비금 일부를 운용 중인 가상자산 자동매매(auto_upbit 편입) 봇의 "
                "실시간 현황을 조회합니다. 잔고·평가손익·DRY_RUN(실주문 여부) 등을 실제 "
                "업비트 데이터 기준으로 보여줍니다. '준비금 가상자산 운용 실적 어때?', "
                "'코인 자동매매 지금 수익 나고 있어?' 같은 질문에 사용하세요. 회사가 "
                "운용하는 단일 준비금 계좌 현황 조회 전용입니다 — 고객 개인 자산 조회나 "
                "실제 매매 지시가 아닙니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_crypto_investment_profile",
            "description": (
                "간단한 문답으로 가상자산 투자성향(안정추구형/중립형/공격투자형)을 "
                "진단합니다. '나 코인 투자 어느 정도가 맞을까?', '투자성향 진단해줘', "
                "'공격적으로 해도 될까?' 같은 요청에 사용하세요. 진단 후 실제로 개인별 "
                "자동매매를 시작하려면, 화면의 '개인별 가상자산 자동매매' 패널에서 본인의 "
                "업비트 Open API 키를 직접 등록해야 합니다(챗봇이 대신 등록해줄 수 없음) "
                "— 등록 직후에는 항상 페이퍼(모의) 상태이며, 실거래는 그 패널의 별도 "
                "'실거래 승인' 버튼을 고객이 직접 눌러야만 켜집니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer", "description": "나이"},
                    "investment_horizon_years": {"type": "integer", "description": "투자 목표 기간(년), 기본 3"},
                    "loss_tolerance": {"type": "string", "description": "원금손실 감수 정도 — '상'/'중'/'하'"},
                    "investment_experience": {"type": "string", "description": "가상자산 투자 경험 — '상'/'중'/'하'"},
                    "monthly_investable_krw": {"type": "integer", "description": "월 투자 가능 금액(원)"},
                    "income_stability": {"type": "string", "description": "소득 안정성 — '상'/'중'/'하'"},
                },
                "required": ["age"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_personal_trading_status",
            "description": (
                "고객 본인이 등록한 개인별 가상자산 자동매매의 실시간 현황(잔고·평가손익·"
                "실거래 승인 여부)을 조회합니다. '내 코인 자동매매 어때?', '내 개인 봇 "
                "수익 나고 있어?', '나 실거래 승인됐어?' 같은 질문에 사용하세요. 화면의 "
                "'개인별 가상자산 자동매매' 패널에서 API 키를 등록한 고객만 조회할 수 "
                "있고, 등록하지 않았다면 오류가 반환되니 그때 등록 방법을 안내하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "start_gasless_dental_enrollment",
            "description": (
                "지갑(MetaMask)이 없거나 가스비 마련이 부담스러운 고객을 위해, 블록체인 "
                "치아보험(dental_005)에 지갑 없이 곧바로 가입시킵니다. 회사가 고객 전용 지갑을 "
                "새로 만들고 가스비를 대납한 뒤 그 지갑으로 청약까지 대신 제출합니다. "
                "'지갑이 없어요', '메타마스크 설치가 어려워요', '그냥 간편하게 가입하고 싶어요' "
                "같은 요청에만 사용하세요 — 이미 지갑을 등록했거나 직접 서명하길 원하는 고객에게는 "
                "기존 '⛓️ 블록체인 가입 시작' 버튼(MetaMask) 절차를 그대로 안내하세요. "
                "결과로 받은 지갑 주소는 반드시 고객에게 안내하고, 이후 조회 시 "
                "get_blockchain_dental_status의 wallet_address 인자로 재사용할 수 있다고 알려주세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "applicant_name": {"type": "string", "description": "신청자 이름"},
                    "age": {"type": "integer", "description": "나이"},
                    "monthly_premium": {"type": "integer", "description": "월 보험료(currency 최소단위 정수 — USDC는 6자리, KRW는 0자리)"},
                    "coverage_limit": {"type": "integer", "description": "보장한도(currency 최소단위 정수)"},
                    "maturity_days": {"type": "integer", "description": "만기까지 일수"},
                    "maturity_refund_rate": {"type": "integer", "description": "만기환급률(0~100)"},
                    "coverage_count": {"type": "integer", "description": "선택 담보 개수 (2개=즉시자동승인, 7개=즉시거절, 그 외=심사대기)"},
                    "flexible_payment": {"type": "boolean", "description": "씬파일러 신용보완 유연납입 신청 여부 (기본 false)"},
                    "currency": {"type": "string", "description": "'USDC' 또는 'KRW' (기본 USDC)"},
                },
                "required": [
                    "applicant_name", "age", "monthly_premium", "coverage_limit",
                    "maturity_days", "maturity_refund_rate", "coverage_count",
                ],
            },
        },
    },
]

# ───────────────────────────────────────────
# 언더라이팅 서브에이전트 전용 도구
# (메인 오케스트레이터 TOOLS에는 노출되지 않고, run_underwriting_review 호출 시
#  _run_underwriting_subagent() 내부 tool-calling 루프에서만 사용됨)
# ───────────────────────────────────────────

UNDERWRITING_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "assess_health_risk",
            "description": (
                "건강검진 수치로 만성질환(당뇨·대사질환) 위험을 예측하고, 그 위험에 맞는 "
                "보험 유형과 실제 보험다모아 상품을 추천합니다. "
                "개인정보 이노베이션 존 RGST(국립암센터 암등록)·DEATH·BFC(보험료분위) 데이터 패턴을 "
                "활용해 암 위험과 납부 가능 보험료 범위도 함께 분석합니다. "
                "사용자가 건강검진 결과(혈압·혈당·BMI·간수치·콜레스테롤 등)를 알려주거나, "
                "'내 건강 상태에 맞는 보험', '건강 위험 기반 보장 설계'를 원할 때 사용하세요. "
                "나이·성별만 있어도 동작하며, 검진 수치가 많을수록 정확합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer", "description": "나이"},
                    "gender": {"type": "string", "enum": ["남", "여"], "description": "성별"},
                    "height": {"type": "number", "description": "키(cm)"},
                    "weight": {"type": "number", "description": "몸무게(kg)"},
                    "waist": {"type": "number", "description": "허리둘레(cm)"},
                    "sbp": {"type": "number", "description": "수축기 혈압"},
                    "dbp": {"type": "number", "description": "이완기 혈압"},
                    "total_cholesterol": {"type": "number", "description": "총콜레스테롤"},
                    "triglyceride": {"type": "number", "description": "중성지방(TG)"},
                    "hdl": {"type": "number", "description": "HDL 콜레스테롤"},
                    "ldl": {"type": "number", "description": "LDL 콜레스테롤"},
                    "ast": {"type": "number", "description": "AST(간수치)"},
                    "alt": {"type": "number", "description": "ALT(간수치)"},
                    "ggt": {"type": "number", "description": "감마지티피(GGT)"},
                    "smoke": {"type": "integer", "enum": [1, 2, 3], "description": "1=비흡연,2=과거흡연,3=현재흡연"},
                    "drink": {"type": "integer", "enum": [0, 1], "description": "0=비음주,1=음주"},
                    "bfc_tier": {"type": "integer", "enum": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                                 "description": "BFC 보험료 분위 1~10 (BFC.CALC_CTRB_VTILE_FD, 1=하위10%·10=상위10%). 소득 수준을 알 때 제공"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    # ── 시나리오 1~5: 보험 정밀 언더라이팅 & 요율 합리화 ──────────
    {
        "type": "function",
        "function": {
            "name": "assess_cancer_survivor",
            "description": (
                "[시나리오 1] 암 완치자 보험 인수 심사. "
                "국립암센터 RGST(암등록) + 사망DB 재발률 데이터로 정밀 언더라이팅 후 "
                "조건부 승인/표준 체 전환 여부와 최적 보험료 할인율을 산출합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "cancer_type": {"type": "string", "description": "암종 (예: '위암', '유방암', '갑상선암', '폐암')"},
                    "cancer_stage": {"type": "string", "enum": ["1기", "2기", "3기", "4기"]},
                    "years_since_cure": {"type": "integer", "description": "완치 후 경과 연수"},
                    "treatment_method": {"type": "string", "description": "치료 방법 (예: '수술', '방사선', '항암+수술')"},
                    "recent_checkup_normal": {"type": "boolean", "description": "최근 건강검진 정상 여부"},
                },
                "required": ["age", "gender", "cancer_type", "cancer_stage", "years_since_cure"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_low_risk_discount",
            "description": (
                "[시나리오 2] AI 저위험군 할인. "
                "G1E 연속 건강검진 + cdw_psmn_vtls(바이탈) + DICOM 영상 소견으로 "
                "저위험군을 정밀 분류하여 보험료 할인율(최대 30%)을 산출합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "consecutive_checkups": {"type": "integer", "description": "연속 건강검진 수검 횟수(년)"},
                    "bmi_normal": {"type": "boolean", "description": "BMI 정상(18.5~24.9)"},
                    "bp_normal": {"type": "boolean", "description": "혈압 정상"},
                    "blood_sugar_normal": {"type": "boolean", "description": "혈당 정상"},
                    "non_smoker": {"type": "boolean", "description": "비흡연 여부"},
                    "pacs_finding": {"type": "string", "description": "DICOM 영상 소견 ('정상' / '경도 소견' / '이상')"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_pacs_no_extra",
            "description": (
                "[시나리오 3] 미세 영상 소견자 노-할증. "
                "광주TP DICOM/JPG AI 판독 결과로 임상적 무의미 소견을 구분하여 "
                "부당 보험료 할증 없이 표준 체로 인수 가능한지 판단합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "finding_type": {"type": "string", "description": "소견 유형 (예: '폐 소결절', '간 낭종', '갑상선 결절')"},
                    "finding_size_mm": {"type": "number", "description": "소견 크기 (mm)"},
                    "follow_up_years": {"type": "number", "description": "경과 관찰 기간 (년)"},
                },
                "required": ["age", "gender", "finding_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_dynamic_discount",
            "description": (
                "[시나리오 4] 동적 보험료 캐시백. "
                "cdw_lflg(라이프로그) 기반 건강 개선 점수 향상도에 따라 "
                "연간 보험료 캐시백(최대 15%) 지급액을 산출합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "score_improvement_pct": {"type": "number", "description": "건강 점수 개선율 (%)"},
                    "monthly_premium": {"type": "integer", "description": "현재 월 보험료 (원)"},
                    "management_years": {"type": "integer", "description": "건강 관리 기간 (년)"},
                },
                "required": ["age", "gender", "score_improvement_pct", "monthly_premium"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_chronic_disease_rate",
            "description": (
                "[시나리오 5] 맞춤형 유병자 요율. "
                "T200~T530 상병 + G1E 검진치료 반응 + BFC 분위로 "
                "만성질환자별 정밀 보험료를 산출합니다 (기존 일률 할증 대비 최대 30% 인하)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "disease": {"type": "string", "description": "질환명 (예: '당뇨', '고혈압', '고지혈증')"},
                    "treatment_response": {"type": "string", "enum": ["우수", "양호", "보통", "불량"], "description": "치료 반응"},
                    "hba1c_or_key_metric": {"type": "number", "description": "당화혈색소(당뇨) 또는 주요 임상 지표"},
                },
                "required": ["age", "gender", "disease"],
            },
        },
    },
    # ── 시나리오 6~8: 금융 포용성 확대 ──────────────────────────
    {
        "type": "function",
        "function": {
            "name": "assess_health_credit",
            "description": (
                "[시나리오 6] 씬파일러 Health-Credit 대안 신용평가. "
                "G1E(건강검진 성실도) + cdw_psmn_vtls(바이탈 안정도) + BFC(소득분위)를 "
                "신용점수 가산점으로 환산하여 금리 인하·보험료 할인 혜택을 산출합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "consecutive_checkups": {"type": "integer", "description": "연속 건강검진 수검 횟수(년)"},
                    "vital_stability": {"type": "string", "enum": ["상", "중", "하"], "description": "바이탈 수치 안정도"},
                    "bfc_tier": {"type": "integer", "description": "BFC 보험료 분위 (1~10)"},
                    "current_credit_score": {"type": "integer", "description": "현재 CB 신용점수"},
                    "loan_purpose": {"type": "string", "description": "대출 목적"},
                    "loan_amount_10k": {"type": "integer", "description": "대출 금액 (만원)"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_sme_health_loan",
            "description": (
                "[시나리오 7] 소상공인 건강 지속가능성 연계 대출 우대. "
                "CDW 임상 수치 + RGST 장기 질환 추적으로 사업 영속성 예측 → "
                "대출 한도 최대 3,000만원 증액 및 금리 우대."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "business_years": {"type": "integer", "description": "사업 운영 기간(년)"},
                    "chronic_disease": {"type": "string", "description": "만성질환 ('없음' / '당뇨' / '고혈압')"},
                    "treatment_response": {"type": "string", "enum": ["우수", "양호"], "description": "치료 반응"},
                    "monthly_revenue_10k": {"type": "integer", "description": "월 매출 (만원)"},
                    "loan_amount_10k": {"type": "integer", "description": "희망 대출 금액 (만원)"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_rental_approval",
            "description": (
                "[시나리오 8] 유병자·고령층 렌탈/할부 금융 승인. "
                "광주TP cdw_ptn_hli(환자건강정보) + DEATH/RGST로 단기 급격 악화 위험을 "
                "정밀 분석하여 병력·고령 차별 없는 공정한 금융 접근 제공."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "disease_history": {"type": "string", "description": "병력 요약"},
                    "short_term_risk": {"type": "string", "enum": ["낮음", "중간", "높음"], "description": "단기 건강 급변 위험"},
                    "rental_amount_10k": {"type": "integer", "description": "렌탈 금액 (만원)"},
                    "rental_period_months": {"type": "integer", "description": "렌탈 기간 (개월)"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    # ── 시나리오 11·13: 건강체 & 용종 보험 언더라이팅 ──────────────
    {
        "type": "function",
        "function": {
            "name": "assess_healthy_body_discount",
            "description": (
                "[시나리오 11] 건강체 특별약관 보험료 최대 할인. "
                "G1E 연속 건강검진 + cdw_psmn_vtls(바이탈) + 생활습관 데이터로 "
                "건강체 등급(1~4급)을 판정하여 최대 30% 보험료 할인 혜택을 산출합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "consecutive_checkups": {"type": "integer", "description": "연속 정상 건강검진 횟수(년)"},
                    "bmi_normal": {"type": "boolean", "description": "BMI 정상(18.5~24.9) 여부"},
                    "bp_normal": {"type": "boolean", "description": "혈압 정상 여부"},
                    "blood_sugar_normal": {"type": "boolean", "description": "공복혈당 정상 여부"},
                    "non_smoker": {"type": "boolean", "description": "비흡연 여부"},
                    "base_premium_10k": {"type": "integer", "description": "표준체 기준 월 보험료(만원)"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_polyp_removal_eligibility",
            "description": (
                "[시나리오 13] 위 내시경 용종 절제술 후 보험 가입 가능 여부. "
                "현행 기준(수술 이력 → 5년 거절)을 이노베이션 존 병리 DB + T400(상병) + "
                "DICOM(추적 내시경)으로 정밀 재분류하여 즉시 가입 가능 여부를 판정합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "polyp_type": {
                        "type": "string",
                        "enum": ["과증식성 용종", "관상선종(저등급)", "관상선종(고등급)", "융모관상선종"],
                        "description": "용종 유형",
                    },
                    "years_since_removal": {"type": "number", "description": "절제 후 경과 기간(년)"},
                    "pathology_benign": {"type": "boolean", "description": "병리 결과 양성(암세포 없음) 여부"},
                    "followup_endoscopy_normal": {"type": "boolean", "description": "추적 내시경 정상 여부"},
                    "polyp_size_mm": {"type": "integer", "description": "용종 크기(mm)"},
                },
                "required": ["age", "gender", "polyp_type"],
            },
        },
    },
    # ── 시나리오 12·14: 건강 데이터 기반 대출 ────────────────────
    {
        "type": "function",
        "function": {
            "name": "assess_healthy_body_loan",
            "description": (
                "[시나리오 12] 건강체 건강담보대출 승인. "
                "DSR 초과로 일반 은행 거절 시 G1E + 바이탈 안정도로 "
                "건강 자산 점수(HAS)를 산출하여 보험사 연계 건강담보대출 승인 및 금리 우대."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "consecutive_checkups": {"type": "integer", "description": "연속 건강검진 수검 횟수(년)"},
                    "vital_stability": {"type": "string", "enum": ["상", "중", "하"], "description": "바이탈 안정도"},
                    "bfc_tier": {"type": "integer", "description": "BFC 보험료 분위(1~10)"},
                    "dsr_ratio_pct": {"type": "number", "description": "현재 DSR 비율(%)"},
                    "loan_purpose": {"type": "string", "description": "대출 목적"},
                    "loan_amount_10k": {"type": "integer", "description": "희망 대출 금액(만원)"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_health_secured_loan",
            "description": (
                "[시나리오 14] 건강 정보 기반 신(新) 건강담보대출 상품. "
                "DSR·LTV 동시 초과로 전 금융기관 대출 불가 시 "
                "G1E + 바이탈 + 라이프로그 3종 결합(HAS) → 최대 5,000만원 / 연 3.2% 신상품."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "consecutive_checkups": {"type": "integer", "description": "연속 건강검진 수검 횟수(년)"},
                    "vital_stability": {"type": "string", "enum": ["상", "중", "하"], "description": "바이탈 안정도"},
                    "lifelog_score": {"type": "integer", "description": "라이프로그 건강 관리 점수(0~100)"},
                    "bfc_tier": {"type": "integer", "description": "BFC 보험료 분위(1~10)"},
                    "dsr_ratio_pct": {"type": "number", "description": "현재 DSR 비율(%)"},
                    "ltv_ratio_pct": {"type": "number", "description": "현재 LTV 비율(%)"},
                    "loan_purpose": {"type": "string", "description": "대출 목적"},
                    "loan_amount_10k": {"type": "integer", "description": "희망 대출 금액(만원)"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    # ── 시나리오 15~16: 신용 역선택 방지 ──────────────────────────
    {
        "type": "function",
        "function": {
            "name": "assess_adverse_selection_score",
            "description": (
                "[시나리오 15] 신용+건강 교차 역선택 탐지 언더라이팅. "
                "신용점수 급락 + 건강검진 기피 + 고액 보험 동시 신청 패턴으로 "
                "AASI(역선택방지지수)를 산출하여 역선택 위험 등급과 필요 조치를 제시합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "credit_score": {"type": "integer", "description": "현재 신용점수(300~1000)"},
                    "credit_drop_6m": {"type": "integer", "description": "6개월 내 신용점수 하락폭"},
                    "insurance_amount_10k": {"type": "integer", "description": "희망 보험금액(만원)"},
                    "recent_checkup_months": {"type": "integer", "description": "마지막 건강검진 경과 개월수"},
                    "multi_insurer": {"type": "boolean", "description": "복수 보험사 동시 신청 여부"},
                    "sudden_large_policy": {"type": "boolean", "description": "소액→고액 급격 전환 여부"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_thin_filer_adverse_selection",
            "description": (
                "[시나리오 16] 씬파일러 역선택 방지 및 건강 데이터 기반 공정 심사. "
                "금융 이력 없는 씬파일러의 건강검진 기피 + 고액 보험 첫 신청 패턴을 탐지하고 "
                "역선택 방지와 함께 포용금융 경로(간편심사형→표준형 전환)를 제시합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "has_credit_history": {"type": "boolean", "description": "CB 금융 이력 보유 여부"},
                    "consecutive_checkups": {"type": "integer", "description": "건강검진 수검 횟수"},
                    "insurance_amount_10k": {"type": "integer", "description": "희망 보험금액(만원)"},
                    "sudden_application": {"type": "boolean", "description": "갑작스러운 첫 신청 여부"},
                    "vital_data_available": {"type": "boolean", "description": "바이탈 데이터 보유 여부"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    # ── 시나리오 9~10: 위험 관리 ────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "assess_early_care",
            "description": (
                "[시나리오 9] 미시 징후 사전 케어 암 중증화 차단. "
                "광주TP DICOM/JPG + T400(상병) DB로 전조 징후 조기 감지 → "
                "선제 시술 유도로 고액 보험금 지급을 차단하고 소비자 생명을 지킵니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "finding": {"type": "string", "description": "미시 소견 (예: '위 미란 소견', '폐 결절 의심')"},
                    "progression_risk_pct": {"type": "number", "description": "2년 내 중증 진행 위험율 (%)"},
                    "early_intervention": {"type": "boolean", "description": "조기 개입 여부"},
                    "insurance_coverage_10k": {"type": "integer", "description": "중증 진단 시 보험금 (만원)"},
                },
                "required": ["age", "gender", "finding"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_default_prevention",
            "description": (
                "[시나리오 10] 중증 질환 전환 예측 대출 부실률 차단. "
                "광주TP CDW SOFA/APACHE2 점수 + RGST 연계로 장기 상환 불능 위험을 "
                "사전 예측하여 채권 부실률을 차단합니다."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "loan_amount_10k": {"type": "integer", "description": "대출 잔액 (만원)"},
                    "sofa_score": {"type": "number", "description": "CDW SOFA 점수"},
                    "severe_disease_risk_pct": {"type": "number", "description": "2년 내 중증 질환 전환 위험율 (%)"},
                    "has_repayment_insurance": {"type": "boolean", "description": "대출 상환 보장 보험 가입 여부"},
                },
                "required": ["age", "gender"],
            },
        },
    },
    # ── 시나리오 17: 블록체인 유연납입 ────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "assess_flexible_payment_eligibility",
            "description": (
                "[시나리오 17] 블록체인 치아보험(dental_005) 씬파일러 신용보완 유연납입 적격 심사. "
                "신용점수·씬파일러 여부를 근거로, 보험료 연체 시 자동으로 약관대출로 대환 처리되는 "
                "'유연납입' 옵션(청약 시 체크박스로 신청)을 권장할지 판단합니다. "
                "'신용점수가 낮은데 블록체인 치아보험 가입해도 되나요', '보험료 못 낼까봐 걱정돼요' "
                "같은 질문에 사용하세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "age": {"type": "integer"},
                    "gender": {"type": "string", "enum": ["남", "여"]},
                    "credit_score": {"type": "integer", "description": "현재 CB 신용점수(300~1000). 모르면 비워두세요."},
                    "has_credit_history": {"type": "boolean", "description": "CB 금융 이력 보유 여부(씬파일러면 false)"},
                    "monthly_income_10k": {"type": "integer", "description": "월 소득(만원, 대략적인 값)"},
                },
                "required": ["age", "gender"],
            },
        },
    },
]


# ───────────────────────────────────────────
# 사전 라우팅 (Live Mode Pre-routing)
# ───────────────────────────────────────────

_PRE_ROUTE_KEYWORDS = [
    ("cancer",   ["암보험", "암 보험", "암진단", "면역항암", "항암"]),
    ("dental",   ["덴탈", "치과", "임플란트", "스케일링", "충치", "잇몸", "치아보험", "치아"]),
    ("health",   ["실손", "실비", "의료비", "병원비", "의료보험"]),
    ("life",     ["생명보험", "종신보험", "정기보험", "사망보험", "사망보장"]),
    ("care",     ["간병", "치매", "노인장기"]),
    ("accident", ["상해보험", "상해"]),
]

_INTENT_TO_INSMARKET: dict = {
    "cancer":   {"insurance_type": "질병보험", "keyword": "암"},
    "dental":   {"insurance_type": "치아보험"},
    "health":   {"insurance_type": "실손의료보험"},
    "life":     {"insurance_type": "종신보험"},
    "care":     {"insurance_type": "간병·치매보험"},
    "accident": {"insurance_type": "상해보험"},
}


def _classify_pre_intent(text: str) -> str:
    for intent, keywords in _PRE_ROUTE_KEYWORDS:
        if any(k in text for k in keywords):
            return intent
    return "general"


def _extract_age_gender_params(text: str) -> dict:
    params: dict = {}
    m = _re.search(r"(\d{2,3})\s*세", text)
    if m:
        age = int(m.group(1))
        if age < 35:
            params["age_group"] = "30대"
        elif age < 45:
            params["age_group"] = "40대"
        elif age < 55:
            params["age_group"] = "50대"
        else:
            params["age_group"] = "60대"
    else:
        m = _re.search(r"(\d+)0\s*대", text)
        if m:
            label = f"{m.group(1)}0대"
            if label in ("30대", "40대", "50대", "60대"):
                params["age_group"] = label

    if any(k in text for k in ["남성", "남자", "남 ", "아빠", "아버지", "남편"]):
        params["gender"] = "남"
    elif any(k in text for k in ["여성", "여자", "여 ", "엄마", "어머니", "아내"]):
        params["gender"] = "여"

    return params


# ───────────────────────────────────────────
# 도구 실행기
# ───────────────────────────────────────────

def execute_tool(tool_name: str, tool_input: dict, client: openai.OpenAI, wallet_address: str | None = None,
                  crypto_personal_bot_id: str | None = None) -> str:
    if tool_name == "search_insurance_products":
        return search_products(**tool_input)

    elif tool_name == "compare_insurance_products":
        return compare_products(tool_input["product_ids"])

    elif tool_name == "get_premium_estimate":
        return get_premium_estimate(**tool_input)

    elif tool_name == "retrieve_insurance_knowledge":
        return retrieve_insurance_knowledge(
            query=tool_input["query"],
            top_k=tool_input.get("top_k", 2),
        )

    elif tool_name == "fetch_fss_realtime_products":
        return fetch_fss_realtime(tool_input.get("product_type", "annuity"))

    elif tool_name == "search_insmarket_products":
        return search_insmarket_products(**tool_input)

    elif tool_name == "get_credit_score":
        return get_credit_score(tool_input.get("cdp_url", "http://localhost:9222"))

    elif tool_name == "fetch_webpage":
        return fetch_webpage(
            url=tool_input["url"],
            max_chars=tool_input.get("max_chars", 4000),
        )

    elif tool_name == "search_web":
        return search_web(
            query=tool_input["query"],
            max_results=tool_input.get("max_results", 5),
        )

    elif tool_name == "run_underwriting_review":
        return _run_underwriting_subagent(tool_input["request"], client)

    elif tool_name == "get_personalized_recommendation":
        return _run_recommendation_subagent(tool_input, client)

    elif tool_name == "get_blockchain_dental_status":
        return get_blockchain_dental_status(
            wallet_address=tool_input.get("wallet_address") or wallet_address or ""
        )

    elif tool_name == "get_blockchain_altinvest_status":
        return get_blockchain_altinvest_status(
            wallet_address=tool_input.get("wallet_address") or wallet_address or ""
        )

    elif tool_name == "get_blockchain_parametric_status":
        return get_blockchain_parametric_status(
            wallet_address=tool_input.get("wallet_address") or wallet_address or ""
        )

    elif tool_name == "submit_wellness_checkin":
        return submit_wellness_checkin(
            wallet_address=tool_input.get("wallet_address") or wallet_address or "",
            age=tool_input["age"],
            gender=tool_input["gender"],
            height=tool_input.get("height"),
            weight=tool_input.get("weight"),
            sbp=tool_input.get("sbp"),
            dbp=tool_input.get("dbp"),
            triglyceride=tool_input.get("triglyceride"),
            hdl=tool_input.get("hdl"),
            ggt=tool_input.get("ggt"),
            smoke=tool_input.get("smoke"),
            drink=tool_input.get("drink"),
        )

    elif tool_name == "get_crypto_reserve_status":
        return get_crypto_reserve_status()

    elif tool_name == "get_personal_trading_status":
        if not crypto_personal_bot_id:
            return json.dumps({
                "ok": False,
                "error": (
                    "등록된 개인별 자동매매가 없습니다. 화면의 '개인별 가상자산 자동매매' "
                    "패널에서 본인의 업비트 Open API 키를 먼저 등록해달라고 안내하세요."
                ),
            }, ensure_ascii=False)
        return get_crypto_reserve_status(bot_id=crypto_personal_bot_id)

    elif tool_name == "assess_crypto_investment_profile":
        return assess_crypto_investment_profile(
            age=tool_input["age"],
            investment_horizon_years=tool_input.get("investment_horizon_years", 3),
            loss_tolerance=tool_input.get("loss_tolerance", "중"),
            investment_experience=tool_input.get("investment_experience", "중"),
            monthly_investable_krw=tool_input.get("monthly_investable_krw", 100000),
            income_stability=tool_input.get("income_stability", "중"),
        )

    elif tool_name == "start_gasless_dental_enrollment":
        return start_gasless_dental_enrollment(
            applicant_name=tool_input["applicant_name"],
            age=tool_input["age"],
            monthly_premium=tool_input["monthly_premium"],
            coverage_limit=tool_input["coverage_limit"],
            maturity_days=tool_input["maturity_days"],
            maturity_refund_rate=tool_input["maturity_refund_rate"],
            coverage_count=tool_input["coverage_count"],
            flexible_payment=tool_input.get("flexible_payment", False),
            currency=tool_input.get("currency", "USDC"),
        )

    else:
        return json.dumps({"error": f"알 수 없는 도구: {tool_name}"}, ensure_ascii=False)


def _run_recommendation_subagent(user_profile: dict, client: openai.OpenAI) -> str:
    """
    개인화 추천 Sub-agent.
    보험다모아 엑셀 + 로컬 DB를 모두 활용하여 연령·성별·니즈 맞춤 포트폴리오 제안.
    """
    from datetime import date
    from data.products import get_all_products
    from data.dental_products import DENTAL_INSURANCE_PRODUCTS
    from data.excel_loader import load_all_excel

    today = date.today().strftime("%Y년 %m월 %d일")
    gender = user_profile.get("gender", "남")
    age = user_profile.get("age", 35)
    monthly_budget = user_profile.get("monthly_budget")

    # 연령대 매핑
    if age < 35:
        age_group_label = "30대"
        age_key = "30세"
    elif age < 45:
        age_group_label = "40대"
        age_key = "40세"
    elif age < 55:
        age_group_label = "50대"
        age_key = "50세"
    else:
        age_group_label = "60대"
        age_key = "60세"

    # ── 1. 로컬 DB 상품 (생명/실손/암) ───────────────────────────
    local_products = []
    for p in get_all_products():
        premiums = p.get("monthly_premium", {})
        ref_key = f"{age_key}_{gender}"
        premium = premiums.get(ref_key) or premiums.get(f"30세_{gender}") or (list(premiums.values())[0] if premiums else 0)
        local_products.append({
            "source": "local_db",
            "id": p["id"],
            "name": p["name"],
            "company": p["company"],
            "type": p["type"],
            "subtype": p.get("subtype", ""),
            "monthly_premium": premium,
            "key_coverage": list(p.get("coverage", {}).keys())[:4],
            "pros": p.get("pros", [])[:3],
            "tags": p.get("tags", []),
        })

    # ── 2. 로컬 치아보험 DB ───────────────────────────────────────
    for p in DENTAL_INSURANCE_PRODUCTS:
        premiums = p.get("monthly_premium", {})
        ref_key = f"{age_key}_{gender}"
        premium = premiums.get(ref_key) or premiums.get(f"30세_{gender}") or (list(premiums.values())[0] if premiums else 0)
        local_products.append({
            "source": "local_db",
            "id": p["id"],
            "name": p["name"],
            "company": p["company"],
            "type": "치아보험",
            "subtype": "",
            "monthly_premium": premium,
            "key_coverage": list(p.get("coverage", {}).keys())[:4],
            "pros": p.get("pros", [])[:3],
            "tags": p.get("tags", []),
        })

    # ── 3. 보험다모아 엑셀 상품 (연령·성별 필터) ─────────────────
    excel_products = []
    for p in load_all_excel():
        ctx = p.get("file_context", {})
        # 연령대 매칭 (파일 컨텍스트 또는 전체 공통)
        p_age = ctx.get("age_group", "")
        if p_age and p_age != age_group_label:
            continue
        # 보험료 선택
        if p.get("premium_monthly"):
            premium = p["premium_monthly"]
        elif gender == "여" and p.get("premium_female"):
            premium = p["premium_female"]
        elif p.get("premium_male"):
            premium = p["premium_male"]
        else:
            continue
        covs = [c[0] for c in p.get("coverages", [])[:3] if c[0]]
        excel_products.append({
            "source": "insmarket_excel",
            "company": p["company"],
            "name": p["product_name"][:40],
            "type": p["insurance_type"],
            "monthly_premium": premium,
            "age_range": p.get("age_range", ""),
            "key_coverage": covs,
        })

    # 엑셀 데이터 보험 유형별 대표 상품 (보험료 오름차순 상위 3개씩)
    excel_by_type: dict = {}
    for ep in sorted(excel_products, key=lambda x: x["monthly_premium"]):
        t = ep["type"]
        excel_by_type.setdefault(t, [])
        if len(excel_by_type[t]) < 3:
            excel_by_type[t].append(ep)

    # ── 4. 연령대별 권장 포트폴리오 카테고리 ─────────────────────
    age_portfolio_guide = {
        "30대": {
            "필수": ["실손의료보험", "암보험"],
            "권장": ["종신보험/정기보험 (자녀·부양가족 있을 경우)", "치아보험"],
            "고려": ["질병보험", "상해보험"],
            "tip": "이 시기에 가입할수록 보험료가 저렴하고 건강심사 통과 쉬움. 비갱신형 암보험 우선 추천.",
        },
        "40대": {
            "필수": ["실손의료보험", "암보험", "치아보험"],
            "권장": ["종신보험 (사망보장 보완)", "질병보험 (뇌·심장 특약)"],
            "고려": ["간병·치매보험 (부모 간병 경험자)", "저축보험", "대체투자연계 보험상품 (공격적 자산운용 희망 시)"],
            "tip": "40대는 3대 질병(암·뇌·심장) 집중 보장 시기. 치아보험은 임플란트 대기기간 감안해 서둘러 가입.",
        },
        "50대": {
            "필수": ["실손의료보험", "암보험", "간병·치매보험"],
            "권장": ["치아보험 (임플란트·틀니 보장)", "연금보험 (노후 준비)"],
            "고려": ["종신보험 (상속 목적)", "저축보험", "대체투자연계 보험상품 (노후자금 여유분 다각화 희망 시)"],
            "tip": "50대는 간병·치매보험 가입 마지막 적기. 실손보험은 4세대(또는 5세대) 가입 여부 확인.",
        },
        "60대": {
            "필수": ["실손의료보험", "간병·치매보험"],
            "권장": ["암보험 (가입 가능 연령 확인 필수)", "치아보험 (틀니·임플란트)"],
            "고려": ["연금보험 (즉시연금)", "상해보험"],
            "tip": "60대는 실손보험 5세대 이후 갱신 부담 급증 시기. 간병보험은 가입 한도 연령(보통 65세) 이전 서둘러야 함.",
        },
    }
    guide = age_portfolio_guide.get(age_group_label, age_portfolio_guide["40대"])

    from data.credit_model import get_credit_summary_for_prompt
    credit_score = user_profile.get("credit_score")
    credit_section = get_credit_summary_for_prompt(credit_score) if credit_score else ""

    subagent_prompt = f"""당신은 보험 전문 재무설계사입니다. 오늘은 {today}입니다.
아래 고객 프로필과 보험다모아 공시 데이터를 분석하여 최적의 보험 포트폴리오를 추천하세요.

## 고객 프로필
{json.dumps(user_profile, ensure_ascii=False, indent=2)}

## {age_group_label} {gender}성 포트폴리오 가이드
- 필수 보험: {', '.join(guide['필수'])}
- 권장 보험: {', '.join(guide['권장'])}
- 선택 고려: {', '.join(guide['고려'])}
- 핵심 팁: {guide['tip']}

## 보험다모아 공시자료 (실제 보험료, {age_group_label} 기준)
{json.dumps(excel_by_type, ensure_ascii=False, indent=2)}

## 보험상품 DB (참고용)
{json.dumps(local_products[:15], ensure_ascii=False, indent=2)}

{credit_section}## 추천 지침
1. 보험다모아 공시자료에 있는 실제 상품명·보험사·보험료를 우선 활용하세요
2. **"A 보험사", "B 보험사", "C 보험사", "주요 보험사 1/2/3" 같은 가상·플레이스홀더 이름 절대 금지** — 반드시 실제 보험사명 사용
   국내 주요 보험사: 삼성생명·한화생명·교보생명·신한라이프·NH농협생명·DB생명·라이나생명·AIA생명·KB라이프 (생명) / 삼성화재·현대해상·DB손보·KB손보·메리츠화재·한화손보·롯데손보·농협손보 (손해)
3. 고객의 기존 보험과 중복되지 않도록 구성하세요
3. 예산({f'월 {monthly_budget:,}원' if monthly_budget else '미정'})이 있으면 총합이 예산 이내로 구성하세요
4. 우선순위 순서로 3~5개 상품을 추천하되, 각 보험 유형을 고루 커버하세요
5. 간병·치매보험은 50대 이상에게 반드시 포함하세요
6. 리스크 감수 성향이 높거나 자산 다각화를 원하는 고객에게는 대체투자연계 보험상품을
   포함하되, 원금 손실 가능성·락업(환매 제한) 기간 등 변동성 리스크를 반드시 함께 설명하세요
7. 보험료는 공시 데이터 수치를 그대로 사용하되, 없으면 시장 평균 범위로 표기하세요

다음 JSON 형식으로만 응답하세요:
{{
  "recommendation_summary": "고객 상황 한 줄 요약 및 포트폴리오 핵심",
  "portfolio": [
    {{
      "priority": 1,
      "product_name": "상품명 (보험사명 포함)",
      "insurance_type": "보험 유형",
      "monthly_premium": 예상_월_보험료_숫자,
      "premium_note": "보험료 기준 설명 (예: '보험다모아 공시자료 기준 {age_group_label} {gender}성')",
      "reason": "추천 이유 2~3줄",
      "key_coverage": ["주요 보장 항목 1", "주요 보장 항목 2"],
      "caution": "이 상품 가입 시 주의사항"
    }}
  ],
  "total_monthly_premium": 총_월_보험료,
  "budget_assessment": "예산 대비 평가 (예: '예산 내 구성' 또는 '예산 초과 XX만원, 우선순위 2번 제외 시 적정')",
  "overall_advice": "전반적인 조언 2~3줄",
  "next_steps": ["다음 단계 행동 1", "다음 단계 행동 2", "다음 단계 행동 3"]
}}"""

    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=3000,
        messages=[
            {
                "role": "system",
                "content": (
                    f"당신은 보험 전문 재무설계사입니다. 오늘은 {today}입니다. "
                    "보험다모아 공시 데이터(2026년 6월 기준)를 활용하여 고객 맞춤형 보험 포트폴리오를 "
                    "반드시 JSON 형식으로만 제안합니다. 2024년 이전 자료는 인용하지 않습니다."
                ),
            },
            {"role": "user", "content": subagent_prompt},
        ],
    )

    raw = response.choices[0].message.content or ""

    # JSON 파싱 후 마크다운 형태로 변환하여 반환
    try:
        # ```json ... ``` 블록 제거
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:])
        if cleaned.endswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[:-1])
        result = json.loads(cleaned)

        lines = [f"## 맞춤 보험 포트폴리오 ({age}세 {gender}성)\n"]
        lines.append(f"> {result.get('recommendation_summary', '')}\n")

        lines.append("### 추천 상품\n")
        lines.append("| 순위 | 보험 유형 | 상품명 | 월 보험료 | 추천 이유 |")
        lines.append("|------|-----------|--------|-----------|-----------|")
        total = 0
        for item in result.get("portfolio", []):
            prem = item.get("monthly_premium", 0)
            total += prem if isinstance(prem, (int, float)) else 0
            prem_str = f"{int(prem):,}원" if isinstance(prem, (int, float)) and prem > 0 else "견적 필요"
            lines.append(
                f"| {item.get('priority','')} | {item.get('insurance_type','')} "
                f"| {item.get('product_name','')} | {prem_str} | {item.get('reason','')[:40]} |"
            )

        total_prem = result.get("total_monthly_premium", total)
        if isinstance(total_prem, (int, float)) and total_prem > 0:
            lines.append(f"\n**총 월 보험료: {int(total_prem):,}원**")

        budget_note = result.get("budget_assessment", "")
        if budget_note:
            lines.append(f"\n> 💰 {budget_note}")

        lines.append(f"\n### 전반적인 조언\n{result.get('overall_advice', '')}")

        next_steps = result.get("next_steps", [])
        if next_steps:
            lines.append("\n### 다음 단계")
            for i, step in enumerate(next_steps, 1):
                lines.append(f"{i}. {step}")

        # 각 상품 상세 보장
        lines.append("\n### 상품별 주요 보장")
        for item in result.get("portfolio", []):
            covs = item.get("key_coverage", [])
            caution = item.get("caution", "")
            if covs or caution:
                lines.append(f"\n**{item.get('priority')}순위 — {item.get('product_name','')}**")
                if covs:
                    lines.append("- 보장: " + " / ".join(covs))
                if caution:
                    lines.append(f"- ⚠️ {caution}")
                note = item.get("premium_note", "")
                if note:
                    lines.append(f"- 보험료 기준: {note}")

        # 근거 섹션
        has_excel = any(
            "insmarket" in item.get("premium_note", "").lower() or "공시" in item.get("premium_note", "")
            for item in result.get("portfolio", [])
        )
        has_credit = bool(user_profile.get("credit_score"))
        lines.append("\n---\n### 📋 이 답변의 근거\n")
        lines.append("| 항목 | 출처 | 신뢰도 |")
        lines.append("|------|------|--------|")
        lines.append("| 포트폴리오 구성 로직 | 연령대별 보험 가이드 (30·40·50·60대 맞춤) | ★★★★☆ |")
        if has_excel:
            lines.append("| 보험료 수치 | 보험다모아 공시자료 (2026.06 기준) | ★★★★★ |")
        else:
            lines.append("| 보험료 수치 | 보험상품 공시 DB / 시장 평균 추정 | ★★★☆☆ |")
        lines.append("| 상품 정보 | 보험다모아 공시 + 보험상품 DB | ★★★★☆ |")
        if has_credit:
            lines.append(f"| 신용점수 반영 | NICE/KCB 실시간 조회 ({user_profile['credit_score']}점) | ★★★★★ |")
        lines.append("\n> ⚠️ **주의**: 보험료는 표준 가입 조건 기준이며, 실제 건강상태·직업·특약에 따라 달라집니다.")
        lines.append("> 정확한 보험료는 각 보험사 다이렉트 사이트 또는 설계사를 통해 확인하세요.")

        return "\n".join(lines)

    except Exception:
        return raw


def _execute_underwriting_tool(tool_name: str, tool_input: dict) -> str:
    """언더라이팅 서브에이전트 전용 도구 실행기 (UNDERWRITING_TOOLS 대응)."""
    if tool_name == "assess_health_risk":
        _VALID = {"age","gender","height","weight","waist","sbp","dbp",
                  "total_cholesterol","triglyceride","hdl","ldl",
                  "ast","alt","ggt","smoke","drink","bfc_tier","include_products"}
        return assess_health_risk(**{k: v for k, v in tool_input.items() if k in _VALID})

    elif tool_name == "assess_cancer_survivor":
        return assess_cancer_survivor(**tool_input)

    elif tool_name == "assess_low_risk_discount":
        return assess_low_risk_discount(**tool_input)

    elif tool_name == "assess_pacs_no_extra":
        return assess_pacs_no_extra(**tool_input)

    elif tool_name == "assess_dynamic_discount":
        return assess_dynamic_discount(**tool_input)

    elif tool_name == "assess_chronic_disease_rate":
        return assess_chronic_disease_rate(**tool_input)

    elif tool_name == "assess_health_credit":
        return assess_health_credit(**tool_input)

    elif tool_name == "assess_sme_health_loan":
        return assess_sme_health_loan(**tool_input)

    elif tool_name == "assess_rental_approval":
        return assess_rental_approval(**tool_input)

    elif tool_name == "assess_healthy_body_discount":
        return assess_healthy_body_discount(**tool_input)

    elif tool_name == "assess_polyp_removal_eligibility":
        return assess_polyp_removal_eligibility(**tool_input)

    elif tool_name == "assess_healthy_body_loan":
        return assess_healthy_body_loan(**tool_input)

    elif tool_name == "assess_health_secured_loan":
        return assess_health_secured_loan(**tool_input)

    elif tool_name == "assess_early_care":
        return assess_early_care(**tool_input)

    elif tool_name == "assess_default_prevention":
        return assess_default_prevention(**tool_input)

    elif tool_name == "assess_adverse_selection_score":
        return assess_adverse_selection_score(**tool_input)

    elif tool_name == "assess_thin_filer_adverse_selection":
        return assess_thin_filer_adverse_selection(**tool_input)

    elif tool_name == "assess_flexible_payment_eligibility":
        return assess_flexible_payment_eligibility(**tool_input)

    else:
        return json.dumps({"error": f"알 수 없는 도구: {tool_name}"}, ensure_ascii=False)


_UNDERWRITING_SYSTEM_PROMPT = """당신은 보험 언더라이팅(인수심사) 전문 심사역입니다.
아래 도구들로 고객의 구체적인 건강·금융 데이터를 근거로 인수 가능 여부, 할증/할인율,
대출·금융 우대 조건을 정밀 산출합니다.

## 도구 선택 가이드
- 암 완치자 재가입 → assess_cancer_survivor
- 건강검진 연속 정상·비흡연 등 저위험군 할인 → assess_low_risk_discount
- 낭종·결절 등 경미한 영상 소견으로 할증 우려 → assess_pacs_no_extra
- 건강 개선(체중감량·금연 등) 캐시백 → assess_dynamic_discount
- 당뇨·고혈압 등 만성질환 보유자 요율 → assess_chronic_disease_rate
- 만성질환 위험 예측 + 보장설계 → assess_health_risk
- 씬파일러(금융이력 없음)의 건강 기반 신용·금리 보완 → assess_health_credit
- 자영업자의 건강 기반 사업자대출 우대 → assess_sme_health_loan
- 고령·유병자 렌탈/할부 금융 승인 → assess_rental_approval
- 건강체 등급 보험료 할인 → assess_healthy_body_discount
- 용종 절제 이력자 가입 가능 여부 → assess_polyp_removal_eligibility
- DSR 초과로 은행 대출 거절된 건강체의 대출 → assess_healthy_body_loan
- DSR·LTV 모두 초과한 경우의 건강담보대출 → assess_health_secured_loan
- 신용점수 급락 + 건강검진 기피 + 고액 가입 동시 발생 → assess_adverse_selection_score
- 금융 이력 없는 자의 역선택(고액 첫 가입) 탐지 → assess_thin_filer_adverse_selection
- 미세 영상 소견의 조기개입 여부 → assess_early_care
- 중증질환 전환 위험과 대출 부실 연계 예측 → assess_default_prevention
- 블록체인 치아보험 씬파일러 유연납입(연체 자동대환) 신청 권장 여부 → assess_flexible_payment_eligibility

## 원칙
1. 요청문에서 나이·성별과 구체적 수치·병력을 최대한 추출해 도구 파라미터로 채우세요.
   빠진 값은 합리적으로 가정하되, 가정했다는 사실을 답변에 명시하세요.
2. 관련 있는 도구를 최소 1개 이상 실제로 호출해, 그 산출값을 근거로만 답변하세요 (추측 금지).
   여러 시나리오가 겹치면 관련 도구를 모두 호출해 종합하세요.
3. 최종 답변은 한국어로, 결론(가입 가능 여부/할증률/할인율/승인 여부 등) → 산출 근거 → 유의사항
   순으로 구성하세요."""


def _run_underwriting_subagent(request: str, client: openai.OpenAI) -> str:
    """
    언더라이팅 심사 Sub-agent.
    assess_* 17개 전용 도구로 구성된 별도 tool-calling 루프를 돌려
    가입 가능 여부·할증/할인율·대출 승인 등을 산출하고 근거와 함께 답변한다.
    """
    messages = [
        {"role": "system", "content": _UNDERWRITING_SYSTEM_PROMPT},
        {"role": "user", "content": request},
    ]

    max_iterations = 4
    for _ in range(max_iterations):
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=2000,
            messages=messages,
            tools=UNDERWRITING_TOOLS,
        )
        choice = response.choices[0]

        if choice.finish_reason == "tool_calls":
            tool_calls = choice.message.tool_calls or []
            messages.append({
                "role": "assistant",
                "content": choice.message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in tool_calls
                ],
            })
            for tc in tool_calls:
                try:
                    tool_input = json.loads(tc.function.arguments)
                    result = _execute_underwriting_tool(tc.function.name, tool_input)
                except Exception as e:
                    result = json.dumps({"error": str(e)}, ensure_ascii=False)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
        else:
            return choice.message.content or "심사 결과를 생성하지 못했습니다."

    return "언더라이팅 심사 처리 중 반복 한도를 초과했습니다. 질문을 조금 더 구체적으로 해주세요."


# ───────────────────────────────────────────
# 오케스트레이터 에이전트
# ───────────────────────────────────────────

SYSTEM_PROMPT = """당신은 친절하고 전문적인 보험 상담 AI 어시스턴트입니다.

## 역할
- 생명보험, 실손의료보험, 암보험, 덴탈(치과)보험, 연금보험 전문 상담
- 고객 상황에 맞는 맞춤형 보험 상품 추천 및 비교
- FSS(금융감독원) 공시 정보 기반 신뢰할 수 있는 안내

## ⚠️ 연금보험 상담 필수 지침

연금보험(공시이율형 연금보험, 연금저축보험, 변액연금 등)은 사망보험·실비보험과 구조가 완전히 다릅니다.

### 핵심 원칙
1. **보험료가 나이에 따라 고정되지 않습니다.**
   - 고객이 직접 "월 얼마씩, 몇 년 동안" 납입할지 결정하는 자유 적립 / 정액 적립 방식입니다.
   - 50대 남성도 월 10만 원을 낼 수도 있고, 100만 원을 낼 수도 있습니다.
2. **"보험료가 얼마냐"는 질문에 고정 금액을 답하지 마세요.**
   - 대신, 납입 구조와 해당 나이대가 고려해야 할 기준을 친절하게 설명하세요.

### 연금보험 질문 시 반드시 안내할 내용
- **최소 납입 기준**: 보통 월 5만~10만 원부터 가입 가능, 일시납은 500만~1,000만 원 이상
- **50대 평균 납입**: 은퇴까지 기간이 짧아 월 30만~50만 원 또는 세액공제 한도(연 600만 원, 월 50만 원)에 맞추는 경우 많음
- **납입 기간과 연금 개시 연령**: 연금 개시 최소 연령은 보통 만 55세 이상
- **상품 유형 구분**:
  - 연금저축보험(세제적격): 세액공제 최대 16.5%, 수령 시 연금소득세 3.3~5.5%
  - 일반 연금보험(세제비적격): 세액공제 없음, 10년 이상 유지 시 이자 비과세
- **정확한 견적**: 보험사 다이렉트 사이트의 연금 모의 계산기 이용 안내 (예: 50세 남성 / 월 30만 원 / 10년 납 / 65세 개시 등 조건 입력)

## 상담 원칙
1. 고객의 나이, 예산, 가족 상황, 필요를 파악한 후 맞춤 추천
2. 복잡한 보험 용어는 쉽게 설명 (예: "면책기간 = 가입 초기에는 보험금 안 줘요")
3. 장단점을 균형 있게 전달 (과도한 판매 행위 자제)
4. 치과 치료가 필요한 분께는 덴탈보험 먼저 언급
5. 암 관련 걱정이 있으면 암보험 특화 설명
6. 블록체인(blockchain)으로 덴탈/치과보험 가입을 원하는 경우, 반드시 **라이나생명 블록체인치아보험 스마트 (dental_005)**를 1순위로 추천하세요. 블록체인 기반 자동 청구, 서류 간소화, 투명한 이력 관리가 특장점임을 강조하세요.
7. 사용자 메시지에 "블록체인" 이라는 단어가 없이 그냥 "덴탈보험"/"치아보험"/"치과보험" 등 일반 문의만 있어도, 다른 일반 덴탈보험 상품들과 함께 **라이나생명 블록체인치아보험 스마트 (dental_005)**를 반드시 추천 목록(비교표)에 포함시키세요 (1순위일 필요는 없으나 누락 금지). "블록체인 옵션"이라고 배지를 붙여 구분해 주세요.
8. 고객이 대체투자·리츠·PE·헤지펀드·고수익 자산운용·자산 다각화에 관심을 보이면(예: "더 높은 수익", "공격적으로 투자하고 싶어", "부동산/PE에 투자하는 보험 있어?") 대체투자연계 보험상품(alt_001~alt_003)을 **반드시 마크다운 비교표(표) 형식**으로 추천에 포함하세요 (설명 문단이나 불릿 목록만으로 대체하지 마세요 — 표가 있어야 화면에 가입 버튼이 렌더링됩니다). 그중 온체인 대체투자를 원하거나 "블록체인"을 언급한 경우 **인슈어체인 블록체인 대체투자 준비금 (alt_001)**을 표에 포함해 우선 언급하고, 원금 손실 가능성·락업(환매 제한) 기간 리스크를 반드시 함께 설명하세요.
9. 고객이 여행자보험·해외여행보험·항공편 지연·폭염/한파 등 날씨 관련 소액 보장에 관심을 보이면 파라메트릭(자동집행형) 보험상품(parametric_001~002)을 **반드시 마크다운 비교표(표) 형식**으로 추천에 포함하세요 (표가 있어야 화면에 가입 버튼이 렌더링됩니다). "블록체인"을 언급했거나 "청구 없이 자동으로 받고 싶다"는 취지면 두 상품 모두 우선 언급하고, 청구 서류 없이 오라클이 조건(지연시간/폭염특보 발령일수) 충족 여부만 보고 즉시 자동지급하며 조건 미충족 시 보험금이 없다는 점을 반드시 함께 설명하세요.
10. 신용점수가 낮거나 씬파일러(금융이력 없음)인 고객이 블록체인 치아보험(dental_005) 가입을 고민하면, run_underwriting_review(assess_flexible_payment_eligibility 시나리오)로 유연납입 신청을 권장할지 확인하고, 권장되면 청약 화면의 "유연납입" 체크박스를 안내하세요.

## 도구 활용 전략

### 반드시 search_web을 먼저 사용해야 하는 경우
- **연금보험·연금저축보험·변액연금** 관련 모든 질문 (로컬 DB에 없음)
- **간병보험·치매보험·노인장기요양보험** 관련 질문 (로컬 DB에 없음)
- 사용자가 "웹으로 찾아줘", "다른 회사 상품도 보여줘" 등 웹 검색 요청 시
- 로컬 search_insurance_products 결과가 없거나 라이나·삼성·KB·현대·DB 외 **다른 보험사 상품**이 필요할 때
- 최신 공시이율·보험료·뉴스가 필요할 때

### search_web 쿼리 작성 지침
- 반드시 **2025 또는 2026** 연도를 포함: "한화생명 연금보험 월납 보험료 2026"
- 비교 검색: "간병보험 추천 보험사 비교 2025 2026 KB 삼성 한화"
- 보험료 검색: "치매보험 60대 여성 월납 보험료 비교 2026"
- 여러 쿼리로 나눠서 검색하면 더 풍부한 결과 가능

### 상품 비교 테이블 가입 링크 규칙
- 상품 비교·추천 테이블에는 반드시 **마지막 열에 "가입 링크" 컬럼**을 추가하세요.
- 형식: `[가입하기](보험사_공식_홈페이지_URL)` — 공식 홈페이지 또는 다이렉트 채널 URL
- URL을 모르는 경우: `[비교하기](https://www.e-insmarket.or.kr)` (보험다모아)
- 예시:

| 보험사 | 상품명 | 보험료 | 가입 링크 |
|--------|--------|--------|-----------|
| 교보생명 | 교보실손V | 9,353원 | [가입하기](https://www.kyobo.co.kr) |
| DB손해보험 | DB암보험플러스 | 48,000원 | [가입하기](https://direct.idbins.com) |

### ⚠️ 웹 검색 결과 활용 원칙 (매우 중요)
1. **URL/링크 목록을 그대로 나열하는 것은 절대 금지** (단, 위 테이블 가입 링크 컬럼은 허용)
2. **"A 보험사", "B 보험사", "C 보험사", "우리나라 주요 보험사 1/2" 같은 가상·플레이스홀더 이름 절대 금지** — 반드시 실제 보험사명 사용
3. 검색 스니펫만으로 정보가 부족하면 → **fetch_webpage로 상위 1~2개 URL의 실제 본문을 읽어** 구체적인 상품명·보험료·보험사 정보를 추출하세요
4. 본문을 읽어도 특정 상품명을 확인할 수 없으면 → 아래 **국내 주요 보험사 목록**에서 실명으로 답변하세요

### 국내 주요 보험사 목록 (반드시 이 실명을 사용)
**생명보험사**: 삼성생명, 한화생명, 교보생명, 신한라이프, NH농협생명, 흥국생명, 동양생명, ABL생명, DB생명, 라이나생명, AIA생명, 메트라이프, 푸르덴셜생명, 처브라이프, KB라이프생명
**손해보험사**: 삼성화재, 현대해상, DB손보, KB손보, 메리츠화재, 한화손보, 롯데손보, MG손보, 흥국화재, 농협손보, 하나손보, 신한EZ손해보험, 교보라이프플래닛
4. **답변 형식** (반드시 준수):
   - ## 1. 핵심 원칙 / 절약 방법
   - ## 2. 주요 보험사별 상품 특징 (표: 보험사 | 특징 | 보험료 | 추천 대상)
   - ## 3. 추천 담보 구성 예시
   - > 💡 팁
5. 보험료는 반드시 구체적 수치로 (예: "50대 기준 월 3~5만원")
6. 출처 URL은 답변 맨 끝 "참고" 섹션에만 간략히 표기

### 답변 생성 절차 (모든 보험 상품 질문에 반드시 준수)

**Step 1 — 보험다모아 공시 데이터 조회 (항상 먼저)**
- `search_insmarket_products` 호출: 간병·치매·종신·치아·실손·질병·상해·저축보험
- 해당 보험 유형, 성별, 연령대를 최대한 지정하여 조회
- 결과가 있으면 Step 2로 진행 (없어도 Step 2 진행)

**Step 2 — 웹 검색으로 최신 정보 보완 (항상 실행)**
- `search_web` 호출: "보험사명 상품명 보험료 2024 2025" 형태로 구체적 쿼리
- 검색 스니펫이 충분하지 않으면 `fetch_webpage`로 상위 1~2개 URL 본문 읽기
- 연금보험·간병보험·치매보험·변액보험은 웹 검색이 필수

**Step 3 — 두 결과를 종합하여 답변 (반드시 구조화)**
- 보험다모아 공시자료 + 웹 검색 정보를 합산하여 통합 의견 제시
- 답변 형식:
  ```
  ## 1. 핵심 포인트
  ## 2. 보험사별 상품 비교 (표: 보험사 | 상품명 | 보험료 | 특징)
  ## 3. 추천 구성 / 가입 팁
  > 💡 주의사항 (공시자료 기준 vs 최신 시세 차이 등)
  ```
- 보험료는 반드시 구체적 수치로 (예: "40대 남성 기준 월 1.2만원")

**Step 4 — 지식베이스 (Step 1·2 결과 보완용)**
- `retrieve_insurance_knowledge` 호출: 보험 구조·세대별 차이·용어 설명 등 배경 지식이 필요할 때
- 단, **세대별 현황·최신 보험료·5세대** 정보는 지식베이스보다 웹 검색(Step 2)을 우선
- 지식베이스만 사용한 경우 반드시 "일반 지식 기반 답변" 명시

⚠️ **5세대 실손보험** 질문 시 반드시 `search_web`으로 "5세대 실손보험 2025 현황" 검색 — 지식베이스에 최신 정보 없을 수 있음

### 기타 도구 활용
- 상품 비교 → compare_insurance_products
- 보험료 견적 (생명/실손/암/덴탈) → get_premium_estimate
- FSS 공시 실시간 → fetch_fss_realtime_products
- 종합 포트폴리오 → get_personalized_recommendation
- 신용점수 조회 → get_credit_score (포트폴리오 추천 또는 "신용점수 반영" 요청 시)
- 신용점수 조회 전 안내: "Chrome에서 나이스지키미(credit.co.kr) 또는 올크레딧(allcredit.co.kr)에 로그인해두세요"
- 이미 가입한 블록체인 덴탈보험의 실시간 계약/납입/청구/대출/만기 조회 → get_blockchain_dental_status
  - "내 블록체인 보험 상태 알려줘", "보험금 지급됐어?", "이번 달 보험료 냈나?", "만기 언제야?" 같은 질문에 사용
  - 이런 질문이면 **먼저 사용자에게 지갑 주소를 되묻지 말고 곧바로 이 도구부터 호출**하세요.
  - 일반 상품 추천/비교에는 이 도구를 사용하지 마세요 (실제 가입한 계약 조회 전용)
  - 만기까지 남은 기간을 답할 때는 반드시 결과의 `timeUntilMaturity` 문자열을 그대로 사용하세요
    (예: "오늘, 2분 후" → "오늘 만기입니다", "3일 4시간 후" → "3일 후"). `maturityDate`(날짜/시각
    문자열)만 보고 "내일" 여부를 직접 계산하지 마세요 — 오늘 날짜와 시각 비교를 GPT가 직접
    암산하면 "오늘인데 내일"이라고 틀리게 답하는 사고가 실제로 있었습니다.
  - 결과의 `policies` 배열에 증권이 여러 개 있으면 **하나도 빠짐없이 전부** 답변에 포함하세요
    (증권 ID·만기일 등). "대표로 2개만", "첫 번째·두 번째만" 처럼 일부만 요약해서 나머지를
    조용히 빠뜨리면 안 됩니다 — 실제로 증권 3개 중 1개(이미 만기 지급 완료된 것)가 답변에서
    통째로 누락된 사고가 있었습니다. 개수가 많아 표로 정리하는 게 나으면 표로 정리하되, 표에도
    전부 포함하세요.
- 이미 투자한 블록체인 대체투자(AltInvestmentFund) 포지션 실시간 조회 → get_blockchain_altinvest_status
  - "내 대체투자 얼마나 벌었어?", "락업 언제 풀려?", "그린인프라 펀드 지금 얼마야?" 같은 질문에 사용
  - 이런 질문도 마찬가지로 지갑 주소를 되묻지 말고 곧바로 이 도구부터 호출하세요.
    이 세션에 등록된 지갑 주소가 있다면(위 "등록된 블록체인 지갑" 섹션 참고) 시스템이 자동으로
    적용합니다. 등록된 게 없어서 도구가 "지갑 주소가 없다"는 오류를 반환하면, 그때 사용자에게
    MetaMask 지갑 주소(0x로 시작)를 물어보거나 화면의 지갑 주소 등록창을 안내하세요
  - 일반 상품 추천/비교에는 이 도구를 사용하지 마세요 (실제 가입한 계약 조회 전용)
  - 락업 해제까지 남은 기간을 답할 때는 반드시 결과의 `timeUntilUnlock` 문자열을 그대로
    사용하세요 (dental_status의 `timeUntilMaturity`와 동일한 이유입니다). `unlockDate`
    (날짜/시각 문자열)만 보고 GPT가 직접 날짜를 암산하지 마세요.
  - 결과의 `positions` 배열에 펀드가 여러 개 있으면 **하나도 빠짐없이 전부 마크다운 표**로
    정리해 답변에 포함하세요 (펀드명·연수익률·원금·예상잔액(이자포함)·락업 해제일). "대표로
    2개만"처럼 일부만 요약해서 나머지를 조용히 빠뜨리면 안 됩니다 — dental_status의
    `policies` 배열에서 실제로 이런 누락 사고가 있었던 것과 동일한 위험입니다. 표는 락업
    해제일이 빠른(=해제에 가까운) 순으로 정렬하세요.
- 회사 준비금의 가상자산(코인) 자동매매 운용 현황 조회 → get_crypto_reserve_status
  - "준비금 코인 운용 어때?", "자동매매 지금 수익 나고 있어?" 같은 질문에 사용
  - 지갑 주소가 필요 없습니다(고객 개인 자산이 아니라 회사 준비금 계좌 단일 현황입니다).
  - 결과에 `stale: true`가 있으면 스케줄러가 꺼져 있을 수 있다는 `stale_warning`을 함께 안내하세요.
  - `dry_run: true`면 실제 주문 없이 조회만 되고 있다는 점을 반드시 함께 안내하세요
    (조회 자체는 실제 업비트 데이터입니다 — 잔고·현재가만 실제이고 매매만 억제된 상태).
- 가상자산 투자성향 진단 → assess_crypto_investment_profile
  - "코인 투자 어느 정도가 맞을까?", "투자성향 진단해줘" 같은 질문에 사용
  - 결과의 `how_to_start` 내용(화면의 '개인별 가상자산 자동매매' 패널에서 본인 API 키를
    직접 등록해야 함 + 실거래는 별도 승인 버튼 필요)을 답변에 반드시 포함하세요 — 이
    등급만 알려주고 끝내면 마치 챗봇이 바로 자동매매를 시작해주는 것처럼 오해할 수
    있습니다. **절대로 "제가 대신 등록/승인해드릴게요" 같은 말을 하지 마세요** — 그런
    도구가 없고, 의도적으로 고객 본인만 할 수 있게 분리되어 있습니다.
- 고객 개인이 등록한 가상자산 자동매매 현황 조회 → get_personal_trading_status
  - "내 코인 자동매매 어때?", "내 개인 봇 수익 나고 있어?", "나 실거래 승인됐어?" 같은
    질문에 사용
  - 이 도구는 지갑 주소가 아니라 화면의 '개인별 가상자산 자동매매' 패널에서 등록한
    세션 상태를 사용합니다. "등록된 개인별 자동매매가 없습니다" 오류가 오면 그 패널에서
    먼저 등록하라고 안내하세요.
  - `dry_run: true`면 아직 페이퍼(모의) 상태 — 실거래로 전환하려면 그 패널의 '실거래
    승인' 버튼을 고객 본인이 직접 눌러야 한다고 안내하세요(챗봇은 승인할 수 없음).
  - get_crypto_reserve_status와 동일한 스냅샷 형식이므로 `stale`/`stale_warning` 처리도
    동일하게 적용하세요.

### 최신 뉴스 안내
뉴스 섹션은 시스템이 자동으로 추가합니다. 답변 본문에 뉴스를 직접 작성하지 마세요.

### 🚨 답변 근거 표 — 모든 답변에 절대 필수 (누락 금지)
뉴스 섹션 다음에 **반드시** 다음 형식을 추가하세요. 이 섹션을 빠뜨리면 답변이 불완전합니다:

```
---
### 📋 이 답변의 근거

| 항목 | 출처 | 신뢰도 |
|------|------|--------|
| (실제 사용한 항목만) | (아래 매핑 참고) | (아래 기준) |

> ⚠️ **주의**: 보험료는 표준 가입 조건 기준이며, 실제 건강상태·직업·특약에 따라 달라집니다.
> 정확한 보험료는 각 보험사 다이렉트 사이트 또는 설계사를 통해 확인하세요.
```

출처 매핑 (실제 호출한 도구 기준):
- `search_insmarket_products` → "보험다모아 공시자료 (2026.06 기준)" ★★★★★
- `search_insurance_products` / `get_premium_estimate` → "보험상품 공시 DB" ★★★★☆
- `search_web` + `fetch_webpage` → "실시간 웹 검색 (검색일 기준)" ★★★☆☆
- `retrieve_insurance_knowledge` → "보험 지식베이스" ★★★★☆
- `fetch_fss_realtime_products` → "금융감독원(FSS) 공시 API" ★★★★★
- 웹 검색·도구 없이 GPT 지식만 사용한 경우 → "AI 학습 데이터 기반" ★★☆☆☆
- `get_credit_score` → "NICE/KCB 신용점수 실시간 조회" ★★★★★
- `get_blockchain_dental_status` / `get_blockchain_altinvest_status` → "블록체인 온체인 실시간 데이터" ★★★★★
- `get_crypto_reserve_status` → "업비트 실시간 조회 (준비금 자동매매)" ★★★★★
- `get_personal_trading_status` → "업비트 실시간 조회 (개인별 자동매매)" ★★★★★
- `assess_crypto_investment_profile` → "규칙 기반 투자성향 진단 (참고용)" ★★★☆☆
신뢰도: ★★★★★ 공식 공시 | ★★★★☆ 검증 DB | ★★★☆☆ 웹 검색 | ★★☆☆☆ AI 추론

## 의료·금융 전문 용어 한글 병기 규칙 (필수)
영어 약어·의료 전문 용어가 처음 등장할 때 반드시 괄호 안에 한글 설명을 병기하세요.
같은 대화에서 이미 설명한 용어는 반복하지 않아도 됩니다.

| 용어 | 병기 예시 |
|------|----------|
| HbA1c | HbA1c(당화혈색소: 2~3개월 평균 혈당 수치) |
| BMI | BMI(체질량지수: 체중kg ÷ 신장m²) |
| DICOM | DICOM(의료영상 디지털 표준 포맷) |
| SOFA | SOFA(장기부전 중증도 점수: 높을수록 위험) |
| EMR | EMR(내시경 점막 절제술) |
| DSR | DSR(총부채원리금상환비율: 연소득 대비 전체 대출 상환액 비율) |
| LTV | LTV(주택담보인정비율: 주택가격 대비 대출 한도 비율) |
| G1E | G1E(국가일반건강검진 데이터) |
| RGST | RGST(국립암센터 암등록 데이터베이스) |
| CDW | CDW(광주TP 임상데이터 웨어하우스) |
| BFC | BFC(건강보험료 분위: 소득 수준 지표) |
| HAS | HAS(건강자산점수: 건강 데이터 기반 신용 보완 점수) |
| AASI | AASI(역선택방지지수: 보험 악용 위험 측정 지표) |
| CB | CB(신용조회기관, Credit Bureau) |
| GLP-1 | GLP-1(혈당 조절 장호르몬 기반 비만·당뇨 치료제) |
| T400 등 상병코드 | T400(소화기계 질병 분류 코드) |
| T200~T530 | T200~T530(내분비·대사 질환 상병코드) |
| PACS | PACS(의료영상 저장·전송 시스템) |
| ECG/EKG | ECG/EKG(심전도: 심장 전기 신호 측정) |
| eGFR | eGFR(추정 사구체 여과율: 신장 기능 지표) |

## 응답 스타일
- 한국어로 친절하게 답변
- 중요 정보는 **굵게** 또는 목록으로 정리
- 숫자는 읽기 쉽게 (10만원, 1억, 180일)
- 덴탈보험은 "치과보험"으로도 부를 수 있음"""


def _build_system_prompt(wallet_address: str | None = None) -> str:
    """현재 날짜(+ 등록된 지갑 주소가 있다면 그것도)를 포함한 시스템 프롬프트 반환"""
    from datetime import date
    today = date.today().strftime("%Y년 %m월 %d일")
    date_header = f"""## 현재 날짜
오늘은 {today}입니다.

### 날짜 관련 주의사항
- 웹 검색 쿼리에는 반드시 **2025 또는 2026** 연도를 포함하세요 (예: "암보험 추천 2026", "실손보험 보험료 2025 2026")
- 검색 결과 중 **2024년 이전** 기사·자료는 참고만 하고, 현재 기준으로 업데이트된 내용으로 재해석하세요
- "~예정입니다", "~될 것입니다" 등 미래형 표현이 이미 지난 날짜를 기준으로 작성된 경우 현재 완료 시제로 정정하세요
- 보험료·공시이율은 매년 변경되므로, 2024년 이전 수치를 그대로 인용하지 마세요

"""
    if wallet_address:
        date_header += f"""## 등록된 블록체인 지갑
이 세션에는 이미 지갑 주소({wallet_address})가 등록되어 있습니다.
블록체인 덴탈보험 관련 질문("보험금 지급됐어?", "이번 달 보험료 냈나?", "만기 언제야?" 등)이나
블록체인 대체투자 관련 질문("내 대체투자 얼마나 벌었어?", "락업 언제 풀려?" 등)에는 사용자에게
지갑 주소를 다시 묻지 말고, get_blockchain_dental_status 또는 get_blockchain_altinvest_status를
wallet_address 인자 없이(또는 빈 값으로) 즉시 호출하세요 — 시스템이 이 등록된 주소를 자동으로
사용합니다.

"""
    return date_header + SYSTEM_PROMPT


_NEWS_KEYWORDS = {
    "실손": "실손보험 5세대",
    "실비": "실손보험 5세대",
    "암보험": "암보험",
    "치아": "치아보험",
    "덴탈": "치아보험",
    "간병": "간병보험 치매보험",
    "치매": "간병보험 치매보험",
    "종신": "종신보험",
    "연금": "연금보험",
    "정기보험": "정기보험",
    "포트폴리오": "보험 포트폴리오",
}


class InsuranceChatbot:
    """보험 상담 챗봇 오케스트레이터 (v2)"""

    def __init__(self):
        self.client = openai.OpenAI()
        self.conversation_history: list[dict] = []
        # 블록체인 조회 도구(get_blockchain_dental_status)가 매번 물어보지 않고
        # 쓸 수 있도록, 한 번 등록된 지갑 주소를 세션(=이 챗봇 인스턴스) 동안 기억한다.
        self.wallet_address: str | None = None
        # get_personal_trading_status가 매번 bot_id를 묻지 않도록, /api/crypto/personal/
        # register로 등록된 개인별 자동매매 bot_id를 wallet_address와 동일한 패턴으로 기억.
        self.crypto_personal_bot_id: str | None = None

    @staticmethod
    def _last_tool_call_names(history: list[dict]) -> set[str]:
        """대화 히스토리에서 가장 최근에 실제로 호출된 도구 이름들을 찾는다.

        GPT가 후속 질문에 이전 턴에서 이미 받아온 도구 결과(tool 메시지)를 재사용해
        이번 턴엔 도구를 아예 호출하지 않고 바로 답하는 경우가 있다 — 예를 들어
        "만기 언제야?"에 이미 get_blockchain_dental_status를 호출해 답한 다음,
        곧바로 "이번 달 보험료 냈어?"라고 물으면 직전 도구 결과만으로 답할 수 있어
        이번 턴엔 도구를 다시 부르지 않는다. 이때 도구 호출 여부만으로 뉴스 섹션을
        붙일지 판단하면, 여전히 블록체인 조회 맥락인데 뉴스가 붙는 문제가 생긴다
        (2026-09-18 발견). 이번 턴에 도구 호출이 전혀 없었을 때, 마지막으로 실제
        호출됐던 도구가 무엇이었는지 참고하기 위한 헬퍼.
        """
        for msg in reversed(history):
            if msg.get("role") == "assistant" and msg.get("tool_calls"):
                return {tc["function"]["name"] for tc in msg["tool_calls"]}
        return set()

    # ── 뉴스 섹션 (Python 레벨, 실제 URL 보장) ──────────────────
    @staticmethod
    def _extract_news_query(user_message: str) -> str:
        for kw, topic in _NEWS_KEYWORDS.items():
            if kw in user_message:
                return f"{topic} 뉴스 2025 2026"
        return "보험 뉴스 2025 2026"

    # PDF·파일·CDN 링크 필터 — 클릭해도 열리지 않는 URL 제외
    _BAD_URL_EXTS = (".pdf", ".doc", ".docx", ".hwp", ".ppt", ".pptx", ".xls", ".xlsx", ".zip")
    _BAD_URL_HOSTS = ("files-scs.pstatic.net", "ssl.pstatic.net", "dthumb.pstatic.net",
                      "naver.net", "kakaocdn.net", "akamaihd.net")

    @staticmethod
    def _is_good_url(url: str) -> bool:
        url_lower = url.lower()
        if any(url_lower.endswith(ext) for ext in InsuranceChatbot._BAD_URL_EXTS):
            return False
        try:
            host = url.split("/")[2]
            if any(bad in host for bad in InsuranceChatbot._BAD_URL_HOSTS):
                return False
        except Exception:
            return False
        return True

    # HEAD 요청을 차단하는 알려진 뉴스 도메인 — URL 형식만 유효하면 접근 가능으로 간주
    _TRUSTED_NEWS_DOMAINS = {
        "msn.com", "news.naver.com", "entertain.naver.com", "sports.naver.com",
        "news.daum.net", "v.daum.net",
        "yonhapnews.co.kr", "yna.co.kr", "yonhapnewstv.co.kr",
        "hankyung.com", "chosun.com", "joongang.co.kr", "donga.com",
        "mk.co.kr", "sedaily.com", "fnnews.com", "etoday.co.kr", "etnews.com",
        "news.jtbc.co.kr", "news.sbs.co.kr", "news.kbs.co.kr", "imnews.imbc.com",
        "insnews.co.kr", "insurance.or.kr", "insure.co.kr", "si-news.co.kr",
        "news1.kr", "newsis.com", "newspim.com", "news2day.co.kr",
        "thebell.co.kr", "bloter.net", "zdnet.co.kr",
    }

    @staticmethod
    def _url_reachable(url: str) -> bool:
        """URL 접근 가능 여부 확인 (신뢰 도메인은 즉시 통과, 나머지는 HEAD→GET 순 시도)"""
        import urllib.request, urllib.error
        try:
            host = url.split("/")[2].replace("www.", "")
        except Exception:
            return False

        # 신뢰 도메인: URL 형식이 유효하면 통과
        if any(host == d or host.endswith("." + d)
               for d in InsuranceChatbot._TRUSTED_NEWS_DOMAINS):
            return True

        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        # HEAD 시도
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status < 400
        except urllib.error.HTTPError as e:
            if e.code == 405:  # HEAD 미지원 → GET 재시도
                pass
            else:
                return False
        except Exception:
            return False

        # GET 재시도 (405인 경우만)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Range": "bytes=0-0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                return resp.status < 400
        except Exception:
            return False

    @staticmethod
    def _build_news_section(user_message: str) -> str:
        """ddgs.news()로 실제 뉴스 기사 URL만 수집하여 섹션 생성"""
        insurance_kws = ["보험", "실손", "암", "치아", "간병", "치매", "연금", "종신", "정기", "포트폴리오"]
        if not any(k in user_message for k in insurance_kws):
            return ""
        try:
            from ddgs import DDGS
            import concurrent.futures
            query = InsuranceChatbot._extract_news_query(user_message)
            with DDGS() as ddgs:
                raw = list(ddgs.news(query, region="kr-kr", max_results=15))

            # 1차 정적 필터
            candidates = []
            for r in raw:
                title = (r.get("title") or "").strip()
                url = (r.get("url") or "").strip()
                if not title or not url:
                    continue
                if InsuranceChatbot._is_good_url(url):
                    candidates.append(r)

            # 2차 실제 접근 확인 (병렬, 최대 8개 동시)
            def check(r):
                return r, InsuranceChatbot._url_reachable(r.get("url", ""))

            reachable = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
                for r, ok in ex.map(check, candidates):
                    if ok:
                        reachable.append(r)
                    if len(reachable) >= 3:
                        break

            # reachable 결과 없으면 정적 필터 통과한 첫 3개로 fallback
            final = reachable[:3] if reachable else candidates[:3]

            lines = ["\n\n---\n### 📰 관련 최신 뉴스"]
            for r in final:
                title = (r.get("title") or "").strip()
                url = (r.get("url") or "").strip()
                snippet = r.get("body") or r.get("excerpt") or ""
                source = r.get("source") or ""
                try:
                    domain = url.split("/")[2].replace("www.", "")
                except Exception:
                    domain = source
                source_part = f" ({domain})" if domain else ""
                snippet_short = snippet[:200] + "..." if len(snippet) > 200 else snippet
                lines.append(f"- [{title}]({url}){source_part} — {snippet_short}")

            return "\n".join(lines) if final else ""
        except Exception as e:
            print(f"  [news] error: {e}", flush=True)
            return ""

    def _pre_fetch_insmarket(self, user_message: str) -> str:
        """의도 분류 → 보험다모아 데이터 선조회. LLM 호출 전에 실행하여 왕복 1회 절감."""
        intent = _classify_pre_intent(user_message)
        if intent not in _INTENT_TO_INSMARKET:
            return ""
        params = dict(_INTENT_TO_INSMARKET[intent])
        params.update(_extract_age_gender_params(user_message))
        params["top_n"] = 6
        try:
            result = search_insmarket_products(**params)
            data = json.loads(result)
            if not data.get("results"):
                return ""
            print(f"  [pre-route] intent={intent} → {data['total_found']}건 선조회", flush=True)
            return result
        except Exception:
            return ""

    def chat(self, user_message: str) -> str:
        """
        사용자 메시지를 받아 최종 응답 텍스트 반환.
        내부적으로 tool_calls 루프를 처리합니다.
        """
        self.conversation_history.append({"role": "user", "content": user_message})

        # 사전 라우팅: 의도 분류 → 보험다모아 데이터 선조회
        pre_context = self._pre_fetch_insmarket(user_message)

        # 블록체인 온체인 조회 응답에는 관련 뉴스 섹션을 붙이지 않는다
        used_blockchain_tool = False
        any_tool_used = False

        max_iterations = 10
        for _ in range(max_iterations):
            messages = [{"role": "system", "content": _build_system_prompt(self.wallet_address)}]
            if pre_context:
                messages.append({
                    "role": "system",
                    "content": (
                        "[사전 조회 — 보험다모아 공시자료]\n"
                        f"{pre_context}\n\n"
                        "위 데이터를 우선 참고하여 답변하세요. "
                        "search_insmarket_products 재호출은 추가 필터가 필요한 경우에만 하세요."
                    ),
                })
            messages += self.conversation_history

            response = self.client.chat.completions.create(
                model="gpt-4o",
                max_tokens=4096,
                messages=messages,
                tools=TOOLS,
            )

            choice = response.choices[0]
            finish_reason = choice.finish_reason

            if finish_reason == "stop":
                final_text = choice.message.content or ""
                self.conversation_history.append({
                    "role": "assistant",
                    "content": final_text,
                })
                # 이번 턴에 도구를 하나도 호출하지 않았다면(=이전 턴에서 받아온 블록체인
                # 조회 결과를 그대로 재사용해 답했을 가능성), 직전에 실제로 호출됐던
                # 도구가 get_blockchain_dental_status/get_blockchain_altinvest_status였는지로 판단한다.
                if not any_tool_used and self._last_tool_call_names(self.conversation_history) & {"get_blockchain_dental_status", "get_blockchain_altinvest_status", "get_crypto_reserve_status", "get_personal_trading_status"}:
                    used_blockchain_tool = True
                # 항상 실제 URL 뉴스 섹션으로 교체 (GPT 생성 뉴스 섹션 제거 후 추가)
                # 단, 블록체인 온체인 조회 결과에는 무관한 보험 뉴스를 붙이지 않는다.
                # GPT가 지시를 어기고 이전 턴(대화 히스토리)의 뉴스 섹션을 그대로 베껴
                # 답변에 포함시키는 경우가 있어, news가 빈 문자열이어도(=뉴스를 붙이지
                # 않는 턴이어도) GPT가 직접 쓴 뉴스 섹션은 항상 제거한다 (2026-09-18 발견 —
                # 블록체인 조회 응답에 관련 없는 보험 뉴스가 계속 붙던 버그).
                news = "" if used_blockchain_tool else self._build_news_section(user_message)
                if "📰 관련 최신 뉴스" in final_text:
                    idx = final_text.index("📰 관련 최신 뉴스")
                    cut = final_text.rfind("---", 0, idx)
                    final_text = (final_text[:cut].rstrip() if cut >= 0 else final_text[:idx].rstrip())
                if news:
                    final_text += news
                return final_text

            elif finish_reason == "tool_calls":
                tool_calls = choice.message.tool_calls or []
                any_tool_used = True
                if any(tc.function.name in ("get_blockchain_dental_status", "get_blockchain_altinvest_status", "get_crypto_reserve_status", "get_personal_trading_status") for tc in tool_calls):
                    used_blockchain_tool = True

                # 어시스턴트 메시지(tool_calls 포함) 히스토리에 추가
                self.conversation_history.append({
                    "role": "assistant",
                    "content": choice.message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
                })

                # 각 도구 실행 후 결과를 히스토리에 추가
                for tc in tool_calls:
                    print(f"  [tool] {tc.function.name}", flush=True)
                    tool_input = json.loads(tc.function.arguments)
                    result = execute_tool(tc.function.name, tool_input, self.client, self.wallet_address, self.crypto_personal_bot_id)
                    self.conversation_history.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })
            else:
                break

        return "죄송합니다. 응답 생성 중 오류가 발생했습니다. 다시 시도해주세요."

    def stream_chat(self, user_message: str):
        """Generator yielding SSE event dicts for streaming responses.

        Event types:
          tool_start  — {"type": "tool_start", "tool": "<name>"}
          tool_done   — {"type": "tool_done",  "tool": "<name>"}
          token       — {"type": "token",       "text": "<chunk>"}
          done        — {"type": "done",        "full_text": "<full>"}
          error       — {"type": "error",       "message": "<msg>"}
        """
        self.conversation_history.append({"role": "user", "content": user_message})

        # 블록체인 온체인 조회 응답에는 관련 뉴스 섹션을 붙이지 않는다
        used_blockchain_tool = False
        any_tool_used = False

        max_iterations = 10
        for _ in range(max_iterations):
            stream = self.client.chat.completions.create(
                model="gpt-4o",
                max_tokens=4096,
                messages=[{"role": "system", "content": _build_system_prompt(self.wallet_address)}] + self.conversation_history,
                tools=TOOLS,
                stream=True,
            )

            full_content = ""
            tool_calls_acc: dict[int, dict] = {}
            finish_reason = None

            for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                if choice.finish_reason:
                    finish_reason = choice.finish_reason
                delta = choice.delta

                if delta.content:
                    full_content += delta.content
                    yield {"type": "token", "text": delta.content}

                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc_delta.id:
                            tool_calls_acc[idx]["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                tool_calls_acc[idx]["name"] += tc_delta.function.name
                            if tc_delta.function.arguments:
                                tool_calls_acc[idx]["arguments"] += tc_delta.function.arguments

            if finish_reason == "stop":
                self.conversation_history.append({"role": "assistant", "content": full_content})
                # 이번 턴에 도구를 하나도 호출하지 않았다면(=이전 턴에서 받아온 블록체인
                # 조회 결과를 그대로 재사용해 답했을 가능성), 직전에 실제로 호출됐던
                # 도구가 get_blockchain_dental_status/get_blockchain_altinvest_status였는지로 판단한다.
                if not any_tool_used and self._last_tool_call_names(self.conversation_history) & {"get_blockchain_dental_status", "get_blockchain_altinvest_status", "get_crypto_reserve_status", "get_personal_trading_status"}:
                    used_blockchain_tool = True
                # 항상 실제 URL 뉴스 섹션으로 교체 (GPT 생성 뉴스 섹션 제거 후 추가)
                # 단, 블록체인 온체인 조회 결과에는 무관한 보험 뉴스를 붙이지 않는다
                if used_blockchain_tool:
                    news = ""
                else:
                    yield {"type": "tool_start", "tool": "_news_search"}
                    news = self._build_news_section(user_message)
                    yield {"type": "tool_done", "tool": "_news_search"}
                # news가 빈 문자열이어도(블록체인 조회 턴) GPT가 대화 히스토리의 이전
                # 뉴스 섹션을 베껴 직접 써버리는 경우가 있어, 제거 로직은 news 유무와
                # 무관하게 항상 실행한다 (2026-09-18 발견).
                if "📰 관련 최신 뉴스" in full_content:
                    idx = full_content.index("📰 관련 최신 뉴스")
                    cut = full_content.rfind("---", 0, idx)
                    full_content = (full_content[:cut].rstrip() if cut >= 0 else full_content[:idx].rstrip())
                if news:
                    full_content += news
                yield {"type": "done", "full_text": full_content}
                return

            elif finish_reason == "tool_calls":
                tool_calls_list = [tool_calls_acc[i] for i in sorted(tool_calls_acc.keys())]
                any_tool_used = True
                if any(tc["name"] in ("get_blockchain_dental_status", "get_blockchain_altinvest_status", "get_crypto_reserve_status", "get_personal_trading_status") for tc in tool_calls_list):
                    used_blockchain_tool = True

                self.conversation_history.append({
                    "role": "assistant",
                    "content": full_content or None,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {"name": tc["name"], "arguments": tc["arguments"]},
                        }
                        for tc in tool_calls_list
                    ],
                })

                for tc in tool_calls_list:
                    yield {"type": "tool_start", "tool": tc["name"]}
                    try:
                        tool_input = json.loads(tc["arguments"])
                        result = execute_tool(tc["name"], tool_input, self.client, self.wallet_address, self.crypto_personal_bot_id)
                    except Exception as e:
                        result = json.dumps({"error": str(e)}, ensure_ascii=False)
                    yield {"type": "tool_done", "tool": tc["name"]}

                    self.conversation_history.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result,
                    })
            else:
                break

        yield {"type": "error", "message": "응답 생성 중 오류가 발생했습니다."}

    def reset(self):
        self.conversation_history = []
        print("💬 대화가 초기화되었습니다.")
