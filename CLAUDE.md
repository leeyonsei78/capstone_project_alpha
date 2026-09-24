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

### 진행 중 — 가상자산(auto_upbit) 투자 기능 편입 (2026-09-23 계획, 2026-09-24 ①단계 구현 시작)

사용자의 별도 개인 프로젝트 `https://github.com/leeyonsei78/auto_upbit`(업비트 실계좌
자동매매 봇, public, Python/Streamlit — 이 캡스톤과 완전히 별개의 스택)를 검토해 캡스톤에
가상자산 투자를 편입할지 논의함. **결론: 3가지 방향 모두 하기로 결정, 세 개 다 아직 코드
작업은 시작 안 함** — 중간에 세션이 끊길 수 있어 다음에 이어가기 위한 기록.

**`auto_upbit` 요약** (2026-09-23 시점, 저장소 자체 `CLAUDE.md` 기준): `TradingBot`이
BTC/SOL/XRP/ETH 4종목을 RSI/MACD/BBANDS/Stoch/ATR/EMA/ADX/Supertrend 등 11개 지표
점수제 + 바이낸스 펀딩비 필터로 60초 주기 자동매매(`app.py` → `trade_bot.py`). 건당
15,000원, 하루 최대 10회. API 키는 로컬 `config.json`에 평문(사용자가 로컬 단독 사용
확인해 로테이션 불필요라고 이미 정리됨 — 이 프로젝트로 가져올 때도 재확인 불필요).
⚠️ **저장소 자체 문서에 명시된 미해결 버그가 있음** — 재시작 시 손절/익절가 초기화,
매수 수량 계산에 수수료 미반영, "동적 가중치 조정"이 키 불일치로 no-op, 물타기 직후
매도 로직 충돌 가능성 등. 실제 자금(내부 준비금이든 고객 자금이든)을 이 봇에 연결하기
전에 이 버그들부터 해결해야 함 — `auto_upbit` 저장소 쪽 작업이지 이 캡스톤 저장소
작업이 아니므로, 작업 시작 전 `auto_upbit`으로 가서 `CLAUDE.md`의 "🟠 High" 목록부터
확인할 것.

**결정된 3방향** (전부 진행하기로 함, 순서는 미정 — 다음 세션에서 사용자와 우선순위
정하고 시작):
1. **내부 준비금 운용 도구** (사용자가 가장 낮은 리스크로 판단할 만한 방향) — 인슈어체인
   `ReserveFund` 자금 일부를 `auto_upbit`으로 운용한다는 설정으로, 챗봇엔 "준비금 운용
   실적"만 읽기전용으로 공시(기존 `get_blockchain_dental_status`/`get_blockchain_altinvest_status`
   패턴 재사용 — Python 프로세스 안에서 도는 별도 봇이라 `query-policy.js` 같은 subprocess
   브릿지 대신, `auto_upbit`의 `config.json`/거래내역을 직접 읽는 새 도구가 필요할 것으로
   예상). 고객에게 직접 매매 권유 없음 → 보험업법 겸영 제한·투자자문업 등록 이슈 최소.
2. **신규 고객 상품 (크립토 인덱스 연동형)** — 개발 범위 가장 큼. `trade_bot.py`의
   공격적인 개별종목 데이트레이딩 로직을 그대로 고객 상품에 연결하면 안 됨(보험사가
   비면허 투자자문/매매 권유를 하는 모양새) — 월 1회 리밸런싱하는 보수적 인덱스 방식으로
   재설계해, 기존 `AltInvestmentFund`의 `riskLinked` 펀드 메커니즘(2026-09-21 추가,
   `ReinsurancePool` 연동 펀드와 같은 패턴)을 재사용해 "크립토 인덱스 연동형" 펀드로 등록.
3. **챗봇 개인 자산 조회 허브** — 고객이 본인 업비트 API 키(read-only 권한)를 챗봇에
   등록하면 보험자산 + 코인자산을 한 화면에서 조회. 보험사는 매매에 관여하지 않으므로
   투자자문 이슈 없음. `get_blockchain_dental_status`의 지갑주소 등록 패턴
   (`InsuranceChatbot.wallet_address`, `/api/blockchain/wallet`)과 유사하게 세션별
   업비트 API 키 등록 라우트를 신설하는 방향으로 예상.

**다음 세션에서 이어갈 때**: (1) 아직 `auto_upbit`의 미해결 버그 상태가 그대로인지
그 저장소의 최신 `CLAUDE.md`로 재확인, (2) 사용자에게 1~3 중 어느 것부터 시작할지
물어보고, (3) 1번(내부 준비금 운용)부터 하는 게 리스크가 가장 낮아 자연스러운 시작점
— 다만 사용자가 이미 순서를 정했다면 그걸 따를 것. 세 방향 다 아직 설계 확정 전 단계라,
시작 전에 다시 한번 구체적 구현 방식(특히 Python 프로세스 간 통신 방식 — 같은
Flask 프로세스에 넣을지 별도 브릿지로 뺄지)을 사용자와 확인할 것.

**(같은 날 후속 논의, 2026-09-23) 범위 확장 결정 — 법규 검토는 보류, "개인별 투자자문 +
자동매매"까지 포함하기로 함**: 사용자가 "법규 사항은 나중에 검토 후 기능을 분리하면
되니, 캡스톤 목적으로 다양한 기능을 넣고 싶다"고 명시적으로 범위를 넓힘 — 위 3방향 중
2번(신규 고객상품)·3번(개인 자산 허브)을 합친 것에 더 가까운, 고객별 리스크 프로파일에
따라 실제 자동매매까지 걸어주는 "개인별 투자자문" 기능을 추가로 요청함. **규제/겸영
문제는 나중에 별도로 검토해서 기능을 분리하기로 미뤄둔 것이지, 없던 일이 된 게
아님** — 나중에 이 기능을 실제로 손볼 때 다시 꺼내지 말라는 뜻이 아니라, 지금은
캡스톤 데모 구현에 집중하되 이 사실 자체를 잊지 말 것.

이 요청에 맞춰 `auto_upbit`의 실제 코드(`trade_bot.py`, `app.py`)를 받아 기술 검토한
결과:
- **`TradingBot(config_data)`는 이미 멀티인스턴스 가능한 구조** — API 키·티커·전략
  가중치를 전부 생성자 인자로 받고, 포지션/거래횟수 등 상태도 전역이 아니라 인스턴스
  변수(`self.positions`, `self.daily_trade_count` 등)로만 들고 있음. **진짜 병목은
  `app.py`** — `st.session_state.bot`에 봇 하나만 넣고 `time.sleep`+`st.rerun()`으로
  "브라우저 탭이 열려있는 동안만" 도는 1인용 루프라는 점. 고객별 자동매매는 Streamlit
  앱 복제가 아니라, 이 루프를 헤드리스 스케줄러로 빼서 고객별 `TradingBot` 인스턴스를
  순회하면 됨(`blockchain-dental/scripts/premium-scheduler.js`와 같은 패턴을 Python으로).
