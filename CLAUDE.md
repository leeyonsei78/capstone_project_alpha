# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 프로젝트 개요입니다.
하위 `insurance_agent/CLAUDE.md`는 AI 어시스턴트 자체의 상세 아키텍처를 다루고,
이 파일은 **두 프로젝트의 통합 지점**을 다룹니다.

## 프로젝트 개요

`C:\test_agent\insurance_agent`(보험상담 AI 어시스턴트)와
`C:\test_blockchain-dental`(블록체인 덴탈보험 dApp) 두 개의 별도 프로젝트를 결합한
캡스톤 프로젝트. 목표: AI 챗봇에서 "블록체인 덴탈보험"을 추천받고 가입 버튼을
누르면, 별도 폴더의 Hardhat/Node 블록체인 dApp이 자동으로 기동되어 실제 가입까지
이어지도록 연동하는 것.

- GitHub: https://github.com/leeyonsei78/capstone_project_alpha (public repo, owner: `leeyonsei78`) —
  2026-09-20 확인: `git remote -v`가 실제로 가리키는 주소이며 이전 표기(`capstone_project`,
  `_alpha` 없음)가 틀려 있었음(오타/구버전 표기로 추정 — 실제로 저장소 이름이 바뀐 적은
  없어 보이나 확실치 않으니, 혼동되면 `git remote -v`로 다시 확인할 것).
- 새 PC 설치: [SETUP.md](./SETUP.md), 실행/아키텍처 요약: [README.md](./README.md)

## 구조

```
insurance_agent/        Flask 챗봇 (:5000) — 원본 test_agent/insurance_agent 복사본
blockchain-dental/       Hardhat + dApp (:8545 노드, :3000 프론트엔드) — 원본 test_blockchain-dental 복사본
start.bat                루트 실행 진입점 (insurance_agent\run.bat 호출)
SETUP.md                 새 PC 1회성 설치 가이드 (프로그램, MetaMask 네트워크/계정)
```

## 통합 메커니즘 (직접 추가한 부분)

- `insurance_agent/blockchain_bridge.py` — `blockchain-dental/run.bat`과 동일한 순서로
  Hardhat 노드 → 컨트랙트 배포 → 만기환급/오라클/자동납부 서비스 → 프론트엔드 서버를
  기동하고, 마지막에 Chrome(관리자)/Edge(고객) 두 창을 자동으로 엽니다.
  포트(8545, 3000)로 idempotent 체크를 하므로 이미 떠 있으면 재사용합니다.
  백그라운드 서비스 7종은 psutil로 **실제 살아있는 node 프로세스**를 확인해 죽은 것만
  다시 띄웁니다. 노드를 새로 띄운 경우에는 옛 컨트랙트 주소를 바라보는 이전 세션 서비스를
  종료하고 7개 전부 재기동합니다. (예전 `.services_started` 마커 파일 방식은 재부팅 후에도
  마커가 남아 서비스를 영영 skip하는 버그가 있어 제거됨.)
- `web_app.py`의 `/api/blockchain/dental/enroll`, `/api/blockchain/dental/status` —
  위 브릿지를 백그라운드 스레드로 실행하고 상태를 폴링하게 해주는 라우트.
- `web_app.py`의 `addLinksToTables()` (JS) — 상품 비교표 행 텍스트에 "블록체인"이
  포함되면 일반 보험사 링크 대신 **⛓️ 블록체인 가입 시작 →** 버튼을 렌더링.
- `dental_005`(라이나생명 블록체인치아보험)는 `data/dental_products.py`의 로컬
  정적 상품이며, `web_app.py`의 mock `dental` 분기와 `agents/orchestrator.py`의
  시스템 프롬프트(상담 원칙 7번) 양쪽에서 "블록체인"을 명시하지 않은 일반 덴탈보험
  질문에도 항상 포함되도록 강제하고 있음.
- **챗봇 → 블록체인 실시간 조회** (`get_blockchain_dental_status` 도구): 위 두 항목이
  "챗봇이 블록체인 앱을 실행시켜주는 것"까지였다면, 이건 챗봇이 실제 온체인 데이터를
  읽어 자연어로 답하는 것. `insurance_agent/tools/blockchain_tool.py`가
  `blockchain-dental/scripts/query-policy.js`(신규, 읽기 전용)를 subprocess로 호출해
  JSON을 받아온다 — Python에 web3 등 새 의존성을 추가하지 않고 이미 있는 ethers.js
  스택을 그대로 재사용하기 위함. 지갑 주소는 챗봇 화면의 "⛓️ 블록체인 덴탈보험 조회"
  패널(`/api/blockchain/wallet`)에 한 번 등록하면 그 브라우저 탭(session_id) 동안
  `InsuranceChatbot.wallet_address`에 저장되어 매번 물어보지 않음. 이 패널은 상품
  비교표에 블록체인 상품이 뜨면 살짝 펼쳐지고, "⛓️ 블록체인 가입 시작" 버튼을
  누르면 강조 표시된다(`revealBlockchainQueryPanel()`).
- **Slack 양방향 연동**: `blockchain-dental/scripts/slack-notifier.js` 등 기존 Slack
  연동은 전부 "블록체인 → Slack" 단방향 이벤트 알림이었다. `insurance_agent/web_app.py`의
  `/api/slack/commands`는 그 반대 방향 — Slack 슬래시 커맨드(예: `/덴탈조회 0x지갑주소`)로
  관리자가 Slack에서 바로 실시간 온체인 현황을 조회할 수 있게 한다. Slack 요청 서명을
  `SLACK_SIGNING_SECRET`(HMAC-SHA256)으로 검증하고, 조회 자체는 기존
  `tools/blockchain_tool.py`(`get_blockchain_dental_status`)를 그대로 재사용해 새 로직을
  중복 구현하지 않는다. 슬래시 커맨드의 3초 응답 제한을 피하기 위해 조회는 백그라운드
  스레드에서 수행하고 결과는 Slack이 매 요청마다 발급하는 `response_url`로 비동기 전송한다.
  로컬에서만 돌릴 경우 Slack이 `localhost`로 접근할 수 없으므로 ngrok 등 외부 터널링이
  필요함 (`insurance_agent/.env.example` 참고). `blockchain-dental/scripts/test-slack.js`
  (`npm run test-slack`)는 `SLACK_WEBHOOK_URL`(단방향 알림 쪽) 연결 자체를 한 번에
  검증하는 별도 스크립트 — 슬래시 커맨드(`SLACK_SIGNING_SECRET`)와는 다른 설정값이니
  둘을 혼동하지 말 것.
- **증권/청구 알림 이메일 발송** (2026-09-18 신규): 청약 화면의 "이메일" 입력칸(선택)에
  이메일을 등록해두면, 증권 발급(PolicyCreated)·청구 승인/거절/지급 이벤트가 감지될
  때마다 실제로 이메일이 발송된다. 원래 `frontend/app.js`에 "지갑주소별 이메일을
  로컬스토리지에 기억해뒀다가 이벤트 시점에 웹훅으로 알림을 보낸다"는 뼈대
  (`EMAIL_NOTIFY_WEBHOOK_URL`, 예전 이름 `N8N_NOTIFY_WEBHOOK_URL`)는 있었지만 URL이
  빈 문자열이라 실제로는 아무 일도 안 하는 미완성 상태였음(외부 n8n 워크플로우를 직접
  구성해야 하는 전제였음). 이번에 그 자리를 채움: `docker-compose.yml`로 로컬
  Mailpit(SMTP 캐처, 실 이메일 계정 불필요 — 발송된 메일은 `http://localhost:8025`에서
  바로 확인)을 띄우고, 새 `scripts/email-service.js`(HTTP 웹훅 수신 →
  `scripts/lib/mailer.js`(nodemailer)로 실제 SMTP 발송)가 그 웹훅을 직접 받게 함 —
  별도 n8n 서버/워크플로우 구성이 필요 없음. 증권 발급 메일에는 `certificate-service.js`가
  만드는 PDF 증권 서류를 첨부하는데, 그 서비스가 PDF를 쓰는 데 몇 초(AI 요약 생성 포함)
  걸릴 수 있어 `email-service.js`가 웹훅을 받으면 즉시 202로 응답하고 백그라운드에서
  파일이 생길 때까지 최대 `EMAIL_CERT_WAIT_SEC`(기본 20)초 재시도 대기 후 발송 — 시간
  안에 못 만들면 첨부 없이 다운로드 링크만 넣어 발송한다(항상 발송은 성공시키는 게
  목표). 청구 승인/거절/지급 메일은 첨부 없이 상태 안내만 보낸다. `run.bat`/
  `blockchain_bridge.py` 양쪽 다 첫 단계에서 `docker compose up -d mailpit`을 실행하도록
  추가했고(Docker 없어도 나머지 흐름은 계속 진행, 이메일만 안 나감), `SERVICE_PROCESSES`
  에도 `email-service.js`를 등록해 psutil 기반 idempotent 재기동 대상에 포함시킴.
  ⚠️ 처음 배포했을 때 CORS 헤더가 빠져 있어서, curl/Node 스크립트로 직접 호출한
  테스트는 다 통과했는데도 실제 브라우저(`frontend/app.js`의 `fetch`)에서는
  "Failed to fetch"로 조용히 실패해 메일이 전혀 안 갔던 적이 있음(2026-09-18,
  사용자가 브라우저로 직접 청약해보고 신고 → `Access-Control-Allow-*` 헤더 +
  OPTIONS 프리플라이트 처리 추가로 해결). **프론트엔드가 fetch로 호출하는 로컬
  서비스를 새로 만들 땐 curl/Node 테스트만으로는 안 되고 반드시 실제 브라우저
  탭에서 확인할 것** — CORS는 브라우저 밖에서는 재현되지 않는다.

- **5개 신규 사업 기능 추가** (2026-09-20): "챗봇과 블록체인에서 사업을 하도록 추가할 부분"
  검토 요청에서 시작해, 기존 인프라(오라클/준비금 계좌/언더라이팅 서브에이전트)를 재사용하는
  5개 신규 상품·서비스를 컨트랙트→백엔드→챗봇→프론트엔드까지 전부 구현·실제 검증(단위테스트
  167개 통과 + 실제 브라우저 클릭 테스트 + curl 종단검증)함.
  - **A. 파라메트릭(자동집행) 보험** — 신규 `blockchain-dental/contracts/ParametricInsurance.sol`.
    관측값이 임계치를 넘으면 청구 절차 없이 즉시 자동지급. `scripts/parametric-oracle-service.js`가
    관측값을 채움 — ⚠️ **실제 항공/기상 API 연동이 아니라 `coverageId` 기반 결정론적 pseudo-random
    시뮬레이션**이다(파일 상단 주석에 명시). 챗봇 상품 `parametric_001`/`002`
    (`insurance_agent/data/parametric_products.py`), 조회 도구 `get_blockchain_parametric_status`.
  - **B. 씬파일러 신용보완 유연납입** — `DentalInsurance.sol`에 `flexiblePayment` 플래그 +
    `autoCoverArrearsWithLoan()`(연체 시 해지환급금 한도 내에서 약관대출 자동 대환) 추가.
    `getMaxLoanAmount()`가 `totalPaid>0`을 요구해 **최초 납입 전에는 적용 안 됨**(2회차부터).
    `premium-scheduler.js`가 수납 실패 시 Slack 알림 전에 먼저 이 함수를 시도. 청약/증권생성
    폼에 체크박스 추가, 언더라이팅 서브에이전트 18번째 도구 `assess_flexible_payment_eligibility`
    (`insurance_agent/tools/health_credit_tool.py`) 추가로 17→18종.
  - **C. 웰니스 연동 동적 보험료** — `DentalInsurance.sol`에 `applyWellnessAdjustment()`(oracle
    전용, `baselinePremiumAmount` 기준 ±20% 상한). 챗봇 도구 `submit_wellness_checkin`
    (`insurance_agent/tools/wellness_tool.py`)이 `health_risk_tool.py`의 위험점수를 재사용해
    이전 체크인 대비 개선폭만큼 할인 후 `scripts/wellness-oracle.js`(1회성 CLI)로 온체인 반영.
    체크인 이력은 `data/wellness_checkins.json`(신규 .gitignore 대상, 커밋 안 함).
  - **D. 재보험풀(외부 유동성 공급)** — 신규 `contracts/ReinsurancePool.sol`. 지분가치가
    관리자가 정한 고정 APR이 아니라 `DentalInsurance`의 실제 보험료 수취(`payPremium`/
    `collectPremium`)에서 `cedingBps`(기본 5%, 최대 30%) 비율만큼 자동 이체되는 걸로 오른다 —
    `AltInvestmentFund`(고정 APR 가짜 투자)와 근본적으로 다른, 진짜 리스크 공유 구조. 청구
    재원이 부족하면 관리자가 `drawForClaim()`으로 인출해 수동으로 `depositFunds()`에 재입금
    (컨트랙트 간 자동 신뢰 연결 없이 2단계 수동 브릿지).
  - **E. B2B 파트너 API** — `insurance_agent/tools/partner_api.py` + `web_app.py`의
    `/admin/login`·`/admin/partners`(Flask `session` 쿠키 인증, `.env`의 `ADMIN_PASSWORD`/
    `FLASK_SECRET_KEY`) + `/api/partner/v1/dental/status`(`X-Api-Key` 헤더, 분당
    `PARTNER_RATE_LIMIT_PER_MIN`(기본 60) 레이트리밋, `get_blockchain_dental_status` 재사용).
    키·사용량은 `data/partner_api_keys.json`(신규 .gitignore 대상).
  - 부수 수정: 청구 오라클 자동승인(`oracleModeEnabled`) **기본값을 OFF→ON으로 전환**
    (`DentalInsurance.sol:127`) — 보장한도 20% 이하 소액청구는 자동지급, 초과는 오라클 모드와
    무관하게 항상 관리자 수동심사인 기존 로직은 그대로 두고 기본값만 바꿈. `blockchain_bridge.py`의
    `start_enrollment_async()`가 `target` 인자를 받지도, `ensure_blockchain_stack`에 넘기지도
    않던 버그도 같이 고침(altinvest 딥링크가 이미 깨져 있었을 가능성 — `#parametric`/
    `#reinsurance` 신규 딥링크 추가하면서 발견).

## 알아두면 좋은 것들

- **`DentalInsurance.sol`이 EIP-170 배포 크기 한도(24576바이트)를 넘김** (2026-09-20,
  위 B/C/D 필드·함수 추가로 24892바이트): 메인넷 배포 스크립트 자체가 없는(로컬 전용)
  프로젝트라 `hardhat.config.js`의 `networks.hardhat`에 `allowUnlimitedContractSize: true`를
  추가해 해결. 실제 메인넷 배포를 붙이게 되면 그때는 컨트랙트 분리가 필요함.
- **ethers v6 `Contract` 반환값(Result 객체)을 `{...result}`로 스프레드하면 이름 붙은
  필드가 사라짐** (2026-09-20, 브라우저에서 "가입자: -, 상품: #undefined"로 실제 발견):
  `Object.keys(result)`는 숫자 인덱스만 보이고(`["0","1",...]`) `result.holder`처럼 직접
  접근해야만 값이 나옴 — named 필드가 own-enumerable 프로퍼티가 아니라서 spread(`{...}`)가
  못 집어옴. 기존 `refreshAltInvest()` 등은 애초에 `rows.push({ fundId, principal: pos.principal, ... })`
  처럼 필드를 하나하나 명시적으로 골라 담는 패턴이었는데, 이게 정확히 이 문제를 피하는
  방식이었음(스타일이 아니라 필수). `frontend/app.js`에 새 컨트랙트 조회 결과를 캐시/렌더링용
  객체로 옮길 때는 항상 이 명시적 필드 선택 패턴을 쓸 것 — `{...contractResult}`는 쓰지 말 것.
- **Windows 콘솔(cp949) 기본 인코딩에서 Python `print()`에 이모지를 쓰면 서버 시작 자체가
  죽음** (2026-09-20, `web_app.py`에 새로 추가한 `print("⚠️ ...")`가
  `UnicodeEncodeError: 'cp949' codec can't encode character '⚠'`로 즉시 크래시하는 걸
  발견): 이 파일의 기존 `print()`들은 전부 이모지 없이 순수 텍스트(한글은 cp949로 인코딩
  가능하므로 문제없음)만 쓰고 있었음 — 우연이 아니라 이 문제를 피하기 위한 기존 관례였던
  것으로 보임. 새 `print()`를 추가할 때 이모지·화살표 등 cp949 밖 유니코드 문자를 넣지
  말 것(HTML/JSON 문자열 안에서 쓰는 건 무관 — Flask가 UTF-8로 인코딩해 내보내므로 콘솔
  코드페이지와 무관함. 문제는 오직 파이썬 프로세스 자신의 stdout `print()`뿐).
- **전략맵/과제 에세이 문서에 "AI Agent / AI 어드바이저(Human-in-the-Loop) / 자동화" 3분류
  추가 + "GPT-4o" 표기를 전부 "LLM"으로 교체** (2026-09-20, 사용자 요청):
  `인슈어체인_전략맵.html`에 새 Slide 5(3열 카드: 자율실행 Agent / 참고용 어드바이저 /
  AI 미관여 규칙기반 자동화)를 추가하고 기존 GPT-4o 언급 2곳을 LLM으로 교체.
  `GSI7723_short_essay_...docx`(아래 항목 참고)의 GPT-4o 언급 4곳도 LLM으로 교체하고, 5단계
  "조직·프로세스" 불릿의 기존 Agent/어드바이저 이원 구조를 Agent/어드바이저/자동화 삼원
  구조로 확장(짧게 한 문장만 추가, 2페이지 제한 고려).
- **`GSI7723_short_essay_...docx`는 자유 서술형이 아니라 2페이지 제한이 있는 대학원 과제
  제출 양식** (2026-09-20 발견, 2026-10-17 제출 마감): 1~5단계 표가 교수님이 준 고정
  템플릿이라, 새 내용을 반영할 땐 새 섹션을 통째로 추가하지 말고 기존 셀 안에 기존 불릿과
  같은 길이·톤의 짧은 불릿 1개만 추가할 것(사용자가 이미 이 방식을 명시적으로 선택함).
  이 머신엔 LibreOffice/pandoc이 없어 편집 후 실제 페이지 수를 렌더링해서 확인할 방법이
  없음 — 편집할 때마다 사용자에게 Word로 직접 페이지 수를 확인해달라고 안내할 것.
- **`insurance_agent/data/wellness_checkins.json`, `data/partner_api_keys.json`은 런타임
  생성 파일로 `.gitignore`에 추가함** (2026-09-20) — 기존 `insmarket_excel_cache.json` 등과
  동일한 "로컬 전용 캐시/상태" 카테고리. 커밋하지 말 것.

- **`insurance_agent/run.bat`은 반드시 ANSI(CP949) 인코딩으로 저장** — UTF-8로 저장하면
  한글이 깨짐 (원본 프로젝트의 기존 제약, `insurance_agent/CLAUDE.md`에도 명시됨).
  루트 `start.bat`/`SETUP.md`는 한글 대신 순수 ASCII 위주로 작성해 이 문제를 회피함.
- **블록체인 계정**: Hardhat 기본 테스트 계정 사용. Account #0(관리자, Chrome) /
  Account #1(고객 "김덴탈", Edge). 개인키는 [SETUP.md](./SETUP.md) 4장 참고 —
  Hardhat이 항상 동일하게 생성하는 공개적으로 알려진 테스트 키라 저장소에 남겨도 안전.
- **gh CLI 다중 계정 주의**: 이 머신에는 GitHub 계정이 2개 로그인되어 있음
  (`leeyonsei78` = 이 저장소 소유자, `Sdapaul` = 다른 프로젝트용 기본 계정).
  `git push` 전에 반드시 `gh auth status`로 활성 계정이 `leeyonsei78`인지 확인할 것
  (기본값은 `Sdapaul`로 되어 있어서 그대로 두면 push 권한 문제가 생기거나 커밋 작성자가
  잘못 표기될 수 있음). 필요 시 `gh auth switch --hostname github.com --user leeyonsei78`.
  단, Claude Code(bash 도구, Git Bash 환경)에서는 `gh`가 PATH에 없어 이 확인 자체가
  안 될 수 있음 — 그런 경우 아래 `git push` 항목 참고.
- **Claude Code에서 `git push`는 bash 도구가 아니라 PowerShell 도구로 실행할 것**:
  Git Bash(`bash` 도구)에서 `git push`를 실행하면 Git Credential Manager가 tty를
  못 찾아 `fatal: User cancelled dialog` / `could not read Username`로 실패함.
  `PowerShell` 도구로 같은 명령을 실행하면 Windows Credential Manager에 저장된
  자격증명(`cmdkey /list`의 `git:https://github.com`, 계정 `leeyonsei78`)을 그대로
  사용해 정상 push됨 (stderr로 나오는 `To https://github.com/... main -> main` 같은
  정상 출력을 PowerShell이 에러처럼 표시할 수 있으니 무시하고 실제 결과로 판단할 것).
- **.gitignore로 제외된 것들** (재생성 필요): `insurance_agent/.env`(API 키),
  `insurance_agent/chroma_db/`, `*.xls`/`*.xlsx`, `blockchain-dental/node_modules/`,
  `artifacts/`, `cache/`, `frontend/config.json`.
- **2026-09-13 히스토리 재작성됨**: 원본 `insurance_agent` 폴더에서 그대로 복사되어 온
  개인정보 포함 파일 5개(실명+학번 조합 `.html`/`.zip`, 실제 건강검진 `.pdf`,
  `.ipynb`, 경진대회 신청서 `.hwp`)가 최초 커밋에 실려 공개 저장소에 올라간 것을
  발견 → `git filter-repo`로 전체 히스토리에서 제거 후 `git push --force`. 이 시점
  이전에 이 저장소를 clone한 적이 있다면 커밋 SHA가 전부 바뀌었으므로 pull이 아니라
  재-clone이 필요함. (강제 push 직후에도 GitHub가 예전 dangling 커밋을 즉시 GC하지
  않아 정확한 옛 SHA로는 잠시 더 접근 가능할 수 있음 — 사용자 확인 후 현재 상태 유지
  중.)
- **UI 문구는 "대회/경진대회" 표현 배제**: 챗봇 UI(탭 라벨, 데모 시나리오 프롬프트 등)에서
  "대회"라는 단어는 의도적으로 뺐음 (예: "🏆 대회 데모" → "🎬 가상 시나리오",
  `web_app.py`의 `DEMO_QUERIES` 16개 + `agents/orchestrator.py`의 대응 tool
  description/주석 27개에서 "대회 시나리오" → "시나리오"). 새 UI 카피를 추가할 때도
  이 톤을 유지할 것. 단, `경진대회_제안서_초안.md`·`CARELINK_README.md` 등 실제 과거
  경진대회 제출 이력을 기록한 문서는 의도적으로 그대로 둠 — 라이브 UI가 아니라
  아카이브 기록이라 고치면 역사 왜곡이 되므로, 이 문서들까지 손대려면 먼저 확인할 것.
- **이 머신의 `npm`이 구버전(6.12.0)이라 node(v22)와 버전이 안 맞음**: 이 상태에서
  `blockchain-dental`에서 `npm install`을 돌리면 `package.json`엔 실제 의존성 변경이
  없어도 `package-lock.json`이 `lockfileVersion: 3 → 1`로 통째로 재작성되며 수백 줄
  diff가 생김 (2026-09-18에 한 번 발생 → `git checkout`으로 원복함). `npm install`이
  꼭 필요한 게 아니라면 실행하지 말고, 실행했다면 커밋 전에 `package-lock.json` diff를
  반드시 확인할 것.
- **Python→Node subprocess로 한글 출력을 읽을 땐 `encoding="utf-8"` 필수**:
  `insurance_agent/tools/blockchain_tool.py`의 `get_blockchain_dental_status`가
  `subprocess.run(..., text=True)`(인코딩 미지정)로 `query-policy.js`를 호출했다가,
  Windows 기본 인코딩(cp949)으로 Node의 UTF-8 출력(한글 이름·₩ 기호)을 디코딩하려다
  `UnicodeDecodeError`로 매번 조회가 실패한 버그가 있었음 (2026-09-18 수정,
  `encoding="utf-8", errors="replace"` 명시). 앞으로 Python에서 Node 스크립트를
  subprocess로 호출해 한글이 섞인 출력을 읽는 코드를 추가할 때 동일 패턴을 조심할 것.
- **블록체인 조회 응답에는 무관한 보험 뉴스 섹션을 붙이지 않음**: `agents/orchestrator.py`의
  `chat()`/`stream_chat()`은 GPT 응답이 끝나면 사용자 메시지에 "보험" 등의 키워드가 있을 때
  항상 뉴스 섹션(`_build_news_section`)을 붙이는데, `get_blockchain_dental_status`(온체인
  조회 도구)로 답한 응답에도 무조건 붙어 납입 확인 같은 답변 아래 무관한 보험 뉴스가 뜨는
  문제가 있었음 (2026-09-18 수정). 이번 턴에 그 도구가 호출됐는지 `used_blockchain_tool`
  플래그로 추적해, 호출됐으면 뉴스 섹션을 생략함. 새로운 도구를 추가할 때 뉴스 섹션이
  붙으면 안 되는 응답이 있다면 같은 패턴을 따를 것.
- **보험료납입/청구/자동납부/약관대출/만기환급 5개 탭의 증권 선택 드롭다운은 currencyMode로
  필터링됨** (2026-09-18 변경, 사용자 결정): `blockchain-dental/frontend/app.js`의
  `populateCompositeSelect()`는 원래 이 5개 탭 모두에서 USDC·KRW 증권을 한 드롭다운에 섞어
  보여주고, 다른 통화 증권을 선택하면 입력 금액을 자동 환산해 전송하는 기능까지 있었음(목록
  테이블인 보험증권 관리/청구 내역만 currencyMode로 필터링됨). 화면 통화와 다른 통화 증권이
  섞여 보이는 게 혼란스럽다는 피드백에 따라, 목록 테이블과 동일하게 currencyMode로
  필터링하도록 바꿈 — 교차 통화 자동 환산 입력 기능은 의도적으로 제거됨. 이 5개 탭을 다시
  손볼 때 "두 통화를 섞어서 보여주는" 예전 방식으로 되돌리기 전에 먼저 사용자에게 확인할 것.
- **`deploy.js` 샘플 청약 4건은 이제 USDC·KRW 양쪽에 동일하게 신청됨** (2026-09-18 수정):
  원래 샘플 보험증권 2건(김덴탈/이치과)은 두 통화에 똑같이 만들면서, 샘플 청약 4건(담보
  2개 선택→자동승인 1 / 담보 4개→관리자심사대기 1 / 연령초과·전체담보→자동거절 2)은 USDC
  `DentalInsurance` 계약에만 신청하고 KRW 계약에는 신청하지 않았음 — 그래서 화면 통화를
  USDC↔KRW로 전환하면 대시보드의 청약/보험증권 건수가 서로 달라 보였음(계산 로직 버그가
  아니라 시드 데이터 누락이었음). `KRW_PER_USD = 1400`(= `config.json`의 `krwPerUsd`)로
  금액만 환산해 KRW 계약에도 동일한 4건을 신청하도록 추가함 — KRW 심사 룰
  (`setUnderwritingRules`)이 이미 이 환산 금액 기준으로 맞춰져 있어 승인/대기/거절 결과까지
  자동으로 동일하게 나옴. 새로 `npx hardhat run scripts/deploy.js`로 배포하면 자동 반영되지만,
  이미 떠 있는 노드의 기존 데이터는 별도로 한 번 맞춰줘야 함(스크립트는 커밋하지 않고
  1회성으로 실행 후 삭제).
- **위 드롭다운 필터링은 같은 5개 탭 안의 다른 테이블까지는 적용 안 돼 있었음 → 이번에
  추가 수정** (2026-09-18): `refreshAutopaySchedule`(자동납부 탭 납입 일정표),
  `refreshLoanPolicies`(약관대출 탭 내 보험증권 납입 현황), `refreshMaturity`(만기환급 탭
  만기환급 일정표), `refreshPremiumHistory`(보험료 납입 탭 납입 이력, 원래 "USDC+KRW 통합"
  으로 의도적으로 작성돼 있었음)는 여전히 `for (const ccy of ['USDC','KRW'])`로 두 통화를
  한 테이블에 섞어 보여주고 있었음. 화면 통화를 KRW로 두고 있어도 이 4개 테이블에는 USDC
  증권까지 같이 나왔고(사용자가 스크린샷으로 신고), 특히 만기환급 탭에서는 USDC #1과
  KRW #1이 나란히 보여 "둘이 같은 증권"처럼 보이는데 실제로는 완전히 독립된 온체인
  증권이라 한쪽 만기를 바꿔도 다른 쪽엔 반영이 안 되는 게 버그처럼 보이는 부작용도
  있었음. 네 함수 모두 루프를 `[currencyMode]`로(또는 `fetchAllPoliciesBothCcy()` 결과를
  `ccy === currencyMode`로) 필터링하도록 수정. 그리고 `refreshAutopaySchedule()`이
  `refreshAll()`에 빠져 있어서, 자동납부 탭을 보고 있는 상태에서 통화를 전환하면 이전
  통화의 낡은 행이 탭을 벗어났다 돌아오기 전까지 남아있는 문제가 있었음 — `refreshAll()`
  호출 목록에 추가함. 이 시점엔 관리자 대시보드 합산 통계·계약심사(청약) 탭·준비금 계좌
  탭은 의도적으로 그대로 두 통화를 합쳐서 보여주도록 남겨뒀었으나, 바로 아래 항목에서
  이마저 마저 정리함. 이 5개 탭에 새 테이블을 추가할 때는 currencyMode 필터링과
  `refreshAll()` 등록을 둘 다 잊지 말 것.
