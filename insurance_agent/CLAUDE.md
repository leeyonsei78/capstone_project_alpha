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
    ├── get_personalized_recommendation → Sub-agent (GPT-4o, 단일 completion)
    └── run_underwriting_review       → Sub-agent (GPT-4o, 자체 tool-calling 루프)
                                          └── UNDERWRITING_TOOLS (18종: assess_* 시나리오 1~17 + assess_health_risk)
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
  - 다음 단계로 남긴 것(이번 범위 아님): human_review로 넘어간 건을 관리자가 확인할
    대기열 UI, 그리고 "원래 요청+보완 정보를 합쳐 재구성"을 모델이 놓치지 않는지에 대한
    실제 대화 테스트(현재는 `SYSTEM_PROMPT` 지침에만 의존).

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