- **개인별 투자자문**: `STRATEGY_WEIGHTS_BY_COIN`이 이미 코인별 오버라이드를 지원하므로
  "고객 리스크 티어"(안정추구/중립/공격투자 3단계 정도) 차원만 추가하면 됨. 진단은
  `health_risk_tool.py`의 "질문→점수→등급" 패턴 재사용(`crypto_risk_tool.py` 신설).
  신규 챗봇 도구: `assess_crypto_investment_profile`(진단), `get_personal_trading_status`
  (`get_blockchain_dental_status`와 동일한 읽기전용 패턴).
- **자동매매 연동 시 반영 필요**: (1) `auto_upbit` 자체 미해결 버그 #7(재시작 시
  손절/익절가 초기화)이 무인·다중고객 환경에서는 훨씬 위험해지므로 **고객별 포지션 상태
  영속화가 멀티테넌트화보다 선행되어야 함**. (2) 일일 손실 % 서킷브레이커(현재는 횟수
  상한만 있고 손실액 상한 없음). (3) 고객별 킬스위치. (4) 매매 알림은 새 스택 만들지
  말고 기존 `email-service.js`/Slack 웹훅 재사용. (5) 고객 API 키 저장은
  `relay_wallets.json`과 동일한 "데모 전용 평문 저장" 트레이드오프 패턴.
- **레포 구조 제안**: `insurance_agent/`, `blockchain-dental/`처럼 `auto_upbit`도
  캡스톤 안에 `crypto_trading/`으로 복사해 세 번째 컴포넌트로 둘 것.
- **데모 안전장치**: 버그 수정 전까지는 `DRY_RUN`(모의매매) 모드로 먼저 붙이는 걸
  제안 — 파라메트릭 보험 오라클이 처음에 결정론적 시뮬레이션으로 시작했던 것과 같은 방식.

**결정된 시작점 (2026-09-23) — 다음 세션에서 여기부터**: "상태 영속화 + DRY_RUN
스케줄러"부터 진행하기로 확정. **단, 사용자가 두 번 강조한 정확한 요구사항: 계좌/포지션
조회(잔고, 현재가, 평가손익 등)는 실제 업비트 데이터로 동작해야 하고, 오직 실제
주문(매수/매도 체결)만 일어나지 않도록 막을 것** — "조회까지 막는 시뮬레이션"이
아니라 "조회는 진짜, 주문만 억제"라는 뜻이므로 구현 시 헷갈리지 말 것(예:
`pyupbit.Upbit(access, secret)`로 실제 연결·잔고 조회는 그대로 하되,
`buy_market_order`/`sell_market_order` 등 주문 함수 호출부만 DRY_RUN 플래그로
가드해 로그만 남기고 실제 API 호출은 생략하는 방식이 적합해 보임 — 실제 구현 시
`trade_bot.py`에서 주문 함수가 정확히 어디 몇 곳에서 호출되는지부터 확인할 것,
이번 세션엔 위치까지는 확인 안 했음). 이후 순서는: ② 챗봇 투자자문(진단) 도구 →
③ `crypto_trading/` 레포 복사 + 기본 배선. **이번 세션엔 이 중 아무것도 구현하지
않았음 — 순수 검토·계획 기록만 완료한 상태.**

