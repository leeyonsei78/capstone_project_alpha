# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 보험 상담 AI 에이전트

GPT-4o + ChromaDB RAG + 보험다모아 엑셀/실시간 스크래핑 + FSS API + 실시간 웹 검색 기반 보험 상담 챗봇.

---

## 실행 명령어

```bash
# 웹 서버 (메인)
python web_app.py          # http://localhost:5000

# CLI
python main.py

# Windows 원클릭
run.bat                    # ANSI(CP949) 인코딩 필수 — UTF-8 저장 시 한글 깨짐

# ChromaDB 최초 구축
python scripts/build_vectorstore.py [--reset]

# 엑셀 → 지식베이스 반영 + ChromaDB 재구축
python scripts/build_knowledge_from_excel.py --apply --rebuild

# 보험다모아 실시간 데이터 수집 (CDP 모드)
python scripts/fetch_live_data.py --cdp [--type 종신보험] [--debug]
```

### 보험다모아 CDP 스크래핑 사전 작업
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
    --remote-debugging-port=9222 ^
    --user-data-dir="%TEMP%\ChromeDebug" ^
    --remote-allow-origins=* ^
    "https://www.e-insmarket.or.kr"
```

---

## 아키텍처

```
사용자 입력
    │
    ▼
InsuranceChatbot (agents/orchestrator.py)
    │  GPT-4o Tool Calling 루프 + SSE 스트리밍
    │  _build_system_prompt(): 오늘 날짜 동적 주입
    │
    ├── search_insmarket_products    → tools/excel_search_tool.py  ← 1순위
    ├── search_web / fetch_webpage   → tools/web_search_tool.py    ← 2순위
    ├── search_insurance_products    → tools/product_tools.py      ← 3순위
    ├── retrieve_insurance_knowledge → tools/rag_tools.py (ChromaDB) ← fallback
    ├── fetch_fss_realtime_products  → api/fss_client.py
    ├── get_credit_score             → tools/credit_score_tool.py (CDP)
    ├── get_blockchain_dental_status/altinvest_status/parametric_status → tools/blockchain_tool.py
    ├── submit_wellness_checkin      → tools/wellness_tool.py (health_risk_tool 위험점수 재사용 + 온체인 보험료 조정)
    ├── get_crypto_reserve_status    → tools/crypto_reserve_tool.py (../crypto_trading/data/status_snapshot_*.json 직접 읽기)
    ├── get_personal_trading_status  → 위 함수를 세션의 crypto_personal_bot_id로 재호출(신규 함수 없음)
    ├── assess_crypto_investment_profile → tools/crypto_risk_tool.py (health_credit_tool 점수제 패턴 재사용, 등급 진단)
    ├── get_personalized_recommendation → Sub-agent (GPT-4o, 단일 completion)
    └── run_underwriting_review       → Sub-agent (GPT-4o, 자체 tool-calling 루프)
                                          └── UNDERWRITING_TOOLS (19종: assess_* 시나리오 1~18 + assess_health_risk)
                                          └── submit_underwriting_decision (구조화된 최종 결론 제출, 2026-10)