- **USDC↔KRW는 상태를 공유하지 않기로 확정 — 동기화 기능은 만들지 않음** (2026-09-18,
  사용자 결정): 위 항목에서 "USDC #1 만기를 바꿨는데 KRW #1엔 안 반영됨"을 보고 사용자가
  처음엔 "USDC·KRW는 금액만 다르고 나머지(계약 내용·납입·만기)는 항상 같아야 하니, 한쪽을
  바꾸면 다른 쪽도 자동으로 같이 바꿔달라"고 요청함. 이걸 전체 상태변경 액션(납입/만기/
  대출/자동납부/청구/심사)마다 두 계약에 각각 트랜잭션을 쏘는 구현(클릭 1번에 MetaMask
  서명 2번 필요, ID 매핑 취약, 이미 어긋난 과거 데이터는 못 맞춤)으로 확인 질문했더니,
  사용자가 정반대로 결론 내림: "USDC와 KRW는 완전 별개로 가야함. 동기화는 없던 것으로
  해야 함" / "동기화 하지 말고, 각 통화별로 별개로 하고, 모두 동기화 하지 말자". 즉 두
  계약은 (deploy.js의 최초 시드 데이터 동기화 1회성 제외) 런타임에는 계속 완전히 독립.
  이 주제가 다시 나오면 동기화 기능을 새로 제안하지 말 것 — 이미 물어봤고 명시적으로
  거절당함.
- **챗봇의 블록체인 조회는 USDC 계약만 봄 + KST 타임존 버그 수정** (2026-09-18): 위
  동기화 논의 중 사용자가 "챗봇은 USDC만 나오도록 해주고, 챗봇 결과와 블록체인 내용이
  틀린 것만 수정해달라"고 요청. (1) `blockchain-dental/scripts/query-policy.js`의
  `currencies` 배열을 USDC 하나로 줄여, `get_blockchain_dental_status`가 더 이상 KRW
  증권을 함께 보여주지 않음(우연히 같은 번호를 쓰는 독립된 증권이 섞여 보이는 문제
  방지). (2) `query-policy.js`의 `tsToDate()`가 `toISOString()`(타임존 표시 없는 UTC)을
  쓰고 있어서, 프론트엔드(`app.js`의 `tsToDate()`, `toLocaleString("ko-KR")` → 이 머신의
  실제 타임존인 KST로 렌더링)와 챗봇 답변의 만기 시각이 서로 다르게 보이는 버그가 있었음
  (사용자가 두 번의 챗봇 응답이 서로 다른 시각을 말한다며 스크린샷으로 신고). GPT가 라벨
  없는 UTC 문자열을 받아 재해석하면서 매번 다른 시각으로 답하던 것으로 보임.
  `toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })` + `" (KST)"` 라벨을 명시해 프론트
  엔드와 정확히 같은 문자열을 GPT에 넘기도록 고침 — 실제 챗봇에 재질문해 프론트엔드 표시
  시각과 정확히 일치함을 확인함(오후 8:15:05 KST). 블록체인 타임스탬프를 사람/LLM에게
  보여줄 새 코드를 추가할 때는 항상 이 패턴(명시적 timeZone + 라벨)을 쓸 것,
  `toISOString()`을 그대로 노출하지 말 것.
- **관리자 대시보드(블록체인 상태 탭) 합산 통계·청약 심사 탭·준비금 계좌 탭도
  currencyMode로 필터링됨** (2026-09-18 추가 결정): 위 두 항목의 연장선 — 사용자가 이
  세 곳도 "각 통화별로 각각 맞추어서 보여달라"고 요청. `refreshBlockchainState`의
  `stateContractBal`/`statePremiums`/`statePaid`/`stateProfit`, `refreshStatCharts`의
  `chartAppStatus`/`chartClaimStatus`/`chartFundsFlow`, `refreshApplications`(청약 목록),
  `refreshReserve`의 관리자 전체 고객 현황·송금/인출 내역을 모두 두 통화 합산+환산에서
  currencyMode 하나만 조회하도록 변경. `index.html`의 차트 부제도 "USDC+KRW 전체"라고
  써 있던 낡은 문구를 "현재 화면 통화(USDC/KRW)"로 고침. 유일하게 그대로 둔 것은
  `chartCcySplit`("💱 통화별 보험료 수납 비중" 도넛 차트) — 이건 애초에 두 통화를
  나란히 비교하는 게 존재 목적이라 자기 라벨("현재 화면 통화 기준으로 환산해 비교")로
  이미 명확히 밝히고 있어, 다른 곳들의 "실수로 섞여 보이는" 문제와는 다르다고 판단해
  남겨둠 — 이것까지 없애고 싶다면 먼저 확인할 것.
- **블록체인 후속 질문에도 뉴스가 계속 붙던 버그, 진짜 원인은 달랐음** (2026-09-18):
  위 "블록체인 조회 응답에는 뉴스 안 붙임" 수정(`used_blockchain_tool` 플래그) 이후에도
  사용자가 스크린샷으로 재신고함. 실제 원인은 GPT가 뉴스를 베껴 쓰는 게 아니라, 같은
  대화에서 "만기 언제야?" 다음에 "이번 달 보험료 냈어?"처럼 **후속 질문에 이전 턴의
  도구 결과를 재사용해 답하면서 이번 턴엔 도구를 아예 호출하지 않는** 경우가 있었던
  것 — "이번 턴 도구 호출 없음"을 "블록체인 답변 아님"으로 오판해 뉴스가 붙었음.
  `orchestrator.py`에 `_last_tool_call_names()` 헬퍼를 추가해, 이번 턴에 도구 호출이
  전혀 없었다면 히스토리에서 직전에 실제로 호출됐던 도구가 `get_blockchain_dental_status`
  였는지로 판단하도록 폴백을 추가함(`chat()`/`stream_chat()` 둘 다). 새 도구를 추가할 때
  "이전 턴 결과를 재사용해 이번 턴엔 호출 안 함" 패턴이 나올 수 있다면 같은 폴백을
  고려할 것 — 단순히 "이번 턴에 호출했는가"만 보면 이런 케이스를 놓친다.
- **"내일 만기"라고 틀리게 답하던 버그**: `query-policy.js`의 `daysUntilMaturity`가
  `Math.ceil(남은초/86400)`이라, 만기가 단 몇 분 뒤(=오늘)여도 결과가 1이 되어 GPT가
  "내일"로 오해했음(2026-09-18 발견, 사용자가 "내일 만기 아닌데 내일 만기로 나옴"이라고
  신고). 프론트엔드 카운트다운(`app.js`)과 동일한 방식(`Math.floor` 기반)으로
  `timeUntilMaturity` 문자열(예: `"오늘, 28분 후"`, `"3일 4시간 후"`)을 미리 계산해
  넘기도록 고치고, GPT가 직접 날짜를 암산하지 말고 이 문자열을 그대로 쓰도록
  시스템 프롬프트에도 명시함. 블록체인 타임스탬프 기반으로 "며칠 남았는지" 같은 걸
  새로 계산해 사람/LLM에게 보여줄 땐 항상 이 패턴(문자열로 미리 계산해서 넘기기)을 쓸 것
  — GPT에게 날짜 산수를 맡기면 틀림.
- **관리자 수동 만기환급이 항상 "No premiums paid"로 실패하던 버그**: `deploy.js`의
  데모 증권(김덴탈/이치과, USDC·KRW 각 2건)은 만기가 배포 30~45분 후인데 보험료
  납입주기는 컨트랙트 기본값(30일)로 남아있고 고객 계좌의 approve도 없어서, **만기
  전에 보험료가 단 한 번도 징수될 수 없는 구조**였음(2026-09-18 발견). 컨트랙트에
  이미 있던 테스트용 상수 `PREMIUM_INTERVAL_TEST`(5분)로 `setPremiumInterval`을 걸고
  고객 계좌가 보험사 컨트랙트에 `approve(MaxUint256)`하도록 `deploy.js`에 추가함 —
  `collectPremium` → `processMaturityRefund` 순서로 성공하는 것을 직접 컨트랙트 호출로
  확인함. 데모용으로 만기를 짧게 잡는 증권을 추가할 땐 납입주기도 그보다 짧게 맞춰야
  실제로 납입액이 쌓여 만기환급 테스트가 가능하다는 점을 기억할 것.
- **표에서 한글 텍스트(이름/뱃지)가 중간에 줄바꿈되던 문제**: `styles.css`의 `td`에
  `th`와 달리 `white-space: nowrap`이 빠져 있어서, 컬럼이 많아 좁아지는 표(준비금
  탭 등)에서 "김덴탈"이 "김덴\n탈"처럼 잘려 보였음(2026-09-18 사용자 신고,
  `.table-wrap`에 이미 `overflow-x:auto`가 있어 nowrap이 원래 의도였던 것으로 보임).
  `td`에도 `white-space: nowrap` 추가로 통일.
- **npm 버전 불일치로 `package-lock.json`이 통째로 재작성될 때 diff를 작게 유지하는 법**:
  위 항목("npm이 구버전이라...")의 실전 대응 — `npm install -g npm@10`으로 npm 자체를
  올리는 걸 먼저 시도해볼 것(이번엔 다른 프로세스가 파일을 잠갔는지 EPERM으로 실패함,
  재부팅 후 재시도하면 될 수도 있음). 실패하면: 의존성이 **없는**(zero-dependency)
  패키지에 한해, `git checkout`으로 lockfile을 원복한 뒤 `node_modules/<pkg>/package.json`
  에 이미 설치되어 있는 `_resolved`/`_integrity` 값을 그대로 읽어 lockfileVersion 3
  포맷의 `packages["node_modules/<pkg>"]` 엔트리 하나와 루트 `packages[""].dependencies`
  이름 하나만 수동으로 추가하면, npm 10+이 만들었을 것과 동일한 형태의 작은 diff를
  만들 수 있음(`nodemailer` 추가 시 2772줄 → 9줄로 줄임). 의존성이 있는 패키지는 전이
  의존성까지 다 맞춰야 해서 이 수작업이 위험해지므로 권장하지 않음.
- **챗봇이 증권이 여러 개인데 일부만 답하던 버그**: `get_blockchain_dental_status` 결과의
  `policies` 배열에 3개가 들어있는데도 GPT가 "첫 번째, 두 번째"처럼 2개만 요약하고 3번째를
  조용히 빠뜨린 적이 있었음(2026-09-18, 온체인·`query-policy.js` 양쪽 다 3개 다 정상
  반환하는 것을 직접 확인 — 순전히 GPT 요약 단계의 누락이었음). 시스템 프롬프트에 "배열에
  여러 개 있으면 하나도 빠짐없이 전부 포함, 일부만 요약해서 나머지를 빠뜨리지 말 것"을
  명시해 해결. 다른 배열형 도구 결과를 다룰 때도 GPT가 "대표로 몇 개만" 요약해버리는
  경향이 있다는 걸 기억할 것 — 전수 나열이 필요하면 프롬프트에 명시적으로 못박아야 함.
- **USDC↔KRW 통화 전환을 반복하면 이벤트 리스너가 쌓여 알림이 중복 발송되던 버그**:
  `frontend/app.js`의 `switchCurrency()`는 호출될 때마다 `loadContracts()`를 다시 실행해
  `insCtx`를 새 `ethers.Contract` 인스턴스로 교체하는데, `provider`는 세션 내내 재사용되는
  공유 객체라서 이전 `insCtx`에 `attachEventListeners()`로 걸어둔 리스너(PolicyCreated 등)
  가 정리되지 않고 그대로 살아있었음. 같은 통화로 여러 번 돌아올 때마다 리스너가 하나씩
  쌓여, 실제 온체인 이벤트 1건에 이메일/Slack 알림 등이 통화 전환 횟수만큼 중복 발송됨
  (2026-09-18 발견 — 사용자가 같은 증권 발급 이메일을 5통 받음. 처음엔 "탭 여러 개
  열어놔서 그런가" 의심했으나 사용자가 탭 하나만 썼다고 확인해줘서 진짜 원인을 찾음 —
  섣부른 추측을 사실처럼 단정하지 말 것). `loadContracts()`에서 새 인스턴스를 만들기
  전에 `insCtx?.removeAllListeners()`를 호출하도록 수정. `insCtx`/`usdcCtx` 등 공유
  `provider`에 물려있는 컨트랙트 인스턴스를 재생성하는 코드를 또 추가할 때는 항상 이
  패턴(교체 전 이전 인스턴스 리스너 정리)을 쓸 것.
- **대체투자(AltInvestmentFund) 재원이 개인 지갑이 아니라 준비금 계좌(ReserveFund)에서
  나가도록 변경 — 확정 결정** (2026-09-19): 원래 `investAltFund()`는 개인 USDC 지갑
  잔액에서 바로 투자됐는데, 사용자가 "준비금은 원래 보험사가 굴려서 수익 내는 재원인데
  대체투자도 그 준비금에서 나가야 논리적으로 맞다"고 지적함(실제 보험업의 준비금 운용
  논리와 일치) — 동의하여 반영. `ReserveFund.sol`/`AltInvestmentFund.sol` 둘 다 그대로
  두고(새 컨트랙트 연동 없이), 프론트엔드에서 기존 검증된 함수만으로 **①
  `reserveSign.withdrawReserve(amount)`(준비금→지갑) → ② `usdcSign.approve`+
  `altInvestSign.invest(fundId, amount)`(지갑→AltInvestmentFund)** 순서로 서명 2회를
  이어서 실행하도록 `investAltFund()`를 재작성함. 인출/조기해지도 대칭적으로 —
  `withdrawAltFund()`/`earlyWithdrawAltFund()`가 성공하면 새로 만든
  `depositToReserveAfterAltInvest()`가 받은 돈(조기해지는 페널티 제외한 실수령액만)을
  자동으로 다시 `reserveSign.depositReserve()`로 준비금에 넣음. "투자 가능 금액(내
  지갑)" 라벨/변수(`_altInvestWalletBal`)도 "투자 가능 금액(준비금 계좌)"/
  `_altInvestReserveBal`로 이름까지 바꿈 — 소스를 `reserveCtx.previewBalance()`로
  변경. USDC↔KRW를 동기화하지 않기로 확정한 것과 마찬가지로 이것도 이미 사용자가
  명시적으로 확정한 결정이니, 재론의 없이 참고할 것.