**사업 서사 정리 (2026-09-24)**: 규제 이질성(투자자문업 겸영)은 "지금은 포함해 확장
가능성으로 열어두고, 필요해지면 별도 법인/라이선스로 분리"하는 쪽으로 정리하고, 오히려
"국내 손보사가 아직 진입하지 않은 블루오션"으로 긍정 프레이밍하기로 확정(사용자 결정).
실제로 국내외 보험업계가 최근 스테이블코인 연계 사업으로 확대 중인 흐름(교보생명·EQBR
원화 스테이블코인 보험료 PoC, Ripple×교보생명 파트너십, Aon의 USDC·PYUSD 보험료 결제
PoC — 전부 2026년)과 같은 방향이라는 근거를 `인슈어체인_전략맵.html`(Slide 7 신규 추가)과
`인슈어체인 사업계획서.docx`(신규 섹션 "가상자산·스테이블코인 연계 확장 — 블루오션
신사업")에 반영함. 두 문서 모두 기존 리스크 섹션(자본시장법·VASP 대응)과 모순되지 않도록
"규제 대응은 그대로 적용하되 사업 자체를 막지 않는다"는 톤으로 연결해둠 — docx는
LibreOffice/pandoc이 이 머신에 없어 렌더링 검증을 못 했으므로(기존에 알려진 제약과 동일),
Word로 직접 열어 페이지 배치·표 렌더링을 확인할 것.

**①단계 구현 (2026-09-24) — 상태 영속화 + DRY_RUN 스케줄러**: auto_upbit(`C:\test_auto_upbit`)
코드를 `crypto_trading/`으로 복사(설계 원칙: 대체투자·B2B API 등 기존 5~6종 확장과 동일하게
"기존 인프라 재사용" 계보를 따르되, 이번엔 언어가 Python으로 같아 blockchain_bridge.py류의
subprocess+JSON 브릿지가 아니라 `health_risk_tool.py`류의 직접 파일 접근이 자연스럽다고 판단
— `get_personal_trading_status` 등 챗봇 조회 도구를 붙일 ②단계에서 실제로 이 패턴을 씀).
`config.json`/`Key.txt`/`trade_history.json`은 복사하지 않음(실제 API 키 유출 방지 —
`config.example.json`만 복사, `.gitignore`도 새로 작성).
  - **DRY_RUN 가드**: `trade_bot.py`의 실제 주문 호출은 정확히 4곳(638→713, 702→777,
    1174→1249 매수, 1257→1332, 코드 복사 후 줄번호 이동됨)이었음 — 이 4곳을 전부
    `_place_buy_order`/`_place_sell_order` 헬퍼로 교체하고, `DRY_RUN=True`(기본값,
    `config.example.json`/`DEFAULT_CONFIG`에 추가)면 실제 `pyupbit` 주문 API를 호출하지
    않고 로그만 남기도록 함. **사용자가 두 번 강조한 요구사항대로 잔고·현재가·평가손익
    조회 경로는 전혀 건드리지 않음** — `get_balance`, `_initialize_state_from_upbit`
    등은 그대로 실제 업비트 데이터를 씀.
  - **재시작 시 리스크관리 상태 초기화 버그(auto_upbit CLAUDE.md 🟠 #7) 완화**:
    `stop_loss_price`/`target_price`/`highest_price`/`buy_time` 4개 필드만
    `data/positions_state_<bot_id>.json`(신규, `.gitignore` 대상)에 별도 저장했다가
    `_initialize_state_from_upbit()` 끝에서 복원(`_load_risk_state`) — 단, 실제로 그
    티커를 보유 중일 때만 덮어쓰고, 이미 청산된 티커의 옛 손절가는 되살리지 않음.
    `total_volume`/`average_buy_price`는 원래대로 매번 실제 업비트 잔고에서 복원(변경 없음).
    저장은 `trade_bot.py` 내부 여러 return 지점을 일일이 쫓지 않고, `scheduler.py`가
    매 사이클(60초) 끝에 한 번씩 `bot._save_risk_state()`를 호출하는 방식으로 단순화
    — 최악의 경우도 최근 60초 분만 유실.
  - **`scheduler.py`(신규)**: `app.py`의 Streamlit 루프(브라우저 탭이 열려 있어야만 동작)를
    대체하는 헤드리스 콘솔 루프. `TradingBot.run_once()`를 60초 간격으로 호출, 사이클 중
    예외가 나도 스케줄러 프로세스 자체는 죽지 않고 다음 사이클을 계속 시도(auto_upbit에
    남아있는 미해결 버그들을 이번 단계에서 고치지 않았으므로 이 방어가 특히 중요).
    ⚠️ **Windows cp949 이모지 크래시 대응**: `trade_bot.py`에는 이모지 섞인 `print()`가
    다수 있는데(원본 프로젝트는 Streamlit 안에서 실행돼 문제 없었음), 이 스크립트는 새
    콘솔 프로세스로 직접 뜨므로 `web_app.py`가 이미 겪었던 것과 같은
    `UnicodeEncodeError` 위험이 있음 — 이모지를 일일이 걷어내는 대신 스크립트 최상단에서
    `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`로 프로세스 인코딩 자체를
    바꿔 원천 차단(실제로 이모지 출력 테스트해 정상 동작 확인함).
  - **`insurance_agent/crypto_bridge.py`(신규)**: `blockchain_bridge.py`와 같은 목적
    (psutil로 실제 살아있는 프로세스 확인 → 죽은 것만 재기동하는 idempotent 패턴)을
    `crypto_trading/scheduler.py` 하나에 대해 수행. Hardhat 노드 기동·컨트랙트 배포 같은
    선행 단계가 없어 훨씬 단순함.
  - **검증**: `config.json` 없이(빈 `config.example.json`을 임시로 `config.json`으로 복사)
    `python scheduler.py` 실행 → 업비트 미연결을 정상 감지하고 크래시 없이 깔끔하게 종료하는
    것을 직접 실행해 확인. 실제 API 키로 업비트 연결·실제 조회·DRY_RUN 매수/매도 로그가
    나오는지는 **아직 실제 키로 테스트하지 않음** — 다음 세션에서 실제 Upbit API 키(읽기+거래
    권한, 단 DRY_RUN이 켜져 있으므로 거래 권한이 있어도 실제 주문은 나가지 않음)로 최소 1
    사이클 이상 돌려서 확인할 것.

**②단계 구현 (2026-09-24, 같은 세션에서 이어서 진행) — web_app.py 라우트 연결 + 챗봇 진단 도구**:
  - **`web_app.py`에 `/api/crypto/reserve/start`(POST)·`/api/crypto/reserve/status`(GET)
    라우트 추가** — `/api/blockchain/dental/enroll`·`/status`와 정확히 동일한 패턴.
    `crypto_bridge.py`에도 `blockchain_bridge.start_enrollment_async()`와 동일한
    `_IN_PROGRESS_STATES` 가드 + 백그라운드 스레드 기동 패턴(`start_scheduler_async()`)을
    추가해 맞춤. 단, 이 준비금 운용 봇은 고객이 누르는 "가입 버튼"이 없는 내부 운용
    기능이라 프론트엔드에 트리거 버튼은 아직 안 붙임(관리자가 필요 시 라우트를 직접
    호출하거나, 조회 도구가 스냅샷이 없다고 답하면 관리자가 그때 기동하는 흐름을 상정).
  - **`crypto_trading/scheduler.py`에 상태 스냅샷 저장 추가**: `run_once()`는 티커를
    라운드로빈으로 한 사이클에 하나씩만 처리하므로, 전 종목의 "지금" 잔고·시세를 보려면
    사이클과 별개로 전 종목을 다시 조회해야 함 — `_build_and_save_status_snapshot()`이
    `pyupbit.get_current_price()`(인증 불필요한 순수 조회 API)로 시세를, `bot.get_balance()`로
    잔고를 실제 데이터 그대로 가져와 `data/status_snapshot_<bot_id>.json`에 매 사이클(+시작
    시 1회) 저장. **여기서도 "조회는 실제, 주문만 억제" 원칙을 그대로 지킴.**
  - **`insurance_agent/tools/crypto_reserve_tool.py`(신규) — `get_crypto_reserve_status`**:
    위 스냅샷 파일을 직접 읽는 in-process 도구. `blockchain_tool.py`는 blockchain-dental이
    Node.js 스택이라 subprocess+JSON 브릿지가 필요했지만, crypto_trading은 이미 같은
    Python이라 그 장벽이 없어 `health_risk_tool.py`처럼 파일을 바로 읽는 쪽을 택함(지난
    세션에 "자연스러운 연결" 검토에서 이미 이렇게 정리했던 방향 그대로). 지갑 주소가
    필요 없음(고객 개인 자산이 아니라 회사 준비금 계좌 단일 현황 조회이므로) — 3방향 중
    A(준비금 운용)만 실제로 백엔드가 존재한다는 점을 도구 설명·시스템 프롬프트 양쪽에
    명시. 스냅샷이 5분 이상 오래됐으면 `stale: true` + 경고 문구를 함께 반환해 "스케줄러가
    꺼져 있을 수 있음"을 GPT가 사용자에게 안내하도록 함(`get_blockchain_dental_status`가
    스택 미기동 시 안내하는 것과 같은 의도, 구현 방식만 다름).
  - **`insurance_agent/tools/crypto_risk_tool.py`(신규) — `assess_crypto_investment_profile`**:
    `health_risk_tool.py`(로지스틱 회귀 모델)가 아니라 `health_credit_tool.py`의 단순
    점수제 가중합(질문별 배점 → 합산 → 등급) 패턴을 재사용 — 투자기간·손실감수·투자경험·
    소득안정성 4개 항목을 100점 만점으로 합산해 안정추구형/중립형/공격투자형 3단계로
    분류. **참고용 진단만 제공하고 실제 자동매매에 연결되어 있지 않다는 `important_disclaimer`
    를 도구 결과·시스템 프롬프트 양쪽에 명시** — 3방향 중 B/C(개인별 자동매매)는 아직
    구현되지 않았으므로, 등급만 알려주고 실제로 그렇게 운용 중인 것처럼 오해하게 두면 안 됨.
  - **`agents/orchestrator.py`에 두 도구 등록**: import → `TOOLS` 스키마 2개 추가 → 실행
    디스패치 2개 추가 → 도구 선택 가이드/출처 매핑 표에 반영 → 기존 "블록체인 조회에는
    뉴스 안 붙임" 로직(`used_blockchain_tool` 플래그, 4곳)에 `get_crypto_reserve_status`도
    포함시킴(실시간 데이터 조회라는 성격이 같으므로 — `assess_crypto_investment_profile`은
    진단/상담성 답변이라 이 목록에는 넣지 않음, 뉴스가 붙어도 무방).
  - **⚠️ 작업 중 발견한 별개의 심각한 기존 버그를 같이 수정함**: `tools/gasless_enrollment_tool.py`
    가 `import relay_wallet`(bare)로 되어 있었는데, `relay_wallet.py`는 `tools/` 폴더
    안에 있어서 이 import가 항상 `ModuleNotFoundError`로 실패 — `agents/orchestrator.py`가
    모듈 로드 시점에 이 파일을 import하므로 **오케스트레이터 전체, 즉 챗봇 백엔드 자체가
    아예 뜨지 못하는 상태**였음. `git stash`로 확인한 결과 가스리스 온보딩을 추가한
    **c03dd80 커밋(2026-09-21)부터 계속 이 상태**였던 것으로 보임(그 뒤 커밋들도 같은
    파일을 건드리지 않음). `from tools import relay_wallet`로 수정하고
    `python -c "import web_app"` 로 실제 임포트가 끝까지 성공하는 것과 라우트 27개가
    전부 등록되는 것을 확인함. **다음에 실제로 `python web_app.py`를 띄워서 브라우저로
    한 번 정상 동작을 확인해볼 것** — 이번 세션엔 import 성공까지만 확인했고 실제 서버
    기동·브라우저 클릭 테스트는 안 함.
  - **다음에 이어갈 것**: (1) ~~실제 API 키로 스케줄러 1사이클 이상 실측 검증~~ **완료**,
    (2) ~~실제 챗봇 대화창에서 두 도구 호출 확인~~ **완료(아래 참고)**, (3) auto_upbit
    자체의 미해결 버그(🟠 #6/#8/#9, 특히 #6 "물타기 직후 같은 사이클에 매도 로직 통과
    가능")는 이번 단계에서 손대지 않았으므로 실제 자금 연결 전에는 반드시 재검토, (4) 3방향
    중 B/C(개인별 자동매매)는 여전히 미착수 — `assess_crypto_investment_profile`은
    진단만 하는 상태.

**실제 챗봇 대화 테스트 완료 (2026-09-24, 같은 세션)**: `python web_app.py` 실기동 후
`/api/chat`(Live 모드, 실제 GPT-4o)로 두 질문을 실제로 보내 검증함.
  - "회사 준비금으로 코인 자동매매 하고 있다는데 지금 수익 나고 있어? 실주문도
    나가고 있어?" → GPT가 스스로 `get_crypto_reserve_status`를 호출, DRY_RUN 여부·
    4개 종목(BTC/SOL/XRP/ETH) 손익을 하나도 빠뜨리지 않고 전부 보고, 스냅샷이 5분
    이상 지나 스케줄러가 꺼졌을 수 있다는 경고까지 정확히 포함. 출처표에도
    "업비트 실시간 조회 (준비금 자동매매) ★★★★★"가 정확히 붙었고, 무관한 보험
    뉴스 섹션은 붙지 않음(뉴스스킵 로직 정상 작동).
  - "32살, 코인 투자 경험 좀 있음, 5년 장기, 손실 어느 정도 감수 가능, 월 20만원
    투자 가능 — 나한테 맞는 투자성향 진단해줘" → GPT가 나이·투자기간·경험·투자금을
    자연어에서 정확히 추출해 `assess_crypto_investment_profile` 호출, 78점(공격투자형)
    산출 + 점수 세부내역 투명 공개 + "참고용일 뿐 실제 자동매매 연결 없음" 고지까지
    정확히 포함.
  - 두 테스트 다 첫 시도부터 의도한 대로 동작 — 추가 수정 없이 통과.

**실제 API 키 실측 검증 완료 (2026-09-24, 같은 세션)**: 사용자가 `C:\test_auto_upbit\config.json`
(실제 업비트 키가 든 기존 개인 설정)을 `crypto_trading/config.json`으로 복사해달라고
요청 → 실제로 복사 후 `python scheduler.py`를 실제 키로 두 번(합계 약 3분) 실행해 검증함.
  - **실제 계정 연결 성공** — BTC 0.00611176 / ETH 0.12363554 / XRP 170.2557037 /
    SOL 1.90967854, KRW 43,249원 등 실제 보유 잔고·평단가를 정확히 불러옴.
  - **DRY_RUN=True 정상 작동** — 로그에 `DRY_RUN = True` 명시, 실제 매수/매도 신호가
    관측되는 사이클도 있었지만(RSI/MACD/Supertrend 등 실제 지표 기반) 임계치 미달로
    실제 주문 자체는 없었음(주문이 있었어도 `_place_*_order`가 막았을 것).
  - **재시작 시 리스크관리 상태 복원 버그(auto_upbit 🟠 #7) 수정 실제 검증** — 1차 실행이
    `data/positions_state_default.json`을 남긴 뒤 2차 실행(새 프로세스)에서 4개 종목
    전부 "🔄 리스크관리 상태 복원 완료" 로그와 함께 정상 복원되는 것을 확인.
  - **`get_crypto_reserve_status()` 종단 검증** — 스케줄러가 남긴
    `data/status_snapshot_default.json`(실제 잔고·현재가·평가손익)을 챗봇 도구가 그대로
    읽어 `ok: true, stale: false`로 반환하는 것까지 확인.
  - **⚠️ 검증 중 발견한 `.gitignore` 누락 수정**: `crypto_trading/.gitignore`에
    `positions_state_*.json`만 넣고 `status_snapshot_*.json`을 빠뜨려서, `git add`를
    시뮬레이션(`git add -n`)해보니 **실제 잔고·평가손익이 든 스냅샷 파일이 커밋 대상에
    잡히는 것**을 발견 → 패턴 추가로 수정, 이후 재확인해 두 상태 파일 모두 제외되는 것
    확인함. (API 키만큼 민감하진 않지만 개인 자산 데이터라 공개 저장소에 올라가면 안 됨.)
  - 검증 후 스케줄러 프로세스는 종료했고, `crypto_trading/config.json`은 사용자 요청대로
    로컬에 그대로 남겨둠(`.gitignore` 대상이라 커밋되지 않음, 기존 `auto_upbit`과 동일한
    "로컬 단독 사용 확인됨 → 로테이션 불필요" 정책 그대로 적용).

### ③단계 — auto_upbit 미해결 버그 수정 + 개인별 자동매매(승인 게이트) 구현 (2026-09-24)

PR #2(`claude/crypto-reserve-integration`)에서 이어서, "auto_upbit 미해결 버그 3개
수정"과 "3방향 중 B/C(개인별 자동매매)" 둘 다 같은 세션에서 구현. **사용자가 중간에
"개인별 자동매매는 사용자의 승인으로 변경해달라"고 명시적으로 요구** — 등록만으로는
페이퍼(DRY_RUN) 상태 유지, 실거래는 고객 본인의 별도 명시적 승인이 있어야만 켜지는
구조로 설계함(아래 상세).

**auto_upbit 🟠 #6/#8/#9 수정** (`crypto_trading/trade_bot.py`, `config.py`,
`config.example.json`, 그리고 사용자의 실제 `config.json`까지 3곳 전부):
- **#9 (매수 수량 수수료 미반영)**: `buy_volume = buy_amount_krw / price`를
  `(buy_amount_krw * (1 - FEE_FACTOR)) / price`로 수정. `use_atr_sltp=False`면 기존
  `fee_factor` 지역변수가 아예 정의되지 않는 스코프 문제가 있어 새로 `self.config.get()`
  으로 읽음.
- **#8 (동적 가중치 조정 키 불일치)**: `DYNAMIC_WEIGHT_ADJUSTMENT.trend_strength_multipliers`
  의 `ADX_BUY_SCORE`/`ADX_SELL_SCORE`(존재하지 않는 키, 실제는 `ADX_TREND_SCORE` 하나)와
  `SUPERTREND_BUY_SCORE`(밑줄 없음, 실제는 `SUPER_TREND_BUY_SCORE`)를 실제 cfg_w 키
  이름으로 수정. `EMA_TREND_SCORE`는 애초에 cfg_w가 아니라 `self.config` 최상위의
  `EMA_TREND_SCORE_WEIGHT`라는 별개 메커니즘이라 조정 불가능한 키였으므로 제거(이걸
  실제로 동적 조정하려면 `_apply_dynamic_weight_adjustments` 자체를 확장하는 별도
  작업 필요 — 지금은 안 함). **사용자의 실제 운용 중인 `config.json`도 같은 버그를
  갖고 있어서 API 키 등 나머지는 그대로 두고 이 섹션만 패치**(파이썬 json 로드/수정/
  저장, 값 노출 없이).
- **#6 (물타기 직후 같은 사이클 매도 통과)**: 매수 실행 블록 끝에 `return`을 추가해
  같은 `run_once()` 호출 안에서 "5-2. 점수 기반 매도" 섹션으로 넘어가지 못하게 함.
  원인은 두 가지였음: (1) 물타기(추가 매수)는 `self.positions[ticker]`를 새 dict로
  안 바꾸고 그대로 mutate하는데, `buy_time`만 갱신 안 해서 `MIN_HOLD_HOURS`/
  `BUY_PROTECTION_HOURS` 보호기간이 무력화됨. (2) 매도가 실제로 체결되면 방금 만든
  매수 `trade_result`가 매도 `trade_result`로 덮어써져 매수 체결 기록이 거래내역에서
  사라짐. `return`으로 원천 차단 — 다음 라운드로빈 주기(다른 티커들 처리 후 최대
  수 분 뒤)에 최신 상태로 정상적인 매도 판단을 받으므로 실질적 손실은 없음.
- **실행 검증**: 세 수정 다 반영한 상태로 실제 API 키로 스케줄러를 다시 돌려 크래시
  없음을 확인(수정 전 마지막 검증과 동일한 실계정으로 재확인).

**개인별 자동매매 구현 — 등록/승인 분리**:
- **`crypto_trading/config.py`에 `RISK_TIER_PRESETS`/`DEFAULT_RISK_TIER` 신규** —
  `insurance_agent/tools/crypto_risk_tool.py`의 3단계 등급과 반드시 같은 값을
  유지해야 함(두 프로젝트 폴더가 별도 프로세스라 import 공유 불가 — 값 자체를
  중복 정의, 파일 양쪽에 "같이 고칠 것" 주석 남김).
- **⚠️ 멀티테넌트 도입 전 발견한 별개의 심각한 버그를 먼저 고침**: `trade_bot.py`의
  `run_once()`가 매번 무조건 `config.load_config()`(전역 `config.json` 하나만 읽는
  모듈 싱글톤 캐시)로 `self.config`를 통째로 교체하고 있었음 — 이대로 개인별 봇을
  여러 개 띄우면 첫 `run_once()` 호출 즉시 **모든 개인별 봇의 API 키·티커·DRY_RUN이
  회사 준비금 봇의 config.json 값으로 조용히 덮어써지는** 심각한 사고가 날 뻔했음.
  `if self.bot_id == "default":` 가드를 추가해 이 재로드를 회사 준비금 봇 하나로만
  제한(기존 "default" 하나만 있던 시절 동작은 완전히 그대로 유지).
- **`crypto_trading/scheduler.py` 멀티테넌트화**: 매 사이클 `data/personal_bots.json`을
  다시 읽어(재시작 없이 신규 등록·승인 변경 즉시 반영) 등록된 개인별 봇마다
  `TradingBot` 인스턴스를 만들고(최초 1회만 연결, 이후엔 캐시 재사용), 승인 플래그만
  매 사이클 최신값으로 덮어씀. 개인별 config는 `copy.deepcopy(DEFAULT_CONFIG)` 기반
  (config.py 자체에 이미 기록돼 있던 "얕은 복사 시 중첩 dict 오염 가능" 이슈가 여러
  봇을 동시에 만드는 지금 처음으로 실제 위험이 되므로 깊은 복사로 회피). 한 봇의
  예외/정지 조건이 다른 봇이나 회사 준비금 봇에 전혀 영향 없음(각각 독립적으로
  try/except, 정지되면 그 봇만 목록에서 제거).
- **안전장치 — 승인 분리** (사용자 요구사항): `insurance_agent/crypto_bridge.py`의
  `register_personal_bot()`은 항상 `approved: false`로 시작/리셋. `approved: true`로
  바꿀 수 있는 함수는 `approve_personal_bot()` 하나뿐이고, 이건 챗봇 도구가 아니라
  `web_app.py`의 `/api/crypto/personal/approve` 라우트(고객 본인의 명시적 버튼 클릭 +
  체크박스 확인 + `confirm: true` 필수)에서만 호출됨. **`agents/orchestrator.py`의
  `TOOLS`에는 승인을 켜는 도구를 절대 추가하지 않음** — 대화만으로 실거래가 켜지는
  경로 자체를 없앰. `/api/crypto/personal/revoke`로 언제든 다시 페이퍼로 되돌릴 수
  있음(승인 취소는 confirm 불필요, 안전한 방향이므로).
- **신규 라우트 4개**: `/api/crypto/personal/register`(POST), `/approve`(POST,
  confirm 필수), `/revoke`(POST), `/status`(GET) — `wallet_address`와 동일하게
  `sessions[sid]` in-memory 딕셔너리에 `crypto_personal_bot_id`를 저장하는 패턴
  재사용(Flask 쿠키 세션이 아니라 이 앱 자체의 클라이언트 생성 `SESSION_ID` 기준).
- **신규 챗봇 도구 `get_personal_trading_status`**: 새 함수를 만들지 않고 기존
  `get_crypto_reserve_status(bot_id=...)`를 세션에 등록된 개인 bot_id로 그대로 호출 —
  스냅샷 형식이 봇 종류와 무관하게 동일해서 가능했음(애초에 `get_crypto_reserve_status`
  를 설계할 때 `bot_id`를 매개변수로 열어둔 덕). `assess_crypto_investment_profile`의
  안내 문구도 "아직 준비 중"에서 "화면 패널에서 직접 등록 + 별도 승인 필요"로 갱신.
- **프론트엔드**: 기존 "⛓️ 블록체인 실시간 조회" `<details>` 패널과 동일한 스타일로
  "🪙 개인별 가상자산 자동매매" 패널 신규 — API 키 입력(Secret은 password 타입) +
  리스크 등급 선택 + 등록 버튼(페이퍼 모드로만 등록됨을 명시) + **별도로 분리된**
  체크박스("실제 제 돈으로 자동 주문이 나갈 수 있음을 이해했습니다") + 빨간색
  "⚠️ 실거래 승인" 버튼 + "승인 취소" 버튼.
- **`data/personal_bots.json`을 `.gitignore`에 추가** — 고객 API 키가 평문으로 들어감
  (`relay_wallets.json`/`partner_api_keys.json`과 동일한 "데모 전용 평문 저장" 트레이드오프).
- **실제 검증**: 실제 Flask 서버로 등록 → 승인거부(confirm 없이, 정상 실패) → 승인
  (confirm=true, 성공) → 상태 조회(approved:true 반영) → 취소(approved:false로 복귀)
  전체 라이프사이클을 curl로 실행해 확인. 실제 챗봇 대화로 "내 개인 자동매매 현황
  알려줘" → `get_personal_trading_status`가 세션의 bot_id를 정확히 resolve해 "스케줄러가
  아직 이 봇을 처리하지 않았다"를 정확히 답변하는 것도 확인. 더미(가짜) API 키로
  등록한 개인별 봇을 스케줄러가 실제로 집어 들어(hot-reload) 독립된 인스턴스로
  처리하는 것도 실행 로그로 확인 — 가짜 키라 업비트 인증은 실패했지만(RemainingReqParsingError,
  trade_bot.py의 기존 예외처리로 정상 흡수) **회사 준비금 봇의 실제 잔고/설정에는
  전혀 영향이 없었음**(멀티테넌트 격리, 그리고 위 config 공유 버그 수정이 실제로
  작동함을 함께 증명). 테스트에 쓴 더미 등록 정보는 검증 후 삭제함.
- **아직 안 한 것**: 실제 두 번째 업비트 계정으로 개인별 봇의 진짜 승인→실거래
  전체 경로를 끝까지 테스트하지 않음(실계좌가 하나뿐이라 더미 키로 격리성만
  검증). 리스크 등급 변경(재등록) 시 이미 떠 있는 봇 인스턴스의 TICKERS 등을
  갱신하려면 스케줄러가 그 bot_id를 캐시에서 지우고 재생성해야 하는데, 지금은
  최초 연결 이후 승인 플래그만 갱신하고 나머지(등급/티커)는 재연결 전까지 고정임
  — 필요해지면 "등급이 바뀌면 인스턴스를 버리고 새로 만든다" 로직 추가할 것.

### ④단계 — 매수/매도 Slack 승인 플로우 (2026-09-24)

사용자 요청: "자동 매매를 진행하고, 매수 매도 타이밍에 나에게 슬랙으로 묻고, 슬랙에서
승인하면 매매가 진행되도록 수정해줘". ③단계까지의 "등록 시 항상 페이퍼, 별도 승인
버튼으로만 실거래 on/off"라는 **큰 스위치** 위에, 이번엔 **매수/매도 신호가 뜰 때마다
매번** Slack으로 승인을 구하는 **개별 거래 단위** 게이트를 추가함 — 두 안전장치는
서로 배타적이지 않고 겹쳐서 적용됨(둘 다 통과해야 실제 체결).

**아키텍처**: crypto_trading(Python, 요청 생성)과 insurance_agent(Flask, 버튼 클릭
수신)가 서로 다른 프로세스라 `data/pending_trades.json` 파일을 매개로 통신 —
`personal_bots.json`과 동일한 패턴.
- `crypto_trading/slack_notify.py`(신규): `request_trade_approval()`이 pending
  레코드를 저장하고 Slack Block Kit 버튼 메시지(✅ 승인 / ❌ 거절, `value`에
  `<bot_id>:<ticker>` 키)를 `SLACK_WEBHOOK_URL`로 전송. `get_pending_for_ticker()`는
  만료 시각을 넘긴 pending을 "expired"로 승격해 반환.
- `trade_bot.py`: `_place_buy_order`/`_place_sell_order`가 이제 **bool을 반환** —
  DRY_RUN이면 True(기존과 동일), `SLACK_APPROVAL_REQUIRED=True`(기본값) +
  DRY_RUN=False면 새 요청만 만들고 False 반환(아직 미체결). 호출부(매수 블록 1곳,
  매도 블록 3곳) 전부 반환값을 확인해 False면 포지션 갱신 없이 그대로 반환하도록 수정.
  **승인 결과 반영은 이 반환값 체크가 아니라 `run_once()` 최상단의 별도 블록**이
  담당 — 매수/분석매도 신호는 `is_new_candle`(캔들 경계, 길게는 몇 시간)에서만
  재평가되는데, 승인 확인을 그 안에 두면 방금 Slack에서 눌러도 반영이 다음 새
  캔들까지 늦어질 수 있어서, candle 여부와 무관하게 그 티커의 라운드로빈 순번마다
  (최대 [티커 개수]×60초 간격) 확인하도록 위치를 분리함. 승인되면 `_apply_approved_trade()`
  (신규 메서드, 체결 시점 현재가로 재조회해 포지션 반영 — 신호 탐지 시점 인라인
  로직과는 별도 경로)가 실행, 거절/만료면 조용히 취소하고 Slack에 결과를 알림.
- `insurance_agent/web_app.py`의 `/api/slack/interactive`(신규): Slack Interactivity
  콜백 수신(`_verify_slack_signature` 재사용, 기존 `/api/slack/commands`와 서명
  검증 공유). `crypto_bridge.resolve_pending_trade()`로 결정만 기록하고(3초 응답
  제한 안에 끝나야 함) 실제 체결은 scheduler.py가 다음 사이클에 처리 — `response_url`로
  원본 메시지를 결과 텍스트로 교체(버튼 중복 클릭 방지).
- 스냅샷(`scheduler.py`)에 `slack_approval_required`, 종목별 `pending_slack_approval`
  필드 추가 — 챗봇이 "지금 승인 대기 중"을 실시간으로 답할 수 있음(orchestrator.py
  가이드도 갱신).
- **설정**: `crypto_trading/config.py`에 `SLACK_APPROVAL_REQUIRED`(기본 True),
  `SLACK_WEBHOOK_URL`(기본 ""), `SLACK_APPROVAL_TIMEOUT_SEC`(기본 600초=10분) 추가.
  **`SLACK_WEBHOOK_URL`이 비어 있거나 Slack App의 Interactivity가 설정 안 돼 있어도
  안전한 방향으로만 실패한다** — 요청이 콘솔 로그+pending_trades.json에만 남고
  결국 타임아웃으로 자동 취소될 뿐, "승인 없이 그냥 체결"되는 경로는 존재하지 않음.
  `data/pending_trades.json`은 거래 세부내역이 담겨 `.gitignore` 추가.

**실제 반영된 설정**: `crypto_trading/config.json`(사용자의 실제 준비금 봇 설정)의
`SLACK_WEBHOOK_URL`을 `blockchain-dental/.env`의 기존 실제 웹훅(이미 검증되어
동작 중인 값)으로 채움 — 새 Slack App을 만들 필요 없이 그대로 재사용. `SLACK_APPROVAL_REQUIRED`
/`SLACK_APPROVAL_TIMEOUT_SEC`도 기본값으로 채움.

**⚠️ 하지 않은 것 — Claude Code 자체 안전장치가 차단함**: `config.json`의
`DRY_RUN`을 `False`로 바꾸는 시도는 "Claude Code auto mode classifier"가 위험한
작업으로 판단해 차단함(승인 사유 미공개). 다른 도구/우회 방법을 시도하지 않고
그대로 받아들임 — **사용자가 직접 `crypto_trading/config.json`의 `"DRY_RUN": true`를
`false`로 바꿔야 실제로 이 기능이 켜진다**(한 줄 수정). 이 자체가 안전장치로도
적절해 보임 — 실거래 on/off는 사람이 마지막에 직접 눌러야 하는 스위치로 남기는 게
맞다고 판단, 다시 시도하지 않기로 함.

**검증**: 실제 `config.json`을 전혀 건드리지 않는 격리된 테스트로 검증 —
(1) 메모리상의 가짜 config(`DRY_RUN=False`, `SLACK_APPROVAL_REQUIRED=True`,
`upbit=None`)로 `_place_buy_order`를 직접 호출해 pending 요청 생성 + `upbit` 호출
없이 False 반환 확인. (2) 더미 API 키로 만든 실제 `TradingBot` 인스턴스에 pending
레코드를 직접 심고 `run_once()`를 실행해, 최상단 분기가 정확히 "Slack 승인 대기
중" 메시지로 조기 반환하는 것을 실제 함수 호출 경로로 확인(신호 재평가·추가 API
호출 없음). 실제 Slack 메시지 왕복(버튼 클릭 → `/api/slack/interactive` → 체결)은
Interactivity Request URL이 아직 등록되지 않아 이번 세션엔 끝까지 확인 못함.

**다음에 이어갈 것**: (1) 사용자가 직접 `config.json`의 `DRY_RUN`을 `false`로
변경, (2) Slack App에서 Interactivity & Shortcuts → Request URL을
`https://<공인주소>/api/slack/interactive`로 등록(ngrok 등 외부 터널링 필요,
`/api/slack/commands`와 동일 앱 재사용 가능) + `.env`의 `SLACK_SIGNING_SECRET`을
placeholder(`your_slack_signing_secret_here`)에서 실제 값으로 교체(**아직 실제
값이 채워지지 않은 상태를 이번에 확인함** — 이게 안 되어 있으면 슬래시 커맨드도
승인 버튼도 둘 다 서명 검증에서 막힘), (3) 실제 매수/매도 신호가 뜰 때 Slack
메시지가 정말 오는지, 버튼을 눌렀을 때 다음 사이클에 실제 체결되는지 실전 확인.

### ⑤단계 — UI 버그 2건 수정 + ngrok 정상화 (2026-09-24)

사용자가 실제 화면 스크린샷 2장으로 신고:
1. 가상자산 준비금 현황 표에 보험 상품용 "비교하기 →" 버튼이 잘못 붙어 있음.
2. 개인별 자동매매 등록 패널의 Access Key 입력칸이 평문(`type="text"`)으로 노출됨.

**버그 2 (Access Key 노출)**: `type="text"` → `type="password"`로 변경, Secret Key와
함께 `autocomplete="off"` 추가, 등록 성공 시 두 필드 모두 비우도록 수정. 단순 수정.

**버그 1 (비교하기 버튼 오표시) — 두 번 고쳐야 했음, 근본 원인이 처음 생각과 달랐음**:
- **1차 시도(실패)**: `addLinksToTables()`(JS)가 모든 `<table>`에 무조건 버튼을 붙이는데,
  표 헤더에 "Ticker"가 있거나 셀에 "KRW-BTC" 패턴이 있으면 제외하도록 추가함. **사용자가
  재신고** — 헤더가 "티커"(한글)로, 티커값도 "BTC"(KRW- 접두사 없이)로 나온 경우라
  두 조건 다 안 걸림.
- **2차 시도(부분 개선, 결국 폐기)**: 헤더 부분 문자열 "평가손익"/"Ticker"/"티커" +
  메시지 전체에서 "DRY_RUN" 검색으로 강화. 검증 중 GPT가 헤더를 "종목"으로, 상태
  표현을 "dry_run: true"(소문자)나 "페이퍼(모의)"로, 심지어 나중엔 "드라이 런(dry_run)"
  으로 매번 다르게 쓴다는 걸 실측으로 확인 — **문구/헤더 매칭으로는 근본적으로 안정적일
  수 없다는 결론**.
- **최종 해결(근본 수정)**: 클라이언트에서 렌더링된 텍스트를 보고 추측하는 대신, **서버가
  실제로 어떤 도구를 호출했는지**(확정적 사실)를 그대로 내려주는 방식으로 전환.
  - `agents/orchestrator.py`: `InsuranceChatbot.__init__`에
    `self.last_response_used_crypto_tool` 신규(wallet_address와 동일한 인스턴스
    속성 패턴). `chat()`은 return 직전에, `stream_chat()`은 `done` 이벤트에
    `used_crypto_tool` 필드로 실어(+ 인스턴스 속성도 같이 갱신) 기존
    `used_blockchain_tool`(뉴스 섹션 스킵용으로 이미 추적하던 값 — get_blockchain_dental/
    altinvest_status·get_crypto_reserve_status·get_personal_trading_status 호출 여부)를
    그대로 재사용.
  - `web_app.py`: `addLinksToTables(htmlStr, skip)`에 두 번째 인자 추가 —
    `skip===true`면 표 파싱 자체를 안 하고 즉시 반환. 기존의 "평가손익/Ticker/티커/
    DRY_RUN 텍스트 매칭" 코드는 전부 제거(더 이상 필요 없고, 오탐 위험만 남기므로).
    `/api/chat/stream`을 실제로 소비하는 두 스트리밍 핸들러(메인 챗봇 탭 + 다른 탭이
    공유하는 동일 코드, 두 곳 다 완전히 동일한 코드라 `sed`로 동시 수정) 둘 다
    `event.used_crypto_tool`을 그대로 넘기도록 수정. **`/api/chat`(비스트리밍 JSON)도
    같은 필드를 추가했지만, 확인해보니 실제 웹 프론트엔드는 이 라우트를 전혀 호출하지
    않고 항상 `/api/chat/stream`(SSE)만 씀** — API 호환성 차원에서만 남겨둠. 신용점수/
    건강위험 포트폴리오 탭의 `addLinksToTables()` 호출 2곳은 크립토와 무관해 그대로 둠
    (`skip` 인자 없이 호출 = 항상 기존 버튼 로직 적용, 하위호환).
  - **실측 검증**: 실제 서버로 크립토 질문(→ `used_crypto_tool: true`, GPT가 이번엔
    "드라이 런(dry_run)"이라고 또 다르게 표현 — 그래도 플래그는 정확) + 일반 보험
    질문(→ `used_crypto_tool: false`, 기존 비교/가입 버튼 로직 영향 없음) 둘 다
    SSE 원시 응답을 직접 파싱해 확인함.
  - **교훈**: LLM이 자연어로 매번 표현을 바꿀 수 있는 출력(헤더 문구, 상태 설명 문구
    등)을 클라이언트가 문자열 매칭으로 판별하려는 시도는 근본적으로 깨지기 쉽다.
    이미 서버가 알고 있는 확정적 사실(이번 턴에 어떤 도구를 호출했는가)이 있다면,
    그걸 응답에 실어 내려주는 쪽이 항상 더 안정적 — 앞으로 비슷한 "GPT 응답 내용에
    따라 프론트엔드 동작을 바꿔야 하는" 케이스가 생기면 이 패턴을 먼저 고려할 것.

**ngrok 인프라 문제 발견 및 해결**: winget으로 설치된 ngrok(`Ngrok.Ngrok` 패키지)이
버전 불일치 상태로 깨져 있었음(`ngrok.exe`가 `.ngrok.exe.old`로 이름만 바뀌고 새
버전이 제자리에 안 들어옴 — winget 자체는 여전히 3.3.1로 인식하는데, 실제로는 ngrok
자체 업데이터가 3.39.11까지 올렸다가 이후 뭔가에 의해 중간에 끊긴 것으로 추정).
3.3.1은 계정의 최소 요구 버전(3.20.0) 미달로 인증 자체가 거부됨(`ERR_NGROK_121`).
`%LOCALAPPDATA%\ngrok_bin\ngrok.exe`에 최신 버전을 직접 받아 해결 — **앞으로 ngrok
관련 문제가 또 생기면 winget 경로 말고 이 경로의 바이너리를 우선 확인할 것**.
다행히 **ngrok 계정에 고정 무료 정적 도메인이 배정되어 있어**(`yarn-thievish-severity.ngrok-free.dev`),
`ngrok http 5000`을 옵션 없이 실행해도 매번 같은 주소가 나옴 — 재부팅 후 다시 켜도
주소가 안 바뀌는 것까지 이번에 두 번 재현해 확인함(단, PC가 꺼져 있거나 두 프로세스
—`python web_app.py`, `ngrok http 5000`—가 안 떠 있으면 당연히 응답 안 함; 이 자체가
24/7 클라우드 호스팅은 아니라는 뜻).

**다음에 이어갈 것**: 사용자에게 `web_app.py` + `ngrok`을 한 번에 띄우는 배치파일을
만들어주기로 제안함(다음 세션에서 이어갈 것, 아직 안 만듦).

### ⑥단계 — 파라메트릭 자동지급 Slack 알림 누락 수정 (2026-09-24)

사용자 질문("파라메트릭 보장은 블록체인에서 구동되는지, 챗봇으로 빼야 하는 건
아닌지 검토")에서 시작한 검토 → 실행 로직(오라클 패턴, 스마트컨트랙트)은 정상
설계이고 옮길 필요 없음. 대신 검토 중 실제 알림 경로에 구멍을 발견해 수정함.

**발견**: `frontend/app.js`의 `paramCtx.on("CoverageResolved", ...)` 리스너만
지급/만료 알림(이메일)을 보내고 있었음 — **브라우저 탭이 열려서 이 리스너가
살아있을 때만** 알림이 감. `maturity-watcher.js`(만기 알림)는 백엔드 스크립트가
직접 `postToSlack()`을 호출해 브라우저 없이도 항상 알리는 것과 대조적. 더 파보니
`scripts/slack-notifier.js`("블록체인 전 메뉴 행위" 공용 Slack 알림 서비스)의
컨트랙트 목록에 `ParametricInsurance`가 애초에 등록된 적이 없었음(AltInvestmentFund
추가 때도 헤더 주석 갱신을 빠뜨렸던 것과 같은 종류의 "새 컨트랙트 추가 시 이 파일에
등록하는 걸 잊음" 패턴).

**수정**: `slack-notifier.js`에 `PARAMETRIC_ABI`(CoveragePurchased/CoverageResolved)
추가, `targetDefs`에 USDC/KRW ParametricInsurance 등록, `CoverageResolved`의
status(1=Triggered/2=Expired)에 따라 아이콘·제목을 런타임에 다시 고르는 로직 추가
(`InterestAccrued`가 ReserveFund/AltInvestmentFund 구분에 쓰던 것과 동일 패턴).
헤더 주석의 컨트랙트 목록도 실제와 맞게 갱신(AltInvestmentFund도 마침 빠져있었음).

**이메일 알림은 그대로 브라우저 의존적** — `rememberCertEmail`/`getCertEmail`이
`localStorage`에만 지갑주소→이메일 매핑을 저장하는 구조라(서버 쪽엔 이 매핑이
전혀 없음), 백엔드 스크립트가 고객 이메일을 알 방법이 없음. Slack(관리자용 단일
채널)은 이번에 고쳤지만, "브라우저 없이도 고객에게 이메일이 가게" 하려면 이메일
저장 자체를 서버 사이드(파일/DB)로 옮기는 별도 설계 변경이 필요함 — 이번 범위
밖으로 남겨둠.

**실제 검증**: 실행 중인 `slack-notifier.js`를 재기동해 반영 확인
(9개 컨트랙트로 등록 개수 증가, 기존 7개 → USDC/KRW 파라메트릭 2개 추가) →
Hardhat Account #1로 폭염특보 상품(threshold=3) 커버리지를 실제로 구매하고,
오라클 키로 `resolveCoverage(coverageId, 1003)`을 직접 호출해 강제 트리거 →
`slack-notifier.js` 로그에 "🌦️ 파라메트릭 커버리지 구매"와 "🎯 파라메트릭
자동지급(트리거) — 관측값 1003, 지급액 $150.00"가 정확히 찍히는 것을 브라우저를
전혀 열지 않은 상태로 확인. 실제 Slack 웹훅이 설정돼 있어 실제 채널로도 전송됨.
테스트에 쓴 1회성 검증 스크립트는 커밋하지 않고 삭제함(체인에는 테스트 커버리지
#4 기록이 남아있음 — 실제 자금 영향 없는 로컬 테스트넷이라 문제 없음).

**같은 종류의 다른 잠재 갭 (이번엔 손 안 댐, 참고용)**: `ReinsurancePool`도
`slack-notifier.js`에 등록되어 있지 않음(`Deposited`/`Withdrawn`/`ClaimDrawUsed`
이벤트가 브라우저 리스너에만 의존). 필요해지면 이번과 같은 패턴(ABI 추가 +
EVENT_META + formatEventBody + targetDefs)으로 고칠 것.