```

**언더라이팅 서브에이전트** (`agents/orchestrator.py`의 `_run_underwriting_subagent`):
- 암 완치자 심사·건강체 할인·유병자 요율·씬파일러 신용보완·역선택 탐지 등 정밀 심사가 필요한
  질문은 메인 오케스트레이터가 `run_underwriting_review` 하나만 호출하고, 실제 assess_* 17종
  선택·파라미터 추출·실행은 이 서브에이전트의 독립된 tool-calling 루프(`UNDERWRITING_TOOLS`,
  `_execute_underwriting_tool`)가 전담한다.
- 메인 `TOOLS`에는 더 이상 assess_* 개별 도구가 노출되지 않음 (27→11개로 축소).
- `web_app.py`의 `DEMO_QUERIES`(라이브 모드 데모 시나리오 16개)는 예전에 `assess_*` 도구명을
  직접 지시했으나, 이제 `run_underwriting_review 도구로 [assess_* 시나리오]` 형태로 상위 도구를
  가리키도록 갱신됨. `TOOL_LABELS`(JS)에도 `run_underwriting_review` 라벨이 추가됨 (기존
  `assess_*` 라벨 16개는 이제 SSE로 노출되지 않아 사실상 미사용 — 정리하지 않고 남겨둠).
- Mock 모드 데모 패널(`/api/demo/run`)은 `tools/*.py`를 직접 import해 호출하므로 이번 변경과
  무관하게 그대로 동작한다.
- **구조화 출력 전환 (2026-10, 멀티에이전트/HITL 설계 합의 반영)**: 이 서브에이전트는 이제
  평문이 아니라 `submit_underwriting_decision`(신규 도구) 호출로 `{tier, route, missing_items,
  reasons, customer_message}` JSON을 반환한다. `tier`(정상/경계/중위험/고위험)만 모델이 판단하고,
  `route`(auto_approve/supplement/human_review)는 모델이 주장하는 값을 쓰지 않고 코드의
  `_UNDERWRITING_TIER_ROUTE` 매핑으로 결정한다 — "고위험인데 자동승인" 같은 모델의 판단
  오류가 그대로 실행될 여지를 없애기 위함. 경계 티어는 자동승인하되 `audit_sample: true`로
  표시해 사후 샘플감사 대상임을 남긴다. 모델이 이 도구를 호출하지 않고 평문으로 끝나거나,
  인자 파싱에 실패하거나, 반복 한도(6회)를 넘기면 전부 `tier: "불명", route: "human_review"`로
  안전하게 전환한다(`_underwriting_fallback_result`) — 구조화된 결론을 못 받았을 때 절대
  자동승인 쪽으로 새지 않도록 하는 안전장치. 메인 오케스트레이터의 `SYSTEM_PROMPT`에도
  이 JSON을 해석하는 지침(`customer_message`를 그대로 전달, `route`가 supplement면
  `missing_items`를 나열해 재질문, human_review면 즉시 결론이 나오지 않음을 안내)을 추가함.
- **보완요청 재심사 루프 (2026-10)**: `route`가 "supplement"로 나오면 메인 오케스트레이터가
  `missing_items`를 사용자에게 물어보고, 사용자가 답하면 원래 요청+보완 정보를 합쳐
  `run_underwriting_review`를 재호출하는 흐름 자체는 기존 멀티턴 대화와 `SYSTEM_PROMPT`
  지침만으로 이미 동작한다(신규 코드 불필요). 이번에 추가한 건 **보완 기회를 1회로 강제하는
  안전장치**다:
  - `execute_tool()`이 호출마다 `conversation_history`에서 `_last_underwriting_route()`로
    "직전 `run_underwriting_review` 호출의 route가 supplement였는가"를 직접 확인해
    `is_resubmission` 플래그를 만든다 — 모델에게 몇 번째 시도인지 세어달라고 맡기지 않는다
    (tier→route 매핑과 같은 이유: 안전장치는 모델 자율보다 코드가 담보해야 함).
    가장 최근 호출 1건만 보는 이유는, 세션 안의 서로 무관한 두 심사 요청이 라운드를
    같이 누적해 엉뚱하게 조기 에스컬레이션되는 걸 막기 위함.
  - `is_resubmission=True`인데 모델이 또 `tier: "중위험"`(=여전히 정보 부족)을 제출하면,
    `_finalize_underwriting_decision()`이 `route`를 `human_review`로 강제 전환하고
    `missing_items`를 비우고 `customer_message`도 "수동심사로 넘어갑니다" 취지로
    덮어쓴다 — `tier` 자체는 모델이 판단한 값을 그대로 남겨 감사 기록이 정직하게 유지됨.
    반대로 재심사에서 `tier`가 정상/경계/고위험으로 바뀌면 그대로 통과(강제 전환 없음).
  - 가짜 OpenAI 클라이언트로 "직전 supplement 감지/무관한 케이스 구분/1회차 그대로 통과/
    2회차에도 중위험→human_review 강제/2회차에 해소되면 강제 없음/execute_tool 통합" 6가지
    경로를 스크립트 테스트로 검증함(이 샌드박스는 API 호출 자체가 불가능해 응답 shape를
    흉내낸 테스트로 대체 — 실제 gpt-4o 응답으로도 동일하게 동작하는지는 실제 환경에서
    재확인 필요).
  - 남은 것: "원래 요청+보완 정보를 합쳐 재구성"을 모델이 놓치지 않는지에 대한 실제
    대화 테스트(현재는 `SYSTEM_PROMPT` 지침에만 의존).
- **human_review 대기열 UI (2026-10)**: `route: "human_review"`로 확정된 건을 관리자가
  확인·승인/거절할 화면 `/admin/partners`와 동일한 Flask `session` 기반 `admin_required`
  인증으로 보호됨). 저장은 다른 런타임 상태 파일(`data/wellness_checkins.json` 등)과
  같은 패턴으로 `tools/underwriting_review_queue.py`가 `data/underwriting_review_queue.json`
  JSON 파일에 `enqueue`/`list_queue`/`resolve`로 쌓고 뺀다(`.gitignore` 대상, 커밋 안 함).
  - `agents/orchestrator.py`의 `execute_tool()`이 `run_underwriting_review` 결과의
    `route`가 `human_review`일 때마다 자동으로 `enqueue()`를 호출한다 — 챗봇 쪽은
    아무 추가 호출 없이 그냥 평소처럼 답하면 된다.
  - **이 챗봇의 언더라이팅 심사는 익명 대화형 Q&A라 신청자 연락처가 없음** — 관리자가
    승인/거절을 눌러도 그 결과를 고객에게 자동으로 돌려줄 방법이 없다. 그래서 이 큐는
    "관리자가 왜 수동심사로 넘어왔는지 보고 결정을 기록해 두는" 내부 기록 용도이지,
    기존 증권/청구 이메일 알림처럼 고객에게 결과를 통지하는 기능은 아니다 — 하려면
    먼저 신청자 연락처 수집 단계가 선행되어야 하며 이번 범위에는 없음.
  - 화면에 띄우는 `request_text`/`customer_message`/`reasons`/`missing_items`는 전부
    사용자 입력·LLM 출력이라, `render_template_string`에 Python `.format()`으로 미리
    박아 넣는 기존 `admin_partners` 테이블 방식(`partner_name`은 관리자 입력이라 상대적으로
    안전했음)을 그대로 따라가면 저장형 XSS가 될 수 있었다 — 그래서 이 페이지만 값을
    Jinja `{% for %}` 루프 안에서 `{{ }}`로 넣어 Flask의 기본 자동 이스케이프를 받도록
    작성함(수동 이스케이프 불필요, 실수로 빠뜨릴 걱정도 없음). Flask가 설치돼 있지 않은
    이 샌드박스에서는 Flask와 동일 조건(`autoescape=True`)의 순수 Jinja2 `Environment`로
    렌더링해 `<script>` 등이 전부 `&lt;script&gt;`로 이스케이프되는지 직접 확인함.
  - `/admin/partners` 페이지에 이 큐 화면으로 가는 링크, 이 화면에 돌아가는 링크를
    상호 추가함.
- **종합 병력(질병·치료이력·수술) 심사 도구 추가 — 19번째 assess_* 도구** (2026-10-23,
  사용자가 "계약심사 단계에서 질병·치료이력·수술 정보를 추가하고 해당 정보로 에이전트가
  판단하는 로직"을 요청): 기존 assess_* 18종은 전부 "암 완치자", "용종 절제" 같은
  단일 시나리오 하나만 다뤄서, 고객이 "고혈압 치료 중이고 2년 전에 수술도 받았어요"처럼
  여러 병력을 한 번에 말하는 복합 케이스를 받을 도구가 없었음 — `tools/medical_history_tool.py`의
  `assess_medical_history(age, gender, diseases, surgeries, treatments)` 신설로 메움.
  `diseases`/`surgeries`/`treatments`는 각각 객체 배열(JSON Schema `items: object`)로
  받아, 모델이 고객 발화에서 여러 건을 파싱해 한 번에 넘길 수 있게 함.
  - 점수 체계는 `data/credit_model.py`의 `assess_adverse_selection_risk`(AASI)와
    **동일한 가산점 + 4단계 밴드(정상<15, 경계15~34, 중위험35~59, 고위험≥60)**를
    그대로 재사용함 — 서로 다른 밴드 이름을 새로 만들면 `submit_underwriting_decision`의
    `tier` 값(정상/경계/중위험/고위험)과 매번 수동으로 맞춰줘야 해서, 처음부터 같은
    이름 체계를 쓰도록 설계함. `_UNDERWRITING_TIER_ROUTE` 등 route 매핑 쪽은 전혀
    손대지 않음 — tier 이름만 맞으면 기존 안전장치(route는 코드가 결정, 보완 1회 제한,
    실패 시 human_review로 수렴)가 그대로 적용됨.
  - ⚠️ **health_credit_tool.py 등의 "건강 데이터는 가산점으로만, 감점 금지" 윤리 원칙과는
    다른 영역임을 파일 상단에 명시**: 그쪽은 신용·대출 심사에서 건강 데이터로 불이익을
    주지 않겠다는 금융포용 원칙이고, 이 도구는 보험 "언더라이팅"(동일 위험집단 내
    보험료 형평성을 위해 실제 병력을 반영하는 것) 자체라 성격이 다름 — 다만 ① 완치 후
    5년 이상 경과한 경미한 이력은 점수를 거의 안 주고(가산 2점), ② 점수가 "고위험"이어도
    자동거절이 아니라 항상 사람(전문 언더라이터)의 수동심사로만 이어지도록(기존 route
    매핑 재사용) 두 가지 안전장치는 유지함.
  - `agents/orchestrator.py`에 import·`UNDERWRITING_TOOLS` 스키마 항목(시나리오
    18번)·`_execute_underwriting_tool` 분기·`_UNDERWRITING_SYSTEM_PROMPT` 라우팅
    힌트 4곳을 전부 추가해야 실제로 호출 가능해짐(어느 하나라도 빠뜨리면 모델이
    도구 존재는 알아도 호출이 안 되거나, 호출해도 "알 수 없는 도구" 에러가 남) —
    새 assess_* 도구를 추가할 때마다 이 4곳을 체크리스트로 쓸 것. 기존 "17종"으로
    적혀 있던 도구 개수 주석 3곳(모듈 docstring, `_SUBMIT_UNDERWRITING_DECISION_TOOL`
    주석, `_run_underwriting_subagent` docstring)도 사실은 이미 18종이었던 걸 이번에
    19종으로 같이 바로잡음 — 전부터 하나씩 밀려 있었던 것으로 보임.
  - 테스트는 이 샌드박스에 `OPENAI_API_KEY`가 없어 실제 GPT-4o 호출로는 확인 못 했음
    — `assess_medical_history()` 자체를 직접 호출한 결정론적 점수 계산(완치 10년 경과
    단일 질환→정상, 중증암+당뇨+최근수술+항암 복합→고위험 등 4개 케이스)과,
    `agents.orchestrator` import 후 `UNDERWRITING_TOOLS` 19개 포함 여부·
    `_execute_underwriting_tool` 디스패치·`_UNDERWRITING_TIER_ROUTE`에 4개 밴드명이
    전부 키로 존재하는지만 스크립트로 검증함. 실제 상담에서 모델이 복합 병력 발화를
    이 도구 파라미터로 잘 파싱해 넘기는지는 실제 환경에서 재확인 필요.
- **경계·중위험 구간 한정 교차심사(Cross-Review) 구현** (2026-10-24, 사용자가 "에이전트끼리
  서로 심사해서 다른 자료를 참고해 언더라이팅할 수 있는지 검토" 요청 → 전면 도입은 과하다는
  검토 결론에 사용자가 동의해 scoped 버전만 구현): 1차 심사(`_run_underwriting_subagent`,
  19종 도구 전부 접근)가 tier="경계" 또는 "중위험"을 내면, `_apply_cross_review()`가
  건강 중심 리뷰어(`_HEALTH_REVIEW_TOOL_NAMES`, 10종)와 신용·행동 중심 리뷰어
  (`_CREDIT_BEHAVIOR_REVIEW_TOOL_NAMES`, 9종) 둘을 독립적으로 더 돌려(각각
  `_run_scoped_reviewer()`, 반복 한도 3회로 1차보다 짧음) 재확인한다.
  - **정상·고위험은 의도적으로 제외**(검토 단계에서 이미 결론 — 정상은 속도만 깎고,
    고위험은 어차피 human_review로 가서 AI끼리 더 겨뤄도 최종 경로가 안 바뀜).
  - **불일치 시 항상 더 보수적인(위험도 높은) tier를 채택** — `_TIER_RISK` 순서(정상<경계<
    중위험<고위험)로 1차 tier와 두 리뷰어 tier 중 최댓값을 고름. 반대로 더 낮은 쪽으로
    끌어내리는 경로는 코드에 아예 없음 — "완화" 장치가 아니라 "추가 확인(safety net)"
    장치로만 설계. 상향될 때 escalator(상향시킨 쪽) 리뷰어의 reasons/missing_items를
    가져와 고위험이면 human_review용, 중위험이면 supplement용 customer_message로
    교체함 — 1차 tier의 customer_message는 escalate된 상황에 안 맞는 톤(예: 경계=승인
    톤)이라 그대로 두면 안 됨.
  - **리뷰어가 실패해도(평문 응답, 파싱 실패, 반복 한도 초과) 크래시하지 않고 그냥 그
    의견을 "없음"으로 취급** — 1차 판단을 그대로 유지하며, 실패가 tier를 올리지도
    내리지도 않음(교차심사 자체의 불안정성이 기존 안전장치를 약화시키지 않도록).
  - **is_resubmission(보완 재심사)에는 교차심사를 아예 돌리지 않음** — 보완 1회 제한
    로직과 동시에 적용하면 상호작용이 복잡해지는 걸 피하기 위한 의도적 범위 제한.
  - 결과 JSON에 `cross_review`(ran/primary_tier/opinions/escalated) 키를 새로 추가함
    — `_finalize_underwriting_decision()`이 decision dict에 이 키가 있으면 최종 result에
    그대로 실어 보냄(없으면 안 실음, 기존 응답 형태를 깨지 않음). 관리자 UI 등에서 나중에
    "왜 상향됐는지" 보여줄 때 쓸 수 있도록 남겨둔 것 — 지금은 소비하는 화면 없음.
  - 테스트는 이 샌드박스에 `OPENAI_API_KEY`가 없어 역시 스크립트 가짜 OpenAI 클라이언트로만
    검증함(system prompt 문자열로 "1차/건강리뷰어/신용리뷰어 중 어느 쪽 호출인지" 구분해
    순서대로 스크립트된 응답을 반환) — 고위험 상향, 불일치 없을 때 유지, 정상/고위험 스킵,
    양쪽 리뷰어 실패해도 안전, is_resubmission 스킵, 경계→중위험 상향 시 missing_items
    교체, 리뷰어가 실제 assess_* 도구를 루프 중간에 호출하는 경로까지 7개 케이스 전부
    통과 확인. 실제 GPT-4o가 "이 관점과 관련된 도구만 1~2개 호출"하라는 교차심사
    프롬프트 지시를 잘 따르는지(불필요하게 많이 호출해 지연·비용이 커지지 않는지)는
    실제 환경에서 재확인 필요.

**데이터 소스 우선순위** (GPT-4o 지시 순서):
1. 보험다모아 엑셀 공시 데이터 (`*.xls` 프로젝트 루트 스캔)
2. 실시간 웹 검색 (DuckDuckGo, API 키 불필요)
3. 로컬 정적 DB (`data/products.py`, `data/dental_products.py`)
4. ChromaDB RAG fallback (`data/knowledge.py` 기반)
5. FSS API (연금저축보험 전용, `FSS_API_KEY` 필요)

---

## 핵심 설계 결정 사항

### 엑셀 로더 (`data/excel_loader.py`)
- 프로젝트 루트 `*.xls` 자동 스캔 및 파싱
- 파일명에서 연령대/성별 컨텍스트 추출 (예: `40대_남성_실손보험.xls`)
- Type 1: 단일 보험료 컬럼 / Type 2: 남/여 별도 컬럼
- `file_context.age_group` 없는 상품 = 연령 무관 → 모든 조회에 포함
- 캐시: `data/insmarket_excel_cache.json` (파일 수정 시 자동 갱신)

### ChromaDB 벡터 스토어 (`rag/vectorstore.py`)
- 싱글톤 패턴, `get_instance()` 사용
- `add_documents(docs)` 로 upsert, `reset()` 후 재구축
- `build_from_knowledge()` 메서드는 **존재하지 않음** — 항상 `get_all_knowledge()` + `add_documents()` 패턴 사용

### 임베딩 (`rag/embeddings.py`)
- 모델: `jhgan/ko-sroberta-multitask` (최초 실행 시 ~443MB 다운로드)
- ChromaDB 미설치 시 `rag_tools.py`가 키워드 검색으로 자동 fallback

### 웹 서버 (`web_app.py`)
- Flask + SSE 스트리밍 (`/api/chat/stream`)
- Live Mode: GPT-4o 오케스트레이터 / Mock Mode: 로컬 도구만 사용
- Auto Mode: API 크레딧 확인 후 자동 선택

### 신용점수 포트폴리오
- `/api/credit-portfolio` → GPT-4o 서브에이전트 생성
- 5등급 모델 (`data/credit_model.py`): 최우량(900+) / 우량(750~) / 보통(600~) / 주의(450~) / 불량(~449)
- NICE + KCB 점수 평균 자동 계산

---

## 주의 사항

- `data/dental_products.py`는 함수 없음 — `DENTAL_INSURANCE_PRODUCTS` 리스트 직접 참조
  (`data/parametric_products.py`도 동일 패턴 — `PARAMETRIC_INSURANCE_PRODUCTS` 직접 참조,
  둘 다 `data/products.py`의 `ALL_PRODUCTS`에 합산됨)
- `data/wellness_checkins.json`, `data/partner_api_keys.json`은 런타임에 자동 생성되는
  상태 파일(`.gitignore` 대상) — 커밋하지 말 것, 코드는 파일 없음을 정상 처리함
- **`tools/gasless_enrollment_tool.py`의 `import relay_wallet`(bare) 버그로 `agents/orchestrator.py`
  전체가 import 시점에 `ModuleNotFoundError`로 죽어있었음** (2026-09-24 발견 — `relay_wallet.py`는
  `tools/` 안에 있는데 바깥에서 쓰는 `blockchain_bridge`(insurance_agent 루트)와 같은 방식으로
  bare import해서 생긴 문제. `git stash`로 확인한 결과 **c03dd80 커밋(2026-09-21) 이후
  계속 이 상태였음** — 즉 챗봇 백엔드 자체가 그동안 한 번도 뜨지 못했을 가능성이 있음.
  `from tools import relay_wallet`로 수정. 새 도구를 추가할 때 `tools/` 안에서 서로를
  bare import하면 같은 문제가 재발하니, 항상 `from tools import <모듈>` 형태를 쓸 것.
- `data/relay_wallets.json`, `crypto_trading/data/positions_state_*.json`,
  `crypto_trading/data/status_snapshot_*.json`, `crypto_trading/data/personal_bots.json`도
  동일한 "런타임 생성 상태 파일" 카테고리(뒤 셋은 `crypto_trading/.gitignore`에서 관리)
- **개인별 가상자산 자동매매의 실거래 승인은 절대 챗봇 도구로 노출하지 말 것** —
  `crypto_bridge.approve_personal_bot()`을 호출하는 도구를 `TOOLS`에 추가하면 대화만으로
  고객 실거래가 켜질 수 있음(사용자가 명시적으로 "사용자의 승인으로 변경"을 요구해
  등록(`/api/crypto/personal/register`, 항상 페이퍼)과 승인(`/api/crypto/personal/approve`,
  고객 본인 버튼 클릭 + `confirm: true` 필수)을 분리함). 이 기능을 다시 손볼 때
  이 분리를 허물지 말 것.
- **`/api/slack/interactive`(매수/매도 승인 버튼 콜백)와 `/api/slack/commands`
  (슬래시 커맨드)는 `SLACK_SIGNING_SECRET` 하나를 공유** — 같은 Slack App에 Slash
  Commands와 Interactivity & Shortcuts 둘 다 등록해야 함. **`.env`의
  `SLACK_SIGNING_SECRET`이 아직 placeholder(`your_slack_signing_secret_here`) 그대로임을
  확인함(2026-09-24)** — 실제 값으로 채우기 전까진 두 엔드포인트 다 모든 요청을
  거부한다(`_verify_slack_signature`가 항상 실패).
- **`crypto_trading/`의 `DRY_RUN`을 `false`로 바꾸는 건 Claude Code 자체 안전장치가
  차단함** — 실거래 on/off는 사용자가 직접 파일을 수정해야 하는 스위치로 남겨둠(다시
  시도하지 말 것). `SLACK_WEBHOOK_URL` 등 나머지 설정값 쓰기는 막히지 않았음 — 이
  분류기는 "실거래 스위치 자체"만 막는 것으로 보임.
- `run.bat`은 반드시 **ANSI(CP949)** 인코딩 저장
- FSS API는 **연금저축보험만** 지원
- `scripts/build_knowledge_from_excel.py`의 `update_knowledge_py()`:
  - `re.sub` 교체값은 반드시 `'\n'` (빈 문자열이면 `]` 탐지 실패)
  - AUTO-GENERATED 블록은 `data/knowledge.py`의 `KNOWLEDGE_BASE` 리스트 닫는 `]` 바로 앞에 삽입됨

---

## 환경 변수 (`.env`)

```
OPENAI_API_KEY=sk-...   # 필수
FSS_API_KEY=...         # 선택 (연금저축보험 조회 시)
```