- **대체투자 이메일은 원래 조기해지 시에만 발송되던 것 — 투자 완료 시에도 발송하도록
  추가** (2026-09-19): `frontend/app.js`의 `notifyAltInvestUpdate()`는 처음엔
  `EarlyWithdrawn` 이벤트에만 연결돼 있었음(투자 화면 이메일 입력칸 라벨도 "조기해지
  시 알림용"이라고만 되어 있었음). `Invested` 이벤트 리스너에도
  `notifyAltInvestUpdate("altinvest_invested", ...)` 호출을 추가하고,
  `scripts/email-service.js`의 `ALTINVEST_LABELS`/`handleAltInvestUpdate()`에
  `altinvest_invested` 전용 템플릿(투자금액·연수익률·락업해제일 안내)을 추가함.
- **대체투자 예상잔액에 이자가 안 보이는 건 버그 아님 — 일 복리 계산의 정상 동작**:
  `AltInvestmentFund.sol`의 `_accrue()`/`previewPosition()`은
  `daysElapsed = (경과초)/86400`(정수 나눗셈)이라 **꽉 찬 24시간이 지나야** 이자가
  붙는다. 투자 직후(수십 분~1시간 내) 조회하면 예상잔액=원금이 정확한 값.
  `scripts/advance-time.js`(로컬 체인 시간을 강제로 앞당기는 기존 개발 도구)로 3일
  앞당겨 재조회해서 APR대로 이자가 정확히 붙는 것을 확인함. ⚠️ **이 세션에서 로컬
  체인 시간을 실제로 3일 앞당겼음** — Hardhat 노드를 재기동하지 않는 한 이 상태가
  유지되므로, 이후 세션에서 만기환급/자동납부 등 다른 탭의 날짜가 예상보다 빨라
  보이면 이것 때문일 수 있음(노드를 새로 띄우면 초기화됨).
- **"좀비 node 프로세스"로 보였던 건 실은 정상 — 정리 안 함**: 블록체인 스택이 뜬
  상태에서 `node.exe`가 13개 보여서 처음엔 재시작 잔재로 의심했으나, 커맨드라인을
  전부 까보니 Hardhat 노드(npx 래퍼+실제 프로세스 2개)+백그라운드 서비스 9종(각
  1개)+프론트엔드 serve(npx 래퍼+실제 프로세스 2개) = 정확히 13개로, 전부 같은 기동
  시점(45초 이내)에 뜬 정상 프로세스였음. `node.exe` 개수만 보고 "여러 번 재시작된
  것 같다"고 넘겨짚지 말고, 항상 `Get-CimInstance Win32_Process`로 커맨드라인까지
  확인할 것.
- **대체투자 상품(alt_001) 추천이 표 형식이 아니면 "블록체인 가입 시작" 버튼이 아예
  안 뜸**: `web_app.py`의 `addLinksToTables()`가 `<table>` 안의 행에만 버튼을
  붙이는데, `orchestrator.py`의 상담원칙 8번(대체투자 추천)에는 애초에 표 형식을
  쓰라는 지시가 없어서 GPT가 산문/불릿으로 답하면 버튼이 안 나오는 문제가 있었음
  (dental_005 쪽 원칙 7번엔 "비교표"라고 명시돼 있었음). 상담원칙 8번에도 "반드시
  마크다운 비교표 형식"을 명시해 해결.
- **`get_blockchain_altinvest_status` 관련 프롬프트가 실수로
  `get_blockchain_dental_status` 지침 밑에 잘못 끼워져 있던 구조적 버그 수정**:
  대체투자 도구를 추가할 때 dental_status의 `timeUntilMaturity`/`policies` 배열
  관련 하위 지침이 (내용은 그대로인 채) 대체투자 항목 밑으로 밀려 들어가 있었음 —
  GPT가 읽기엔 "대체투자 조회 시 policies 배열을 보라"는 것처럼 잘못 그룹핑된
  상태였음. 덴탈 지침을 원래 자리(덴탈 항목 밑)로 되돌리고, 대체투자에는 `positions`
  배열용으로 별도 지침(전수나열 + 표 형식 + 락업 해제일 빠른 순 정렬,
  `timeUntilUnlock` 문자열 그대로 사용)을 새로 작성함.
- **대체투자에도 챗봇/블록체인 UI 격차 몇 가지 추가 보완** (2026-09-19): (1) 관리자
  "전체 투자자 현황" 테이블에 다른 관리자 테이블과 동일하게 `exportAltInvestTableCsv()`
  + "⬇️ CSV 내보내기" 버튼 추가. (2) "🪙 대체투자" 탭 버튼에 만기환급/자동납부 탭과
  동일한 패턴의 락업 해제(인출 가능) 알림 배지(`altInvestAlertBadge`) 추가 — 고객은
  본인 포지션, 관리자는 전체 투자자 기준. (3) 챗봇의 "블록체인 가입 시작" 버튼이
  대체투자 추천에서 눌려도 항상 파우셋 탭으로 열리던 것을, `target`(dental/altinvest)을
  `web_app.py`→`blockchain_bridge.py`까지 전달해 `#altinvest` 해시를 붙여 열도록
  수정 — 그런데 `frontend/app.js`에 애초에 URL 해시를 읽는 로직 자체가 없어서
  (`location.hash` 처리 전무), `window.addEventListener("load", ...)` 초기화 코드에
  해시 기반 초기 탭 선택 로직을 새로 추가함. 앞으로 새 딥링크 진입점을 추가할 때는
  이 해시 라우팅을 재사용할 것.
- **Slack 슬래시 커맨드(`/덴탈조회`)는 대체투자 조회를 지원하지 않음 — 의도적으로
  보류**: `/api/slack/commands`가 `get_blockchain_dental_status`만 호출하도록
  하드코딩돼 있어 대체투자 포지션은 Slack에서 조회 불가. 리뷰 중 발견했으나 이번엔
  범위에서 제외하기로 함 — 필요해지면 별도 슬래시 커맨드 또는 기존 커맨드 확장으로
  추가할 것.

- **사업화(수익성) 관점 고도화 6종 추가** (2026-09-21, 사용자가 "수익성으로
  투자자를 설득하려면 뭘 더 고도화해야 하는지" 검토 요청 → 6개 항목 전부 승인):
  - **A. 수익성 지표 대시보드** — 관리자 대시보드(블록체인 상태 탭)에 손해율·
    사업비율·합산비율 3종 추가(`frontend/app.js`의 `renderProfitabilityRatios()`).
    사업비율은 온체인에 실제 사업비 데이터가 없어 `EXPENSE_RATIO_BPS`(기본 25%)
    가정치를 씀 — 실제 운영비 데이터를 연동하게 되면 그 상수를 교체할 것.
  - **B. 재보험풀 청구 백스톱 1클릭화** — `ReinsurancePool.sol`이 의도적으로
    자동화하지 않은 "인출→재입금" 2단계 수동 브릿지(주석 참고) 자체는 그대로 두고,
    프론트엔드(`adminDrawAndReplenish()`)가 `drawForClaim()` → `depositFunds()`를
    이어서 실행해주도록 묶음. 온체인 신뢰 구조 변경 없음(두 트랜잭션 다 여전히
    관리자 본인 서명) — 운영 부담·실수 위험만 없앤 것.
  - **C. AltInvestmentFund에 "리스크연동형" 신규 펀드 추가** (기존 고정APR 3종은
    무변경) — `FundInfo`에 `riskLinked`/`linkedPool` 필드를 추가하고
    `addRiskLinkedFund()`로 등록하면, 그 펀드는 고정 이율 대신 지정한
    `ReinsurancePool`의 실제 지분가치를 그대로 따라간다. 내부적으로 여러 투자자의
    예치금을 모아 하나의 풀 포지션으로 합쳐 들고 있고, 투자자별 몫은
    `_riskLinkedShares[investor][fundId]`로 별도 추적(ReinsurancePool.deposit()이
    민팅한 지분 수량 기준). `invest(fundId, amount)`는 기존 고정APR 펀드와 함수를
    공유하지만(입력 단위가 항상 스테이블코인 금액으로 동일), 인출은 단위가
    달라져서(지분 수량 vs 스테이블코인 금액) `withdrawRiskLinked`/
    `earlyWithdrawRiskLinked`라는 별도 함수로 분리 — 기존 `withdraw`/`earlyWithdraw`/
    `previewPosition`은 riskLinked 펀드에 대해 명시적으로 revert하도록 가드해
    단위 혼동으로 인한 잘못된 호출을 컴파일이 아니라 런타임에서라도 즉시 잡아냄.
    `deploy.js`가 배포 때마다 "재보험풀 연동 인컴 펀드"(락업 30일, 조기해지 페널티
    2%)를 USDC·KRW 양쪽에 자동 등록. `query-altinvest.js`/`altinvest-watcher.js`/
    `frontend/app.js`의 대체투자 관련 조회·알림 코드 전부 riskLinked 분기 추가 —
    빠뜨리면 해당 펀드만 조용히 조회 결과에서 빠지거나(catch로 스킵) 락업해제
    알림이 안 가는 형태로 실패하므로(크래시는 안 남) 발견하기 쉽지 않다는 점
    기억할 것. 관리자가 새 리스크연동형 펀드를 추가하는 UI(admin 폼)는 이번엔
    빠짐 — 현재는 `deploy.js` 시드 또는 콘솔 스크립트로만 추가 가능.
  - **D. 파라메트릭(폭염특보) 상품에 실제 기상 데이터 연동** —
    `parametric-oracle-service.js`가 `metricLabel`에 "폭염"이 포함된 상품에
    한해 Open-Meteo(무료, API 키 불필요, Node 22 내장 `fetch` 사용)로 서울의
    일 최고기온을 조회해 33도 이상 일수를 관측값으로 씀(`fetchSeoulHeatwaveDays`).
    API 호출이 실패하면(네트워크 장애 등) 그 회차만 기존 시뮬레이션 값으로
    안전하게 폴백. 항공편 지연 상품은 무료 API가 마땅치 않아 여전히 시뮬레이션
    유지 — 항공 데이터도 실 연동하려면 유료 API(AviationStack 등) 키 발급이
    먼저 필요함.
  - **E. B2B 파트너 API 월별 정산 리포트** — 기존 `partner_api.py`의 `call_count`는
    발급 이후 누적치라 "이번 달 청구액"을 낼 수 없었음(정산은 월 단위로 끊어야
    함). `record_usage()`가 `monthly_usage["YYYY-MM"]`도 함께 집계하도록 추가하고,
    `monthly_billing_report()`/`available_months()`를 신설. `/admin/partners`
    페이지에 월 선택 드롭다운 + 그 달 파트너별 호출수·청구액 표를 추가하고,
    `/admin/partners/export?month=YYYY-MM` CSV 다운로드 라우트 신설(다른 관리자
    테이블들의 기존 CSV 내보내기 관례와 동일 목적 — 실제 청구서 발행 근거자료).
  - **F. 가스리스(경량 Relayer) 온보딩** — MetaMask 설치·가스비 마련이 부담스러운
    고객을 위한 챗봇 신규 도구 `start_gasless_dental_enrollment`
    (`insurance_agent/tools/gasless_enrollment_tool.py` + `tools/relay_wallet.py`).
    정식 ERC-4337 Account Abstraction(번들러/페이마스터 인프라)이 아니라 훨씬
    가벼운 방식 — 신규 `blockchain-dental/scripts/relay-wallet.js`가 호출마다
    새 지갑을 생성하고 회사(스폰서, 기본 Hardhat Account #0) 계정이 가스용 ETH를
    대납한 뒤, 그 지갑 자신이 서명해 `submitApplication()`을 직접 호출한다 —
    회사 명의 대리가입이 아니라 그 신규 주소가 실제 청약/증권 소유자가 됨. 세션
    간 지갑을 이어 쓰는 매핑은 두지 않음(매 호출마다 신규 지갑 생성 후 그 자리에서
    바로 가입까지 완결 — 받은 주소를 고객이 직접 기억했다가 이후 조회 시
    `get_blockchain_dental_status(wallet_address=...)`에 넣어 재사용). 생성된
    지갑은 감사 목적으로만 `data/relay_wallets.json`(신규 .gitignore 대상 —
    테스트넷 전용이지만 개인키를 담고 있어 커밋 금지)에 기록. ⚠️ 개인키를 서버
    JSON 파일에 평문 보관하는 것 자체가 데모 전용 트레이드오프임을
    `relay-wallet.js` 파일 상단에 명시 — 실 서비스 전환 시 KMS/HSM 기반 키
    관리로 반드시 교체 필요.
  - **테스트**: 신규 `test/AltInvestmentFund.test.js`(리스크연동형 펀드 전용,
    기존 고정APR 경로는 회귀 스모크만) 추가. ⚠️ 이 6종을 구현한 원격 세션 환경은
    네트워크 egress 정책상 `binaries.soliditylang.org`(Hardhat의 solc 컴파일러
    다운로드)와 `api.open-meteo.com`이 모두 막혀 있어, `npx hardhat compile`/
    `npx hardhat test`를 이 환경에서 직접 실행하지 못했음 — 대신 이미 npm으로
    설치된 `solc`(순수 JS) 패키지로 전체 컨트랙트를 직접 컴파일해 문법·타입
    오류가 없음만 확인함. **실제 Windows 개발 머신에서 `npm test`로 전체
    스위트(기존 167개 + 신규 AltInvestmentFund 테스트)가 통과하는지, 그리고
    Open-Meteo 실제 호출이 되는지 반드시 재확인할 것.**

- **투자피칭 PPT(`인슈어체인_투자피칭_발표자료.pptx`) 16→21슬라이드 재구성** (2026-10-19,
  사용자가 "상담 AI Agent(저축성·보장성·리밸런싱·부수업무) 먼저, 그다음 블록체인
  UW·청구 AI Agent" 순서로 발표하고 싶다고 요청): 빌드 스크립트는
  `/tmp/.../scratchpad/pptxbuild/build_deck.js`(세션별 임시 디렉터리라 세션이
  바뀌면 사라짐 — 저장소에는 결과물 `.pptx`만 커밋됨, 스크립트를 다시 쓰려면 이
  CLAUDE.md 항목과 git log의 해당 커밋 메시지를 참고). 신규 슬라이드 3종(보험상담
  AI Agent 상품추천/리밸런싱(CareLink)/부수업무 건강금융)을 블록체인 슬라이드
  앞에 배치, 기존 "AI 거버넌스" 통합 슬라이드를 UW/청구 두 슬라이드로 분리,
  비용비교표에 UW(가입심사) 행 추가(⑤ 워크넷 언더라이터 평균임금 6,750만원 출처
  — invione.com이 워크넷 데이터를 옮겨 게재한 것으로 보이는 자료라 원자료 직접
  확인을 권하는 캐비트를 각주에 명시), 비즈니스모델에 "헬스케어 파트너십"(건강검진센터
  ×보험사 리퍼럴) 수익유형과 전용 다이어그램 슬라이드 추가.
  - ⚠️ **PowerPoint로 열면 실제 내용 슬라이드 위에 빈 "표/콘텐츠" placeholder가 함께
    보이던 버그 발견·수정**: `pres.defineSlideMaster({title:"CONTENT", ...})`가
    `type:"body"` placeholder를 선언해뒀는데, 정작 CONTENT 마스터를 쓰는 슬라이드
    14개 전부 `{placeholder:"body"}`로 채우는 코드가 단 한 줄도 없었음 — 온라인
    미리보기(이 세션의 `markitdown`/LibreOffice 변환 등)에서는 빈 placeholder가
    아예 안 보이지만, 실제 PowerPoint 네이티브 뷰에서는 미채움 placeholder가
    그대로 노출된다는 게 원인으로 보임(사용자가 "다운로드한 파일은 화면에서 안
    보이는데 ppt로 열면 default 표가 보인다"고 신고). CONTENT 마스터 정의에서
    `body` placeholder 자체를 제거해 해결 — `defineSlideMaster()`로 title/body를
    같이 선언해두고 실제로는 title만 쓰는 패턴을 반복하면 같은 버그가 재발하니,
    새 마스터를 만들 때 선언한 placeholder를 모든 슬라이드가 실제로 채우는지 꼭
    확인할 것(`grep -n 'placeholder.*"body"'` 등으로 빠르게 점검 가능).
  - **이 세션 환경엔 pptxgenjs가 preinstalled 상태가 아니었음**(스킬 문서는
    "preinstalled"라고 안내하지만 실제로는 컨테이너마다 다를 수 있는 것으로 보임) —
    `npm install pptxgenjs`로 로컬 설치 후, `apply_theme.js`가 자기 자신의 위치
    기준으로 `pptxgenjs`를 재탐색하다 못 찾는 문제가 있어
    `NODE_PATH="$PWD/node_modules" node build_deck.js deck.pptx`처럼 NODE_PATH를
    명시해야 정상 빌드됨(스크립트 자체의 에러 메시지에 이미 이 해법이 안내돼 있음).
  - ⚠️ **이 세션에서는 LibreOffice(`soffice`) 변환 자체가 환경 레벨에서 깨져 있어
    시각적 QA(슬라이드를 이미지로 렌더링해 직접 확인)를 수행하지 못함** — 최소
    재현(빈 텍스트박스 하나뿐인 pptx)으로도 `soffice --headless --convert-to pdf`가
    매번 "Error: source file could not be loaded"로 실패하는 것을 확인해, 파일
    자체의 문제가 아니라 이 세션/컨테이너의 LibreOffice 환경 문제임을 특정함.
    `validate.py`(스키마·관계·콘텐츠타입·차트 검증)는 전부 통과했고 `markitdown`으로
    21개 슬라이드 텍스트 내용도 전수 확인했지만, 텍스트 박스 겹침·표 레이아웃
    초과 같은 시각적 결함은 실제로 렌더링해보지 않고는 100% 장담할 수 없음(특히
    비용비교표 슬라이드는 행을 4→5개로 늘려 각주 영역과 겹칠 여지가 있어 수치
    기반으로 여백을 보수적으로 늘려뒀을 뿐, 실제 렌더링 확인은 못함) — 다음
    세션에서 LibreOffice가 정상 동작하면 `soffice --headless --convert-to pdf`
    → `pdftoppm`으로 꼭 한 번 시각 QA할 것, 특히 비용비교표 슬라이드(9번)를 먼저
    볼 것.

- **투자피칭 PPT 21→24슬라이드 확장 + 사업계획서(확장판)에 수익성 숫자 모델·
  헬스케어 리퍼럴 수익화 사례 추가** (2026-10-26, 사용자가 "사업을 확대하고
  수익성에 초점을 맞추려면 무엇이 필요한지 검토" 요청 → 수익성 숫자 모델 +
  검진센터 제휴 사전가입 구체 사례 + 배너광고식(CPM/CPC/CPA) 유입비용 계산
  방식 추가를 승인받아 구현):
  - **수익성 시뮬레이션(규모의 경제)** — 평균보험료 30만원/건·평균손해율 55%·
    개별 손해율 변동계수(CV) 1.5·연간 고정비 1.8억원·가변비 8%(전부 명시된
    가정치)를 고정한 채 가입 건수(N=100~100,000)만 늘려보는 단순 모델을
    `/tmp/.../scratchpad/profit_model.py`로 직접 계산 — 손익분기점이 약
    1,622건(로드맵 2단계 '컨소시엄 구축' 목표 규모와 거의 일치)으로 나오고,
    N이 커질수록 중심극한정리(CLT)에 의해 손해율 95% 신뢰구간이 좁아짐을
    보여줌. 재보험풀 15% ceding 시 99% VaR 기준 필요자본이 같은 비율로
    줄어드는 것도 함께 계산(quota-share 재보험의 실제 효과는 "비율 변동성"이
    아니라 "절대금액 변동성·필요자본" 감소라는 점에 유의해 그렇게만 서술함).
    투자피칭 PPT 신규 슬라이드(18번) + 사업계획서 신규 "5-1-1. 수익성
    시뮬레이션" 절에 동일한 표로 반영.
  - **헬스케어 파트너십 수익화 구체 사례** — 기존에 개념만 있던 "건강검진센터
    ×보험사 매칭"(PPT 15번 슬라이드)을 "6개월 후 재검"(경계성 고혈압·
    공복혈당장애 등 추적관찰 소견) 판정자에게 결과지 전달 시점에 CareLink
    연결을 권유하는 구체 퍼널(수진자 3,000명→추적관찰 판정 450명(15%)→동의
    90명(20%)→가입전환 11명(12%), 전부 예시 가정)로 구체화. PPT 신규
    슬라이드(16번) + 사업계획서 신규 "5-3-1. 수익화 구체 사례" 절, 그리고
    사업계획서 "5-3. 수익 구조" 표에 "헬스케어 파트너십" 행 추가(기존
    PPT에는 이미 5유형으로 반영돼 있었는데 사업계획서 쪽은 4유형인 채로 누락돼
    있던 것도 같이 맞춤).
  - **유입 비용 계산(CPM/CPC/CPA)** — "고객이 보험사 사이트로 인입될 때 배너
    광고처럼 비용을 계산해달라"는 요청에 따라, 검진센터 리퍼럴 채널도 일반
    배너광고와 동일한 공식(CPM=비용÷(노출÷1,000), CPC=비용÷클릭수,
    CPA=비용÷전환수=CPC÷전환율)으로 계산해 두 채널을 숫자로 직접 비교하는
    표를 추가(PPT 17번 슬라이드, 사업계획서 5-3-1절). 검진센터 CPA(약
    3만원)가 일반 배너광고 CPA(약 2.5만원, 참고 가정치)와 비슷한 수준이지만,
    "모수 1,000명당" 비용(CPM 환산)은 훨씬 높다는 점과, 역선택 방지·가입
    가능 시점 선점 같은 CPA 숫자에 안 잡히는 질적 가치가 있다는 한계를
    같이 명시함 — 배너광고 비교 수치는 업계 평균이 아닌 예시 가정치임을
    매번 각주로 밝힘.
  - **구현 방식**: 이번 세션에서는 `pptxgenjs` 원본 빌드스크립트가 유실된
    상태였고, 반대로 이번 세션의 LibreOffice는 정상 동작했음(세션마다
    환경이 달라질 수 있다는 걸 재확인 — 이전 세션 기록을 맹신하지 말고
    매번 `soffice` 동작 여부를 먼저 확인할 것). 그래서 `add_slide.py`로
    기존 슬라이드(15번)를 3장 복제한 뒤, 기존 슬라이드(9/15/17번)에서
    역추출한 좌표·스타일 그리드(타이틀/리드/3단 플로우/스탯카드/표/각주/
    용어설명 패턴)를 순수 Python 문자열 템플릿(`gen_slides.py`)으로
    재조립해 슬라이드 XML을 직접 작성 — ElementTree 라운드트립 없이 문자열
    그대로 써서 네임스페이스 깨짐을 피함. 사업계획서(docx)도 동일하게
    `word/document.xml`을 직접 문자열 치환으로 편집했는데, 첫 시도에서
    하위 헤딩 삽입 지점을 `<w:t>` 텍스트 노드 안쪽으로 앵커링하는 바람에
    기존 문단의 `<w:r>` 중간에 새 `<w:p>`가 끼어들어가 스키마 검증이 깨짐 —
    앵커를 해당 문단 전체(`<w:p>...</w:p>`) 시작 지점으로 바꿔 수정함(문단을
    끼워넣을 땐 항상 "완전한 형제 문단 경계"에 앵커링할 것, 내부 텍스트
    노드에 앵커링하지 말 것). 둘 다 `validate.py` 통과 + `soffice`+
    `pdftoppm`으로 실제 렌더링까지 확인(PPT는 24장 전체, DOCX는 6페이지
    전체) — 첫 렌더링에서 PPT 18번 슬라이드가 제목 줄바꿈으로 리드 문단과
    겹치고 하단 통계카드·각주가 서로 겹치는 문제를 발견해 좌표 재계산으로
    수정함(표 안의 `<a:tr h="0">`의 `h`는 최소값 힌트일 뿐 실제 렌더링은
    내용 기준으로 자동 높이 조정되므로, 표 다음 요소의 y좌표를 표의 선언된
    `cy`만으로 계산하면 안 되고 실제 렌더링을 봐야 함 — 이번에 겪은 실수).

- **`WK5_마케팅믹스_BCG매트릭스_5Layers_인슈어체인.docx`(WK5 과제 — AI핀테크 비즈니스모델
  수업) 신규 추가, 이후 AI Agent/블록체인 비중 조정·문체 변환 여러 차례 반영** (2026-10-26~30):
  이정훈 교수 WK5 강의자료(마케팅 믹스 4P/7P, BCG 매트릭스, 5 Layers)를 인슈어체인
  프로젝트에 적용한 신규 문서. 빌드 스크립트는 `/tmp/.../scratchpad/wk5build/build.js`
  (docx-js, 테이블/2x2 매트릭스 헬퍼 함수 포함 — 다른 PPT/DOCX 빌드 스크립트와 마찬가지로
  세션별 임시 디렉터리에만 존재, 저장소에는 결과물 `.docx`만 커밋됨). 사용자가 "보험 AI
  Agent 비중을 블록체인과 50%가 되도록"이라고 요청해, 7P 표의 Product/Price/Place/
  Promotion/People/Physical Evidence 전부와 BCG 4사분면에 `[보험 AI Agent]`/`[블록체인
  자동화]` 태그를 붙여 항목을 나란히 비교할 수 있게 함 — 이 과정에서 "언더라이팅 AI
  엔진(19종 자율심사+교차심사)"을 챗봇과 분리해 보험사에 단독 라이선스 가능한 별도
  B2B 자산으로 새로 정의해 AI 쪽 항목 수를 늘림(블록체인 쪽 기존 항목은 그대로 유지 —
  없는 내용을 지어내지 않고, 이미 존재하는 기술 요소를 "같은 비중으로 조명"하는
  방향으로 처리). 이 작업과 연동해 투자피칭 PPT(`인슈어체인_투자피칭_발표자료.pptx`)
  10번 슬라이드 제목에 "AI·블록체인"을 명시하고 14번 슬라이드 연속성 수익 카드에도
  "AI Assistant·언더라이팅 엔진 라이선스"를 추가— 단, PPT의 "11개 신규 상품" 카운트
  (슬라이드 17 통계와도 연결됨)는 건드리지 않고 문구만 보강.
  - **사용자가 Word로 직접 편집한 버전(팀원명 "2조 이기재, 전병하, 고다운, 이종재"를
    표지에 추가, 두 캡션에서 "(현재, 파일럿 단계 기준)"/"요약" 같은 부연 설명 제거,
    말미의 "※ 본 분석은..." 가정 고지 각주 통째로 삭제)을 업로드받아 PDF 변환 요청 →
    이후 "~다로 끝나는 문체를 ~함/~임으로 모두 바꿔달라"는 요청까지 받음. **사용자가
    Word에서 직접 수정한 내용(소스인 `build.js`에는 반영 안 돼 있던 것들)을 덮어쓰지
    않도록, 업로드된 .docx의 `word/document.xml`을 직접 문자열 치환으로 고쳐 PDF로
    변환해 전달**(merge_runs.py로 런 병합 후 처리 — Word가 재저장하면서 텍스트가
    런 단위로 잘게 쪼개져 있어 병합 없이는 치환 대상 문자열을 찾기 어려움). "~다"
    종결을 쓸 위치만 바꾸는 게 아니라 "~보다"(비교 조사, 동사 아님) 같은 가짜 일치를
    걸러내야 해서, 정규식으로 1차로 걸러낸 뒤 각 건을 육안으로 확인하고 1건씩 정확한
    문자열 치환으로 처리함 — 첫 회 변환 후 재스캔에서 "선행한다"/"인정한다" 2곳을
    더 찾아냄(한 번 스캔으로 다 잡힌다고 가정하지 말고 변환 후 반드시 재스캔할 것).
    사용자가 이 결과를 저장소에도 반영해달라고 해서, 같은 치환을 `build.js` 소스에도
    동일하게 적용(표지 팀원명·캡션 축약·각주 삭제 포함)해 두 버전이 다시 갈라지지
    않도록 동기화함 — 다만 실제로 저장소에 커밋한 `.docx` 파일 자체는 이미 LibreOffice
    렌더링으로 레이아웃을 검증해둔 "업로드본 직접 수정" 버전을 그대로 사용(새로
    `node build.js`로 다시 뽑은 버전은 문단 분리 등 사소한 구조 차이가 있어 재검증
    없이 교체하지 않음).

- **차세대 판단 AI 후보에 Jev(TypeSafe AI) 외에 Laya(ConvAI Innovations) 추가 검토**
  (2026-10-30, 사용자가 "Jev 대신 Laya를 쓸 수 있는지" 요청 → WebSearch로 조사):
  Laya는 2026-09-18 Hugging Face에 공개된 오픈 웨이트 "System 1 결정 모델" —
  Jev와 동일하게 자유 텍스트 대신 구조화된 값(선택지·점수·예/아니오 + 신뢰도)만
  반환하는 용도. ModernBERT-large 기반 영어 전용(395~421M)과 mmBERT 기반 다국어판
  (322M, 한국어 포함) 두 체크포인트가 있고 Apache 2.0 라이선스로 가중치가 공개돼
  있어 **자체 호스팅**이 가능(`pip install laya`, Jev 호환 HTTP 엔드포인트 내장,
  Docker/ONNX export 지원).
  - **Jev 대비 가장 큰 차이 — 접근 방식**: Jev는 호스티드 API 전용($0.042/백만
    입력 토큰)인 반면 Laya는 오픈 웨이트라 벤더 승인·API 키 없이 바로 자체
    서버에서 돌릴 수 있음 — 이 프로젝트가 Jev PoC조차 못 해본 이유(벤더 초기
    접근 게이트, 로컬 자격증명 부재, 이 세션 환경 프록시의 도메인 차단) 중 최소
    두 가지가 구조적으로 사라짐. 자체 호스팅이라 건강·신용 등 민감정보를 외부
    API로 전송하지 않아도 된다는 점도 기존에 적어둔 "민감정보 외부 전송 우려"
    리스크를 줄여주는 효과가 있음.
  - **다만 실효성은 아직 미흡 — 지금 바로 운영 투입은 비권장**: ① 한국어
    정확도가 약함(51개 언어 의도분류 벤치마크에서 영어 체크포인트는 한국어
    거의 랜덤 수준(0.110), 다국어 체크포인트도 0.490 — "쓸 수는 있지만 완벽과는
    거리가 멂"). ② Laya 자체 모델 카드가 스스로 "Jev 대비 soft accuracy 0.471 vs
    0.580로 낮고, Jev보다도 과신(overconfident) 경향"이라고 명시 —애초에 Jev를
    검토한 이유가 "판단 신뢰도가 기본 내장된다"는 점이었는데 Laya는 그 신뢰도
    보정에서조차 Jev보다 못하다고 자인하는 셈. ③ 모든 벤치마크 수치가 자체
    측정치(self-reported)이고 공식 벤더 페이지도 불명확(ConvAI Innovations와
    2020년 설립 동명의 인도 업체 간 혼동이 검색으로도 안 풀림).
  - **권고**: Jev를 Laya로 완전 대체하지 말고 둘 다 PoC 후보로 남겨, 같은 1~2개
    판단 지점(예: 씬파일러 신용보완 심사)에서 나란히 비교할 것. Laya는 무료·
    자체호스팅·민감정보 비유출이라는 구조적 장점 때문에 장기적으로는 매력적이나,
    당장은 "가볍게 돌려볼 수 있는 2순위 PoC 후보" 정도로 취급할 것 — 실제 심사
    결정에 반영하기 전에 반드시 기존 LLM 판단과의 일치율을 먼저 재야 함.
  - ⚠️ **모델 가중치 다운로드(~647MB)·추론 실행은 이 원격 세션이 아니라 실제
    Windows 개발 머신에서 진행할 것** — 이 세션은 pip install은 되더라도 GPU가
    없고, Hugging Face 다운로드가 이 환경의 아웃바운드 프록시 allowlist에
    포함되는지도 확인 전임.

- **투자피칭 PPT 24→26슬라이드 확장 — IT 인프라·결제 수수료 절감 근거 추가**
  (2026-10-31, 사용자가 "비용 분석에 인프라·유지보수·클라우드·라이선스 비용,
  자동이체 시 카드·은행·VAN사 수수료 절감도 객관적 근거와 함께 추가해달라" 요청):
  기존 슬라이드 9(건별 처리비용 비교표, UW/청구/결제/재보험/상담)는 그대로 두고,
  바로 뒤에 신규 슬라이드 2장(화면상 10·11번)을 삽입 — 파일은
  `ppt/slides/slide25.xml`/`slide26.xml`(다음 사용 가능한 파일번호, 앞서 22~24번
  패턴과 동일하게 물리적 파일번호와 화면 표시 순서가 다름), `presentation.xml`의
  `<p:sldIdLst>`에서 slide9(id 264/rId10) 바로 뒤에 새 `<p:sldId>` 2개를 끼워
  넣는 방식으로 삽입. 뒤따르는 slide10~24(화면상 10~24번, slide21 제외 — 클로징
  슬라이드라 애초에 페이지번호 placeholder 없음) 전부의 `<a:fld type="slidenum">`
  캐시 텍스트를 +2씩 일괄 수정.
  - **슬라이드 10(신규) — IT 인프라·유지보수 비용 구조**: DB·코어시스템
    라이선스/장애대응·이중화(BCP)/레거시 유지보수 비중/현대화 참고사례 4행 비교표.
    근거: ① KoreaScience 국내 논문(국민주택채권 정보중계시스템 — 중앙집중형
    중계센터 구축·운영비용 문제 지적, 분산원장 전환 시 네트워크·디스크 사용률
    각 1.7%/8.53% 개선 보고) ② Wipro, "From Run to Reinvention: How Insurers
    Are Reshaping IT Spend to Fund the Future" — 보험사 93%가 IT예산 절반
    이상을 운영(Run)에 사용, 65%는 레거시가 전환 걸림돌이라 응답 ③ IBM 케이스
    스터디(Sompo Holdings) — 메인프레임 현대화 후 CPU 코어 54%·메모리 33% 감소
    (벤더 공개 자료, 독립 검증 아님이라고 명시). DB·코어시스템 라이선스
    "0원" 비교는 공개 통계가 아니라 이 프로젝트 실제 blockchain-dental
    스택(Hardhat·Node.js·ethers.js, 전부 오픈소스) 구성 기준 자체 비교임을
    각주에 명시 — 슬라이드 9의 ⑤(워크넷 수치 재게재 자료) 캐비트와 같은 패턴으로
    출처 신뢰도 차이를 숨기지 않음.
  - **슬라이드 11(신규) — 자동이체 결제 수수료 절감(카드·VAN사·은행)**: 카드
    가맹점수수료/VAN사 수수료/CMS 계좌 자동이체 수수료 3행 비교표. 근거: ①
    생명보험협회 공시 관련 보도(2026) 카드수수료 2.2%(슬라이드 9와 동일 출처
    재인용) ② 카드사→VAN사 승인+매입수수료 합산 건당 70~120원(2014년 보도
    기준 — 이후 정액제→정률제 전환 논의가 있었던 것으로 보이나 최신 요율은
    별도 확인 필요라고 명시) ③ CMS 자동이체 중계기관(금융결제원 등) 수수료
    건당 약 200~250원(포트원 블로그, 2026.09 정리) + 은행 자체 이용수수료
    별도(예: 건당 300원, 하나은행 '납부자 자동이체 약관' 2023년 개정) 합산
    추정 ④ Polygon 등 L2 네트워크 평균 거래 수수료 약 $0.0026(2026년 2월
    보도) 수준 — 스마트컨트랙트 자동집행 비용은 이와 유사한 수준으로 자체
    추정. "연 4,800만원/년" 절감 예시(1만건×월납×CMS 400원/건 가정)는 단순
    추정치임을 각주에 명시.
  - ⚠️ **table() 헬퍼의 `<a:tr h="0">`가 실제 렌더 높이를 결정하지 않는다는
    기존 교훈(2026-10-19 항목 참고)을 다시 체감**: 처음 시도에서 인용구
    (citation_box)를 슬라이드 9의 각주만큼 길게(출처 4개를 전체 문장으로) 썼더니
    — 슬라이드 23/24처럼 짧은(200~300자) 인용구를 기준으로 튜닝된 `citation_box`
    기본 `cy` 값보다 실제 줄바꿈 텍스트가 훨씬 길어져 그 아래 insight_box·
    glossary_box·페이지번호까지 전부 겹쳐 보이는 문제가 발생(LibreOffice 렌더링
    으로 직접 확인). 인용구를 슬라이드 23/24와 비슷한 분량(출처당 1문장, 약
    200~260자)으로 줄이고 세부 근거는 표의 "근거/비고" 열로 분산시켜 해결 —
    citation_box에 긴 문단을 넣을 때는 항상 기존 슬라이드의 실측 글자수 대비
    cy 비율을 기준으로 삼을 것, "출처가 많으니 각주도 길어야 한다"고 생각하지
    말고 표 자체에 출처 번호만 달고 근거 설명을 분산시킬 것.
  - 빌드 스크립트는 `/tmp/.../scratchpad/costbuild/build_cost_slides.py`(세션별
    임시 디렉터리 — 다른 PPT 빌드 스크립트와 동일하게 저장소에는 결과물
    `.pptx`만 커밋, 스크립트 재작성 필요 시 이 항목과 커밋 메시지 참고).
    `validate.py` 통과 + `soffice`+`pdftoppm`으로 신규 슬라이드 2장과 전후
    슬라이드(9, 12, 18, 26 클로징)까지 렌더링해 레이아웃·페이지번호 확인함.

- **투자피칭 PPT 26→27슬라이드 확장 — 설계사 수수료 절감 슬라이드 추가 +
  헬스케어 파트너십에 치과병원·CPA/CPS 명시** (2026-10-31, 바로 위 항목과 같은
  요청 흐름에서 이어짐 — 사용자가 "TM/GA 설계사가 없어도 청약되니 설계사 수수료
  절감도 넣어주고, 검진센터·치과병원 고객DB 확보에 따른 CPS/CPA 수수료를 수익으로
  추가해달라" 요청):
  - **신규 슬라이드(화면상 12번, 파일 `slide27.xml`)** — "설계사(TM/GA) 수수료
    절감 — 블록체인 자가가입". 결제수수료 슬라이드(11번) 뒤, 제품 슬라이드(기존
    12→13번) 앞에 삽입. 1년차 모집수수료 상한(월납보험료의 1200% — 정착지원금·
    시책 포함)을 2026년 7월 GA 소속 설계사까지 확대 시행된 금융위원회 '1200%룰'
    (보험업감독규정 개정)로 인용, 블록체인 자가가입 시 이 항목이 구조적으로
    0원이 됨을 비교. 각주에 "모집수수료 1개 항목만 다루며 유지관리수수료 등은
    미포함"을 명시해 과장 방지. insight_box에 "설계사의 설명의무·불완전판매
    방지 기능은 AI상담·전자서명 UX로 별도 보완 필요"라는 트레이드오프도 함께
    명시(슬라이드17의 "CPA 숫자만으로는 질적 가치가 안 잡힌다" 캐비트와 같은
    패턴 — 비용 절감 주장에 반드시 한계도 병기).
  - **비즈니스 모델 슬라이드(원 파일 `slide14.xml`, 화면상 17번)** — "헬스케어
    파트너십" 카드 설명을 "건강검진센터×보험사 매칭 리퍼럴 수수료"에서
    "건강검진센터·치과병원×보험사 매칭 **CPA/CPS** 리퍼럴 수수료"로 수정 —
    치과병원을 두 번째 채널로 명시하고 수수료 메커니즘 용어(CPA/CPS)를 직접
    노출. 이 슬라이드는 원래 pptxgenjs로 만들어진(빌드스크립트 유실) 슬라이드라
    `gen_slides.py` 헬퍼 대신 실제 XML의 `<a:t>` 런을 exact-string으로 직접
    치환(WK5 docx 작업과 동일한 안전 패턴 — count==1 assert).
  - **사업 제휴 다이어그램 슬라이드(원 파일 `slide15.xml`, 화면상 18번)** —
    제목·리드문·3단 플로우 첫 박스("건강검진센터"→"건강검진센터·치과병원")·
    "검진센터 측 가치" 헤딩·검진센터측 가치 첫 불릿·보험사측 가치 첫 불릿·
    마무리 문단까지 총 8곳을 "검진·진료"/"치과병원" 반영으로 수정, 마무리
    문단에 "치과병원 채널도 동일한 CPM·CPC·CPA 체계로 정산하되, 구체 전환율·
    수수료율은 제휴 협의에 따라 검진센터 사례와 다를 수 있다"는 캐비트 추가 —
    슬라이드19(CPM/CPC/CPA 계산, 구 slide23)의 구체 수치(3,000명 수진자 등)는
    건강검진센터 "6개월 후 재검" 사례 전용으로 그대로 두고, 치과병원 채널의
    실제 수치를 지어내 끼워 넣지 않음(날짜·비율을 추정해 새로 만들지 말 것 —
    프레임워크 재사용만 언급하고 구체 숫자는 제휴 협의 이후로 남겨둠).
  - 텍스트 치환 전 각 타겟 박스의 `xfrm cx/cy`를 먼저 확인해 글자 수 증가분이
    박스 폭에 안전하게 들어가는지 계산 후 진행(예: "건강검진센터" 카드는
    cx=3291840EMU·sz=1350 기준 16~18자 수용 가능해 "·치과병원"(+5자) 추가 시
    줄바꿈 없이 들어감을 사전 계산으로 확인) — 이번엔 실제 렌더링에서도
    오버플로우 없음을 재확인함.
  - 뒤따르는 슬라이드 전부(기존 12~26번, 클로징 제외)의 `<a:fld type="slidenum">`
    캐시 텍스트를 +1 일괄 수정. 빌드 스크립트는
    `/tmp/.../scratchpad/costbuild/build_ga_slide.py` + 같은 디렉터리의 XML
    치환 인라인 스크립트(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).
    `validate.py` 통과 + `soffice`+`pdftoppm`으로 신규 슬라이드와 수정된
    비즈니스모델·사업제휴 슬라이드 모두 렌더링해 레이아웃 확인함.

- **투자피칭 PPT 27개 슬라이드 전체에 발표자 노트(슬라이드 노트) 작성** (2026-10-31,
  사용자가 "발표 내용 숙지가 어려워 보인다, 보험을 잘 모르는 사람 대상으로 설명하도록
  노트에 발표 내용을 작성해달라" 요청): 전문용어(손해율·UW·VAN·재보험·제3보험 등)를
  그때그때 쉬운 말로 풀어서 설명하는 구어체 발표 스크립트를 27개 슬라이드 전부에
  채움 — 슬라이드 위 텍스트를 그대로 복사한 게 아니라, 실제로 말하듯 자연스럽게
  재구성하고 전문용어는 처음 나올 때 바로 괄호로 풀이를 붙임.
  - **기존 slide1~21.xml은 처음 PPT를 만들 때(pptxgenjs, 2026-10-19) 이미
    `notesSlide1~21.xml`이 생성되어 있었으나 전부 빈 placeholder**(`<a:t></a:t>`,
    텍스트 없음)였음 — 이 placeholder 문단을 실제 노트 문단들로 교체.
  - **이후 세션에서 추가된 slide22~27.xml**(2026-10-26 "구체사례/CPM·CPC·CPA/
    수익성시뮬레이션" 3장 + 2026-10-31 "IT인프라/결제수수료/설계사수수료" 3장)은
    애초에 notesSlide 자체가 없었음 — `notesSlide22~27.xml` 6개를 새로 생성하고,
    각 `notesSlideN.xml.rels`(notesMaster + 원본 slide 역참조), 각
    `slideN.xml.rels`에 `notesSlide` 관계(rId2) 추가, `[Content_Types].xml`에
    Override 6개 추가까지 전부 수동으로 배선함(PowerPoint가 슬라이드를 노트 없이
    추가할 때는 이 넷 중 하나라도 빠지면 노트 자체가 비어 보이거나 파일이
    깨지므로, 새 슬라이드에 발표자 노트를 추가할 때는 이 4가지 — notesSlide
    본문, notesSlide.rels, slide.rels, Content_Types — 를 항상 세트로
    확인할 것).
  - 새 notesSlide의 `sldNum` 캐시 값은 해당 slide 파일의 현재 캐시값과 동일하게
    맞춤(예: `notesSlide25.xml`은 `slide25.xml`과 같은 "10") — PowerPoint가
    열 때 실제 값으로 재계산하므로 필수는 아니지만 기존 관례(2026-10-19/26/31
    슬라이드 번호 재배선 항목들)와 일관성을 맞춤.
  - 빌드 스크립트는 `/tmp/.../scratchpad/notesbuild/notes_content.py`(슬라이드
    파일명 → 발표 문단 리스트 딕셔너리)와 `apply_notes.py`(기존 21개는 치환,
    신규 6개는 생성+배선)로 분리 — 세션별 임시 디렉터리, 저장소에는 결과물
    `.pptx`만 커밋. `python-pptx`로 27개 슬라이드 전부 `has_notes_slide`와
    노트 텍스트가 해당 슬라이드 제목과 일치하는지 직접 읽어 검증했고,
    `validate.py` 통과 + `soffice`+`pdftoppm`으로 본문 슬라이드 렌더링(노트
    자체는 프레젠테이션 모드 전용이라 슬라이드 이미지에는 안 보임 — 검증은
    python-pptx 텍스트 읽기로 수행)도 재확인함.

- **투자피칭 PPT 28번째 슬라이드 추가 — "종합 손익 비교" (일반 보험사 대비 전체
  금액 변동)** (2026-10-31, 사용자가 "수익과 비용절감을 고려해 일반 보험사 대비
  전체 금액 변동이 어떻게 되는지 장표 추가" 요청): 그동안 따로 보여준 비용
  절감(9/10/11/12번)과 신규 수익원(14/15/18/19/20번)·수익성 시뮬레이션(21번)을
  하나로 합쳐, 21번 슬라이드 N=10,000건 시뮬레이션 수치를 재인용하는 방식으로
  "종합 비교" 장표를 만듦(새 숫자를 지어내지 않고 이미 검증된 기존 수치를
  재사용 — 21번 슬라이드 바로 뒤, 화면상 22번에 삽입, 파일은 다음 사용가능
  번호인 `slide28.xml`).
  - **손해율은 비교를 위해 양쪽 모두 55%로 동일하게 고정** — 실제 손보업계
    손해율(예: 2025년 자동차보험 87.5%, 금감원 공식 실적)은 치아보험과 상품군
    자체가 달라 직접 비교 대상이 아니라는 점을 각주에 명시하고, 기술 때문에
    손해율이 낮다고 오해살 수 있는 비교는 하지 않음 — 사업비율(기술이 실제로
    차이를 만드는 지점)만 변수로 두고 비교.
  - **일반 보험사 쪽 사업비율 20%는 "보장성보험 사업비(대부분 신계약비)가
    총 납입보험료의 20% 이상"이라는 2018년 이투데이 보도를 인용** — 치아보험이
    속한 제3보험·보장성보험 카테고리에 맞춘 수치. 오래된 자료라는 점과 최신
    공시는 상품·회사별로 다르다는 점을 숨기지 않고 밝힘(2025년 자동차보험
    사업비율 16.2%, 대형사 15%대/중소형사 26%대라는 더 최신이지만 자동차보험
    한정 수치도 조사했으나, 상품군이 더 가까운 2018년 수치를 주 근거로 채택).
  - 합산비율(75.0%→69.0%, 6%p↓)과 사업비 총액(보험료 30억원 기준 6억원→4.2억원,
    1.8억원↓)을 핵심 수치로, 거기에 "일반 보험사는 보험료 마진이 사실상
    유일한 수익원이지만 인슈어체인은 14번 슬라이드의 5가지 수익원이 동시에
    쌓인다"는 구조적 차이는 정성적으로만 언급 — 신규 수익원의 구체 금액은
    건당 환산이 어려워(B2B 라이선스 등은 가입자 수와 무관한 별도 계약 기반)
    추정치를 지어내지 않고 "+5가지(일반 보험사=1가지)"로만 표시.
  - ⚠️ **빌드 스크립트 작성 중 좌표 복붙 실수로 겪은 레이아웃 버그**: `stat_cards()`
    y좌표를 이 세션에서 이미 두 차례(25/26/27번 슬라이드) 검증해둔 안전값
    3300000 대신 실수로 다른 슬라이드 초안에서 쓰던 4200000을 그대로 남겨둔 채
    빌드 → `citation_box`(y=5100000)가 늘어난 stat 박스(4200000~5350000) 영역과
    직접 겹쳐 박스 안에 각주 텍스트가 섞여 보이는 버그 발생. `soffice`+
    `pdftoppm`으로 200dpi 고해상도 렌더링 후 문제 구간을 크롭해서 실제 픽셀
    위치를 계산해보고 나서야 "좌표값 자체가 다른 슬라이드의 잔재"임을
    특정함 — 레이아웃이 깨지면 먼저 각 헬퍼 호출의 실제 인자값을 `grep`으로
    다시 확인할 것(겹침의 원인이 항상 헬퍼 함수의 구조적 한계만은 아니고,
    단순 복붙 실수일 수도 있음).
  - 빌드 스크립트는 `/tmp/.../scratchpad/summarybuild/build_summary_slide.py`
    (세션별 임시 디렉터리, 결과물 `.pptx`만 커밋). 새 슬라이드에도 발표자
    노트(`notesSlide28.xml` + rels + Content_Types 배선, 바로 위 항목과 동일한
    4종 세트)를 함께 추가 — 이때도 `slide28.xml.rels`를 `slide22.xml.rels`에서
    복사해오면서 거기 이미 들어있던 `notesSlide22` 참조가 같이 딸려와
    `rId2`가 중복 선언되는 실수가 있었음(`validate.py`가 "Duplicate relationship
    ID"와 "referenced by multiple slides"로 즉시 잡아냄) — 다른 슬라이드의
    `.rels`를 템플릿으로 복사할 때는 그 슬라이드가 이미 노트가 달려 있는
    슬라이드인지 먼저 확인하고, 복사 후 불필요한 관계가 섞여 있지 않은지
    반드시 재확인할 것. `validate.py` 통과 + `soffice`+`pdftoppm` 렌더링으로
    신규 슬라이드와 전후 슬라이드(21, 23) 레이아웃·페이지번호까지 확인함.

- **투자피칭 PPT 29번째 슬라이드 추가 — 멀티에이전트 협업(교차심사) + GPT-4o
  표현 전부 삭제 + 18→19종 숫자 오류 수정** (2026-10-31, 사용자가 "에이전트
  구조 지도 내용을 반영해 agent를 얼마나 잘 썼는지 보여줘야 한다, 여러
  에이전트가 서로 대화하며 업무를 주고받는 내용 강조, 완전자동/Human-in-the-Loop
  구간 구분, GPT-4o 표현 전부 삭제" 요청): "에이전트 구조 지도"는 별도 파일이
  아니라 `insurance_agent/CLAUDE.md`의 실제 아키텍처 설명(`agents/orchestrator.py`
  기준)을 가리키는 것으로 해석 — 그 문서에서 PPT에 아직 전혀 반영 안 돼 있던
  **교차심사(Cross-Review)** 메커니즘을 찾아 이게 "여러 에이전트가 서로
  검토를 주고받는" 요청에 가장 정확히 들어맞는 실제 구현임을 확인하고 이를
  신규 슬라이드로 반영함.
  - **신규 슬라이드(화면상 8번, 파일 `slide29.xml`)** — "멀티에이전트 협업 —
    교차심사(Cross-Review)". 슬라이드 7(언더라이팅 AI Agent) 바로 뒤에 삽입.
    `orchestrator.py`에서 실제 상수를 직접 추출해 확인한 수치를 그대로 사용 —
    1차 심사 에이전트(`UNDERWRITING_TOOLS`, 19종) → tier가 경계·중위험일 때만
    건강중심 리뷰어(`_HEALTH_REVIEW_TOOL_NAMES`, 10종)·신용행동중심 리뷰어
    (`_CREDIT_BEHAVIOR_REVIEW_TOOL_NAMES`, 9종) 두 에이전트를 독립 실행 →
    의견이 갈리면 코드가 항상 더 보수적인(위험도 높은) tier를 채택. 정상·
    고위험은 교차심사 자체를 생략한다는 점도 명시(속도·비용 최적화이자, 이미
    결론이 자명한 구간에 에이전트를 추가로 돌리지 않는 설계).
  - **완전자동/Human-in-the-Loop 구분을 4행 표로 명시화** — 정상=완전자동,
    경계=반자동(에이전트 협업+사후 샘플감사), 중위험=반자동→조건부
    Human-in-the-Loop, 고위험=Human-in-the-Loop. 기존 슬라이드 7/8(현재
    7/9)은 UW와 청구를 각각 따로 설명했지만, 이 신규 슬라이드가 둘을 관통하는
    "자동화 수준의 스펙트럼"을 한 장으로 정리함.
  - **GPT-4o 표현 전부 삭제** — 전체 29개 슬라이드 XML을 검색해 슬라이드8(현재
    9번, 청구 AI Agent)의 `"AI(GPT-4o)는 치료코드·설명·과거이력 기반 검토의견만
    Slack 전송"` 1곳이 유일한 잔존 사례였음을 확인하고 `"AI(LLM)"`으로 교체
    (2026-09-20 전략맵·과제 에세이에 적용했던 "GPT-4o → LLM" 치환과 동일 원칙
    — insurance_agent 백엔드 자체는 실제로 OpenAI API를 쓰지만, 투자자 대상
    발표 자료에서는 특정 벤더·모델명을 노출하지 않는다는 기존 결정을 PPT에도
    동일하게 적용). 재확인을 위해 최종 빌드에서 전체 슬라이드 XML을 다시
    스캔해 "GPT" 문자열이 0건임을 검증함.
  - **"18종 언더라이팅 AI 서브에이전트 도구" 표기가 전부 구버전 숫자였던 것도
    같이 바로잡음** — `insurance_agent/CLAUDE.md`에는 2026-10-23에 19번째
    `assess_*` 도구(`assess_medical_history`)가 추가됐다고 적혀 있었는데, PPT
    슬라이드 6(완전자동 집행 개요)·7(언더라이팅 AI Agent, 2곳)·17(기술 검증
    현황 스탯카드, 현재 25번)의 "18"이 전부 그 이전 숫자로 남아 있었음.
    `orchestrator.py`의 `UNDERWRITING_TOOLS` 리스트를 직접 파싱해 현재 실제
    개수가 19개임을 코드 기준으로 재확인한 뒤 네 곳 전부 "19"로 수정 —
    **문서(CLAUDE.md) prose에 적힌 숫자를 그대로 믿지 말고, 숫자가 발표자료
    같은 외부 산출물에 들어갈 때는 항상 소스 코드에서 직접 센 값으로
    재검증할 것**(이번처럼 기능이 반복적으로 추가되는 프로젝트는 CLAUDE.md
    기록이 코드보다 한 박자 늦게 갱신됐을 가능성이 항상 있음).
  - ⚠️ **새 슬라이드 삽입 시 반복된 실수 두 가지, 둘 다 패턴화해둘 것**: ①
    `<p:sldIdLst>`에 새 `<p:sldId>`를 삽입할 때 "바로 앞 슬라이드"의 rId를
    `presentation.xml.rels`에서 다시 확인하지 않고 암기에 의존하다 slide7이
    아니라 slide8 뒤에 잘못 끼워 넣음(rId8=slide7.xml, rId9=slide8.xml인데
    rId9 뒤에 삽입) — `validate.py`는 이런 "슬라이드 수는 맞지만 순서가 틀린"
    실수는 못 잡아내므로(관계 자체는 다 유효함) `python-pptx`로 실제 렌더된
    제목 순서까지 읽어 대조해야 발견 가능했음. ② `slide29.xml.rels`를 만들 때
    "노트가 없는" 슬라이드가 아니라 노트가 이미 있는 slide9.xml.rels를
    템플릿으로 복사해 `notesSlide9` 참조가 잘못 딸려옴(2026-10-31 슬라이드28
    추가 때 겪은 것과 동일 유형의 실수 — 한 세션 안에서도 반복됨). 새 슬라이드
    삽입은 매번 "① sldIdLst 앞뒤 rId를 rels 파일에서 직접 재확인, ②
    slide*.xml.rels 템플릿은 반드시 노트가 없는 슬라이드에서 복사(또는 복사 후
    기존 notesSlide 참조를 수동으로 제거)"는 두 단계를 체크리스트로 삼을 것.
  - 뒤따르는 슬라이드 전부(기존 8~27번, 클로징 제외)의 `<a:fld type="slidenum">`
    캐시 텍스트를 +1 일괄 수정. 빌드 스크립트는
    `/tmp/.../scratchpad/agentmap/build_crossreview_slide.py`(세션별 임시
    디렉터리, 결과물 `.pptx`만 커밋). 발표자 노트(`notesSlide29.xml`)도 함께
    추가. `validate.py` 통과 + `soffice`+`pdftoppm` 렌더링으로 신규 슬라이드와
    전후 슬라이드(7, 9) 및 숫자 수정이 들어간 슬라이드(6, 7, 25)까지 전부
    재확인함.

- **투자피칭 PPT 본문 전체를 개조식(~함/~임/~음)으로 전환** (2026-10-31,
  사용자가 "Ppt 어미를 개조식으로 수정" 요청): 29개 슬라이드 전부의 `<a:t>`
  런을 정규식 `[가-힣]+다(?=[^가-힣a-zA-Z0-9]|$)`로 스캔해 "~습니다/~ㅂ니다/
  ~한다" 계열 종결 어미가 남아있는 문장 42개를 찾아 정확한 전체 문자열
  치환(count==1 assert)으로 "~함/~임/~음"으로 전환 — WK5 docx 작업
  (2026-10-26~30)에서 확립한 패턴(블라인드 정규식 치환 대신 exact-string
  치환, 치환 후 반드시 재스캔)을 그대로 재사용함.
  - **발표자 노트는 의도적으로 건드리지 않음** — 노트는 실제 구어체로 소리
    내어 발표하기 위한 스크립트(바로 위 2026-10-31 항목에서 "보험을 잘 모르는
    사람 대상 설명"을 요청받아 일부러 자연스러운 말투로 작성함)라, 본문
    슬라이드와 달리 개조식으로 바꾸면 오히려 발표 용도에 안 맞음.
  - **1차 스캔 때 42개 중 4개를 놓쳤던 원인**: 전체 텍스트를 먼저
    `repr()`로 한 번 덤프해두고 그 출력을 다시 파싱하는 방식을 썼는데,
    원문에 작은따옴표(`'모수 1,000명당'`, `'1200%룰'` 등)가 들어있으면
    Python `repr()`이 큰따옴표로 감싼 줄을 출력하고, 그 줄들을 걸러내는
    필터(`if not ln.startswith("'")`)가 그런 줄을 통째로 건너뛰어 버림 —
    치환 자체는 전부 실제 XML 원문을 대상으로 정확히 했지만, "변환 대상을
    찾는" 1차 스캔 단계의 전처리(repr 경유)에 구멍이 있었던 것. 재스캔은
    repr을 거치지 않고 XML에서 바로 정규식을 돌리는 방식으로 바꿔 이 4건을
    마저 잡아냄 — **텍스트를 찾아내는 스캔 스크립트 자체도 중간 가공
    단계(repr·CSV 등)를 거치면 자체 버그가 생길 수 있다는 점을 기억할 것,
    가능하면 원본 포맷에서 직접 정규식을 돌리는 편이 안전함.**
  - **의도적으로 변환하지 않은 예외 2곳**: 슬라이드 7·8의
    `"AI가 보험 가입을/보험금을 마음대로 결정한다"는 리스크를 차단...`에서
    큰따옴표로 인용된 `"...결정한다"` 부분은 덱 자신의 주장이 아니라
    "이런 우려가 있을 수 있다"는 인용구이므로 그대로 "~다" 형태를 유지함
    (인용구를 개조식으로 바꾸면 "인용"이라는 성격 자체가 어색해짐) — 바로
    뒤에 이어지는 덱 자신의 서술(`...작동함`/`...보장함`)만 변환.
  - 빌드 스크립트는 `/tmp/.../scratchpad/gaejosik/convert.py`(42쌍 치환) +
    후속 4건 인라인 수정 스크립트(세션별 임시 디렉터리, 결과물 `.pptx`만
    커밋). `validate.py` 통과 + `�`(깨짐 문자) 전체 스캔 + `soffice`+
    `pdftoppm`으로 여러 슬라이드(1, 4, 22, 27, 29) 렌더링 확인 — 슬라이드
    4의 "⚠️ 윤리 원칙" 각주가 LibreOffice에서 글자가 뒤섞여 보이는 건
    2026-10-19에 이미 발견한 기존 폰트 셰이핑 버그(이모지 바로 뒤 텍스트)
    재현일 뿐 이번 변환으로 생긴 문제가 아님을 XML 원문 직접 확인으로
    재검증함(원문 텍스트는 "...쓰지 않음"으로 정상 변환되어 있었음).

- **투자피칭 PPT 29→40슬라이드 확장 — 전략 분석 프레임워크 11장을 표지 바로
  뒤에 추가** (2026-11-02, 사용자가 "최종 발표 ppt에 이전에 만든 산출문의
  내용을 반영해줘. swot·bcg 매트릭스 등 모든 내용을 앞단에 넣고, 사업화 도입
  배경으로 관련 기사도 추가해달라" 요청 → 범위·배치 모두 AskUserQuestion으로
  확인: 범위는 "핵심 분석만(5종)"/"전략맵+BCG"/"모든 프레임워크(10종)" 중
  **"모든 프레임워크"**를, 배치는 "표지 바로 뒤"/"별도 부록" 중 **"표지 바로
  뒤"**를 선택받음): 소스는 두 기존 산출물 — `인슈어체인_전략맵.html`(Logic
  Tree/PEST/3C/SWOT/AI기능분류/신규사업로드맵/사업화전략 7개 섹션,
  애초에 "슬라이드 단위로 옮길 것을 염두에 두고" 작성돼 있었음)와
  `WK5_마케팅믹스_BCG매트릭스_5Layers_인슈어체인.docx`(7P·BCG매트릭스·
  5Layers) — 양쪽 전문을 추출해 11개 슬라이드(화면상 2~12번, 파일
  `slide30.xml`~`slide40.xml`)로 재구성함: 도입배경(뉴스 인용)/Logic
  Tree/PEST/3C/SWOT/BCG매트릭스/7P①/7P②/5Layers/AI기능분류(Agent·
  어드바이저·자동화)/신규사업로드맵·사업화전략요약.
  - **도입 배경 슬라이드는 WebSearch로 실제 보도를 찾아 인용** — 결제인프라
    검증(유니콘팩토리·벤처스퀘어 2026.7.24, 스테이블코인 PoC 완료)/중앙은행
    인프라 확장(머니투데이 2026.7.1, 한국은행 프로젝트 한강 2단계)/규제
    정비(디지털데일리 2026.7.15, 디지털자산기본법)/시장 수용도(아주경제
    2025·사테경제 2026, 손해보험사 지수형 상품 잇단 상용화) 4개 축을 표로
    정리 — 기존 "왜 지금인가"(현 위치 26번) 슬라이드가 출처 없이 같은
    주장을 하던 것의 근거판 역할.
  - `gen_slides.py`에 3개 신규 레이아웃 헬퍼 추가 — `card_with_bullets`(제목+
    불릿 목록을 담는 카드 1개), `quad_2x2`(SWOT/PEST/BCG용 2x2 사분면,
    `card_with_bullets` 4개 배치), `col_cards`(3C/AI기능분류용 N열 카드
    배치) — 기존 `three_col_flow`(2줄 텍스트 전용)/`table()`(구조화 행
    전용) 둘 다 프레임워크형 다중 불릿 콘텐츠에는 안 맞아서 신설.
  - **상세 슬라이드로의 교차 참조 번호를 추측 대신 직접 재계산**: slide40(현재
    12번) 표의 "상세" 열이 가리키는 "제품"(구 slide10)·"웰니스"(구
    slide4)·"비즈니스모델"(구 slide14)·"사업화로드맵"(구 slide18) 네 슬라이드의
    신규 위치를, +11 shift를 적용한 실제 값(25/15/29/37번)을 `python3`로
    직접 조회해 확정한 뒤 반영 — 처음 초안에 적어둔 추측치(13/4번,
    13·17·24번)는 틀려 있었고, 렌더링 전에 검증 스크립트로 잡아냄.
  - ⚠️ **`stat_cards()` y좌표 버그, 이번에도 재발**(2026-10-19/26/31에 이미
    3차례 겪은 동일 패턴): slide30(도입배경) 초안이 2026-10-26~31 다른
    슬라이드에서 검증해둔 안전값 3300000 대신 4100000을 썼다가, `citation_box`
    (y=5100000)가 늘어난 stat 카드 영역과 겹쳐 각주 텍스트가 카드 안에
    섞여 보이는 렌더링 버그로 발견(`soffice`+`pdftoppm` 렌더링 후 Read 툴
    육안 확인 — `validate.py`는 스키마만 보므로 못 잡음). y=3300000으로
    고쳐 재빌드 후 해결 확인. **`stat_cards()`를 쓰는 새 슬라이드를 만들 때마다
    y인자가 3300000인지 습관적으로라도 다시 확인할 것 — 벌써 4번째 재발.**
  - 새 슬라이드 11개 전부에 발표자 노트(`notesSlide30~40.xml` + 4종 세트:
    본문·`.rels`·`slideN.xml.rels`의 notesSlide 관계·`[Content_Types].xml`
    override) 추가 — 이번엔 노트가 없는 깨끗한 `slideN.xml.rels` 템플릿으로
    새로 생성한 뒤 별도 스크립트(`apply_analysis_notes.py`)로 notesSlide
    관계만 나중에 추가하는 순서를 지켜, 2026-10-31에 두 차례 겪었던 "노트
    있는 슬라이드의 `.rels`를 복사해 엉뚱한 notesSlide 참조가 딸려오는"
    중복관계 버그를 이번엔 처음부터 피함.
  - 뒤따르는 기존 29개 슬라이드(구 1~29번, 새 위치 1·13~40번) 전부의
    `<a:fld type="slidenum">` 캐시 텍스트를 +11 일괄 수정. `validate.py`
    통과 + `soffice`+`pdftoppm`으로 신규 11슬라이드 전부(1차 리뷰에서 slide30
    버그 발견 → 수정 → 재렌더링으로 재확인)와 교차참조 대상 구슬라이드
    2곳(새 위치 13, 40번 클로징)까지 렌더링해 레이아웃·페이지번호·콘텐츠
    확인함. 빌드 스크립트는
    `/tmp/.../scratchpad/analysisbuild/{gen_slides.py,build_analysis_section.py,
    apply_analysis_notes.py}`(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT 40→39슬라이드 — 중복 제거 + "왜·어떻게·어디서" 핵심요약 슬라이드
  신설** (2026-11-02, 사용자가 "중복되는 부분은 하나로 정리하고, 왜 사업이
  필요한지·에이전트를 어떻게 썼는지·수익·비용이 어디서 나는지 명확해지도록
  수정해달라" 요청 — 직전 작업(전략분석 11장 추가)으로 40슬라이드가 된 직후):
  전체 40슬라이드 텍스트를 `python-pptx`로 전수 추출(표 포함)해 직접 대조한 결과
  진짜 중복 2건과 교차참조 버그 1건을 발견·수정함.
  - **중복 제거 ①** — `slide2.xml`("보험 상담·가입·청구 과정의 세 가지 비효율",
    구 13번)과 `slide31.xml`(Logic Tree, 구 3번)이 사실상 같은 3가지 문제(상담
    의존·청구 불투명·사후관리 공백)를 다른 표현으로 반복하고 있었음 — Logic Tree
    쪽이 원인·해결방향까지 포함해 더 구조적이므로 `slide2.xml`을 통째로 삭제.
  - **중복 제거 ②** — `slide11.xml`("왜 지금인가 — 제도·인프라가 함께
    움직이고 있음", 구 26번)이 `slide30.xml`(도입배경, 구 2번)과 똑같은
    4축(결제인프라/중앙은행/규제/시장검증)을 다뤘는데, 도입배경 쪽은 출처·날짜
    인용과 통계 stat_cards까지 갖춘 상위호환이라 `slide11.xml`을 삭제.
  - **교차참조 버그 발견·수정** — `slide28.xml`("종합 손익 비교", 구 34번) 본문과
    용어설명 두 곳이 "21번 슬라이드 수익성 시뮬레이션"을 인용하고 있었는데, 실제
    "수익성 시뮬레이션"은 그 시점 기준 34번 슬라이드였음(21번은 전혀 다른
    "운영비용 관점" 슬라이드) — 이전 세션(2026-10-19~31)에 신규 슬라이드를
    끼워넣을 때 전체 슬라이드의 캐시된 `slidenum` 필드(자기 자신의 페이지번호)는
    매번 일괄 재계산했지만, **본문 텍스트 안에 적힌 '다른 슬라이드를 가리키는
    번호'는 그 재계산 대상이 아니어서 누락**되어 있었던 구조적 버그로 보임(지금
    세션의 재배치로 정확한 새 번호로 수정됐지만, **앞으로 슬라이드를 삽입·삭제할
    때마다 본문에 박힌 'N번 슬라이드' 같은 텍스트 인용은 캐시된 페이지번호
    필드와 별개로 항상 `grep '번 슬라이드'`로 전수 재검증할 것** — 이번에도
    `grep`으로 전체 스캔해서야 발견함, 육안 리뷰만으로는 놓치기 쉬움).
  - **신규 슬라이드 — "핵심 요약"(새 2번, `slide41.xml`)**: 사용자가 요청한
    "왜 필요한지 / 에이전트를 어떻게 썼는지 / 수익·비용이 어디서 나는지" 세
    질문에 직접 답하는 3열 카드 슬라이드를 표지 바로 뒤에 신설 — 각 불릿 끝에
    해당 내용을 자세히 다루는 뒤쪽 슬라이드 번호를 인용(예: "19번", "33번")해
    요약과 본문을 연결. 이 슬라이드 자체가 "투자자가 30초 안에 들어야 하는
    것"을 먼저 말하고 나머지 전체가 그 근거를 하나씩 증빙하는 구조로 재배치한
    셈 — 개별 슬라이드 내용을 더 추가하기보다 **이미 있는 근거를 요약 1장으로
    먼저 보여주는 쪽**을 선택함(이미 콘텐츠가 매우 조밀한 상태라, "더 채우기"가
    아니라 "먼저 요약하고 나머지는 근거로 재배치"가 맞다고 판단).
  - **슬라이드12(`slide40.xml`, "신규 사업 로드맵 & 사업화 전략 — 요약")도
    트림** — 원래 두 번째 표(수익구조4유형+실행로드맵)가 뒤쪽 비즈니스모델
    슬라이드(5유형, 상위호환)·사업화로드맵 슬라이드(완전 동일 4단계)와 내용이
    그대로 겹쳐 있었음 — 그 표를 삭제하고 대신 한 줄 insight_box(89%↓ 비용절감·
    수익원 1→5가지·손익분기 약 1,622건 + 해당 슬라이드 번호 인용)로 교체,
    제목도 "...사업화 전략 — 요약"에서 "신규 사업 5종 — 기존 인프라를 재사용한
    신규 수익원"으로 바꿔 이 슬라이드의 유일한 존재 이유(5종 신규사업 자체)만
    남김. 표1(신규사업5종 A~E)의 "상세" 열 참조 번호는 재배치 후에도 우연히
    그대로 유효했음(25번·15번 모두 위치가 바뀌지 않음) — 역시 직접 재계산해서
    확인함, 추측하지 않음.
  - 삭제 2개+삽입 1개로 최종 포지션이 전부 바뀌어, 새 순서(파일명→새 위치)를
    먼저 전수 계산한 뒤 한 번에 배선함: `presentation.xml`의 `sldIdLst`에서
    두 `<p:sldId>` 제거 + 새 슬라이드용 1개 삽입, `presentation.xml.rels`/
    `[Content_Types].xml`에서 삭제분 2개(슬라이드+notesSlide 각각) 제거 + 신규분
    2개 추가, 삭제된 두 슬라이드의 `slideN.xml.rels`·`notesSlideN.xml`·
    `notesSlideN.xml.rels` 전부 제거. 새 슬라이드는 이번에도(2026-11-02 앞선
    항목과 동일 체크리스트로) 노트 없는 깨끗한 `.rels`로 먼저 만든 뒤 notesSlide
    관계를 추가하는 순서를 지켜 중복관계 버그를 피함. 남은 35개 슬라이드
    전부(새로 만든 2개 제외)의 캐시된 `slidenum` 필드를 재계산된 새 번호로
    일괄 치환 — 이번엔 매칭되는 `notesSlideN.xml`의 캐시된 페이지번호도 함께
    갱신(이전 라운드들은 본문 슬라이드만 갱신하고 notesSlide 쪽 캐시는
    건드리지 않았었는데, 이번엔 둘 다 일관되게 맞춤).
  - `validate.py` 통과 + `soffice`+`pdftoppm`으로 신규/수정 슬라이드(2, 13, 33)와
    삭제로 인한 전환부(26번, 제품→경쟁구도 직결)까지 렌더링해 레이아웃과
    교차참조 텍스트를 육안 확인함. 빌드 스크립트는
    `/tmp/.../scratchpad/dedupe/{gen_slides.py,build_edits.py,wire.py}`
    (세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT 39→40슬라이드 — 보험AI Agent:블록체인 슬라이드 비중 50:50 조정 +
  "왜 필요한가"에 수수료 편향·객관성 내용 추가** (2026-11-02, 사용자가 "비율이 보험
  agent와 블록체인 부분이 각각 50%되도록 조정해달라" + "일반 보험 상담은 설계사의
  수수료가 높은 상품을 추천하는데, 이번 내용은 객관적이고 특정 보험사에 편중되지
  않음을 설명에 추가해달라" 요청): 비율 조정 범위가 "제품 슬라이드만/BCG 등
  프레임워크 슬라이드만/덱 전체 슬라이드 비중" 중 어디인지 AskUserQuestion으로
  확인 → **"덱 전체 슬라이드 비중"** 선택받음.
  - **전체 40(당시 39)슬라이드를 AI-only / 블록체인-only / 둘다(Both) / 중립 4종으로
    직접 분류**(추측 대신 슬라이드별 실제 텍스트 내용 기준으로 분류) — AI-only 7개
    (AI상담추천·CareLink·부수업무·AI거버넌스①UW·교차심사·사업제휴·사업제휴구체사례)
    vs 블록체인-only 8개(신규사업5종·완전자동집행솔루션·IT인프라·결제수수료·
    설계사수수료·제품11개·경쟁구도·치아보험메인) — 신규 AI 전용 슬라이드 1장만
    추가하면 정확히 8:8로 균형이 맞는다는 걸 계산으로 확인 후, 그 1장만 추가하는
    최소 개입으로 처리(덱을 더 부풀리지 않는 쪽을 선택— 바로 전 작업(중복 제거)의
    방향과 일관되게).
  - **신규 슬라이드(화면상 28번, 치아보험 메인상품 슬라이드 바로 뒤) — "AI 엔진 —
    보험사 대상 독립 B2B 라이선스 자산 (9개 기능, 대표 6종)"**: "제품 — AI·블록체인
    자동화 11개 신규 상품·고도화 기능(대표 6종)" 슬라이드(화면상 25번, 원래
    pptxgenjs로 만들어진 숫자원형아이콘+카드 6개 그리드 레이아웃)를 그대로 템플릿
    삼아 좌표·스타일은 전부 유지한 채 텍스트만 치환(exact-string 치환, 원문 전체
    `<a:t>` 목록과 치환 목록을 `assert`로 1:1 대조해 누락·오타 방지)해 "짝이 되는"
    AI 전용 슬라이드를 만듦 — **블록체인 쪽 '11개 신규상품'은 2026-09-20/21에
    실제로 구현한 블록체인 기능 11종(파라메트릭·씬파일러유연납입·웰니스·재보험풀·
    B2B API 5종 + 수익성대시보드·재보험1클릭화·리스크연동대체투자·기상데이터연동·
    월별정산·가스리스 6종)을 가리키는 고정된 숫자라, 여기에 AI 항목을 섞어 넣으면
    숫자가 틀어짐 — 대신 AI 쪽만의 독립적인 "9개 기능"(언더라이팅AI엔진19종·
    교차심사·개인화추천엔진·CareLink·Health-Credit대안신용평가·웰니스체크인스코어링
    6개 카드 + 건강담보대출(HAS)·신용점수포트폴리오5등급·기존보험인지형추천
    3개 풋터)으로 별도 집계 — 전부 이미 이 프로젝트에 구현되어 다른 슬라이드에
    흩어져 언급돼 있던 기능들을 재사용했을 뿐, 새로 지어낸 항목은 없음.
  - **"왜 필요한가" 콘텐츠에 수수료 편향·객관성 추가** — Logic Tree(화면상 4번,
    `slide31.xml`) 표의 ① 행: 문제를 "상품 비교·선택의 어려움" → "...과 편향된
    추천"으로, 원인에 "설계사가 수수료 높은 상품을 추천할 유인 존재"를, 해결방향에
    "수수료 구조와 무관하게 공시 데이터 기준으로 비교하는 객관적 AI Agent 개발"을
    추가. 핵심요약 슬라이드(화면상 2번, `slide41.xml`) 카드①의 불릿 3개를 모두
    재작성 — 1번 불릿에 "수수료 높은 상품 위주로 편향되기 쉽고" 추가, 2번 불릿을
    통째로 "AI Agent는 보험다모아 공시 데이터 기준으로 전 상품을 동일하게 비교 —
    특정 보험사 수수료 구조에 편중되지 않는 객관적 추천"으로 교체(기존 "시장검증"
    내용은 3번 불릿에 압축 병합), 새 AI엔진 슬라이드(28번)로의 인용도 추가.
  - ⚠️ **슬라이드 삽입으로 인한 교차참조 재검증을 이번엔 처음부터 체계적으로
    수행**(바로 전 작업에서 육안 리뷰로 겨우 잡아낸 교차참조 버그의 재발 방지) —
    새 슬라이드를 화면상 28번 자리에 끼워 넣어 그 뒤(29번 이후였던) 슬라이드 전부가
    +1 밀리는데, 본문에 박힌 "N번 슬라이드" 인용은 와이어링 스크립트가 자동으로
    재계산해주지 않으므로, `grep`으로 전체 슬라이드에서 `\d+번` 패턴을 전수 추출한
    뒤 **각 참조 번호를 최종 위치표(filename↔position)와 대조하는 검증 스크립트를
    별도로 작성**해 돌림 — `slide28.xml`(종합손익비교)의 "32번"(→33번), `slide40.xml`
    (신규사업5종)의 "28·32번"(→29·33번)·"36번"(→37번), `slide41.xml`(핵심요약)의
    "33번"(→34번)·"28번"(→29번) 등 총 5곳의 밀림을 전부 찾아내 수정하고, 수정
    후 같은 검증 스크립트를 재실행해 전체 참조가 올바른 슬라이드를 가리키는지
    기계적으로 재확인함(육안 리뷰에 의존하지 않음) — **앞으로 슬라이드 삽입·삭제
    때는 이 "`grep`으로 전수 추출 + 위치표 대조 검증 스크립트"를 매번 돌리는
    것을 표준 절차로 삼을 것, 바로 전 라운드처럼 우연히 발견하는 데 의존하지
    말 것.**
  - `validate.py` 통과 + `soffice`+`pdftoppm`으로 신규 슬라이드(28번)와 수정된
    두 슬라이드(2·4번) 렌더링해 레이아웃·텍스트 확인함. 빌드 스크립트는
    `/tmp/.../scratchpad/balance/{build_slide.py,wire.py}`(세션별 임시
    디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT "설계사 수수료 절감"(화면 24번) 슬라이드에 1200%룰의 실제 유인구조와
  AI의 공정성·객관성 결론 추가** (2026-11-02, 바로 위 "50:50 비율 조정" 작업과 같은
  흐름에서 이어짐 — 사용자가 "설계사 수수료 예시에서 1200%룰로 인하여 수수료 많이
  주는 상품을 판매하는 경향도 추가하고, 이로 인한 공정성·객관성 있는 편향적이지
  않은 상품 추천이 가능하다는 내용도 추가해달라" 요청): 이 슬라이드(`slide27.xml`)의
  기존 각주 ①은 '1200%룰'(금융위 보험업감독규정, 모집수수료 상한)을 인용만 하고
  있었는데, **상한 자체는 정률이 아니라 상한선이라는 점 — 즉 그 한도 안에서
  보험사·상품마다 실제 지급 수수료율이 다르게 책정되므로, 설계사가 더 높은 수수료를
  주는 상품을 우선 권유할 구조적 유인이 남는다**는 메커니즘 설명을 각주에 추가함
  (citation_box 텍스트 확장, 박스 `cy`를 650000→780000으로 소폭 늘려 여유 확보).
  슬라이드 하단 insight_box(핵심 결론 한 줄)도 "모집수수료는 신계약 단가 비중이
  크다"는 기존 문장에서 "수수료가 보험사·상품마다 다르게 책정되는 한 대면채널은
  추천이 편향될 구조적 유인이 남지만, AI Agent는 수수료 수취 자체가 없어 공정하고
  객관적인 추천이 가능함"으로 전면 교체 — 기존에 있던 "설명의무·불완전판매 방지는
  AI상담·전자서명 UX로 별도 보완 필요"라는 균형 잡힌 한계 고지는 괄호로 축약해
  그대로 유지함(주장만 내세우고 한계를 빼는 패턴을 반복하지 않기 위함, 이 세션
  다른 슬라이드들에서 이미 여러 번 지킨 관례). 바로 전 작업에서 Logic Tree(4번)·
  핵심요약(2번)에 추가해둔 "설계사 수수료 편향" 서술이 일반론이었다면, 이번 수정은
  **그 구체적 메커니즘(1200%룰=상한선일 뿐 정률이 아님)을 실제 근거 슬라이드에
  명시**해 두 레이어(요약의 주장 vs 상세 슬라이드의 근거)가 서로 맞물리게 함.
  원 빌드 스크립트(`/tmp/.../scratchpad/costbuild/build_ga_slide.py`)가 이전
  세션의 임시 디렉터리라 더는 없어, 이번엔 해당 슬라이드의 XML을 직접 문자열
  치환으로 편집함(이 세션 다른 WK5/pptx 작업들과 동일한 안전 패턴 — exact-string
  치환 + `assert count==1`). `validate.py` 통과 + `soffice`+`pdftoppm`으로 해당
  슬라이드(24번) 렌더링해 각주·insight 박스 모두 겹침 없이 들어가는 것을 확인함.

- **투자피칭 PPT 40→41슬라이드 — "왜 리밸런싱이 중요한가" 슬라이드 신설, 기존 설계사
  영업 방식과의 구조적 비교 + 실제 통계 근거** (2026-11-03, 사용자가 "리밸런싱의
  중요성을 발표 자료에 추가하고, 기존 설계사를 통한 영업 방식과 비교하여 지금
  방향이 적정하다는 근거를 제시해달라" 요청): CareLink 슬라이드(화면상 15번)는
  "어떻게 동작하는지"만 다루고 "왜 중요한지/기존 방식 대비 왜 더 적정한지"는
  다루지 않고 있었음 — WebSearch로 국내 보험업계 실제 통계·보도를 조사해 근거를
  확보한 뒤, CareLink 슬라이드 바로 뒤(화면상 16번, 파일 `slide43.xml`)에 신규
  비교 슬라이드를 추가함.
  - **조사로 확보한 핵심 근거 3가지**: ① 생명보험사 14곳·손해보험사 13곳 전속설계사
    13회차(1년) 평균 정착률이 2025년 기준 각각 38.19%·46.41%에 불과함(금감원 공시
    인용, CEO스코어데일리 2026.7.24) — 즉 나머지(생보 약 62%·손보 약 54%)는 1년
    안에 이직. ② 보험 모집수수료 구조가 선지급(1~2년차 집중)·유지관리(미미)로
    쏠려 있던 문제를 2026년에야 금융위가 보험업감독규정 개정으로 손질(유지관리수수료
    신설, 선지급 분할기간 최장 7년 확대 — CEO스코어데일리·경향신문 2026.1.14,
    기존 슬라이드25의 '1200%룰' 내용과 같은 제도 묶음). ③ 보험연구원 — 설계사
    이직으로 생긴 '고아계약'(관리자 없는 계약)은 관리 설계사가 있는 계약보다
    해약률이 더 높다는 지적(이투데이 보도 경유 인용 — 원 보고서 발간 시점은
    명확히 확인 안 돼 각주에 그대로 명시).
  - **3행 비교표(구분 | 기존 설계사 영업 방식 | AI Agent 리밸런싱)**: 가입 후 관리
    연속성(설계사 이직 시 고아계약으로 방치 vs 재직여부 무관 상시가동) / 보상
    구조의 방향(신계약 판매 유인이 구조적으로 더 큼 vs 영업 유인 없이 공백만
    객관적 탐지) / 재점검 계기(고객이 먼저 연락 안 하면 사후적 vs 건강데이터
    변화 즉시 재계산). insight_box에 "유사한 문제의식은 이미 오래전부터 제기돼
    왔음에도 실제 유지관리수수료 제도화는 2026년에야 이뤄짐 — 사람 중심 영업만
    으로는 가입 후 관리가 구조적으로 느슨해진다는 방증"이라는 결론 문장 추가.
  - ⚠️ **`stat_cards()` 겹침 버그, 5번째 재발 — 이번엔 통째로 빼는 쪽으로 해결**:
    테이블(3행, 긴 셀 텍스트) 뒤에 stat_cards(y=3800000)를 넣고 그 라벨 영역
    (y+1650000=5450000까지)을 감안하지 않은 채 citation_box를 y=5150000에
    배치 — 라벨과 citation 텍스트가 뒤섞여 보이는 버그로 렌더링에서 발견. 이번엔
    좌표를 재계산해 밀어내는 대신, **stat_cards 자체를 삭제**함(표에 이미 있는
    38.19%/46.41% 수치와 중복이었고, "해약률↑"·"24시간" 콜아웃도 안 없어도
    메시지 전달에 지장 없었음 — 콘텐츠가 조밀한 슬라이드에서는 stat_cards를
    무리하게 끼워 넣기보다 표+citation+insight만으로 구성하는 쪽이 더 안전하다는
    걸 Logic Tree(4번) 등 다른 슬라이드에서도 이미 확인한 패턴). citation_box를
    y=4150000·cy=1250000으로 내리고 나니 insight_box(기본 y=6126480)까지
    726480 간격이 확보돼 깔끔하게 렌더링됨 — **stat_cards가 반복적으로 문제를
    일으키는 슬라이드에서는 좌표를 미세조정하기보다 아예 빼는 선택지를 먼저
    고려할 것.**
  - 뒤따르는 슬라이드 전부(새 위치 17번 이후, 클로징 제외)의 `<a:fld
    type="slidenum">` 캐시와, 본문에 박힌 "N번 슬라이드" 교차참조(`slide28.xml`
    종합손익비교, `slide40.xml` 신규사업5종, `slide41.xml` 핵심요약 — 총 3개
    파일, 다수 개소)를 **grep 전수추출+위치표 대조 검증 스크립트**(2026-11-02
    항목에서 확립한 표준 절차)로 전부 재계산·수정하고, 수정 후 같은 검증을
    재실행해 모든 참조가 올바른 슬라이드를 가리키는지 기계적으로 재확인함.
  - `validate.py` 통과 + `soffice`+`pdftoppm`으로 신규 슬라이드(16번) 렌더링
    확인(1차 시도의 겹침 버그 발견 → stat_cards 제거로 수정 → 재렌더링으로
    재확인). 빌드 스크립트는 `/tmp/.../scratchpad/rebalance/{build_slide.py,
    wire.py}`(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT 41→42슬라이드 — "고객 DB 확보의 전략적 가치" 슬라이드 신설** (2026-11-03,
  사용자가 "고객 DB는 영업에 매우 중요함 — 검진센터·치과병원 DB확보 등 이번 프로젝트의
  이점을 추가하고, 보험사의 고질적 DB부족 문제·잠재고객 확보관리 관점·개인정보 불법유출
  후 판매되는 이유(DB가 필요해서)까지 전제로 DB확보의 중요성을 발표자료에 추가해달라"
  요청): WebSearch로 국내 보험업계 DB 거래 실태·불법유통 사례를 조사해 근거를 확보한 뒤,
  사업제휴 구체사례 슬라이드(화면상 32번) 바로 뒤(화면상 33번, 파일 `slide44.xml`)에
  신규 슬라이드를 추가함 — 기존 슬라이드31·32는 "어떻게 검진센터·치과병원과 제휴해
  DB를 확보하는지"만 다뤘고, "그게 왜 전략적으로 중요한지"는 다루지 않고 있었음.
  - **조사로 확보한 핵심 근거**: ① 토스가 소속 설계사에게 고객DB를 건당 6만9000원에
    판매한 사례(2022년 보도), 2025년 보도 기준 일반 보험DB는 건당 5만~25만원에 거래.
    ② 금융감독원 2026년 7월 소비자경보 — '보험점검센터' 등 공공기관 사칭 DB업체가
    개인정보를 1인당 5만~13만원에 GA에 판매, 27개 초대형 GA 표본조사에서 100여개
    DB업체 경유 수집 파악. ③ 2012년 이벤트 응모자 등 개인정보를 불법 유출해 보험사에
    판매해 13억원을 챙긴 사건 — 사용자가 언급한 "개인정보 유출 후 판매되는 이유는
    DB가 필요해서"를 뒷받침하는 실제 사례. ④ 삼성화재가 2026년 7월 'TC(Total
    Consultant)지점'을 신설해 설계사에게 고객DB를 3년간 720건 지원 — 대형 손보사도
    DB 확보·배분을 핵심 과제로 삼고 있다는 최신 방증.
  - **3행 비교표(구분 | 기존 DB 시장 | 인슈어체인)**: 단가(건당 5만~25만원 vs 약
    3만원·CPA 34번 슬라이드 재인용) / 품질·합법성(공공기관 사칭·불법유출 재판매
    사례 존재 vs 검진·진료 직후 명시 동의한 1차 데이터+보장공백 분석까지 완료) /
    확장성(DB업체 공급에 의존하는 1회성 거래 vs 제휴기관 수에 비례한 선형 확장 +
    가입 후 웰니스체크인으로 지속 관리 — CareLink·리밸런싱중요성 슬라이드(15·16번)와
    연결). insight_box에 삼성화재 TC지점 사례로 "DB 확보는 업계 전체의 핵심 과제"임을
    뒷받침하고 결론 연결.
  - 이번에도 **stat_cards는 처음부터 넣지 않음** — 직전 "왜 리밸런싱이 중요한가"
    슬라이드(2026-11-03 앞선 항목)에서 확립한 "콘텐츠가 조밀한 슬라이드는 표+citation+
    insight만으로 구성하고 stat_cards는 넣지 않는" 패턴을 처음부터 적용해 겹침 버그
    자체가 발생하지 않도록 함(재발 방지 — 이 교훈을 실제로 다음 슬라이드에 선제
    적용한 첫 사례).
  - ⚠️ **새로 발견한 교차참조 버그 — "자기 자신을 가리키는" 참조**: 신규 슬라이드
    본문에 "CPA, 33번 슬라이드 재인용"이라고 썼는데(초안 작성 시점엔 유입비용계산
    슬라이드가 33번이었음), 이 신규 슬라이드 자신이 33번 자리에 삽입되면서 유입
    비용계산이 34번으로 밀려 "33번"이 자기 자신(`slide44.xml`)을 가리키게 되는
    버그가 발생 — grep 전수검증 스크립트가 `slide44.xml(pos33) refs 33번 ->
    slide44.xml`로 정확히 잡아냄. **새 슬라이드 본문에서 "뒤쪽 슬라이드"를 인용할
    때, 그 뒤쪽 슬라이드가 자신의 삽입으로 인해 밀릴 수 있다는 점(심지어 자기
    자신을 참조하는 꼴이 될 수도 있다는 점)까지 염두에 두고 검증 스크립트를 반드시
    돌릴 것** — grep 전수추출+위치표 대조는 기존 슬라이드뿐 아니라 방금 만든
    신규 슬라이드 자신의 내부 인용도 똑같이 검사 대상에 포함해야 함.
  - 뒤따르는 슬라이드 전부(새 위치 34번 이후, 클로징 제외)의 `<a:fld
    type="slidenum">` 캐시와, 본문 교차참조 4개 파일(`slide28.xml`·`slide40.xml`·
    `slide41.xml`·신규 `slide44.xml` 자신)을 검증 스크립트로 전부 재계산·수정.
    `validate.py` 통과 + `soffice`+`pdftoppm`으로 신규 슬라이드(33번) 렌더링해
    레이아웃 확인함. 빌드 스크립트는 `/tmp/.../scratchpad/dbvalue/{build_slide.py,
    wire.py}`(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT 42슬라이드 전체 재렌더링 + 전수 시각검토·발표흐름 검토** (2026-11-03,
  사용자가 "PPT 전체 다시 한번 렌더링해서 처음부터 끝까지 검토해줘" + "발표 방향을
  일관성 있게 발표 자료 배열을 검토하고 수정 필요시 재배열 해줘" 요청): 이 세션에서
  11장 추가(2026-11-02)·중복 제거(2026-11-02)·AI:블록체인 비율 조정(2026-11-02)·
  리밸런싱/DB가치 슬라이드 추가(2026-11-03)를 거치며 덱이 유기적으로 커져서,
  전체를 처음부터 끝까지 다시 본 적이 없었음 — fork 서브에이전트로 42장 전체를
  85dpi로 재렌더링한 뒤 (1) 전체 이미지 육안 시각검토 (2) 각 슬라이드 제목·리드문을
  투자자 입장에서 처음부터 다시 읽는 발표흐름 검토를 동시에 수행시킴.
  - **발표 배열 자체는 재배열 불필요 — fork가 "문제 없음"으로 결론**: 11장 분석
    프레임워크 섹션(3~13) 내부 순서(Logic Tree→PEST→3C→SWOT→BCG→7P→5Layers→
    AI기능분류→신규사업5종)는 표준적인 줌아웃→줌인 컨설팅 전개로 타당, AI상담군
    (14~17)→블록체인실행·거버넌스(18~21)→비용비교(22~25)→제품(26~29)→
    비즈니스모델·파트너십(30~33)→수익성(34~37)→기술검증(38)→로드맵(39)→
    리스크(40)→펀딩(41)→클로징(42)까지 각 섹션 경계가 전부 자연스럽게 이어짐.
    핵심요약(2번)이 본문에서 인용하는 슬라이드 번호도 현재 배열과 전부 일치함을
    재확인. (분석 프레임워크 11장이 실제 제품 설명(14번)보다 먼저 나와 발표
    도입부가 길다는 점은 지적됐으나, 이는 2026-11-02에 사용자가 AskUserQuestion으로
    이미 "표지 바로 뒤"를 명시적으로 선택한 배치라 재론하지 않음 — 발표 시
    호흡 조절이 필요하면 그때 가서 고려할 것.)
  - **시각 버그 2건 발견·수정**:
    1. **BCG 매트릭스(8번, `slide35.xml`) — "Star" 사분면 제목이 안 보임**: 박스
       배경색(GOLD, B8862F)과 "Star (성장률↑ 점유율↑)" 제목 글자색이 똑같이
       B8862F — 완전한 동색이라 제목 텍스트 자체가 안 보이는 버그였음(다른 세
       사분면은 전부 NAVY 배경+GOLD 제목이라 대비가 멀쩡했는데, Star만 강조를
       위해 배경을 GOLD로 뒤집으면서 제목색을 NAVY로 같이 뒤집는 걸 빠뜨린
       것으로 보임 — 2026-11-02 전략분석 11장 빌드 당시의 실수). 제목 글자색만
       NAVY(16233F)로 교체해 해결 — 본문 불릿(흰색)은 애초에 문제없었음.
       **카드 배경색을 상황별로 바꿔 강조하는 패턴을 쓸 때는, 제목·본문 텍스트
       색도 그 배경에 맞춰 함께 바꿨는지 항상 재확인할 것** — `validate.py`는
       색상 대비를 검사하지 않으므로 이런 "완전 동색이라 안 보이는" 버그는
       오직 실제 렌더링 육안 확인으로만 잡힘(이번에도 fork의 전수 렌더링
       검토가 아니었다면 못 잡았을 가능성이 높음).
    2. **CareLink(15번, `slide4.xml`)·부수업무(17번, `slide5.xml`)의 "⚠ 윤리
       원칙" 각주 — LibreOffice 렌더링에서 글자가 뒤섞여 보이는 버그 재발**
       (2026-10-19에 이미 한 번 같은 계열의 버그를 발견한 적이 있는 패턴):
       XML 원문을 직접 읽어 두 곳 다 텍스트 자체는 완전히 정상임을 확인 —
       즉 콘텐츠 버그가 아니라 LibreOffice의 폰트 셰이핑(harfbuzz) 쪽
       렌더링 전용 결함. **이모지 뒤에 변이선택자(U+FE0F)를 떼고(⚠️→⚠)
       이모지와 뒷글자를 별도 `<a:r>` 런으로 분리**하는 두 가지 구조적
       완화 조치를 적용했으나, 이 세션의 LibreOffice 환경에서는 여전히
       글자가 뒤섞여 보임 — 즉 런 구조·변이선택자 문제가 아니라 이 렌더링
       파이프라인 자체의 더 근본적인 결함으로 보임. 다만 이 두 조치는 실제
       PowerPoint(DirectWrite/Uniscribe, macOS CoreText)처럼 더 견고한
       텍스트 셰이핑 엔진에서는 교차호환성을 높이는 무해한 개선이라 그대로
       유지함. **이 LibreOffice 전용 글자 뒤섞임 버그는 이제 세션마다
       재발하는 걸로 확인됐고(2026-10-19, 2026-11-03 두 번째), 콘텐츠는
       매번 정상으로 확인되는 패턴이 반복되고 있음 — 다음에 또 발생하면
       XML 재확인에 시간을 더 쓰지 말고 "known LibreOffice-only 렌더링
       결함, 콘텐츠 정상 확인됨"으로 빠르게 결론짓고 넘어갈 것, 단 사용자가
       실제 PowerPoint에서 열어봤을 때도 깨져 보인다고 신고하면 그때
       재조사할 것.**
  - `validate.py` 통과 + 전체 42장 `python-pptx` 재확인(슬라이드 수·발표자
    노트 보유 여부 전수 점검, 누락 없음). 작업 디렉터리는
    `/tmp/.../scratchpad/{fullreview,bugfix}`(세션별 임시 디렉터리, 결과물
    `.pptx`만 커밋).

- **투자피칭 PPT — AI 섹션을 블록체인 섹션 앞으로 재배열(순서만 변경, 슬라이드 수
  42장 그대로)** (2026-11-03, 바로 전 전체 재검토에서 "배열 문제 없음"이라고 결론
  냈음에도 불구하고, 사용자가 직접적으로 "블록체인은 뒤에 배치해주세요. 웹에서
  상품 추천, 리밸런싱 부분이 앞부분에 나오고 블록체인은 뒤에서 강조하는 방향으로
  재배열해달라"고 명시적으로 지시 — 이전 분석과 다른 새 결정이므로 그대로 실행함):
  기존에는 14~29번이 "AI상담군(14-17) → 블록체인솔루션·거버넌스(18-21) →
  비용비교(22-25) → 제품(26-29)"로 AI와 블록체인이 섞여 있었는데, 이번엔 화면상
  18~29번 블록(12개 슬라이드)을 통째로 재배열함.
  - **이동 — AI 쪽으로 당겨온 2장**: "AI 엔진"(구 29번)과 "교차심사"(구 20번)를
    부수업무(17번) 바로 뒤, 18·19번 자리로 이동 — AI Agent 전체 스토리(상품추천→
    CareLink→왜리밸런싱중요한가→부수업무→AI엔진→교차심사)가 14~19번에서
    완결되도록 함.
  - **나머지 — 블록체인 쪽으로 밀어낸 10장**: 솔루션(완전자동 스마트컨트랙트)·
    AI거버넌스①UW·AI거버넌스②청구·운영비용비교·IT인프라·결제수수료·설계사수수료·
    제품11개·경쟁구도·치아보험메인을 20~29번으로 순서는 그대로 유지한 채 밀어냄 —
    "솔루션" 슬라이드의 기존 리드문("상담은 여기까지임 — 이제 가입심사와 보험금
    지급까지...")이 이번 재배치로 AI섹션(14~19) 바로 뒤에 오게 되면서, 손대지
    않았는데도 자연스러운 전환 문장으로 맞아떨어짐(렌더링해서 직접 확인).
  - **구현 방식 — 이번엔 슬라이드 삽입·삭제가 아니라 순수 재배열**이라 기존 삽입/
    삭제 라운드들과 다른 절차를 씀: `presentation.xml`의 `<p:sldIdLst>`에서 해당
    12개 `<p:sldId>` 엔트리(id·r:id 쌍)를 새 순서로 재배열만 하면 되고,
    `presentation.xml.rels`·`[Content_Types].xml`·관계(rels) 파일은 전혀 건드릴
    필요가 없었음(슬라이드 자체는 늘지도 줄지도 않았으므로) — 삽입·삭제보다 훨씬
    단순하고 실수 여지가 적은 절차. 재배열된 12개 슬라이드 파일 각각의 캐시된
    `slidenum`만 새 위치로 갱신(아래쪽 발표자 노트도 매칭해서 갱신).
  - **교차참조 재계산 — 2026-11-02에 확립한 "grep 전수추출 + 위치표 대조" 절차를
    다시 적용**: 이번엔 번호가 거의 전부 바뀌는 큰 재배열이라 단순 치환이 아니라
    각 인용문이 "의미상 가리키는 슬라이드가 무엇인지"부터 먼저 복원한 뒤(히스토리
    추적이 아니라 문장 내용으로 직접 판단 — 예: "수익원 1→5가지"는 비즈니스모델
    슬라이드를 가리킨다는 걸 문장 뜻으로 확정), 그 슬라이드의 새 위치로 전부
    재계산함. `slide40.xml`(신규사업5종)·`slide41.xml`(핵심요약) 두 파일에서
    총 11개 인용 번호가 바뀌었고(`slide28.xml`·`slide44.xml`은 이번 재배열의
    영향을 받지 않아 그대로 유지), 수정 후 같은 검증 스크립트를 재실행해 전체
    인용이 올바른 슬라이드를 가리키는지 기계적으로 재확인함.
  - `validate.py` 통과 + `soffice`+`pdftoppm`으로 42장 전체 렌더링 후 핵심요약
    (2번)·신규사업5종(13번, 교차참조 밀집)·AI엔진(18번)·교차심사(19번)·솔루션
    (20번, 이동된 슬라이드들) 육안 확인 — 레이아웃은 내용을 안 건드렸으므로
    전부 정상.

- **투자피칭 PPT 42→43슬라이드 — "앞단(배경·사업분석·사업수익화)도 웹이 먼저, 마지막은
  웹·블록체인 연결"이라는 덱 전체 원칙 적용** (2026-11-03, 바로 위 "블록체인은 뒤에
  배치" 재배열 직후 사용자가 이어서 "웹으로 접근성이 큼, 블록체인은 특화 상품이므로
  앞단의 배경, 사업분석, 사업 수익화 부분도 모두 웹의 내용이 우선 나와야 함. 그리고
  블록체인, 마지막은 웹과 블록체인 연결로 흐름을 잡아야 함"이라고 요청): 바로 앞
  라운드가 제품·실행 섹션(14~29번)만 AI→블록체인 순으로 재배열한 것이었다면, 이번엔
  그 원칙을 덱 전체(배경/분석 섹션과 마지막 흐름)로 확장하는 요청 — 전체 슬라이드를
  내용 기준으로 다시 분류한 결과, 실제로 손댈 곳은 두 군데로 좁혀짐.
  - **분석 프레임워크 섹션(3~12번: 도입배경/LogicTree/PEST/3C/SWOT/BCG/7P①②/
    5Layers/AI기능분류)은 대부분 이미 '웹 우선' 원칙을 만족하고 있었음** — 2026-11-02
    "50:50 비율 조정" 라운드에서 7P 각 행을 `[AI]` 브래킷이 `[블록체인]`보다 항상
    먼저 오도록, AI기능분류 슬라이드도 AI Agent/어드바이저 열이 자동화(블록체인 실행)
    열보다 먼저 오도록 이미 맞춰져 있었음 — 재건드릴 필요 없음. **유일한 예외가
    "신규 사업 5종"(당시 13번)** — 파라메트릭·씬파일러·웰니스·재보험풀·B2B API, 5개
    항목 전부 블록체인 전용 비즈니스로, 공유 프레임워크 섹션의 맨 끝, 그것도 AI 스토리
    (당시 14번부터)가 시작되기 직전에 자리잡고 있어 "앞단에 블록체인 전용 콘텐츠가
    먼저 보이는" 유일한 실제 위반 사례였음 — 이 슬라이드를 교차심사(당시 19번, AI
    섹션의 마지막) 바로 뒤로 이동해 AI 섹션(13~18번)을 블록체인 섹션(19번부터)보다
    앞세움. 슬라이드 삽입·삭제가 아니라 순수 이동이라 `sldIdLst`에서 그 한 엔트리만
    빼서 다른 자리에 끼워넣으면 끝 — 영향받는 범위도 그 사이에 낀 6장(당시 14~19번,
    AI 묶음)이 한 칸씩 앞으로 당겨지는 것뿐, 20번 이후는 전혀 안 건드림(2026-11-02의
    12장 블록 재배열보다 훨씬 단순한 케이스).
  - **사업수익화 섹션(당시 30~37번: 비즈니스모델5유형/사업제휴/사업제휴구체사례/
    고객DB가치/유입비용계산/수익성시뮬레이션/종합손익비교/연속수익구조)도 이미
    내부적으로 웹 콘텐츠(사업제휴·DB가치·유입비용 — CareLink·검진센터 기반)가
    블록체인 경제성 콘텐츠(수익성시뮬레이션·종합손익비교 — 블록체인 비용절감 수치
    인용)보다 먼저 나오고 있어 손댈 필요 없음 — 과거 라운드들에서 이미 이 순서로
    쌓여온 것.
  - **신규 슬라이드(화면상 42번, 클로징 바로 앞) — "마지막 흐름 — 웹과 블록체인은
    한 고객 여정의 두 단계"**: 사용자가 요청한 "마지막은 웹과 블록체인 연결로 흐름을
    잡아야 함"에 대응하는 종합(synthesis) 슬라이드 — 지금까지 웹 스토리와 블록체인
    스토리를 각각 따로 보여줬다면, 이 장은 둘이 경쟁 관계가 아니라 한 고객 여정 안의
    순환(웹=넓은 접근성으로 진입 → 블록체인=특화된 신뢰로 실행 → 다시 웹=지속 관리로
    복귀)이라는 걸 명시적으로 묶어 보여줌. 3단 플로우(웹 AI상담→블록체인 자동집행→
    다시 AI 관리로) + 3열 카드(각 단계의 근거 불릿, 앞쪽 슬라이드 번호 인용)로 구성
    — 새 수치를 지어내지 않고 전부 이미 검증된 기존 슬라이드 내용을 요약·연결만 함.
    `gen_slides.py`의 `three_col_flow()`(상단 3단 플로우)와 `col_cards()`(하단 3열
    카드, 2026-11-02 전략분석 라운드에서 신설한 헬퍼) 조합으로 제작 — 둘 다 이미
    검증된 헬퍼라 좌표 버그(`stat_cards()` 반복 재발 패턴) 없이 1차 렌더링에서 바로
    깔끔하게 나옴.
  - ⚠️ **`notesSlide21.xml`(클로징 슬라이드의 발표자 노트)의 캐시된 `slidenum` 값이
    이미 오래전부터(최소 2026-10-19 이전부터) "21"로 고정된 채 한 번도 갱신되지
    않고 있었다는 걸 이번에 처음 발견**: 그동안의 모든 renumber 스크립트가
    `SKIP = {slide1.xml, slide21.xml}`로 "클로징은 페이지번호 placeholder가
    없다"고 가정해 건너뛰어 왔는데, 이는 **본문 슬라이드(`slide21.xml`) 기준으로는
    맞지만 그 발표자 노트(`notesSlide21.xml`)는 별도로 자기 자신의 `slidenum`
    필드를 갖고 있었음** — 본문엔 없는 캐시를 노트 쪽만 갖고 있는 비대칭 케이스를
    아무도 체크하지 않았던 것. 이번에 클로징이 42→43번으로 밀리면서 처음으로
    이 필드를 "43"으로 바로잡음. **앞으로 "이 슬라이드는 페이지번호가 없다"고
    SKIP 처리할 때는 본문 슬라이드 파일뿐 아니라 매칭되는 `notesSlideN.xml`에도
    정말 `slidenum` 필드가 없는지 별도로 확인할 것** — 있다고 가정하지 말고
    `grep -c slidenum` 둘 다 찍어볼 것.
  - **신규사업5종 슬라이드의 "상세" 열 C행("웰니스 동적 보험료") 참조가 "15번"으로
    되어 있던 것도 오늘 교차참조 전수검증 중 발견 — 오늘의 이동과 무관한, 훨씬
    이전부터 있던 콘텐츠 버그**였음: 같은 열의 A/B/D/E행은 전부 "27번"(제품11개
    슬라이드 — 실제로 "웰니스 연동 동적 보험료"도 그 슬라이드 하단에 포함돼 있음을
    직접 확인)을 가리키는데 C행만 혼자 다른 슬라이드를 가리키고 있었음 — 패턴에서
    벗어난 한 줄이 섞여 있으면 그게 "원래도 틀렸던 콘텐츠 버그"일 수 있다는 걸
    보여주는 사례. "27번"으로 통일해 수정.
  - 교차참조 재계산은 이번에도 grep 전수추출(`\d+(?:[·,]\d+)*번` 정규식) + 위치표
    대조 스크립트로 수행 — `slide40.xml`(신규사업5종 자신의 "구체 수치는 23·30·35번"
    등, 20번 이후 섹션을 가리키는 참조들은 오늘 전혀 안 움직였으므로 그대로 유효)·
    `slide41.xml`(핵심요약, "AI상담추천·AI엔진 인용(13·17번)"·"교차심사 인용(18번,
    12·18·22번)" 총 3곳 수정)·`slide44.xml`(고객DB가치, "CareLink·왜리밸런싱중요
    인용(14·15번)" 1곳 수정)·`slide28.xml`(종합손익비교, 영향 없음 확인)·신규
    `slide45.xml` 자신(자기참조 없음 확인)까지 전부 재검증.
  - `validate.py` 통과 + `soffice`+`pdftoppm`으로 신규 슬라이드(42번)와 이동으로
    영향받은 경계 슬라이드(핵심요약 2번, AI상담추천 13번, 교차심사 18번, 신규사업5종
    19번, 고객DB가치 33번, 클로징 43번)까지 렌더링해 레이아웃·페이지번호·인용 텍스트
    모두 확인함. 빌드 스크립트는 `/tmp/.../scratchpad/finalflow/{wire1.py,
    renumber.py, build_slide45.py, build_notes45.py, fix_refs.py, scan_refs.py}`
    (세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT — 실제 PowerPoint(모바일 앱)에서 "파일을 열 수 없음"으로 완전히 열리지
  않던 진짜 손상 버그 발견·수정** (2026-11-03, 바로 위 라운드 직후 사용자가 실제
  안드로이드 PowerPoint 앱 스크린샷으로 신고): 이 세션 내내 QA는 `validate.py`
  (스키마/관계/콘텐츠타입)와 LibreOffice(`soffice`+`pdftoppm`) 렌더링에만 의존해
  왔는데, 이번에 처음으로 **진짜 PowerPoint가 파일 자체를 열지 못하고 복구 요구
  다이얼로그를 띄우는** 더 심각한 손상이 발견됨 — `validate.py`도 LibreOffice도
  둘 다 통과·정상렌더링했던 파일이 실제로는 깨져 있었다는 뜻이라, **이 둘만으로는
  충분한 검증이 아님이 이번에 확인됨.**
  - **진짜 원인 — 같은 슬라이드 안에 도형(shape) `id`가 중복**: `gen_slides.py`의
    `slide_number_sp(n)`(페이지번호 placeholder를 만드는 공용 헬퍼, 이 세션 거의
    모든 라운드가 재사용해온 함수)가 다른 도형들처럼 `nid()`로 순번을 받지 않고
    `id="25"`를 하드코딩하고 있었음 — 본문 콘텐츠가 정확히 24개 도형을 다 쓴
    슬라이드에서는(그래서 다음 `nid()` 호출이 마침 25가 되는 경우) 페이지번호
    도형과 본문 도형이 똑같이 `id="25"`를 갖게 되는 충돌이 발생. 실제로 걸린
    슬라이드 5장 — `slide7.xml`(AI거버넌스①, 17번째 작성 당시부터 존재하던
    원본급 구슬라이드)·`slide10.xml`(제품11개)·`slide18.xml`(사업화로드맵)·
    `slide22.xml`(사업제휴구체사례)·`slide42.xml`(AI엔진, 2026-10-31 신설) —
    전부 본문 도형 수가 공교롭게 24개였던 경우. **LibreOffice는 도형 id 중복을
    조용히 무시하고 렌더링해버려서 수십 번의 렌더링 QA에서 단 한 번도 드러나지
    않았음** — 진짜 PowerPoint(데스크톱·모바일 공통 추정)는 이를 구조적 손상으로
    보고 파일 자체를 거부함. 각 슬라이드에서 페이지번호 도형의 id를 해당 슬라이드의
    `max(기존 id)+1`로 재배정해 충돌 해소, `gen_slides.py` 원본도 `id="{nid()}"`로
    고쳐 재발 방지(이 세션의 모든 pptx 빌드 스크립트가 이 헬퍼를 복사해 쓰므로,
    **앞으로 새 슬라이드를 만들 때마다 복사해온 `gen_slides.py`가 이 수정판인지
    확인할 것 — 구버전을 모르고 다시 복사해오면 같은 버그가 재발함**).
  - **부수 발견 — zip 패키지 안에서 `[Content_Types].xml`이 첫 엔트리가 아니었음**:
    이 세션 내내 `zip -q -r -X out.pptx . -x '.*'`로 전체를 한 번에 압축해 와서
    디렉터리·다른 파트들이 알파벳/탐색 순으로 먼저 들어가고 `[Content_Types].xml`은
    219번째쯤에 들어가 있었음 — OPC 스펙은 이를 엄격히 요구하진 않고 실제 손상의
    직접 원인인지는 불확실하지만, 네이티브 Office가 저장하는 파일은 항상
    `[Content_Types].xml`을 첫 엔트리로 둠. 이번에 `zip -X out.pptx
    '[Content_Types].xml'` 먼저 실행 후 나머지를 `-x '[Content_Types].xml'`로
    제외하고 추가하는 2단계 압축으로 바꿔 선제적으로 맞춤 — **앞으로도 pptx를
    재압축할 때는 이 2단계 순서를 기본으로 쓸 것.**
  - **부수 발견 — `docProps/app.xml`의 슬라이드 수 메타데이터가 최초 pptxgenjs
    생성 시점(21장)에서 멈춘 채 이후 22번의 슬라이드 추가·삭제 라운드 내내 한 번도
    갱신되지 않고 있었음**: `<Slides>21</Slides>`·`<Notes>21</Notes>`·
    `HeadingPairs`의 "Slide Titles" 카운트(21)·`TitlesOfParts` 벡터(size 24,
    "Slide 1"~"Slide 21"만 나열)가 전부 실제 43장과 불일치. 복구 다이얼로그의
    직접 원인은 아닌 것으로 보이지만(정보성 메타데이터라 PowerPoint가 보통
    관대하게 처리), 파일 속성 패널에 잘못된 값이 뜨는 명백한 오류라 43장 기준으로
    재작성함. **이런 "집계성 캐시 필드"는 슬라이드 수가 바뀔 때마다 갱신 대상
    목록에 넣어야 하는데, 지금까지 그 목록엔 각 슬라이드·notesSlide의 `slidenum`
    필드만 있었고 `docProps/app.xml`은 빠져 있었음 — 다음에 슬라이드를 추가·
    삭제할 때는 이것도 같이 갱신할 것(단, 이번처럼 여러 라운드 밀린 걸 한 번에
    따라잡는 정도로 충분하며, 매 라운드마다 필수는 아님 — PowerPoint가 다음 저장
    시 자동 재계산함).**
  - **검증 방법론 자체도 강화**: 이번에 처음으로 모든 파트의 XML 잘정형성
    (well-formedness)·모든 `.rels` 파일의 `Id` 중복·`r:id`/`r:embed` 참조가
    실제 선언된 관계와 전부 일치하는지·`[Content_Types].xml`이 모든 슬라이드·
    notesSlide·chart 파트를 빠짐없이 선언하는지·그리고 **각 슬라이드 내부
    `<p:cNvPr id="...">` 중복 여부**를 스크립트로 전수 검사하는 절차를 만듦 —
    `validate.py`와 LibreOffice 렌더링만으로는 이번 버그 같은 "스키마상 유효하지만
    PowerPoint 고유 규칙 위반"은 못 잡는다는 게 확인됐으므로, **앞으로 큰 폭의
    슬라이드 추가·삭제 라운드 직후에는 이 도형 id 중복 검사를 추가로 한 번 돌릴
    것** — 특히 `gen_slides.py`로 새로 만든 슬라이드마다.
  - 수정 후 `validate.py` 재통과 확인 + 영향받은 5개 슬라이드(현재 화면상
    17·21·27·32·39번) 전부 재렌더링해 시각적 변화 없음(순수 속성 수정이라 당연)
    확인. 작업 디렉터리는 `/tmp/.../scratchpad/corruption-check/`(세션별 임시
    디렉터리, 결과물 `.pptx`만 커밋). **다음 세션에서도 사용자가 실제 PowerPoint
    데스크톱에서 정상적으로 열리는지(모바일 앱 복구 다이얼로그가 더는 안 뜨는지)
    확인 요청할 것.**

- **투자피칭 PPT — 표지 슬라이드 엉뚱한 용어설명 삭제 + "핵심 요약" 슬라이드를
  청중 배려 관점에서 전면 재작성(제목·공백·인용번호·모호한 용어)** (2026-11-03,
  사용자가 실제 안드로이드 PowerPoint 앱에서 찍은 스크린샷 5장으로 "① 표지의 그
  내용은 삭제하는 게 맞아 보임 ② 핵심요약 슬라이드에 '핵심 요약'이라는 단어가
  어울리는지 ③ 본문 글자 아래 공백이 너무 많음 ④ '4번' 인용이 뭘 가리키는지
  모호함 ⑤ 'N번' 인용은 다 삭제하는 게 좋겠음 ⑥ '19종 언더라이팅'이 AI Agent
  내용인지 블록체인 내용인지 모호하고 19종이 뭔지 설명 필요 — 전반적으로 청중을
  배려해서 다시 수정해달라" 요청):
  - **표지(`slide1.xml`) 최하단에 엉뚱한 용어설명 박스가 붙어 있던 걸 발견·삭제**
    — "용어 : 지수형(파라메트릭) 보험 = ... · 손해율 = ..." 글로서리 박스가 표지에
    붙어 있었는데, 표지 본문 어디에도 '지수형보험'이나 '손해율'이라는 단어 자체가
    없어 전혀 맥락 없이 떠 있었음(다른 슬라이드에서 쓰는 `glossary_box()`가 표지에
    잘못 섞여 들어간 것으로 추정 — 원인은 특정 못 함, 결과만 확인하고 셰이프
    통째로 제거). 표지는 어떤 본문 슬라이드의 템플릿에서 출발한 게 아니라 이
    pptxgenjs 원본부터 있던 파일이라 재생성 대신 직접 XML에서 해당
    `<p:sp>...</p:sp>` 전체를 삭제.
  - **"핵심 요약" 슬라이드(`slide41.xml`, 화면상 2번) 전면 재작성**:
    - 제목을 "핵심 요약 — 왜 필요하고, 에이전트를 어떻게 썼으며, 어디서 남는가"
      (중복·건조한 느낌)에서 **"투자자가 가장 먼저 묻는 세 가지 질문"**으로 교체 —
      기존 리드문이 이미 설명하던 내용을 제목 자체가 직접 말하게 해 "핵심 요약"
      이라는 라벨 자체를 아예 없앰.
    - 카드 ①②③ 본문 불릿에 붙어 있던 `(4번)`·`(13·17번)`·`(21번)`·`(18번)`·
      `(12·18·22번)` 등 **"다른 슬라이드로 가라"는 인용 번호를 전부 삭제** — 발표를
      듣는 청중은 그 자리에서 다른 슬라이드로 넘겨 확인할 수 없어 숫자만 보고는
      뭘 가리키는지 알 길이 없는, 순수하게 내부 작업용 교차참조였던 것으로 판단.
      (참고: 신규사업5종·DB가치·종합손익비교 등 다른 슬라이드에도 같은 패턴의
      "N번" 인용이 남아있으나, 이번 요청은 스크린샷으로 지목된 이 슬라이드에
      한정된 것으로 보고 그쪽은 손대지 않음 — 같은 패턴을 덱 전체에서 없애길
      원하면 별도로 요청할 것.)
    - **"19종 언더라이팅 서브에이전트를 자율 호출" 불릿이 AI Agent 내용인지
      블록체인 내용인지 모호하다는 지적 반영** — "상담을 맡는 메인 AI Agent는
      보험 심사 로직을 몰라도 됨 — 정밀심사가 필요할 때만 19종의 전문 심사
      도구(소득·질병이력·신용정보 등 위험요인별 자동 판정 로직)를 자동 호출"로
      재작성해 ① 이게 AI Agent 자체 기능(블록체인과 무관)이라는 것 ② "19종"이
      무엇인지(위험요인별 전문 심사 도구) 둘 다 문장 안에서 바로 드러나게 함.
      "교차심사"·"tier별 자동분기" 불릿도 같은 기준으로 더 쉬운 말로 재작성.
    - **본문 글자 아래 공백 과다 문제** — 3열 카드(`col_cards()`)가 `cy=3000000`
      (원래 원인: 처음 만들 때 다른 슬라이드 좌표를 그대로 복붙해온 것으로 보임,
      실제 불릿 내용은 그 절반도 안 채움)로 고정돼 있어 카드 안/아래 모두 빈
      공간이 컸음 — 본문 글자 크기도 `body_sz=850`→**950**로 키워 가독성을
      높이면서(발표 자료는 작은 글자보다 큰 글자가 청중 배려에 더 맞음),
      카드 높이는 `cy=3000000`→**2150000**로 줄여 공백을 크게 줄임(카드②가
      불릿 3개 중 가장 길어 여러 차례 렌더링하며 높이를 맞춤 — 너무 줄이면
      카드② 마지막 줄이 박스 경계에서 잘려나가는 걸 실제 렌더링으로 확인하고
      재조정).
  - ⚠️ **이 작업 중 `gen_slides.py`의 `assemble()`/`slide_number_sp()` 상호작용에서
    새로운 도형 id 중복 버그를 발견·수정** — 바로 전 라운드("실제 PowerPoint에서
    파일이 안 열리던 버그")에서 `slide_number_sp()`가 하드코딩된 `id="25"` 대신
    `nid()`를 쓰도록 고쳤었는데, **이 수정 자체가 불완전했음**: `assemble(name,
    pagenum, *parts)`는 함수 바디 맨 앞에서 `_id[0] = 1`로 카운터를 리셋하지만,
    파이썬은 `*parts`로 넘기는 인자들(`title_box()`·`lead_box()`·`col_cards()`
    등 각 헬퍼 호출)을 `assemble()` 함수 바디가 실행되기 **전에** 먼저 평가함 —
    즉 그 인자들 안에서 일어나는 모든 `nid()` 호출은 리셋이 적용되기 전의 카운터
    상태로 돌아가고, `assemble()` 바디 안에서 나중에 호출되는
    `slide_number_sp()`의 `nid()`만 리셋 **후** 상태(=항상 2부터 시작)로 실행됨 —
    그래서 가장 먼저 호출되는 `title_box()`(거의 모든 슬라이드의 첫 번째 파츠)가
    쓰는 id=2와 페이지번호 도형이 항상 충돌하는 구조적 버그였음(이번 라운드에서
    `slide41.xml`을 이 헬퍼로 재생성하자마자 즉시 재현됨). **진짜 수정**:
    `assemble()`이 `nid()`/전역 카운터에 의존하지 않고, 이미 조립된 `body`
    문자열에서 실제 쓰인 `<p:cNvPr id="...">` 값들을 정규식으로 직접 스캔해
    `max(기존 id)+1`을 페이지번호 도형의 id로 명시 전달하도록 변경(`slide_number_sp`
    에 `shape_id` 파라미터 추가). **이 버그는 `gen_slides.py`로 슬라이드를
    새로 만들 때마다(즉 지금까지 이 세션에서 거의 매 라운드) 똑같이 재현될
    구조적 결함이었는데, 지난 라운드까지는 하드코딩된 "25"가 우연히 대부분
    충돌을 피해가서(본문 도형이 정확히 24개일 때만 걸림, 5장에서만 실제
    발생) 드러나지 않았던 것 — 이번 수정으로 `nid()`/리셋 타이밍에 의존하지
    않는 근본적으로 안전한 방식이 됐으므로, 앞으로 `gen_slides.py`로 새
    슬라이드를 만들 때 이 문제를 다시 걱정할 필요는 없어짐.** 수정 후
    `slide41.xml` 재생성·도형 id 중복 전수 재검사로 깨끗함을 확인.
  - `validate.py` 통과 + 전체 43장 도형 id 중복 전수 재검사(깨끗) +
    `soffice`+`pdftoppm`으로 표지(1번)·핵심요약(2번) 렌더링해 레이아웃 확인함.
    작업 디렉터리는 `/tmp/.../scratchpad/fixslides/`(세션별 임시 디렉터리,
    결과물 `.pptx`만 커밋) — `gen_slides.py`의 `assemble()`/`slide_number_sp()`
    수정 자체는 `/tmp/.../scratchpad/finalflow/gen_slides.py`에 적용함(이전
    라운드가 이 경로에 둔 사본을 계속 재사용 중 — 다음에 새 슬라이드를 만들 때
    이 경로의 최신 사본을 복사해 쓸 것, 더 오래된 라운드의 사본을 가져오면
    이 수정이 빠져 있음).

- **투자피칭 PPT — "N번 슬라이드" 교차참조 패턴을 덱 전체에서 정리 + 19종 언더라이팅이
  실제 구현인지 확인** (2026-11-03, 바로 위 핵심요약 슬라이드 수정 직후 사용자가
  "같은 패턴으로 다른 슬라이드도 정리해줘. 19종 언더라이팅이 가상 시나리오를 얘기하는
  것인지" 요청): 질문부터 먼저 검증 — `insurance_agent/agents/orchestrator.py`의
  `UNDERWRITING_TOOLS` 리스트를 직접 파싱해 실제로 19개의 함수(OpenAI 툴콜 스키마,
  각각 파라미터·설명 포함)가 구현돼 있음을 코드로 재확인함 — **가상 시나리오가 아니라
  실제 구현된 코드**(이미 2026-10-31에도 한 번 코드 기준으로 재검증했던 사실의 재확인).
  - **grep 전수추출로 "N번"/"N번 슬라이드" 패턴이 남아있는 슬라이드 4장을 찾아 전부
    정리** — `slide28.xml`(종합손익비교, 36번)·`slide40.xml`(신규사업5종, 19번)·
    `slide44.xml`(고객DB가치, 33번)·`slide45.xml`(마지막 흐름/웹·블록체인 연결,
    42번, 바로 전 라운드에 새로 만든 슬라이드). 핵심요약 슬라이드와 동일한 원칙으로
    처리 — 단순 삭제가 자연스러운 곳은 삭제(`slide45.xml`의 6곳), 삭제하면 맥락이
    끊기는 곳은 숫자 대신 말로 풀어씀("35번 슬라이드"→"앞서 다룬", "34번 슬라이드
    재인용"→"앞서 설명한 유입비용 계산 재인용", "14·15번 연계"→"CareLink·리밸런싱과
    연계").
  - **`slide40.xml`(신규사업5종) 표의 "상세" 열은 삭제** — A~E 5개 행 전부
    똑같이 "27번"(제품 슬라이드)을 가리키고 있어서 애초에 행마다 구분되는 정보가
    없는 열이었음(단순히 숫자만 지우면 모든 행이 "제품 슬라이드"라는 동일 텍스트만
    반복하게 돼 열 자체의 존재 의미가 없어짐) — 열을 통째로 제거하고 남은
    "차별점" 열 너비로 흡수. 표가 3열(`<a:gridCol>` 3개, 각 행 `<a:tc>` 3개)에서
    2열로 바뀌는 구조 변경이라 `<a:tbl>` XML을 직접 파싱해 각 행의 마지막
    `<a:tc>...</a:tc>`를 제거하고 첫 번째 `<a:gridCol>` 너비는 유지한 채 2·3번째
    너비를 합산하는 방식으로 처리(ElementTree 없이 정규식 기반 — 이 세션 전체의
    기존 직접 XML 편집 패턴과 동일).
  - **`slide45.xml`(마지막 흐름)의 카드 아래 공백도 핵심요약과 같은 패턴으로
    발견돼 선제적으로 같이 정리** — 사용자가 이 슬라이드를 직접 지목하진
    않았지만, 인용번호를 지우고 나니 핵심요약 때와 똑같이 "카드 안 내용은
    2줄뿐인데 박스는 크게 잡혀 있어 빈 공간이 넓어 보이는" 동일 증상이 육안으로
    바로 보여서 같이 손봄 — `body_sz` 1050(기존 기본값보다 큼, 가독성 강화)
    `cy` 2500000→1500000로 줄여 공백을 줄임. 이 슬라이드는 애초에 원본 빌드
    스크립트(`/tmp/.../scratchpad/finalflow/build_slide45.py`)가 있어서
    XML을 직접 짜깁기하지 않고 스크립트 자체를 고쳐 재생성 — **빌드 스크립트가
    남아있는 슬라이드를 고칠 땐 직접 XML 패치보다 스크립트를 고쳐서 재생성하는
    쪽이 더 안전하고 일관적임(좌표·구조가 헬퍼 함수 기준으로 재계산되므로).**
  - `validate.py` 통과 + 전체 43장 도형 id 중복 전수 재검사(깨끗) +
    `soffice`+`pdftoppm`으로 4개 수정 슬라이드(19·33·36·42번) 전부 렌더링해
    표 레이아웃·텍스트·공백 확인함. grep 재스캔으로 "N번"/"N번 슬라이드" 패턴이
    덱 전체에서 0건임을 최종 확인(①②③ 같은 원형숫자 출처 각주는 이 패턴과
    무관해 건드리지 않음 — 이건 "다른 슬라이드로 가라"는 교차참조가 아니라
    일반적인 출처 표기 방식이라 그대로 둠). 작업 디렉터리는
    `/tmp/.../scratchpad/cleanup2/`(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT — 덱 전체 포맷 정리(행잉 인덴트·불릿 간격·표지 부제·과도한 여백
  전수 정리)** (2026-11-03, 사용자가 실제 안드로이드 PowerPoint 앱 스크린샷 4장으로
  추가 신고: "① 표지의 'INVESTOR / 정부지원사업 피칭 자료 · 2026' 문구도 발표 시
  제외해야 함 ② 대쉬(-)가 줄에 맞춰 나오지 않아 동일 항목의 이어지는 줄인지 새
  항목인지 확인이 어려움 ③ 항목마다 빈 줄을 넣어 가독성을 높일 필요 있음 ④ 3C
  분석·7P① 슬라이드 모두 공백이 너무 많이 남음 ⑤ 전체적으로 공백이 발생하지
  않도록 정리 필요"):
  - **표지(`slide1.xml`) 부제 줄 삭제** — "INVESTOR / 정부지원사업 피칭 자료 ·
    2026" 텍스트박스를 표지 전용 셰이프 자체를 통째로 제거(바로 앞 라운드에서
    표지 최하단의 엉뚱한 용어설명 박스를 지운 것과 같은 패턴 — 표지는
    pptxgenjs 원본부터 있던 파일이라 재생성 대신 직접 셰이프 삭제).
  - **행잉 인덴트(줄바꿈된 둘째 줄이 글머리 기호가 아니라 본문 시작 위치에
    맞춰지는 것) + 불릿 사이 여백을 덱 전체에 적용** — `— `로 시작하는 글머리
    기호 문단을 쓰는 슬라이드 11장(`slide7/8/12/15/32/33/34/35/39/41/45.xml`,
    화면상 2·5·6·7·8·12·21·22·28·31·42번)을 grep으로 전수 추출해, 각 문단의
    `<a:pPr>`를 `indent="0" marL="0"`에서 `indent="-182880" marL="182880"`
    (행잉 인덴트)로, `<a:buNone/>` 앞에 `<a:spcBef><a:spcPts val="500"/></a:spcBef>`
    (문단 사이 간격)를 삽입하는 정규식 패치를 103개 불릿 문단 전부에 일괄
    적용함 — 제목처럼 "— "로 시작하지 않는 문단은 정규식이 자연히 건너뜀.
    `gen_slides.py`의 `sp_text()`에도 `bullet=True` 플래그를 받으면 동일한
    행잉인덴트+spcBef를 넣도록 추가하고 `card_with_bullets()`가 이 플래그를
    쓰도록 고쳐, 앞으로 이 헬퍼로 새 슬라이드를 만들 때도 자동으로 같은
    포맷이 적용되게 함.
  - **"전체적으로 공백 정리" — 포크 서브에이전트로 43장 전체 시각 감사 실행**:
    이미 손대고 있던 3C(6번)·7P①(9번) 수정과 동시에, 작업 중인 working copy를
    렌더링해 그 외 슬라이드의 같은 패턴(공백 과다)을 전수 조사하도록 포크를
    백그라운드로 띄움 — 심각(테이블형, 하단 40~48% 공백): 4·9·10·11·19·33·40번.
    보통(카드형, 20~30% 공백): 2·6·12·18·20·30·34·39·42번. 포크가 보고한
    목록을 받아 전부 조치함.
    - **테이블형 슬라이드(Logic Tree·7P①②·5Layers·신규사업5종·DB가치·
      유입비용계산·리스크및대응, 총 8장)** — `table()` 헬퍼의 `sz`(폰트
      크기)와 셀 `marT`/`marB`(상하 패딩)를 테이블 안에서만 범위를 한정해
      1.3~1.6배씩 키움(가독성도 함께 개선 — 작은 글자보다 큰 글자가 청중
      배려에 더 맞다는, 핵심요약 슬라이드 수정 때 세운 원칙을 그대로 적용).
      ⚠️ **1차 시도에서 슬라이드 전체(테이블 밖 제목·리드·인용·용어설명 등)에
      대고 `sz="900"` 같은 흔한 숫자를 통째로 치환하다가, 해당 슬라이드의
      다른 요소(용어설명 등)가 우연히 같은 폰트 크기를 쓰고 있어서 의도치
      않게 같이 바뀌어버린 사고가 1건 발생**(`slide40.xml` 신규사업5종 —
      치환 전후로 "테이블 밖" sz 값 목록을 직접 비교해서 잡아냄) — 교훈: 표
      안의 폰트/패딩만 바꿀 땐 정규식 치환 범위를 반드시 `<a:tbl>...</a:tbl>`
      구간으로 먼저 잘라낸 뒤 그 안에서만 치환할 것, 전체 파일에 대고 숫자
      패턴으로 바로 치환하면 안 됨.
    - **"리스크 및 대응"(40번) 슬라이드는 단순 크기 문제가 아니라 콘텐츠
      자체가 부족했음** — 원래 제목+표(4행)만 있고 리드문·결론 없이 바로
      용어설명으로 넘어가 하단 거의 절반이 완전히 비어 있었음(포크가 "최악의
      사례"로 지목). 이 슬라이드만 `assemble()`로 통째로 재생성 —
      리드문("블록체인 기반 보험 사업이 흔히 부딪히는 규제 리스크 4가지와,
      각각에 대해 이미 선택한 대응 방향")과 결론
      insight_box(네 리스크 모두 구조적으로 포기할 수준이 아니라 포지셔닝·
      계약구조·단계적 전환으로 관리 가능하다는 판단, B2B 기술공급자
      포지셔닝이 보험업법 라이선스 리스크를 원천 차단한다는 요지)를 새로
      추가. ⚠️ `assemble(name, ...)`의 `name`(슬라이드 내부 cSld 이름)에
      `esc()`를 거치지 않고 그대로 꽂던 기존 버그를 이번에 처음 발견 —
      `"Risk & Response"`처럼 영문 `&`가 들어간 이름을 쓰자
      `xmlParseEntityRef` 파싱 에러로 즉시 걸림(그동안 모든 슬라이드 이름이
      우연히 `&`·`<`·`>` 없는 순한글/영문이라 안 걸렸던 것으로 보임) —
      `assemble()`이 `name`도 `esc()`로 이스케이프하도록 `gen_slides.py`
      수정, 이 슬라이드는 이름을 `"Risk and Response"`로 바꿔 우회.
    - **카드형 슬라이드 — 대부분은 기존에 확립된 `col_cards()`/`quad_2x2()`
      `cy` 축소 패턴을 반복 적용**(핵심요약·3C는 이미 1차 라운드에서 손댔던
      걸 조금 더 조임, AI기능분류는 처음 적용) — 단, **이번에 2회 "너무
      줄였다 다시 늘림" 오버슈트를 실제로 겪음**: ① 핵심요약(2번) 카드 높이를
      2150000→1900000으로 더 줄였다가 카드②(불릿 3개 중 가장 긴 문단 포함)의
      마지막 줄이 박스 경계에서 잘려나가는 걸 렌더링에서 발견 → 2150000으로
      원복. **공백 줄이기를 반복 적용할 때는 매번 "이전에 이미 안전하다고
      확인한 값"에서 추가로 줄이기 전에, 그 카드들 중 가장 긴 문단이 몇 줄인지
      다시 셈해볼 것 — "공백이 아직 남아있으니 더 줄여도 되겠지"라는 직관은
      가장 긴 카드 기준이 아니라 평균 기준으로 판단하기 쉬워 과도하게
      줄이는 함정이 있음.**
    - **"솔루션"(20번)·"경쟁구도"(28번, 이미 1차에서 처리)·"사업제휴"(31번)는
      `card_with_bullets()`가 아니라 불릿 한 줄마다 별도 `<p:sp>` 텍스트박스를
      명시적 y좌표로 띄엄띄엄 배치한, 이 세션 다른 어떤 헬퍼와도 다른 손수
      제작된 레이아웃이었음**(아마 이른 라운드에서 함수화 이전에 손으로
      짰던 것으로 보임) — 각 불릿 텍스트박스 자체의 `cy`가 실제 1~2줄 글자보다
      훨씬 커서(예: 640080 EMU인데 실제로는 ~420000이면 충분), 그 '박스 내부
      여유분'이 쌓여 전체적으로 듬성듬성해 보이는 게 원인 — 3개 슬라이드
      전부 각 불릿 박스의 `y`/`cy`를 좁혀 재배치하고 외곽 카드 박스 `cy`도
      맞춰 축소함. 이런 "함수 재사용이 아니라 각 셰이프가 명시적 좌표로
      박혀 있는" 레이아웃을 만났을 땐 `col_cards()`류의 단일 `cy` 파라미터
      조정으로는 못 고치고, 셰이프별 좌표를 각각 다시 계산해야 한다는 걸
      기억할 것.
    - **"비즈니스모델"(30번, 5열 카드)도 같은 방식으로 카드 높이를 줄이다가
      실제 겹침 버그 발생·수정**: "연속성 수익"(골드 카드)에만 있는 별도
      "핵심 매출 기반" 꼬리말 텍스트박스를 본문 텍스트박스 바로 아래로
      당기면서, 본문 텍스트박스 자체의 `cy`를 줄인 걸 깜빡하고 꼬리말
      `y`만 당겼더니 꼬리말이 본문 텍스트박스 "안쪽"(아직 끝나지 않은
      영역)으로 들어가 겹쳐 보이는 버그가 렌더링에서 실제로 발견됨 — 본문
      `cy` 축소분과 꼬리말 `y` 이동분, 외곽 카드 박스 `cy` 세 가지를 한
      세트로 다시 계산해 해결. **여러 셰이프가 순서대로 쌓이는 레이아웃을
      수정할 땐 "맨 아래 셰이프의 y"만 당기지 말고, 그 위에 쌓인 모든
      셰이프의 끝점(y+cy)을 전부 다시 계산해 순서대로 맞는지 확인할 것.**
  - `validate.py` 통과 + 전체 43장 도형 id 중복·XML 잘정형성 전수 재검사(깨끗) +
    `python-pptx`로 43장 전부 노트 보유 확인 + `soffice`+`pdftoppm`으로 수정된
    슬라이드 전부(1, 2, 4, 6, 9, 10, 11, 12, 14/30, 18/19, 20, 28, 33, 39/40,
    42) 재렌더링해 레이아웃·겹침·잘림 없음을 확인함(오버슈트 2건은 재렌더링
    과정에서 발견해 바로 수정). 작업 디렉터리는 `/tmp/.../scratchpad/deckfix/`
    (세션별 임시 디렉터리, 결과물 `.pptx`만 커밋) — `gen_slides.py` 수정은
    이번에도 `/tmp/.../scratchpad/finalflow/gen_slides.py`에 누적 적용함.

- **투자피칭 PPT 43→45슬라이드 — PEST 슬라이드 "깨짐" 신고 조사(재현 안 됨) +
  "에이전트 구조 지도"(업로드 HTML) 기반 19종/멀티에이전트 콘텐츠 보강 2장 추가**
  (2026-11-03, 사용자가 PEST 분석 슬라이드가 사분면 제목이 겹치고 본문이 안
  보인다는 스크린샷과 함께, 별도로 업로드한 "에이전트 구조 지도.html"(챗봇·
  블록체인 양쪽의 AI 관여 수준을 SVG 다이어그램 6개 + 투명성 분류 콜아웃으로
  정리한 참고 문서)을 근거로 "에이전트 구조 지도와 19종 내용도 다시 추가 및
  보완해 달라" 요청):
  - **PEST 슬라이드(`slide32.xml`, 화면상 5번) "깨짐" 신고는 실제 커밋된 파일에서
    재현되지 않음** — XML 텍스트 23개 run 전부 정상, 4개 사분면 좌표도 서로 안
    겹침, `validate.py` 통과, `soffice`+`pdftoppm` 재렌더링에서도 P/E/S/T 네
    박스·불릿 전부 정상 출력됨(본 라운드 결과물에도 재확인). 파일 자체의 결함이
    아니라 사용자 기기에 남아있던 이전 버전 캐시를 보고 있었을 가능성이 높음 —
    이번에 새로 전달하는 파일을 다시 받아서 열어볼 것을 안내함.
  - **업로드된 "에이전트 구조 지도.html"의 핵심 주장 3가지를 실제 코드로 재검증
    후 반영**: ① `insurance_agent/tools/medical_history_tool.py`의
    `assess_medical_history()`에 HTML의 02-A 예시 입력을 그대로 실행해 5개
    예시(0점/2점/14점/20점/115점, tier 정상·정상·정상·경계·고위험)가 문서에
    적힌 값과 정확히 일치함을 직접 실행으로 확인(추정 아님). ②
    `insurance_agent/agents/orchestrator.py` 기준 tier(AI 판단)/route(코드
    고정) 분리·교차심사 설계가 이미 반영돼 있는 기존 슬라이드(AI거버넌스①,
    교차심사)와 HTML 내용이 정확히 일치함도 재확인. ③ HTML 말미의 "정확히
    어디가 멀티에이전트인가" 5단계 투명성 분류(진짜 멀티에이전트/HITL도 설계
    범위/경계 사례/AI 없음/단일호출·결정권없음)는 기존 PPT 어디에도 없던
    내용이라 새로 반영.
  - **신규 슬라이드 A(화면상 22번, `slide46.xml`) — "19종 심사 도구 중 하나 —
    assess_medical_history 실제 판정 예시"**: AI거버넌스①(21번) 바로 뒤에 삽입.
    5행 표(입력 예시|가산점 로직|합산 점수|tier)로 0점(정상)부터 115점(고위험)
    까지 실제 코드 실행 결과를 그대로 제시 — "19종"이 숫자만 내세운 게 아니라는
    근거를 구체 수치로 보여줌. insight_box에 "고위험이 나와도 자동거절이 아니라
    Human-in-the-Loop 대기열로만 이어짐"을 명시해 바로 앞 슬라이드의 tier/route
    분리 설계와 연결.
  - **신규 슬라이드 B(화면상 24번, `slide47.xml`) — "정확히 어디가 AI이고
    멀티에이전트인가 — 투명하게 자가진단"**: AI거버넌스②(23번) 바로 뒤에 삽입.
    5행 표로 ① 언더라이팅 서브에이전트(진짜 멀티에이전트) ② 가입심사·청구
    관리자 승인(HITL도 설계 범위) ③ 추천 서브에이전트(경계 사례, 단발
    completion 1회) ④ 블록체인 청약 자동승인(AI 없음, 코드 규칙만) ⑤ 청구
    고액건 AI 검토의견(단일 호출·결정권 없음)을 분류 — "AI Agent"라는 표현을
    과장 없이 쓰고 있다는 걸 투자자에게 먼저 밝혀, 나머지 슬라이드의 "완전자동"
    표현에 대한 신뢰를 뒷받침하는 설계. 두 슬라이드 모두 "N번 슬라이드" 식
    교차참조를 쓰지 않음(2026-11-03 앞선 라운드에서 전면 제거한 패턴을 신규
    슬라이드에도 처음부터 적용).
  - **테이블 row_h를 처음엔 과도하게 잡아(560000/400000) 표와 각주 사이에 불필요한
    공백이 크게 남는 1차 렌더링 결과를 발견 → row_h를 실제 콘텐츠(짧은 단문 위주,
    대부분 1줄) 기준으로 재계산(270000~430000)해 축소, citation_box도 표 바로
    아래로 당김** — `<a:tr h="0">`가 실제 렌더 높이를 결정하지 않는다는 기존
    교훈(2026-10-19/26/31, 2026-11-02 네 차례 반복)이 이번엔 "겹침"이 아니라
    "과도한 여백" 방향으로 나타난 사례. insight_box·glossary_box는 덱 전체가
    예외 없이 고정 하단 위치(기본값)를 쓰는 "푸터 밴드" 관례를 그대로 따름(콘텐츠가
    적은 슬라이드일수록 표 아래 여백이 커지는 건 이미 DB가치 슬라이드 등에서
    확립된 정상 패턴이라 억지로 눌러 채우지 않음) — 표 바로 아래 citation까지의
    공백만 콘텐츠 실측 기준으로 좁히고, 그 아래 푸터까지의 여백은 덱 전체 일관성을
    위해 그대로 둠.
  - 두 슬라이드 모두 `assemble()`의 최신 수정판(id-스캔 기반, name-escape 적용)을
    쓰는 `gen_slides.py`로 빌드해 도형 id 충돌 없이 1차 빌드부터 깨끗했음.
  - **`docProps/app.xml`의 `<Slides>`/`<Notes>`/`HeadingPairs`/`TitlesOfParts`가
    실제로는 2026-10-19 pptxgenjs 최초 생성 시점의 "21"에서 단 한 번도 안
    갱신된 채 남아있었음을 발견**(2026-11-03 앞선 "진짜 PowerPoint가 파일을
    못 여는" 라운드에서 "43으로 고쳤다"고 기록했으나, 그 수정이 이후 다른
    라운드의 재압축 과정에서 되돌아간 것으로 보임 — 정확한 원인은 특정 못함).
    이번에 45로 정확히 재계산해 갱신(Slides/Notes=45, HeadingPairs의 Slide
    Titles 카운트=45, TitlesOfParts 벡터 size=48 · Slide 1~45 전체 나열) —
    **이 필드가 쉽게 다시 stale해질 수 있다는 걸 확인했으므로, 앞으로 슬라이드
    수가 바뀔 때마다 "수정했다"고 적어두는 데 그치지 말고 최종 커밋 직전에
    `grep -o '<Slides>[0-9]*</Slides>' docProps/app.xml`로 실제 값을 한 번 더
    확인할 것.**
  - 삽입으로 밀린 43개 슬라이드·notesSlide 전부의 `<a:fld type="slidenum">`
    캐시를 일괄 재계산(표지·클로징 슬라이드 본문은 기존 관례대로 SKIP, 단 그
    발표자 노트 쪽 캐시는 — 2026-11-03 앞선 라운드에서 발견한 비대칭 케이스대로
    — 별도로 함께 갱신). `grep` 전수추출로 "N번"/"N번 슬라이드" 패턴이 덱 전체에
    여전히 0건임을 재확인(새 슬라이드도 이 패턴을 쓰지 않아 추가되지 않음).
  - `validate.py` 통과 + 전체 45장 도형 id 중복·XML 잘정형성·rels Id 중복 전수
    재검사(모두 깨끗) + `python-pptx`로 45장 전부 노트 보유 확인 + `soffice`+
    `pdftoppm`으로 신규 슬라이드 2장(22·24번)과 경계 슬라이드(21·23·25번) +
    PEST 슬라이드(5번) 재렌더링해 레이아웃·겹침·잘림 없음 및 PEST 정상 렌더링을
    확인함. 작업 디렉터리는 `/tmp/.../scratchpad/agentmap2/`(세션별 임시
    디렉터리, 결과물 `.pptx`만 커밋) — `gen_slides.py`는 `finalflow/`의 누적
    수정판을 그대로 복사해 사용.

- **투자피칭 PPT — 실제 PowerPoint(사용자 기기)에서 글자가 뒤섞여 보이던 진짜
  원인 발견·수정: 원 번호(①②③) 기호가 바로 뒤 한글과 같은 런(run) 안에 붙어있던
  게 범인이었음, LibreOffice 전용 버그가 아니었음** (2026-11-03, 사용자가 "핵심
  요약" 슬라이드(2번)의 "① 왜 필요한가" 카드 제목이 글자가 뒤섞여 보인다는
  스크린샷과 함께 "동일한데"라고 신고 — 직전 라운드에서 PEST 슬라이드를 조사할
  때 "이모지+한글 뒤섞임은 LibreOffice 전용 렌더링 결함, 콘텐츠는 정상이니
  재조사 불필요"라고 단정했던 것과 사실상 같은 증상이 사용자의 실제 PowerPoint
  에서도 재현된다는 결정적 반증):
  - **실제 원인 특정** — `slide41.xml`(핵심요약, 화면상 2번)의 "① 왜 필요한가"가
    `<a:r>` 하나 안에 `<a:t>① 왜 필요한가</a:t>`로 통째로 들어있었음 — 원 번호
    기호(U+2460 등)가 Cambria 폰트에 없어 폰트 폴백이 걸리는데, 뒤이은 한글이
    같은 런 안에 있으면 그 경계에서 글자 셰이핑이 꼬이는 것으로 보임(2026-10-19
    /11-03에 "이모지+한글"에서 봤던 것과 정확히 같은 클래스의 버그 — 원인은
    "이모지"가 아니라 "주 폰트에 없는 특수기호가 CJK와 한 런에 붙어있을 때"였던
    것으로 범위를 재정정함). 이전엔 이게 LibreOffice 렌더링 파이프라인만의
    결함이라고 단정했었는데, 이번에 사용자의 실제 PowerPoint 스크린샷으로
    반증됨 — **"이 세션의 LibreOffice만의 문제"라고 결론 내리기 전에, 그 근거가
    정말 "실제 PowerPoint에서 확인했는데도 깨짐"인지 "이 세션에서 렌더링 도구가
    다르게 보여서"인지 구분할 것 — 전자는 진짜 버그, 후자만 안심해도 되는
    경우임.**
  - `grep`으로 덱 전체에서 "①~⑨가 포함된 `<a:t>` 런" 전수 스캔 → 11개 슬라이드
    (`slide5/13/25/26/27/28/31/41/43/44/45.xml`)에서 41개 런이 해당(그중
    `slide5`/`slide13`는 원 번호가 배지 아이콘으로 독립된 런에 이미 분리돼 있어
    실질적으로는 영향 없었음, 나머지 9개 슬라이드가 실제 수정 대상). 각 런을
    원 번호 기호마다 별도 `<a:r>`로 쪼개는 스크립트(`fix_circled.py`)를 작성해
    일괄 적용 — 서식(`<a:rPr>`)은 그대로 복제해 시각적으로는 동일하고 런
    경계만 늘어남. 수정 전후 각 파일의 `<a:t>` 텍스트를 전부 이어붙여 바이트
    단위로 비교해 내용이 한 글자도 안 바뀌었음을 확인.
  - **`gen_slides.py`의 `sp_text()`(일반 텍스트)와 `table()`의 내부 `cell()`
    (표 셀) 둘 다에 같은 분리 로직(`split_circled()`)을 내장** — 앞으로 이
    헬퍼로 만드는 모든 새 슬라이드는 원 번호를 텍스트에 섞어 써도 자동으로
    별도 런으로 쪼개져 나가므로, 이모지 때와 달리 이번엔 재발 방지까지 소스
    레벨에서 끝냄.
  - `validate.py` 통과 + 전체 45장 도형 id 중복·XML 잘정형성 재검사(깨끗) +
    `soffice`+`pdftoppm`으로 수정된 9개 슬라이드 전부(2, 4, 15, 16, 26, 27,
    28, 35, 38, 44번 — 카드 제목형·표 셀형·조밀한 각주 문단형 세 패턴 모두)
    재렌더링해 레이아웃 변화 없이 정상 출력됨을 확인함. 작업 디렉터리는
    `/tmp/.../scratchpad/garbletest/`(세션별 임시 디렉터리, 결과물 `.pptx`만
    커밋) — `gen_slides.py` 수정은 `finalflow/gen_slides.py`에 누적 적용함.

- **투자피칭 PPT — 45장 전체 재검토 포크 감사 + ⚠(경고기호)·이모지 잔존 위험 요소
  선제 제거** (2026-11-03, 바로 위 "① 글자 뒤섞임" 수정 직후 사용자가 동일한
  스크린샷을 다시 보내며 "PPT 전체 다시 렌더링해서 처음부터 끝까지 한번 더
  검토해줘. 동일한 데"라고 요청): 커밋된 파일의 slide41.xml(핵심요약, 2번)을
  직접 재확인한 결과 "①"이 이미 독립된 런으로 분리돼 있고 150dpi 렌더링에서도
  완전히 깨끗하게 나와, 사용자가 보낸 스크린샷이 직전 신고 스크린샷과 픽셀
  단위로 동일해 보이는 점과 함께 **새로 받은 파일이 아니라 캐시된 이전 버전을
  보고 있을 가능성**이 있다고 판단 — 다만 "LibreOffice만의 문제"라고 단정했다가
  틀렸던 전례(① 버그)가 있어 섣불리 넘기지 않고, fork 서브에이전트로 45장 전체를
  처음부터 다시 렌더링·전수 감사(겹침·잘림·깨진 글자·번호 오류·무결성 검사 전부)
  시킴.
  - **감사 결과 — 2번 슬라이드 포함 44장은 완전히 깨끗함**(`validate.py` 통과,
    도형 id 중복 0건, XML 전부 잘정형). **유일하게 남은 문제 — CareLink(14번)·
    부수업무(16번)의 "윤리 원칙" 각주 앞 "⚠" 기호가 여전히 글자 뒤섞임으로
    렌더링됨**(2026-10-19부터 "LibreOffice 전용 결함, 콘텐츠 정상, 조치 불요"로
    분류해둔 바로 그 항목).
  - **"① 버그"가 진짜였다는 사실 때문에, 이 "⚠ 버그"에 대한 과거의 안일한 분류도
    재검토함**: 다만 확인해보니 ⚠ 쪽은 이미 2026-11-03 이전 라운드에서 "⚠"를
    "윤리 원칙..." 텍스트와 **별도 런으로 분리까지 해둔 상태**였는데도 여전히
    깨져 보임 — ①버그(같은 런에 붙어있어야만 깨짐, 분리하면 고쳐짐)와는 다른
    증상 패턴이라 완전히 같은 원인은 아닌 것으로 보이나, 그렇다고 "100%
    LibreOffice 전용"이라고 다시 단정할 근거도 약해짐(실제 PowerPoint로
    직접 검증할 방법이 이 세션엔 없음). **확신이 안 서는 상태에서 또 다음
    사용자 신고를 기다리기보다, 순수 장식용 기호라 의미 손실 없이 제거 가능한
    점을 활용해 아예 "⚠ " 런 자체를 삭제**(텍스트는 "윤리 원칙 — ..."으로
    바로 시작, 이탤릭+컬러 스타일만으로도 "주의 문구"라는 느낌은 유지됨) —
    추측에 의존하지 않고 위험 요소 자체를 없애는 쪽을 택함.
  - **같은 기회에 전체 덱의 "원 폰트에 없을 만한 특수기호"를 코드포인트
    기준으로 전수 스캔**(ASCII·한글·흔한 구두점·화살표/≈/±/×/÷ 등 널리
    지원되는 기호는 제외) → AI기능분류 슬라이드(`slide39.xml`, 화면상 12번)의
    카드 제목 3곳 — "🤖 AI Agent — 자율 실행" / "🧑‍⚖️ AI 어드바이저 —
    Human-in-the-Loop"(ZWJ 합성 이모지) / "⚙️ 자동화 — 규칙 기반(AI 미관여)" —
    이 **①버그와 정확히 같은 패턴(이모지+한글이 한 런에 붙어있음)으로 아직
    한 번도 신고되지 않은 채 숨어있던 위험 요소**였음을 발견 — 아직 증상이
    보고되지 않았어도 동일한 구조적 위험이 있다고 판단해 선제적으로 세 곳
    모두 이모지와 뒷글자를 별도 런으로 분리함(①버그 수정과 동일한 패턴 —
    이번엔 `gen_slides.py`의 `split_circled()`를 쓰지 않고 이 슬라이드
    3곳만 타겟팅한 1회성 스크립트로 처리, 범용 헬퍼 확장은 불필요하다고 판단).
  - `validate.py` 통과 + 도형 id 중복·XML 잘정형성 전수 재검사(깨끗) +
    `soffice`+`pdftoppm`으로 수정된 3개 슬라이드(12·14·16번) 전부 렌더링해
    로봇·저울(판사)·톱니바퀴 이모지와 "윤리 원칙" 각주 모두 정상 출력됨을
    확인함. 작업 디렉터리는 `/tmp/.../scratchpad/warningfix/`(세션별 임시
    디렉터리, 결과물 `.pptx`만 커밋).
  - **다음에 사용자가 또 같은 스크린샷(①버그와 동일한 모습)을 보내면**: 이번
    수정이 실제로 반영된 최신 파일을 열고 있는지(앱 완전 종료 후 재실행,
    또는 재다운로드) 먼저 확인을 요청할 것 — 코드 레벨에서 파일 자체는 이미
    두 차례(핵심요약 라운드, 이번 라운드) 독립적으로 재확인되어 정상임.

- **투자피칭 PPT — 진짜 근본 원인 발견: `<a:off>`/`<a:ext>` 좌표값이 "548640.0"처럼
  소수점 붙은 상태로 저장되고 있었음(ST_Coordinate는 정수만 허용) — PEST·핵심요약 등
  여러 슬라이드가 실제 PowerPoint에서 박스가 세로 1글자씩 깨져 보이거나 사라지던
  진짜 이유였고, 앞서 두 차례 "캐시/LibreOffice 전용 문제"로 오판했던 것도 이걸로
  설명됨** (2026-11-03, 사용자가 핵심요약 슬라이드 스크린샷을 또 보내며 — 이번엔
  카드 글자가 뒤섞이는 게 아니라 "① 왜 필요한가"가 왼쪽 끝에 세로로 한 글자씩
  쌓이고 카드 박스 배경 자체가 사라진, 완전히 다른 증상으로 — "계속 이상하게 안
  나옴. 다른 슬라이드도 동일함. 이전 파일들은 정상이었음"이라고 신고):
  - **실제 원인** — `slide41.xml`의 카드 박스 좌표가
    `<a:off x="548640.0" y="1874520"/><a:ext cx="3566160.0" cy="2150000"/>`처럼
    x·cx 값에 **소수점(.0)이 붙어 있었음**. OOXML의 `ST_Coordinate`(도형 좌표) 타입은
    정수(EMU) 전용이라 이런 값은 스펙 위반인데, `validate.py`와 LibreOffice는 둘 다
    관대하게 파싱해 통과·정상렌더링해버려서 이 세션 내내 단 한 번도 걸러지지
    못했음 — 반면 실제 PowerPoint는 이를 파싱 실패로 처리해 해당 도형의 `xfrm`을
    무시하는 것으로 보이고, 그 결과 카드 박스 배경이 안 그려지고 텍스트박스 너비가
    0에 가깝게 축소돼 한 글자씩 세로로 줄바꿈되는 모습으로 나타난 것으로 추정됨.
  - **덱 전체를 좌표 속성(x/y/cx/cy) 값에 소수점이 있는지로 전수 스캔** →
    `slide32.xml`(PEST)·`slide33.xml`(3C)·`slide34.xml`(SWOT)·`slide35.xml`(BCG)·
    `slide39.xml`(AI기능분류)·`slide41.xml`(핵심요약)·`slide45.xml`(마지막 흐름)
    7개 슬라이드에서 총 84곳 발견 — **전부 `col_cards()`/`quad_2x2()`로 만든
    카드형 슬라이드였음**. 모든 값이 예외 없이 정확히 "N.0" 형태(소수부가 진짜
    있는 게 아니라 정수를 그냥 float로 들고 있었을 뿐)라, ".0" 접미사만 제거해도
    손실 없이 정확한 정수로 복원됨을 확인하고 일괄 수정.
  - **"이전엔 캐시/LibreOffice 전용 문제"라고 두 차례(PEST 슬라이드, ① 글자뒤섞임)
    오판했던 진짜 이유가 이걸로 설명됨** — 둘 다 같은 7개 슬라이드 그룹(특히 PEST·
    핵심요약)에서 반복 보고된 증상이었는데, 매번 LibreOffice·`validate.py`가
    통과한다는 걸 근거로 "파일은 멀쩡하다"고 판단했었음. 이번에 실제 근본 원인을
    찾고 나서야, **"LibreOffice와 validate.py가 모두 통과한다"는 게 "실제
    PowerPoint에서도 멀쩡하다"는 보장이 전혀 안 된다**는 걸 세 번째로(도형 id 중복
    버그, zip 패키징 순서 버그에 이어) 확인함.
  - **근본 원인 — `gen_slides.py`의 `quad_2x2()`/`col_cards()`가 폭 계산에 파이썬
    `/`(참 나눗셈, 항상 float 반환)를 썼던 것**: `half_w = (cx_total - gap) / 2`,
    `w = (cx_total - gap * (n - 1)) / n` — 둘 다 결과가 float이고, 그 float가
    `card_with_bullets()`→`sp_box()`/`sp_text()`를 거쳐 그대로 f-string에 박혀
    XML에 "N.0"으로 새겨짐. 이 두 헬퍼는 2026-11-02에 신설된 이후 이 세션의 거의
    모든 "카드형" 슬라이드(전략분석 11장, 핵심요약, AI기능분류, 마지막 흐름 등)에
    반복 재사용돼 왔으므로, **그 시점 이후 만들어진 카드형 슬라이드는 전부 잠재적
    위험군이었음** — 이번에 실제로 걸린 7개 슬라이드가 그 전수였던 것으로 보임(새로
    만든 19·24번 등 그 사이 슬라이드들은 `table()` 기반이라 영향 없었음 — `table()`
    은 이미 `int()`로 감싸고 있어 안전했음).
  - **재발 방지 — 소스 레벨에서 근본적으로 차단**: `gen_slides.py`의 `sp_box()`·
    `sp_text()`·`sp_card_text()`·`table()` 네 함수 전부, XML을 실제로 찍어내는
    지점에서 `x`/`y`/`cx`/`cy`(그리고 `table()`의 `total_h`)를 `int(...)`로
    감싸도록 수정 — 이제 어떤 호출부가 실수로 float를 넘기더라도(이번 같은
    나눗셈 실수든, 앞으로 생길 다른 계산 실수든) 최종 XML에는 항상 정수만
    새겨짐. `quad_2x2()`/`col_cards()` 자체의 나눗셈도 `//`(정수 나눗셈)로
    바꿔 근본 원인도 함께 제거 — 이중 방어.
  - `validate.py` 통과 + 전체 패키지(슬라이드·레이아웃·마스터·노트 전부) 좌표
    속성에 소수점이 남은 곳이 0건임을 재확인 + 도형 id 중복·XML 잘정형성 전수
    재검사(깨끗) + `soffice`+`pdftoppm`으로 영향받은 7개 슬라이드(2·5·6·7·8·
    12·44번) 전부 렌더링해 레이아웃 정상 확인함. 작업 디렉터리는
    `/tmp/.../scratchpad/regress2/`(세션별 임시 디렉터리, 결과물 `.pptx`만
    커밋) — `gen_slides.py` 수정은 `finalflow/gen_slides.py`에 누적 적용함.
  - **다음에 또 "슬라이드가 이상하게 보인다"는 신고가 오면**: 이번처럼 매번
    "LibreOffice/validate.py가 통과하니 괜찮다"고 단정하지 말고, 정말 실제
    PowerPoint 전용 결함일 가능성을 먼저 의심할 것 — 특히 이번처럼 **증상이
    이전 신고와 미묘하게 다르면(겹침→글자뒤섞임→박스소실) 같은 근본 원인이
    여러 방식으로 나타나고 있다는 신호**일 수 있으므로, "증상이 다르니 별개
    문제"라고 넘겨짚지 말고 오히려 더 근본적인 구조적 결함(이번의 좌표
    타입처럼)을 의심해볼 것.

- **투자피칭 PPT — 전체 표(table) 본문 행을 가운데 정렬 → 왼쪽 정렬로 전환(표 제목
  행은 가운데 정렬 유지)** (2026-11-03, 좌표 타입 버그 수정 직후 사용자가 "이제야
  고쳐졌군, 그런데 가운데 정렬이라 모든 슬라이드를 왼쪽 정렬로 변경해 줘. 표에서
  변경. 표 제목은 가운데 정렬 그대로" 요청): 덱 전체에서 `<a:tbl>`을 쓰는 슬라이드
  19장(치아보험 메인 상품표부터 신규 19종 예시표·투명성 분류표까지)을 전수
  스캔 — 전부 표 셀 텍스트가 `algn="ctr"`로 통일돼 있었음(가장 오래된 `slide9.xml`
  처럼 `gen_slides.py` 신설 이전에 손으로 만든 표는 헤더 셀에 아예 `algn` 속성이
  없는 경우도 있었으나, 그 경우도 렌더링에서는 시각적으로 가운데 정렬로 나타남 —
  원인은 특정 못 함, 결과만 확인).
  - 19개 테이블 전부에서 **첫 번째 행(헤더)은 그대로 두고, 그 뒤 모든 데이터 행의
    `<a:pPr>`만** `algn="ctr"` → `algn="l"`로 바꾸는 스크립트(`fix_align.py`)를
    작성해 일괄 적용 — `algn` 속성이 아예 없던 셀(slide9 계열)에는 `algn="l"`을
    새로 추가. 각 `<a:tbl>`·`<a:tr>` 경계로 정확히 스코프를 한정해(이전부터 지켜온
    "표 안쪽만 치환" 원칙과 동일) 표 밖 텍스트나 헤더 행은 전혀 건드리지 않음.
  - `gen_slides.py`의 `table()`/`cell()`에도 `text_algn` 파라미터를 추가해 헤더
    행 호출은 `text_algn="ctr"`, 데이터 행 호출은 `text_algn="l"`을 명시적으로
    넘기도록 고쳐, 앞으로 이 헬퍼로 새 표를 만들 때도 처음부터 이 관례(헤더
    가운데·본문 왼쪽)를 따르게 함.
  - `validate.py` 통과 + 도형 id 중복·XML 잘정형성·좌표값 소수점 잔존 여부(0건)
    전수 재검사(깨끗) + `soffice`+`pdftoppm`으로 표가 있는 슬라이드 중 4장(9,
    19, 31, 46번 — 손수 제작/2026-11-02 헬퍼형/2026-11-03 신규형 세 시대의 표를
    각각 대표)을 렌더링해 헤더는 가운데, 본문은 왼쪽으로 정확히 정렬됨을 확인함.
    작업 디렉터리는 `/tmp/.../scratchpad/tablealign/`(세션별 임시 디렉터리,
    결과물 `.pptx`만 커밋).
  - **같은 메시지에서 사용자가 물어본 "대쉬(—)가 두 개 있는 것" 질문**("— 상담을
    맡는 메인 AI Agent는 보험 심사 로직을 몰라도 됨 — 정밀심사가 필요할 때만...")
    — 파일을 고칠 필요가 있는 버그가 아니라 **의도된 표기임을 확인해 채팅으로
    설명**: 첫 번째 "—"는 글머리 기호(2026-11-03 행잉 인덴트 수정 때 도입한
    "— "로 시작하는 불릿 패턴), 두 번째 "—"는 **같은 불릿 문장 안에서 "주장 —
    그 근거/부연설명"을 잇는 중간 연결사**로, 이 덱 전체에서 수십 곳에 일관되게
    쓰이는 문체임(예: "메인은 작업 1건만 위임, 독립된 tool-calling 루프... —
    구조화된 결론만 반환" 등). 새 줄로 내려가는 하위 불릿이 아니라 한 줄 안의
    콜론 같은 연결 기호이므로 그대로 둠 — 만약 덱 전체에서 이 중간 연결사를
    별도 하위 불릿으로 분리하고 싶다면 범위가 매우 넓은(거의 모든 불릿에 해당)
    별도 작업이 되므로 먼저 확인이 필요하다고 안내함.

- **투자피칭 PPT — 덱 전체에서 "주장 — 부연설명" 식 중간 연결사를 전부 별도
  하위 불릿으로 분리** (2026-11-03, 바로 전 턴에서 "이건 버그가 아니라 의도된
  표기"라고 설명한 직후 사용자가 "덱 전체에서 중간 연결사도 하위 불릿으로
  분리해줘"라고 명시적으로 요청): 덱 전체를 스캔해 "— "로 시작하는 불릿 문단
  중, 그 안에 추가로 " — "가 한 번 더 들어있는 경우를 전수 추출 — 9개 슬라이드
  (`slide7/8/12/15/33/34/35/39/41.xml`)에서 44개 불릿(전부 예외 없이 중간
  연결사가 정확히 1개씩만 있어, 분리해도 항상 정확히 2개 불릿으로 나뉨)을
  찾아 각각 "— 주장" / "— 부연설명" 두 개의 독립된 불릿으로 분리함.
  - **구현 방식이 슬라이드 레이아웃 종류에 따라 완전히 갈림**: `col_cards()`/
    `quad_2x2()`로 만든 "플로잉 텍스트박스" 슬라이드(3C·BCG·AI기능분류·
    핵심요약, `slide33/34/35/39/41.xml`)는 카드 하나가 이미 **하나의
    텍스트박스 안에 불릿마다 별도 `<a:p>` 문단**으로 들어있는 구조라, 매칭되는
    `<a:p>`를 찾아 그 자리에 **똑같은 `<a:pPr>`/`<a:rPr>`를 재사용**해 `<a:p>`
    2개로 쪼개는 범용 정규식 스크립트(`fix_cardslides.py`) 하나로 5개 슬라이드
    전부(36개 불릿) 처리 가능했음 — 서식을 그대로 복제하므로 시각적으로는
    "원래 있던 불릿"과 구분이 안 감. 카드 높이(cy)는 **전혀 건드리지 않고
    그대로 둠** — 기존 `cy`에 이미 확보돼 있던 여유 공간(이전 라운드들에서
    "공백 정리"로 꽉 채웠다고 생각했던 카드들에도 실제로는 1~3줄 분량의
    슬랙이 남아 있었음)이 늘어난 불릿 수(최대 핵심요약 카드②·AI기능분류
    카드①은 8줄까지)를 전부 흡수함 — 렌더링해서 직접 확인함, 미리 계산하지
    않고 "되는지 먼저 보고 필요하면 조정"하는 이 세션의 기존 방식을 그대로
    따름.
  - **`slide7/8/12/15.xml`(AI거버넌스①②·경쟁구도·사업제휴)은 애초에 불릿
    하나하나가 "— N×548640(또는 420000) 간격의 고정 슬롯"에 개별
    `<p:sp>`로 박혀 있던 손수 제작 레이아웃이라, 같은 방식을 그대로 쓰면
    새 불릿마다 고정 슬롯 하나씩(최대 548640 EMU)을 추가로 요구해 바로
    아래 insight_box/슬라이드 하단과 충돌할 뻔했음**(계산해보니 가장 많이
    늘어나는 슬라이드7 우측 박스는 3→6개로 거의 2배, 548640×3=1,645,920
    EMU를 추가로 요구했을 것 — 이미 거의 꽉 찬 박스에 그만큼 더 늘리면
    확실히 넘침). **대신 그 박스 안의 개별 불릿 shape들을 전부 통째로
    걷어내고, `card_with_bullets()`가 쓰는 것과 동일한 "하나의 플로잉
    텍스트박스 + 불릿 리스트" 패턴(`sp_text(..., bullet=True)`)으로
    재작성** — 줄바꿈이 실제 글자 수에 맞춰 자동 계산되므로, 늘어난 불릿
    개수만큼 고정폭을 미리 예약하는 비효율이 없어져 늘어난 콘텐츠가 기존
    박스 높이 안에 거의 그대로 들어맞음(렌더링으로 확인 — 슬라이드7
    우측박스는 3→6개 불릿으로 2배가 됐는데도 박스 바닥에 딱 맞게 들어가고,
    바로 아래 insight 문구와도 겹치지 않음). **이 네 슬라이드는 이제
    `card_with_bullets()` 계열과 동일한 "플로잉 텍스트박스" 구조로
    통일됐으므로, 앞으로 이 네 슬라이드에 불릿을 추가·수정할 때는 더 이상
    "N번째 슬롯 y좌표"를 계산할 필요 없이 그냥 불릿 리스트에 항목을
    추가/삭제하면 됨(기존에 CLAUDE.md가 이 넷을 "셰이프별 좌표를 각각
    다시 계산해야 하는 손수 제작 레이아웃"이라고 경고해뒀던 내용은 이제
    이 네 슬라이드에는 더 이상 해당하지 않음 — 과거 경고를 그대로 믿지
    말고 구조가 바뀌었을 가능성을 먼저 확인할 것).**
  - **색상 버그 하나를 재조립 전 직접 XML 확인으로 사전에 피함**:
    `slide15.xml`(사업제휴) 우측 박스(보험사 측 가치)는 왼쪽(크림 배경)과
    달리 배경이 네이비(`16233F`)였는데, 처음엔 다른 왼쪽 박스들처럼
    본문색을 `16233F`(짙은 네이비 글자)로 쓰려다, 재조립 직전 원본 불릿
    shape의 실제 `<a:rPr>` 색상을 직접 dump해서 `FFFFFF`(흰색)이었음을
    확인하고 바로잡음 — **박스 배경색을 가정으로 넘겨짚지 말고, 손수 제작
    슬라이드를 재조립할 때는 항상 원본 shape의 실제 rPr 색상값을 먼저
    확인할 것**(2026-11-03 BCG "Star 제목이 배경과 동색이라 안 보이던" 버그와
    같은 계열의 실수를 이번엔 사전에 잡아냄).
  - **1차 적용에서 `fix_cardslides.py`에 `slide35.xml`(BCG 매트릭스, 8개
    불릿)을 명령줄 인자에서 빠뜨렸던 실수** — "덱 전체" 재스캔(수정 후
    재검증 — 이 세션에서 거듭 강조해온 "스캔 스크립트로 전수 재확인" 습관)
    에서 8개가 그대로 남아있는 걸 발견해 바로 잡아냄, 누락분 처리 후
    재스캔에서 0건 확인.
  - `validate.py` 통과 + 전체 45장 도형 id 중복·XML 잘정형성·좌표 소수점
    잔존(0건) 전수 재검사(깨끗) + 수정 전후 각 파일의 전체 `<a:t>` 텍스트를
    이어붙여 비교해 공백을 포함한 글자 손실이 전혀 없음을 확인(중간 "—"
    기호 1개가 새 불릿의 "— " 머리글로 재배치됐을 뿐 — 이 재배치 자체가
    의도한 변환이므로 길이 차이는 정상) + `soffice`+`pdftoppm`으로 9개
    슬라이드 전부 렌더링해 모든 카드·박스가 겹침·잘림 없이 들어감을 확인함.
    작업 디렉터리는 `/tmp/.../scratchpad/splitdash/`(세션별 임시 디렉터리,
    결과물 `.pptx`만 커밋).

- **투자피칭 PPT 45→46슬라이드 — "추가 수익 확장 아이디어" 신규 슬라이드(예상 매출
  산출 포함)** (2026-11-04, 사용자가 "사업 수익을 더 확대할 부분이 있는지 검토해줘"
  요청 → 코드 기준으로 미구현 공백 6개를 찾아 제시했으나, 사용자가 "실제 구현은
  나중에 할 예정이고 발표 자료에 더 풍성하게 넣을 것을 말한 것임 — 다시 발표
  자료에 넣고 예상 수익을 산출할 내용으로 검토해달라"고 범위를 명확히 함 — 즉
  코드 구현이 아니라 PPT 콘텐츠·수익 추정 요청이었음): 기존 구현(11개 블록체인
  상품, 5가지 수익원, B2B 파트너 API 등)과 겹치지 않는 영역을 코드로 직접 확인해
  진짜 공백 6개를 찾음 — ① `partner_api.py`의 `monthly_billing_report()`가
  `price_per_call=0.0`이 기본값이라 실제로는 아무도 과금되지 않는 상태(리드DB
  신설은 이와 별개로 CareLink 교차판매 전환 효과로 접근), ② `web_app.py`의
  `/api/partner/v1/dental/status`는 GA/핀테크가 조회하는 API일 뿐 검진센터가
  리퍼럴을 보내는 인입 엔드포인트가 아님(사업계획서 슬라이드에만 있고 실제 연동은
  없음), ③ 보험다모아 실데이터는 이미 쓰지만 실제 보험사·GA가 화이트레이블로
  붙여 쓰거나 CPA 정산받는 구조는 없음, ④ "배너광고" 코드는 UI 상태표시 배너뿐
  실제 광고 슬롯은 전혀 없음(상담형 툴 특성상 직접 광고수익보다 외부상품 클릭
  수수료 쪽이 더 현실적이라고 판단해 그 방향으로 재구성), ⑤ 기존
  `ParametricInsurance.sol`+오라클 패턴 재사용으로 신규 지수형 상품 추가 여지,
  ⑥ `health_credit_tool.py`에 이미 10종의 대안신용평가 로직(`assess_health_credit`
  등)이 구현돼 있는데 챗봇 내부용으로만 쓰이고 핀테크 대상 별도 API 상품으로
  포장돼 있지 않음 — "코드는 다 있고 포장만 안 된" 가장 저평가된 자산으로 판단.
  신규 슬라이드(화면상 39번, 파일 `slide48.xml`, 종합손익비교(38번) 바로 뒤·
  연속수익구조(40번) 바로 앞)에 이 6개를 "항목|수익모델 핵심가정|예상 연매출" 3열
  표로 정리 — 각 행에 구체적 가정(리드 1만건×전환3%, 제휴센터 20곳×센터당 11건,
  GA 10곳×월구독50만원+건당1만원, 월방문5,000명×클릭률10%×클릭당2,000원, 신규
  500건×보험료10만원, 핀테크15곳×월5,000회×호출당80원)을 명시하고 합산 약
  3억650만원/년을 insight_box에 제시. citation_box에 "전부 가정 기반 추정치이며
  구현 전 기획 단계"라는 캐비트와 각 항목별 개별 한계(①은 직접매출이 아니라
  교차판매 효과, ②·③은 계약조건에 따라 달라짐, ④는 일반 포털 배너광고보다 규모가
  작을 수 있어 참고용, ⑤·⑥은 기존 인프라 재사용이라 개발부담 낮음)를 숨기지 않고
  명시 — 이 덱 전체의 "주장만 내세우지 않고 한계도 병기" 관례를 그대로 따름.
  슬라이드24(수익성시뮬레이션)의 "N=10,000건" 가정, 슬라이드22(사업제휴 구체사례)의
  퍼널 수치, 슬라이드19(CPM/CPC/CPA)의 배너광고 비교 프레임을 재인용해 숫자 간
  일관성을 유지함 — 새 가정을 즉흥적으로 지어내지 않고 기존에 이미 검증된 수치
  체계 위에 쌓음. 기존 "수익원 5가지(종합손익비교 슬라이드38 등에서 이미 확정된
  카운트)"는 건드리지 않음 — 이 6개는 어디까지나 "아이디어 단계"이지 이미 집계에
  포함된 5가지 수익원과 같은 위상이 아니므로 혼동하지 않도록 제목에도 "아이디어"를
  명시.
  - `gen_slides.py`(2026-11-03 "① 글자뒤섞임"·"좌표 소수점" 두 버그가 모두 고쳐진
    최신 `finalflow/` 사본)의 `table()` 헬퍼를 그대로 썼지만, 헬퍼 자체의 `cell()`
    마진(`marT="25400" marB="25400"`)은 2026-11-03 "표 전체 폰트·패딩 확대" 라운드가
    기존 테이블에만 직접 XML 패치로 적용했을 뿐 헬퍼 소스에는 반영되지 않은 상태라는
    걸 이번에 처음 인지함 — 새로 만드는 표마다 매번 수동으로
    `.replace('marT="25400" marB="25400"', 'marT="45720" marB="45720"')`를 해줘야
    덱 전체와 밀도가 맞음. **다음에 새 표를 만들 때도 이 치환을 잊지 말 것 — 더
    근본적으로는 `table()` 헬퍼 자체에 `cell_margin` 파라미터를 추가해 기본값을
    덱 전체 관례(45720)로 맞춰두는 편이 안전함(아직 미반영).**
  - 삽입 지점 앞뒤(슬라이드16·17·18·19·20·45번, 그리고 notesSlide 쪽은 비대칭
    케이스인 notesSlide21까지 포함 총 7개)의 `<a:fld type="slidenum">` 캐시를
    +1 일괄 수정, `docProps/app.xml`의 `<Slides>`/`<Notes>`/`HeadingPairs`/
    `TitlesOfParts`도 45→46으로 재계산(2026-11-03 "진짜 PowerPoint가 파일을 못
    여는" 라운드에서 세운 "슬라이드 수가 바뀌면 이 필드도 같이 재확인" 원칙을
    이번엔 처음부터 지킴). 새 슬라이드는 이번에도 노트가 없는 깨끗한
    `slide*.xml.rels` 템플릿으로 먼저 만든 뒤 notesSlide 관계를 추가하는 순서를
    지켜 중복관계 버그를 피함.
  - 도형 id 중복·XML 잘정형성·좌표 소수점 잔존·rels Id 중복 4종 전수 검사(모두
    0건) + `validate.py` 통과 + `python-pptx`로 46장 전체 노트 보유 확인 +
    `soffice`+`pdftoppm`으로 신규 슬라이드(39번)와 경계 슬라이드(38·40·46번
    클로징)까지 렌더링해 표 레이아웃·페이지번호 모두 정상 확인함. 작업 디렉터리는
    `/tmp/.../scratchpad/revexpand/`(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT — 추가 수익 확장 아이디어(39번)·결제수수료(27번)·설계사수수료(28번)·
  종합손익비교(38번) 4개 슬라이드 금액 규모 확대** (2026-11-04, 바로 위 라운드 직후
  사용자가 "수익 금액이 좀 작은데, 수익성 증대 방안과 지금 산출한 금액을 증가할
  방법, 그리고 비용 절감도 금액을 높여줘" 요청): 숫자를 그냥 부풀리지 않고, **이미
  덱에 있는 "수익성 시뮬레이션"(24번) 테이블의 N=100,000건(300억원) 행 — 로드맵
  3단계 '규제샌드박스 실증' 목표 규모로 이미 명시돼 있던 행 —을 종합손익비교·결제
  수수료의 새 기준선으로 끌어올리는 방식**을 택함(이전까지 이 두 슬라이드는 같은
  시뮬레이션의 N=10,000건 행만 썼음) — 단가(%, 건당 수수료)는 그대로 두고 건수만
  이미 검증된 더 큰 행으로 바꾼 것이라 숫자를 지어낸 게 아니라 기존 모델을 끝까지
  활용한 것.
  - **종합손익비교(38번)**: 사업비율 인슈어체인 쪽을 14.0%(N=10,000)→8.6%
    (N=100,000, 시뮬레이션 24번 테이블 재인용)로, 표 전체를 보험료 300억원 기준으로
    전환 — 사업비 총액 6억→4.2억원(절감 1.8억원)이 60억→25.8억원(절감 **34.2억원**,
    57%↓)으로, 합산비율差 6%p→**11.4%p**로 커짐.
  - **결제수수료(27번)**: 기존엔 CMS(계좌이체) 채널 하나만 "연 4,800만원" 예시로
    있었음 — 카드수수료(2.2%)·VAN사수수료(건당~100원)는 "100%↓"라고만 쓰고 원화
    환산을 안 하고 있었던 것을 이번에 처음 환산해 stat_cards 3개로 추가: **카드채널
    6.6억원/년, VAN사 1.2억원/년, CMS 4.8억원/년**(전부 N=100,000건 기준) — 카드·
    계좌이체는 서로 다른 결제수단이라 고객이 둘 다 쓰지 않으므로 단순 합산하지
    않고 채널별로 병기함을 각주에 명시.
  - **설계사수수료(28번)**: 기존엔 "월 보험료 3만원 가정 시 최대 36만원"이라는
    1건짜리 예시만 있었음 — `1200%룰`은 월납보험료 기준 **상한**(연간 경상비용이
    아니라 3~7년에 걸쳐 분급되는 신계약 1건당 총액)이라, 이걸 그대로 N=100,000건에
    곱하면(360억원) 종합손익비교(38번)의 전체 사업비 총액(60억원)보다 커지는
    **내적 모순**이 생김 — 그래서 N=100,000 전체가 아니라 **"연간 신규가입
    코호트 1만 건"**(종합손익비교와 별개의, 매년 새로 들어오는 신규계약 규모라는
    더 작고 방어 가능한 기준)으로 범위를 좁혀 "최대 36억원(건당 36만원×1만건,
    3~7년 분급 누적 총액 — 연간 경상비용 아님)"으로 표 3번째 행과 stat_cards에
    추가 — **"연간 반복비용"과 "다년 분급 신규코호트 총액"을 명확히 구분해 라벨링**
    함으로써, 숫자는 36억원으로 크게 키우면서도 38번 슬라이드의 60억원 총사업비와
    모순되지 않도록 함(합산 가능한 숫자가 아니라 범위가 다른 숫자임을 각주에 명시).
  - **추가 수익 확장 아이디어(39번)**: 6개 항목 전부 "건수×단가" 구조를 유지한 채
    건수(파트너·센터·고객 수)만 로드맵 3~4단계(컨소시엄 확장·GA 등록) 목표 규모로
    상향 — 리드 1만→3만 건, 검진센터 20→60곳, GA 10→25곳, 월방문 5,000→20,000명,
    파라메트릭 500→2,000건, 핀테크 15→30곳(단가도 일부 소폭 상향: 전환율 3%→4%,
    예치금 500→600만원 등). 합계 약 3억650만원/년 → **약 11억 8,400만원/년**(~3.9배).
    각 항목 단가는 그대로 둔 채 건수만 올렸다는 점, 그리고 모든 수치가 여전히
    "가정 기반 추정치·구현 전 기획 단계"라는 기존 캐비트는 그대로 유지함.
  - ⚠️ **처음 빌드에서 4개 슬라이드 전부 표 안의 긴 셀 텍스트가 2줄로 줄바꿈되며
    바로 아래 stat_cards와 겹치는 버그 발생** — 원인은 표를 가진 기존 슬라이드들이
    대부분 기본 `sz=1000`으로 만들어져 있었는데, 이번엔 가독성을 의식해
    `sz=1300`(2026-11-03 "표 전체 폰트 확대" 라운드 관례를 따라감)으로 새로
    만들다 보니 늘어난 셀 텍스트 길이와 맞물려 테이블 실제 렌더 높이가 커졌기
    때문 — `<a:tr h="0">`가 실제 높이를 결정하지 않는다는 기존 교훈(2026-10-19
    이후 다수 반복)이 이번엔 "폰트 키우기 관례를 다른 슬라이드에 그대로
    적용했다가" 재발한 사례. 셀 텍스트를 한 줄에 들어가도록 축약(예: "건당 약
    200~550원(③ 참조, 중계기관+은행 이용수수료 합산)"→"건당 약 200~550원(③,
    중계+은행 합산)")하고 `sz`를 1150~1000으로, `row_h`도 실측 기준으로 줄여
    해결 — 특히 38번(4행 표)은 `sz=1000·row_h=360000`까지 낮추고 stat_cards를
    3300000→3750000으로 내려서야 안전하게 들어감. **표에 새로 긴 문장을 넣을
    때는 "가독성을 위해 폰트를 키운다"는 관례보다 "한 줄에 들어가는 글자 수"를
    먼저 따져볼 것 — 특히 행 수가 3개 이상인 표에서는 작은 폰트 쪽이 안전함.**
  - `validate.py` 통과 + 도형 id 중복·XML 잘정형성·좌표 소수점 잔존 4종 전수 검사
    (모두 0건) + `soffice`+`pdftoppm`으로 4개 슬라이드(27·28·38·39번) 전부
    재렌더링해(1차 겹침 버그 발견 → 축약·재조정 → 재렌더링 재확인) 레이아웃
    정상 확인함. 슬라이드 수·구성은 그대로(46장) — 내용만 교체. 작업 디렉터리는
    `/tmp/.../scratchpad/revexpand2/`(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).

- **투자피칭 PPT — 덱 전체 스타일 통일성 감사 + 수정(폰트·마진·색상)** (2026-11-04,
  사용자가 "스킬을 써서 전체적인 발표 자료를 통일화 해야 하는 것은 아닌지" 질문 →
  `pptx` 스킬을 로드해 확인한 결과 스킬 자체엔 자동 통일성 검사 스크립트가 없고
  `thumbnail.py` 그리드로 "같은 유형 슬라이드끼리 비교"하는 육안 검수가 권장
  방법임을 확인 → fork 서브에이전트로 46장 전체를 스타일 축(정확성 축이 아니라)
  으로 전수 감사): 이 덱이 pptxgenjs 원본(2026-10-19) → `gen_slides.py` 헬퍼
  (2026-11-02~) → 직접 XML 치환 세 시대에 걸쳐 만들어지며 쌓인 드리프트를 코드
  기준으로 정량 확인함.
  - **표 폰트 크기·셀 마진 드리프트**: 20개 테이블의 `sz`가 950~1500(8가지 값),
    `marT`/`marB`가 25400~91440(6가지 값)로 전부 제각각이었음(표 작성 시점마다
    다른 관례를 썼던 흔적). `sz=1150·marT/marB=45720`(가장 최근·가장 가독성
    좋은 조합, slide38/48과 동일)으로 통일 — `<a:tbl>...</a:tbl>` 블록으로
    정확히 스코프를 한정한 정규식 치환(이 세션이 거듭 확인해온 "표 밖 안 건드림"
    원칙).
  - **insight_box 폰트 드리프트** — pptxgenjs 원본 시대 슬라이드 6장(slide3/4/5/9/
    13/20, 현재 위치 3·4·5·16·31·44번)이 `sz=1250~1300`(그 외 ~25개 슬라이드는
    전부 `sz=1150`)로 남아있던 걸 통일.
  - **lead_box 높이 드리프트** — slide3·slide5(현재 3·16번)만 `cy=457200`(그 외
    전부 `cy=365760`)이던 걸 통일.
  - **제품그리드 3슬라이드(slide10·14·42, 현재 10·17·29번)의 "마무리 한 줄"이
    실제로는 insight_box 역할을 하는데 citation_box 스타일(이탤릭+회색+sz1200~
    1350)로 잘못 입혀져 있던 것을 발견·수정** — `color=5A5E68`(회색, 각주용)를
    `1F7A6C`(teal, insight용)로, `sz`를 1150으로 맞춤. 이 세 슬라이드가 쓰는
    "크림카드+원형숫자아이콘" 레이아웃 자체는 덱의 나머지(짙은 남색 카드)와
    확연히 다른 또 하나의 "다른 패밀리"로 남아있으나, `pptx` 스킬 자신의
    디자인 지침("같은 레이아웃 반복하지 말 것")과도 부합하는 의도적 변주로
    보고 레이아웃 자체는 건드리지 않음 — 다만 각주 역할의 텍스트 스타일만은
    맞춰, "이 줄이 핵심 결론인지 출처 각주인지" 혼동되지 않게 함.
  - ⚠️ **표 3개(slide30/25/24, 현재 3·26·37번 — 도입배경/IT인프라/수익성시뮬레이션)
    에서 sz=1150·margin=45720 통일 적용 직후 overflow 재발** — 전부 "표+
    stat_cards가 한 슬라이드에 같이 있는" 조합으로, 2026-11-04 앞선 라운드에서
    슬라이드28(종합손익비교)을 고칠 때 이미 겪었던 바로 그 패턴("표+stat_cards
    조합은 sz=1150이 아니라 sz=1000이어야 안전")을 재확인함 — 포크 감사가 이
    조합까지는 가정하지 못해 처음엔 전체를 1150으로 밀었다가, 렌더링 재검증
    (20개 테이블 슬라이드 전부 육안 확인하는 별도 포크를 또 띄움)에서 3건을
    실제로 잡아냄. 이 3개만 `sz=1000`(슬라이드28과 동일한 안전값)으로 되돌리고,
    `stat_cards` y좌표를 3300000→3650000~3700000으로, `citation_box` y도
    5100000→5350000~5400000으로 밀어 여유를 다시 확보(테이블 자체의 선언된
    `<p:xfrm>` cy는 손대지 않음 — `<a:tr h="0">`가 실제 렌더 높이를 안 정한다는
    기존 교훈대로, 실측 재검증으로만 판단). **"표+stat_cards" 조합은 이 덱에서
    구조적으로 sz=1150이 안전하지 않은 유일한 패턴임이 이제 4개 사례(슬라이드
    24/25/28/30)로 확인됐으니, 앞으로 이 조합의 새 슬라이드를 만들 때는 처음부터
    sz=1000으로 시작하고 stat_cards를 3650000선 밑으로 둘 것 — 매번 sz=1150으로
    먼저 시도했다가 겹침을 발견하고 되돌리는 걸 반복하지 말 것.**
  - 도형 id 중복·XML 잘정형성·좌표 소수점 잔존 3종 전수 검사(모두 0건) +
    `validate.py` 통과 + 1차 통일화 직후 20개 표 슬라이드 전부를 별도 포크로
    렌더링 재검증(3건 발견) → 수정 → 재검증(3건 모두 해결 확인) +
    insight_box·lead_box·제품그리드 수정분(4·16·13·17·29번 등) 개별 렌더링
    확인 + `thumbnail.py` 46장 전체 그리드로 마지막 육안 전수 스캔. 작업
    디렉터리는 `/tmp/styleaudit/`(세션별 임시 디렉터리, 결과물 `.pptx`만 커밋).
  - ⚠️ **이번 감사 중 범위 밖에서 우연히 발견 — 아직 미수정**: "정확히 어디가
    AI이고 멀티에이전트인가"(slide47, 현재 24번) 표의 마지막 행에
    `"GPT 호출 1회뿐이고 루프가 아님"`이라는 문구가 남아있음 — 2026-10-31에
    "GPT-4o 표현 전부 삭제, AI(LLM)로 교체"를 덱 전체에 적용했던 결정과 상충
    (이 슬라이드는 2026-11-03에 새로 추가된 것이라 그 치환 라운드 이후에
    생겨서 빠진 것으로 보임). 이번 라운드는 스타일(폰트·마진·색) 통일만
    범위로 삼아 손대지 않음 — 다음에 이 슬라이드를 다시 열 일이 있으면
    "GPT 호출" → "LLM 호출"로 교체할 것.

### 진행 중 — 다음에 이어서 할 것 (2026-09-18 기준)

증권/청구 알림 이메일 기능은 로컬 Mailpit 기준으로는 완성·검증됐지만, **사용자가 실제
네이버 메일함으로 받고 싶어해서 진짜 SMTP(네이버) 연동을 시작하다가 중단**한 상태.
- `blockchain-dental/.env`에 `SMTP_HOST=smtp.naver.com`, `SMTP_PORT=587`, `SMTP_USER`,
  `SMTP_PASS`(네이버 앱 비밀번호 또는 로그인 비밀번호), `SMTP_FROM`을 채우는 것까지
  안내함 — 사용자가 직접 `.env`에 입력하기로 함(비밀번호는 채팅에 공유하지 않기로).
  코드 쪽(`scripts/lib/mailer.js`)은 이미 이 값들을 그대로 읽도록 되어 있어 추가
  구현 불필요 — `.env` 채우고 `email-service.js`만 재시작하면 됨.
- 다음 세션에서 이어갈 때: 사용자가 `.env`를 채웠는지 확인 → `email-service.js` 재시작 →
  실제 네이버 주소로 테스트 발송 → (요청하면) 비밀번호 값은 보지 않고 로그인 성공
  여부만 확인해주는 방식으로 연결 테스트.
