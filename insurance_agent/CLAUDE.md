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
                                          └── UNDERWRITING_TOOLS (18종: assess_* 시나리오 1~17 + assess_health_risk)
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
