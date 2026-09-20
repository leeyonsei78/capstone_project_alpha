/**
 * 덴탈보험 블록체인 UI - app.js
 * ethers.js v6 | 전체 행위 로깅 + 에러 상세 분석
 */

// ── ABIs ─────────────────────────────────────────────────────
const USDC_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function faucet(uint256 amount)",
  "function mint(address to, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event FaucetUsed(address indexed user, uint256 amount)"
];

const INSURANCE_ABI = [
  "function stablecoin() view returns (address)",
  "function owner() view returns (address)",
  "function nextPolicyId() view returns (uint256)",
  "function nextClaimId() view returns (uint256)",
  "function totalPremiumsCollected() view returns (uint256)",
  "function totalClaimsPaid() view returns (uint256)",
  "function createPolicy(address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 maturityDate, uint256 maturityRefundRate, bool flexiblePayment) returns (uint256)",
  "function deactivatePolicy(uint256 policyId)",
  "function depositFunds(uint256 amount)",
  "function payPremium(uint256 policyId)",
  "function submitClaim(uint256 policyId, uint256 amount, string treatmentCode, string description) returns (uint256)",
  "function approveClaim(uint256 claimId)",
  "function rejectClaim(uint256 claimId, string reason)",
  "function payClaim(uint256 claimId)",
  "function getPolicy(uint256 policyId) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid, uint256 premiumInterval, bool flexiblePayment, uint256 baselinePremiumAmount))",
  "function processMaturityRefund(uint256 policyId)",
  "function adminPayMaturityRefund(uint256 policyId)",
  "function isMatured(uint256 policyId) view returns (bool)",
  "function setMyMaturityInterval(uint256 policyId, uint256 intervalSeconds)",
  "function getClaim(uint256 claimId) view returns (tuple(uint256 id, uint256 policyId, address patient, uint256 amount, string treatmentCode, string description, uint8 status, uint256 submittedAt, uint256 processedAt, string rejectReason))",
  "function getPatientPolicies(address patient) view returns (uint256[])",
  "function getPatientClaims(address patient) view returns (uint256[])",
  "function getAllPolicyIds() view returns (uint256[])",
  "function getAllClaimIds() view returns (uint256[])",
  "function getContractBalance() view returns (uint256)",
  "function getStats() view returns (uint256 premiumsCollected, uint256 claimsPaid, uint256 contractBalance, uint256 policiesCount, uint256 claimsCount)",
  "event PolicyCreated(uint256 indexed policyId, address indexed patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 timestamp)",
  "event PremiumPaid(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
  "event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId, address indexed patient, uint256 amount, string treatmentCode, uint256 timestamp)",
  "event ClaimApproved(uint256 indexed claimId, uint256 indexed policyId, uint256 amount, uint256 timestamp)",
  "event ClaimRejected(uint256 indexed claimId, uint256 indexed policyId, string reason, uint256 timestamp)",
  "event ClaimPaid(uint256 indexed claimId, uint256 indexed policyId, address indexed patient, uint256 amount, uint256 timestamp)",
  "event PolicyDeactivated(uint256 indexed policyId, uint256 timestamp)",
  "event FundsDeposited(address indexed depositor, uint256 amount, uint256 timestamp)",
  "event MaturityRefundPaid(uint256 indexed policyId, address indexed patient, uint256 refundAmount, uint256 timestamp)",
  // Oracle
  "function oracleAddress() view returns (address)",
  "function oracleModeEnabled() view returns (bool)",
  "function setOracleAddress(address _oracle)",
  "function setOracleMode(bool _enabled)",
  "function getOracleVerification(uint256 claimId) view returns (tuple(bool exists, bool approved, bytes32 dataHash, uint256 verifiedAt, string hospitalName, string verificationCode))",
  "event ClaimOracleVerified(uint256 indexed claimId, bool approved, bytes32 dataHash, string hospitalName, uint256 timestamp)",
  // 자동납부
  "function collectPremium(uint256 policyId)",
  "function isDue(uint256 policyId) view returns (bool)",
  "function setMyPremiumInterval(uint256 policyId, uint256 intervalSeconds)",
  "event PremiumAutoCollected(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
  // ─── 청약 심사 (Underwriting) ──────────────────────────────
  "function submitApplication(string applicantName, uint256 age, uint256 monthlyPremium, uint256 coverageLimit, uint256 maturityDays, uint256 maturityRefundRate, uint256 coverageCount, bool flexiblePayment) returns (uint256)",
  "function approveApplication(uint256 appId) returns (uint256)",
  "function rejectApplication(uint256 appId, string reason)",
  "function getApplication(uint256 appId) view returns (tuple(uint256 id, address applicant, string applicantName, uint256 age, uint256 monthlyPremium, uint256 coverageLimit, uint256 maturityDays, uint256 maturityRefundRate, uint8 status, uint256 submittedAt, uint256 processedAt, string rejectReason, uint256 policyId, uint8 riskScore, uint256 coverageCount, bool flexiblePayment))",
  "function getAllApplicationIds() view returns (uint256[])",
  "function getApplicantApplications(address applicant) view returns (uint256[])",
  "function nextApplicationId() view returns (uint256)",
  "event ApplicationSubmitted(uint256 indexed appId, address indexed applicant, string applicantName, uint256 riskScore, uint256 timestamp)",
  "event ApplicationApproved(uint256 indexed appId, uint256 indexed policyId, uint256 timestamp)",
  "event ApplicationRejected(uint256 indexed appId, address indexed applicant, string reason, uint256 timestamp)",
  // ─── 약관대출 (Policy Loan) ────────────────────────────────
  "function requestPolicyLoan(uint256 policyId, uint256 amount)",
  "function repayPolicyLoan(uint256 policyId)",
  "function repayPolicyLoanPartial(uint256 policyId, uint256 amount)",
  "function getMaxLoanAmount(uint256 policyId) view returns (uint256)",
  "function getCurrentInterest(uint256 policyId) view returns (uint256)",
  "function getLoanRepayAmount(uint256 policyId) view returns (uint256 principal, uint256 interest, uint256 total)",
  "function getPolicyLoan(uint256 policyId) view returns (tuple(uint256 policyId, uint256 loanAmount, uint256 borrowedAt, uint256 interestRate, bool active))",
  "function loanInterestRate() view returns (uint256)",
  "function maxLoanRatio() view returns (uint256)",
  "event PolicyLoanTaken(uint256 indexed policyId, address indexed patient, uint256 loanAmount, uint256 timestamp)",
  "event PolicyLoanRepaid(uint256 indexed policyId, address indexed patient, uint256 principal, uint256 interest, uint256 timestamp)",
  // ─── 씬파일러 유연납입 ──────────────────────────────────────
  "function setFlexiblePayment(uint256 policyId, bool enabled)",
  "function autoCoverArrearsWithLoan(uint256 policyId)",
  "event ArrearsCoveredByLoan(uint256 indexed policyId, uint256 amount, uint256 timestamp)",
  "event FlexiblePaymentSet(uint256 indexed policyId, bool enabled)",
  // ─── 웰니스 연동 동적 보험료 ────────────────────────────────
  "function applyWellnessAdjustment(uint256 policyId, uint256 newPremiumAmount, string reason)",
  "event WellnessPremiumAdjusted(uint256 indexed policyId, uint256 oldAmount, uint256 newAmount, string reason, uint256 timestamp)",
  // ─── 재보험풀 ceding ─────────────────────────────────────────
  "function reinsurancePool() view returns (address)",
  "function cedingBps() view returns (uint256)",
  "function setReinsurancePool(address pool)",
  "function setCedingBps(uint256 bps)",
  "event PremiumCededToPool(uint256 indexed policyId, uint256 amount, uint256 timestamp)"
];

// ─── 준비금 계좌 (Reserve Fund) ────────────────────────────────
const RESERVE_ABI = [
  "function depositReserve(uint256 amount)",
  "function withdrawReserve(uint256 amount)",
  "function previewBalance(address patient) view returns (uint256 projectedPrincipal, uint256 pendingInterest)",
  "function getAccount(address patient) view returns (tuple(uint256 principal, uint256 lastAccrualTime, uint256 totalDeposited, uint256 totalWithdrawn, uint256 totalInterestEarned, bool exists))",
  "function getAllHolders() view returns (address[])",
  "function getContractBalance() view returns (uint256)",
  "event ReserveDeposited(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event ReserveWithdrawn(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event InterestAccrued(address indexed patient, uint256 interestAmount, uint256 newPrincipal, uint256 timestamp)"
];

// ─── 대체투자형 준비금 (Alt Investment Fund) ──────────────────
const ALTINVEST_ABI = [
  "function invest(uint256 fundId, uint256 amount)",
  "function withdraw(uint256 fundId, uint256 amount)",
  "function earlyWithdraw(uint256 fundId, uint256 amount)",
  "function addFund(string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps) returns (uint256)",
  "function setFundActive(uint256 fundId, bool active)",
  "function previewPosition(address investor, uint256 fundId) view returns (uint256 projectedPrincipal, uint256 pendingInterest, uint256 unlockTime)",
  "function getFunds() view returns (tuple(string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps, bool active)[])",
  "function getFund(uint256 fundId) view returns (tuple(string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps, bool active))",
  "function getFundCount() view returns (uint256)",
  "function getPosition(address investor, uint256 fundId) view returns (tuple(uint256 principal, uint256 lastAccrualTime, uint256 depositTime, uint256 totalDeposited, uint256 totalWithdrawn, uint256 totalInterestEarned, bool exists))",
  "function getAllHolders() view returns (address[])",
  "function getContractBalance() view returns (uint256)",
  "event FundCreated(uint256 indexed fundId, string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps)",
  "event FundActiveSet(uint256 indexed fundId, bool active)",
  "event Invested(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 newPrincipal, uint256 unlockTime, uint256 timestamp)",
  "event Withdrawn(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event EarlyWithdrawn(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 penalty, uint256 payout, uint256 newPrincipal, uint256 timestamp)",
  "event InterestAccrued(address indexed investor, uint256 indexed fundId, uint256 interestAmount, uint256 newPrincipal, uint256 timestamp)"
];

// ─── 파라메트릭(자동집행) 보험 ──────────────────────────────────
const PARAM_ABI = [
  "function addProduct(string name, string metricLabel, uint256 triggerThreshold, uint256 payoutAmount, uint256 premium, uint256 coverageDurationSecs) returns (uint256)",
  "function setProductActive(uint256 productId, bool active)",
  "function setOracleAddress(address oracle)",
  "function oracleAddress() view returns (address)",
  "function depositFunds(uint256 amount)",
  "function purchaseCoverage(uint256 productId) returns (uint256)",
  "function resolveCoverage(uint256 coverageId, uint256 observedValue)",
  "function getProducts() view returns (tuple(string name, string metricLabel, uint256 triggerThreshold, uint256 payoutAmount, uint256 premium, uint256 coverageDurationSecs, bool active)[])",
  "function getProduct(uint256 productId) view returns (tuple(string name, string metricLabel, uint256 triggerThreshold, uint256 payoutAmount, uint256 premium, uint256 coverageDurationSecs, bool active))",
  "function getProductCount() view returns (uint256)",
  "function getCoverage(uint256 coverageId) view returns (tuple(uint256 id, address holder, uint256 productId, uint256 purchaseTime, uint256 expiryTime, uint8 status, uint256 observedValue, uint256 resolvedAt))",
  "function getHolderCoverages(address holder) view returns (uint256[])",
  "function getAllCoverageIds() view returns (uint256[])",
  "function getContractBalance() view returns (uint256)",
  "function getStats() view returns (uint256 productCount, uint256 coverageCount, uint256 premiumsCollected, uint256 payoutsPaid)",
  "event ProductAdded(uint256 indexed productId, string name, string metricLabel, uint256 triggerThreshold, uint256 payoutAmount, uint256 premium, uint256 coverageDurationSecs)",
  "event ProductActiveSet(uint256 indexed productId, bool active)",
  "event CoveragePurchased(uint256 indexed coverageId, address indexed holder, uint256 indexed productId, uint256 premium, uint256 expiryTime, uint256 timestamp)",
  "event CoverageResolved(uint256 indexed coverageId, uint8 status, uint256 observedValue, uint256 payoutAmount, uint256 timestamp)"
];

// ─── 재보험풀 (외부 유동성 공급) ────────────────────────────────
const REINSURANCE_ABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 shareAmount)",
  "function drawForClaim(uint256 amount)",
  "function shares(address) view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function previewShareValue(address investor) view returns (uint256 shareBalance, uint256 assetValue)",
  "function getHolders() view returns (address[])",
  "function getContractBalance() view returns (uint256)",
  "function getPoolStats() view returns (uint256 assets, uint256 shareSupply, uint256 holderCount)",
  "event Deposited(address indexed investor, uint256 amount, uint256 sharesMinted, uint256 newShares, uint256 timestamp)",
  "event Withdrawn(address indexed investor, uint256 shareAmount, uint256 amountPaid, uint256 newShares, uint256 timestamp)",
  "event ClaimDrawUsed(address indexed to, uint256 amount, uint256 timestamp)"
];

// ── Hardhat 계정 이름 매핑 ────────────────────────────────────
const KNOWN_ACCOUNTS = {
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": { name: "관리자",  account: "#0" },
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": { name: "김덴탈",  account: "#1" },
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": { name: "이치과",  account: "#2" },
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906": { name: "오라클",  account: "#3" },
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65": { name: "박청약",  account: "#4" },
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc": { name: "최이십",  account: "#5" },
  "0x976ea74026e726554db657fa54763abd0c3a0aa9": { name: "노거절",  account: "#6" },
};

function getAccountInfo(addr) {
  if (!addr) return null;
  return KNOWN_ACCOUNTS[addr.toLowerCase()] || null;
}

// ── 전역 상태 ─────────────────────────────────────────────────
let provider  = null;
let signer    = null;
let userAddr  = null;
let usdcAddr  = null;
let insAddr   = null;
let reserveAddr = null;
let altInvestAddr = null;
let paramAddr = null;
let reinsuranceAddr = null;
let usdcCtx   = null;
let insCtx    = null;
let reserveCtx  = null;
let altInvestCtx = null;
let paramCtx = null;
let reinsuranceCtx = null;
let usdcSign  = null;
let insSign   = null;
let reserveSign = null;
let altInvestSign = null;
let paramSign = null;
let reinsuranceSign = null;
let isOwner   = false;
let eventListenersAttached = false;

// ── 통화 모드 ─────────────────────────────────────────────────
let currencyMode = 'USDC';   // 'USDC' | 'KRW'
let configCache  = null;     // config.json 캐시

// ── 알림 이메일 발송 (scripts/email-service.js 연동) ─────────────
// 증권 발급/청구 승인·거절·지급 시점에, 해당 지갑에 등록된 이메일이 있으면
// scripts/email-service.js의 웹훅으로 요청을 보낸다 — 그 서비스가 로컬
// Docker로 띄운 Mailpit(../docker-compose.yml)을 통해 실제 SMTP 메일을
// 발송한다 (발송된 메일은 http://localhost:8025 에서 확인). 이메일 서비스가
// 꺼져 있으면(포트 미응답) fetch가 실패할 뿐 — 다른 선택 기능들과 동일하게
// "없으면 조용히 건너뜀" 원칙. 모든 알림 종류가 이 웹훅 하나로 들어가고,
// payload의 "type" 필드(policy_issued/claim_approved/claim_rejected/
// claim_paid)로 이메일 서비스 쪽에서 분기한다.
const EMAIL_NOTIFY_WEBHOOK_URL = "http://localhost:5679/notify";

function certEmailStorageKey(address) {
  return `certEmail:${(address || "").toLowerCase()}`;
}

function rememberCertEmail(address, email) {
  if (!address || !email) return;
  try { localStorage.setItem(certEmailStorageKey(address), email); } catch (_) { /* 무시 */ }
}

function lookupCertEmail(address) {
  try { return localStorage.getItem(certEmailStorageKey(address)) || null; } catch (_) { return null; }
}

// type="email" input의 브라우저 기본 검증만으로는 프로그래밍적으로 우회되거나
// 느슨할 수 있어, 저장/발송 전에 한 번 더 형식을 확인한다 (완벽한 이메일 검증은
// 불가능하므로 명백히 잘못된 형태만 걸러내는 실용적 수준의 정규식).
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 증권 발급(PolicyCreated) 시점에 호출 — 이 지갑 주소로 등록된 이메일이 있으면
// email-service.js 웹훅으로 {email, policyId, patientName, currency, certFileName, certUrl}을 push.
// certificate-service.js가 만드는 파일명 규칙(scripts/certificate-service.js의
// certFileName)과 동일하게 URL을 미리 구성해서 넘긴다 — email-service.js가 PDF
// 파일이 생길 때까지 잠깐 재시도 대기한 뒤 첨부해서 발송하므로 PDF 생성 타이밍과
// 자연스럽게 맞는다 (scripts/email-service.js의 waitForCertFile 참고).
// certUrl은 location.origin(지금 접속 중인 프론트엔드 주소, 예: http://localhost:3000)
// 기준 완전한 다운로드 링크 — PDF는 certificate-service.js가 frontend/certificates/
// 아래에 저장하고, 프론트엔드 서버(npx serve)가 그 디렉터리를 그대로 정적 서빙하므로
// "/certificates/<파일명>" 경로로 바로 접근 가능하다. email-service.js가 base URL을
// 따로 하드코딩할 필요 없이 이 값을 그대로 이메일 링크로 쓰면 된다.
async function notifyCertReady(policyId, patientAddress, patientName) {
  if (!EMAIL_NOTIFY_WEBHOOK_URL) return;
  const email = lookupCertEmail(patientAddress);
  if (!email) return;

  const certFileName = `${currencyMode.toLowerCase()}-policy-${policyId}.pdf`;
  const certUrl = `${location.origin}/certificates/${certFileName}`;
  try {
    await fetch(EMAIL_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "policy_issued",
        email,
        policyId: Number(policyId),
        patientName,
        currency: currencyMode,
        certFileName,
        certUrl,
      }),
    });
    addLog("info", `📧 증권 발급 이메일 발송 요청 전송 (증권 #${policyId} → ${email})`, `certUrl: ${certUrl}`);
  } catch (e) {
    addLog("error", "증권 발급 이메일 발송 요청 실패 (email-service.js가 켜져 있는지 확인하세요)", e.message);
  }
}

// 청구 승인/거절/지급 이벤트 시점에 호출 — 증권 발급 이메일과 같은 지갑주소
// 기준으로 등록된 이메일이 있으면 같은 웹훅으로 알림 요청을 보낸다.
// type: "claim_approved" | "claim_rejected" | "claim_paid"
async function notifyClaimUpdate(type, claimId, extra = {}) {
  if (!EMAIL_NOTIFY_WEBHOOK_URL) return;
  if (!insCtx) return;
  try {
    const claim = await insCtx.getClaim(claimId);
    const email = lookupCertEmail(claim.patient);
    if (!email) return;

    const policy = await insCtx.getPolicy(claim.policyId).catch(() => null);
    await fetch(EMAIL_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        email,
        claimId: Number(claimId),
        policyId: Number(claim.policyId),
        patientName: policy ? policy.patientName : "",
        currency: currencyMode,
        amount: Number(claim.amount),
        amountFormatted: fmtByCcy(claim.amount, currencyMode),
        treatmentCode: claim.treatmentCode,
        ...extra,
      }),
    });
    addLog("info", `📧 청구 처리 결과 이메일 발송 요청 전송 (청구 #${claimId} → ${email})`, `type: ${type}`);
  } catch (e) {
    addLog("error", "청구 처리 결과 이메일 발송 요청 실패 (email-service.js가 켜져 있는지 확인하세요)", e.message);
  }
}

// 대체투자 조기해지(EarlyWithdrawn) 시점에 호출 — 증권과 달리 투자자는 청약을
// 안 거쳤을 수 있어(rememberCertEmail이 submitApplication에서만 호출됨), 투자
// 카드의 선택 이메일 입력(investAltFund 참고)이 별도로 같은 저장소에 등록해둔다.
// 락업 임박 알림은 시간 기반이라 백엔드 워처(altinvest-watcher.js)만 감지할 수
// 있는데, 그 워처는 브라우저 localStorage에 접근할 수 없어 이메일을 보낼 수
// 없다 — 그래서 이메일 알림은 조기해지(온체인 이벤트, 프론트엔드가 직접 감지)
// 한정이다.
async function notifyAltInvestUpdate(type, investor, fundId, extra = {}) {
  if (!EMAIL_NOTIFY_WEBHOOK_URL) return;
  const email = lookupCertEmail(investor);
  if (!email) return;
  try {
    const fund = _altInvestFundsCache[fundId];
    await fetch(EMAIL_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        email,
        investor,
        fundId: Number(fundId),
        fundName: fund ? fund.name : `펀드 #${fundId}`,
        currency: currencyMode,
        ...extra,
      }),
    });
    addLog("info", `📧 대체투자 처리 결과 이메일 발송 요청 전송 (${shortAddr(investor)} → ${email})`, `type: ${type}`);
  } catch (e) {
    addLog("error", "대체투자 이메일 발송 요청 실패 (email-service.js가 켜져 있는지 확인하세요)", e.message);
  }
}

// 파라메트릭보험 CoverageResolved(트리거/만료) 시점에 호출 — 대체투자와 동일하게
// 구매 카드의 선택 이메일 입력(purchaseParametricCoverage 참고)이 등록해둔 값을 사용.
async function notifyParametricUpdate(type, investor, coverageId, extra = {}) {
  if (!EMAIL_NOTIFY_WEBHOOK_URL) return;
  const email = lookupCertEmail(investor);
  if (!email) return;
  try {
    await fetch(EMAIL_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        email,
        investor,
        coverageId: Number(coverageId),
        currency: currencyMode,
        ...extra,
      }),
    });
    addLog("info", `📧 파라메트릭보험 처리 결과 이메일 발송 요청 전송 (${shortAddr(investor)} → ${email})`, `type: ${type}`);
  } catch (e) {
    addLog("error", "파라메트릭보험 이메일 발송 요청 실패 (email-service.js가 켜져 있는지 확인하세요)", e.message);
  }
}

// 재보험풀 Deposited/Withdrawn 시점에 호출 — fundId 같은 자연 식별자가 없어
// 이벤트별 dedup 키에는 트랜잭션 해시(nonce)를 사용한다.
async function notifyReinsuranceUpdate(type, investor, nonce, extra = {}) {
  if (!EMAIL_NOTIFY_WEBHOOK_URL) return;
  const email = lookupCertEmail(investor);
  if (!email) return;
  try {
    await fetch(EMAIL_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        email,
        investor,
        nonce,
        currency: currencyMode,
        ...extra,
      }),
    });
    addLog("info", `📧 재보험풀 처리 결과 이메일 발송 요청 전송 (${shortAddr(investor)} → ${email})`, `type: ${type}`);
  } catch (e) {
    addLog("error", "재보험풀 이메일 발송 요청 실패 (email-service.js가 켜져 있는지 확인하세요)", e.message);
  }
}

function stableDecimals() { return currencyMode === 'KRW' ? 0 : 6; }
function stableSymbol()   { return currencyMode === 'KRW' ? '₩' : '$'; }
function stableName()     { return currencyMode === 'KRW' ? 'KRW' : 'USDC'; }

// 로그 상태
let logEntries    = [];
let logSeq        = 0;
let logFilter     = "all";
let logSearch     = "";
let logAutoScroll = true;
const LOG_MAX     = 500;

const CLAIM_STATUS       = ["대기중", "승인됨", "거절됨", "지급완료"];
const CLAIM_STATUS_CLASS = ["badge-pending", "badge-approved", "badge-rejected", "badge-paid"];

// ═══════════════════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════════════════
function fmt(amount) {
  if (amount === undefined || amount === null) return currencyMode === 'KRW' ? "0" : "0.00";
  const n = typeof amount === "bigint" ? amount : BigInt(amount.toString());
  return ethers.formatUnits(n, stableDecimals());
}
function fmtUsdc(amount) {
  if (currencyMode === 'KRW') {
    const n = typeof amount === "bigint" ? amount : BigInt((amount || 0).toString());
    return "₩" + Number(n).toLocaleString("ko-KR");
  }
  return `$${parseFloat(fmt(amount)).toLocaleString("ko-KR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })}`;
}
function fmtInterval(seconds) {
  const s = Number(seconds);
  if (s === 300)      return "⏱️ 5분 (테스트 전용)";
  if (s === 86400)    return "📅 1일";
  if (s === 2592000)  return "📅 1개월";
  if (s === 7776000)  return "📅 3개월";
  if (s === 31536000) return "📅 1년";
  return `${s}초`;
}
function shortAddr(addr) {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
function tsToDate(ts) {
  if (!ts || ts === 0n) return "-";
  return new Date(Number(ts) * 1000).toLocaleString("ko-KR");
}
function nowFull() {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function el(id) { return document.getElementById(id); }
function parseUsdc(val) {
  try { return ethers.parseUnits(String(parseFloat(val || 0)), stableDecimals()); }
  catch { return 0n; }
}

// ═══════════════════════════════════════════════════════════════
//  통화 교차 조회/표시
//
//  보험증권 목록/보험금 청구 "목록 테이블"과 보험료납입/자동납부/약관대출/
//  만기환급 등 "액션 대상 선택" 드롭다운(updateActivePolicySelects) 모두
//  현재 토글된 통화(currencyMode)의 계약만 보여준다(다른 통화 계약과 한
//  화면에 섞이지 않음 — refreshPolicies/refreshClaims/populateCompositeSelect
//  참고). 다른 통화 계약을 다루려면 상단에서 통화를 전환해야 한다.
// ═══════════════════════════════════════════════════════════════
function decimalsForCcy(ccy) { return ccy === 'KRW' ? 0 : 6; }

function fmtByCcy(raw, ccy) {
  const n = typeof raw === "bigint" ? raw : BigInt((raw || 0).toString());
  if (ccy === 'KRW') return "₩" + Number(n).toLocaleString("ko-KR");
  return "$" + parseFloat(ethers.formatUnits(n, 6)).toLocaleString("ko-KR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

// raw 금액(ccy 기준)을 반대 통화 값으로 환산해 "≈ ..." 형태로 반환 (표시 전용)
function convertedAmountLabel(raw, ccy) {
  const n = typeof raw === "bigint" ? raw : BigInt((raw || 0).toString());
  if (ccy === 'USDC') {
    const usdVal = Number(ethers.formatUnits(n, 6));
    return `≈ ₩${Math.round(usdVal * KRW_PER_USD).toLocaleString("ko-KR")}`;
  }
  const krwVal = Number(n);
  return `≈ $${(krwVal / KRW_PER_USD).toLocaleString("ko-KR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })}`;
}

// rawAmount(fromCcy 기준)를 toCcy의 최소단위 raw 값(BigInt)으로 환산.
// 같은 통화면 그대로 반환 — 반올림 오차 없이 원래 값 유지.
function convertRawAmount(rawAmount, fromCcy, toCcy) {
  const n = typeof rawAmount === "bigint" ? rawAmount : BigInt((rawAmount || 0).toString());
  if (fromCcy === toCcy) return n;
  if (fromCcy === 'USDC' && toCcy === 'KRW') {
    const usdVal = Number(ethers.formatUnits(n, 6));
    return BigInt(Math.round(usdVal * KRW_PER_USD));
  }
  // fromCcy === 'KRW' && toCcy === 'USDC'
  const krwVal = Number(n);
  const usdVal = krwVal / KRW_PER_USD;
  return ethers.parseUnits(usdVal.toFixed(6), 6);
}

// 현재 모드가 아닌("다른") 통화의 DentalInsurance 컨트랙트 핸들을 지연 생성 +
// 캐시. 청구/증권 목록을 통화 구분 없이 한 번에 보여주기 위해 사용.
const _ccyContractCache = {};
function getContractsForCcy(ccy) {
  if (ccy === currencyMode) {
    if (!insCtx) return null;
    return { ctx: insCtx, sign: insSign, decimals: stableDecimals(), ccy };
  }
  if (!configCache?.contracts || !provider) return null;
  const addr = ccy === 'KRW' ? configCache.contracts.DentalInsuranceKRW : configCache.contracts.DentalInsurance;
  if (!addr) return null;
  const cacheKey = `${ccy}:${addr}`;
  if (!_ccyContractCache[cacheKey]) {
    _ccyContractCache[cacheKey] = {
      ctx: new ethers.Contract(addr, INSURANCE_ABI, provider),
      sign: signer ? new ethers.Contract(addr, INSURANCE_ABI, signer) : null,
      decimals: decimalsForCcy(ccy),
      ccy,
    };
  }
  return _ccyContractCache[cacheKey];
}

// 현재 모드가 아닌 통화의 ERC20 토큰(MockUSDC/MockKRW) 컨트랙트 핸들 —
// payPremium/약관대출/준비금 등에서 approve·balanceOf 대상이 필요할 때 사용.
const _ccyTokenCache = {};
function getTokenForCcy(ccy) {
  if (ccy === currencyMode) {
    if (!usdcCtx) return null;
    return { ctx: usdcCtx, sign: usdcSign, ccy };
  }
  if (!configCache?.contracts || !provider) return null;
  const addr = ccy === 'KRW' ? configCache.contracts.MockKRW : configCache.contracts.MockUSDC;
  if (!addr) return null;
  const cacheKey = `${ccy}:${addr}`;
  if (!_ccyTokenCache[cacheKey]) {
    _ccyTokenCache[cacheKey] = {
      ctx: new ethers.Contract(addr, USDC_ABI, provider),
      sign: signer ? new ethers.Contract(addr, USDC_ABI, signer) : null,
      ccy,
    };
  }
  return _ccyTokenCache[cacheKey];
}

// 현재 모드가 아닌 통화의 ReserveFund 컨트랙트 핸들
const _ccyReserveCache = {};
function getReserveForCcy(ccy) {
  if (ccy === currencyMode) {
    if (!reserveCtx) return null;
    return { ctx: reserveCtx, sign: reserveSign, ccy };
  }
  if (!configCache?.contracts || !provider) return null;
  const addr = ccy === 'KRW' ? configCache.contracts.ReserveFundKRW : configCache.contracts.ReserveFund;
  if (!addr) return null;
  const cacheKey = `${ccy}:${addr}`;
  if (!_ccyReserveCache[cacheKey]) {
    _ccyReserveCache[cacheKey] = {
      ctx: new ethers.Contract(addr, RESERVE_ABI, provider),
      sign: signer ? new ethers.Contract(addr, RESERVE_ABI, signer) : null,
      ccy,
    };
  }
  return _ccyReserveCache[cacheKey];
}

// 현재 모드가 아닌 통화의 AltInvestmentFund 컨트랙트 핸들
const _ccyAltInvestCache = {};
function getAltInvestForCcy(ccy) {
  if (ccy === currencyMode) {
    if (!altInvestCtx) return null;
    return { ctx: altInvestCtx, sign: altInvestSign, ccy };
  }
  if (!configCache?.contracts || !provider) return null;
  const addr = ccy === 'KRW' ? configCache.contracts.AltInvestmentFundKRW : configCache.contracts.AltInvestmentFund;
  if (!addr) return null;
  const cacheKey = `${ccy}:${addr}`;
  if (!_ccyAltInvestCache[cacheKey]) {
    _ccyAltInvestCache[cacheKey] = {
      ctx: new ethers.Contract(addr, ALTINVEST_ABI, provider),
      sign: signer ? new ethers.Contract(addr, ALTINVEST_ABI, signer) : null,
      ccy,
    };
  }
  return _ccyAltInvestCache[cacheKey];
}

// "USDC-3" / "KRW-3" 같은 합성 ID 파싱
function parseCompositeId(value) {
  if (!value || typeof value !== "string") return null;
  const idx = value.indexOf("-");
  if (idx < 0) return null;
  const ccy = value.slice(0, idx);
  const id = value.slice(idx + 1);
  if (ccy !== 'USDC' && ccy !== 'KRW') return null;
  return { ccy, id };
}
function compositeId(ccy, id) { return `${ccy}-${id}`; }

// 청구/납입/자동납부/약관대출/만기환급 드롭다운에서 선택한 증권이 현재 화면
// 통화(currencyMode)와 다른 통화일 때 보여주는 인라인 안내 배지.
// convert=true면 "입력 금액이 자동 환산되어 전송됨"(청구/약관대출),
// false면 "그 통화 잔액이 그대로 필요함"(납입/자동납부/만기환급)으로 문구가 갈린다.
function updateCcyHint(hintElId, compositeValue, { convert = false } = {}) {
  const hintEl = el(hintElId);
  if (!hintEl) return;
  const parsed = parseCompositeId(compositeValue);
  if (!parsed || parsed.ccy === currencyMode) {
    hintEl.style.display = "none";
    return;
  }
  hintEl.style.display = "block";
  hintEl.textContent = convert
    ? `⚠️ 이 증권은 [${parsed.ccy}] 계약입니다 — 입력한 금액은 현재 화면 통화(${currencyMode}) 기준으로 받아 [${parsed.ccy}]로 자동 환산되어 전송됩니다.`
    : `ℹ️ 이 증권은 [${parsed.ccy}] 계약입니다 — 처리 시 [${parsed.ccy}] 잔액이 필요합니다.`;
}

// ═══════════════════════════════════════════════════════════════
//  에러 파싱 (핵심 - 모든 에러 유형 처리)
// ═══════════════════════════════════════════════════════════════
function parseError(err) {
  if (!err) return "알 수 없는 오류";

  const lines = [];

  // ── MetaMask 사용자 거절
  if (err.code === 4001 || err.code === "ACTION_REJECTED") {
    return "🚫 사용자가 MetaMask 서명을 거절했습니다.";
  }

  // ── Solidity revert 사유 (가장 중요)
  if (err.reason) {
    lines.push(`⛔ Revert 사유: "${err.reason}"`);
  }

  // ── ethers shortMessage
  if (err.shortMessage && err.shortMessage !== err.reason) {
    lines.push(`📋 오류 요약: ${err.shortMessage}`);
  }

  // ── 에러 코드
  if (err.code && err.code !== 4001 && err.code !== "ACTION_REJECTED") {
    lines.push(`🔢 에러 코드: ${err.code}`);
  }

  // ── 중첩 에러 (MetaMask → RPC 노드 → Solidity)
  const nested =
    err.info?.error?.data?.message ||
    err.info?.error?.message       ||
    err.error?.data?.message       ||
    err.error?.message             ||
    err.cause?.message;
  if (nested && nested !== err.message && nested !== err.shortMessage) {
    lines.push(`🔗 내부 오류: ${nested}`);
  }

  // ── 트랜잭션 정보
  if (err.transaction) {
    const tx = err.transaction;
    lines.push(`📤 To: ${tx.to || "-"}`);
    lines.push(`📤 From: ${tx.from || "-"}`);
    if (tx.data && tx.data.length > 10) {
      lines.push(`📤 Data: ${tx.data.slice(0, 42)}...`);
    }
  }

  // ── receipt (트랜잭션 실패 후)
  if (err.receipt) {
    lines.push(`🧾 블록: ${err.receipt.blockNumber}`);
    lines.push(`🧾 Gas Used: ${err.receipt.gasUsed}`);
    lines.push(`🧾 Status: ${err.receipt.status === 0 ? "실패(0)" : "성공(1)"}`);
  }

  // ── 에러 데이터
  if (err.data && err.data !== "0x") {
    lines.push(`💾 Error data: ${String(err.data).slice(0, 66)}`);
  }

  // ── 기본 메시지 (위에서 아무것도 없을 때)
  if (lines.length === 0) {
    lines.push(`❌ ${err.message || String(err)}`);
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
//  로그 시스템
// ═══════════════════════════════════════════════════════════════
const TYPE_ICON  = { success:"✅", error:"❌", event:"📡", info:"ℹ️", warning:"⚠️", step:"🔄", call:"📞" };
const TYPE_LABEL = { success:"성공", error:"오류", event:"이벤트", info:"정보", warning:"경고", step:"단계", call:"조회" };

function addLog(type, msg, detail = "", hash = "") {
  const seq   = ++logSeq;
  const entry = { seq, type, msg, detail, hash, time: nowFull() };
  logEntries.unshift(entry);

  // 최대 개수 유지
  if (logEntries.length > LOG_MAX) logEntries.pop();

  // 카운터 업데이트
  updateLogCounters();

  // DOM 렌더
  renderLogEntry(entry, true);

  // 자동 스크롤
  if (logAutoScroll) {
    const c = el("txLog");
    if (c) c.scrollTop = 0;
  }
}

function renderLogEntry(entry, prepend = false) {
  const container = el("txLog");
  if (!container) return;

  // 필터 적용
  if (logFilter !== "all" && entry.type !== logFilter) return;
  if (logSearch && !entry.msg.toLowerCase().includes(logSearch) &&
      !entry.detail.toLowerCase().includes(logSearch)) return;

  const div = document.createElement("div");
  div.className    = `tx-entry tx-${entry.type}`;
  div.dataset.seq  = entry.seq;
  div.dataset.type = entry.type;

  const hashHtml = entry.hash
    ? `<div class="tx-hash" onclick="copyToClip('${entry.hash}')" title="클릭 → 복사">
         🔗 ${entry.hash.slice(0, 14)}...${entry.hash.slice(-8)}
       </div>`
    : "";

  // detail 줄바꿈 처리
  const detailSafe = entry.detail
    ? `<div class="tx-detail">${entry.detail.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\n/g,"<br>")}</div>`
    : "";

  div.innerHTML = `
    <div class="tx-header">
      <span class="tx-type">${TYPE_ICON[entry.type] || "•"} [${String(entry.seq).padStart(3,"0")}] ${TYPE_LABEL[entry.type] || entry.type}</span>
      <span class="tx-time">${entry.time}</span>
    </div>
    <div class="tx-msg">${entry.msg.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</div>
    ${hashHtml}
    ${detailSafe}
  `;

  if (prepend) {
    container.prepend(div);
    // 최대 DOM 노드 수 제한
    while (container.children.length > LOG_MAX) {
      container.removeChild(container.lastChild);
    }
  } else {
    container.appendChild(div);
  }
}

function updateLogCounters() {
  const counts = { all:logEntries.length, success:0, error:0, event:0, info:0, warning:0, step:0, call:0 };
  logEntries.forEach(e => { if (counts[e.type] !== undefined) counts[e.type]++; });

  // 필터 버튼 배지
  Object.keys(counts).forEach(k => {
    [`logCount_${k}`, `logCount_${k}2`].forEach(id => {
      const e2 = el(id);
      if (e2) e2.textContent = counts[k];
    });
  });
}

// 필터 변경
function setLogFilter(type) {
  logFilter = type;
  document.querySelectorAll(".log-filter-btn").forEach(b => b.classList.remove("active"));
  const active = document.querySelector(`[data-filter="${type}"]`);
  if (active) active.classList.add("active");
  rebuildLogView();
}

// 검색
function onLogSearch(val) {
  logSearch = val.toLowerCase().trim();
  rebuildLogView();
}

// DOM 전체 재구성 (필터/검색 변경 시)
function rebuildLogView() {
  const container = el("txLog");
  if (!container) return;
  container.innerHTML = "";
  // 최신순 (이미 unshift로 앞에 추가되므로 순서 그대로)
  logEntries.forEach(entry => renderLogEntry(entry, false));
}

// 전체 로그 지우기
function clearLog() {
  logEntries = [];
  logSeq     = 0;
  const c = el("txLog");
  if (c) c.innerHTML = "";
  updateLogCounters();
  addLog("info", "로그 초기화됨");
}

// 로그 파일로 내보내기
function exportLog() {
  const lines = logEntries.map(e =>
    `[${e.time}] [${e.seq}] [${e.type.toUpperCase()}] ${e.msg}` +
    (e.detail ? `\n  └ ${e.detail.replace(/\n/g, "\n    ")}` : "") +
    (e.hash   ? `\n  🔗 TxHash: ${e.hash}` : "")
  ).join("\n\n");

  const blob = new Blob([lines], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `dental_insurance_log_${new Date().toISOString().slice(0,19).replace(/:/g,"-")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  addLog("info", `로그 내보내기 완료 (총 ${logEntries.length}건)`);
}

// 자동 스크롤 토글
function toggleAutoScroll() {
  logAutoScroll = !logAutoScroll;
  const btn = el("autoScrollBtn");
  if (btn) btn.textContent = logAutoScroll ? "⬆ 자동스크롤 ON" : "⬆ 자동스크롤 OFF";
  btn.style.opacity = logAutoScroll ? "1" : "0.5";
  addLog("info", `자동 스크롤 ${logAutoScroll ? "켜짐" : "꺼짐"}`);
}

// 클립보드 복사
function copyToClip(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast("복사됨: " + text.slice(0, 30) + "..."))
    .catch(() => showToast("복사 실패", "error"));
}

// ── 전역 에러 캐치 ─────────────────────────────────────────────
window.onerror = function(msg, src, line, col, err) {
  addLog("error", `[JS 전역 오류] ${msg}`,
    `파일: ${src}\n위치: ${line}:${col}\n${err ? parseError(err) : ""}`);
};
window.addEventListener("unhandledrejection", (e) => {
  addLog("error", `[미처리 Promise 거절] ${e.reason?.message || e.reason}`,
    e.reason ? parseError(e.reason) : "");
});

// input[type=number]에 포커스된 채로 스크롤하면 크롬이 값을 조용히 증감시키는 것을 방지
// (예: 100 입력 후 페이지 스크롤 → 99.78처럼 의도치 않게 값이 바뀌는 문제)
document.addEventListener("wheel", (e) => {
  const active = document.activeElement;
  if (active && active.tagName === "INPUT" && active.type === "number") {
    active.blur();
  }
}, { passive: true });

// ── 토스트 ────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const colors = { info:"#2f81f7", success:"#3fb950", error:"#f85149", warning:"#d29922" };
  const t = document.createElement("div");
  t.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:${colors[type]||colors.info};color:#fff;
    padding:10px 18px;border-radius:8px;font-size:13px;
    box-shadow:0 4px 16px rgba(0,0,0,0.4);max-width:360px;word-break:break-all;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════════
//  네트워크 전환 (Hardhat Local, chainId 31337)
// ═══════════════════════════════════════════════════════════════
const HARDHAT_CHAIN_ID     = "0x7A69";   // 31337
const HARDHAT_CHAIN_ID_DEC = 31337n;

function showNetworkModal() {
  const m = document.getElementById("networkModal");
  if (m) m.classList.remove("hidden");
}

function hideNetworkModal() {
  const m = document.getElementById("networkModal");
  if (m) m.classList.add("hidden");
}

async function switchToHardhat() {
  addLog("step", "[네트워크 전환] Hardhat Local(31337)로 전환 시도 (wallet_switchEthereumChain)");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HARDHAT_CHAIN_ID }]
    });
    addLog("success", "네트워크 전환 성공 → Hardhat Local (31337)");
    return true;
  } catch (switchErr) {
    addLog("warning", "wallet_switchEthereumChain 실패",
      `코드: ${switchErr.code}\n사유: ${switchErr.message}\n→ 수동 전환 안내 모달 표시`);
    // 어떤 오류든 수동 안내 모달을 띄운다
    showNetworkModal();
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  MetaMask 연결
// ═══════════════════════════════════════════════════════════════
async function connectWallet() {
  addLog("step", "[1] MetaMask 연결 시작");

  if (!window.ethereum) {
    addLog("error", "MetaMask 미설치",
      "window.ethereum 객체가 없습니다.\n→ https://metamask.io 에서 설치 후 새로고침");
    showToast("MetaMask를 설치해주세요!", "error");
    return;
  }
  addLog("info", "window.ethereum 감지됨", `isMetaMask: ${window.ethereum.isMetaMask}`);

  try {
    el("connectBtn").disabled  = true;
    el("connectBtn").innerHTML = `<span class="spinner"></span> 연결 중...`;

    // ── [2] 계정 연결
    addLog("step", "[2] eth_requestAccounts 요청 중 (MetaMask 팝업 확인)");
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer   = await provider.getSigner();
    userAddr = await signer.getAddress();
    addLog("success", "[3] 계정 연결됨", `주소: ${userAddr}`);

    // ── [3] 현재 네트워크 확인
    const network = await provider.getNetwork();
    addLog("info", "[4] 현재 네트워크 확인",
      `이름    : ${network.name}\nChain ID: ${network.chainId}\n` +
      (network.chainId === HARDHAT_CHAIN_ID_DEC
        ? "→ ✅ Hardhat Local 정상"
        : `→ ❌ 잘못된 네트워크 (mainnet/기타)\n   필요: 31337 / 현재: ${network.chainId}\n   → 자동 전환 시도 중...`)
    );

    // ── [4] Mainnet 등 다른 네트워크면 자동 전환
    if (network.chainId !== HARDHAT_CHAIN_ID_DEC) {
      addLog("warning", `현재 네트워크: ${network.name} (${network.chainId}) → 31337로 전환 필요`);
      showToast("Hardhat Local 네트워크로 전환 중...", "warning");

      const switched = await switchToHardhat();
      if (!switched) {
        // 모달이 이미 표시됨 — 사용자가 수동 전환 후 "다시 연결" 클릭 유도
        addLog("warning", "네트워크 수동 전환 필요",
          "화면의 안내 모달을 참고해 MetaMask에서 Hardhat Local(127.0.0.1:8545, chainId 31337)로\n직접 전환 후 [전환 완료 → 다시 연결] 버튼을 클릭하세요.");
        return;
      }

      // 전환 후 provider/signer 재초기화 (chainChanged 이벤트 전에 직접 재초기화)
      addLog("step", "[5] 네트워크 전환 완료 → provider 재초기화");
      provider = new ethers.BrowserProvider(window.ethereum);
      signer   = await provider.getSigner();
      userAddr = await signer.getAddress();
    }

    // ── [5] 전환 후 네트워크 최종 확인
    const finalNetwork = await provider.getNetwork();
    addLog("success", "[6] 네트워크 최종 확인",
      `이름    : ${finalNetwork.name}\nChain ID: ${finalNetwork.chainId}\n→ ✅ Hardhat Local 정상`);

    updateWalletUI(finalNetwork);

    // ── [6] config.json → 컨트랙트 자동 연결
    addLog("step", "[7] config.json 로드 시도");
    await tryLoadConfig();

    const usdcIn = el("usdcAddr").value.trim();
    const insIn  = el("insAddr").value.trim();

    if (ethers.isAddress(usdcIn) && ethers.isAddress(insIn)) {
      addLog("step", "[8] 컨트랙트 자동 연결 시작",
        `USDC: ${usdcIn}\n보험: ${insIn}`);
      await loadContracts(usdcIn, insIn);
    } else {
      addLog("warning", "[8] 컨트랙트 주소 없음 - 수동 입력 필요",
        `→ Setup 패널에 주소 입력 후 [컨트랙트 연결] 클릭\n` +
        `  MockUSDC       : 0x5FbDB2315678afecb367f032d93F642f64180aa3\n` +
        `  DentalInsurance: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`);
      await updateStatusPanel(null, false);
    }

    window.ethereum.on("accountsChanged", (accounts) => {
      addLog("warning", "MetaMask 계정 변경 감지 - 페이지 새로고침",
        `새 계정: ${accounts[0] || "(없음)"}`);
      location.reload();
    });
    window.ethereum.on("chainChanged", (chainId) => {
      addLog("warning", "네트워크 변경 감지 - 페이지 새로고침",
        `새 Chain ID: ${parseInt(chainId, 16)}`);
      location.reload();
    });

  } catch (err) {
    addLog("error", "MetaMask 연결 실패", parseError(err));
    showToast("연결 실패: " + (err.shortMessage || err.message), "error");
  } finally {
    el("connectBtn").disabled  = false;
    el("connectBtn").innerHTML = userAddr
      ? `<span class="pulse-dot"></span> 연결됨`
      : `🦊 MetaMask 연결`;
  }
}

function updateWalletUI(network) {
  const badge    = el("networkBadge");
  const isHardhat = network.chainId === HARDHAT_CHAIN_ID_DEC;

  badge.textContent = isHardhat
    ? `Hardhat Local (31337)`
    : `⚠️ ${network.name || network.chainId} (잘못된 네트워크)`;
  badge.className   = isHardhat ? "network-badge connected" : "network-badge wrong-network";

  renderHeaderName();  // 우선 KNOWN_ACCOUNTS로 표시
}

// 헤더 이름 렌더 — KNOWN_ACCOUNTS 우선, 없으면 컨트랙트 조회
async function renderHeaderName() {
  const addrEl = el("walletAddr");
  if (!addrEl || !userAddr) return;

  const info = getAccountInfo(userAddr);
  let name = info ? info.name : null;

  // KNOWN_ACCOUNTS에 없으면 컨트랙트에서 피보험자명 조회
  if (!name && insCtx) {
    try {
      const ids = await insCtx.getPatientPolicies(userAddr);
      if (ids.length > 0) {
        const policy = await insCtx.getPolicy(ids[0]);
        name = policy.patientName;
      }
    } catch { /* 무시 */ }
  }

  addrEl.textContent = name
    ? `${name} (${shortAddr(userAddr)})`
    : shortAddr(userAddr);
  addrEl.title = userAddr;
}

// ── 연결 상태 패널 ─────────────────────────────────────────────
async function updateStatusPanel(ownerAddr, contractOk) {
  const panel = el("statusPanel");
  if (!panel) return;
  panel.classList.remove("hidden");

  // ① KNOWN_ACCOUNTS 조회
  const info = getAccountInfo(userAddr);
  let displayName = info ? info.name : null;
  let accountTag  = info ? `Account ${info.account}` : null;

  // ② KNOWN_ACCOUNTS에 없으면 컨트랙트에서 피보험자명 조회
  let policyLabel = null;
  if (insCtx && contractOk && !isOwner) {
    try {
      const ids = await insCtx.getPatientPolicies(userAddr);
      if (ids.length > 0) {
        const policy = await insCtx.getPolicy(ids[0]);
        policyLabel = `${policy.patientName} (증권 #${policy.id})`;
        if (!displayName) displayName = policy.patientName;
      }
    } catch { /* 무시 */ }
  }

  const nameHtml = displayName
    ? `<strong style="color:var(--accent-yellow)">${displayName}</strong>${accountTag ? ` <span style="color:var(--text-muted);font-size:10px">${accountTag}</span>` : ""} · `
    : "";

  const addrEl = el("statusMyAddr");
  if (addrEl) {
    addrEl.innerHTML = `${nameHtml}<span style="cursor:pointer" onclick="navigator.clipboard.writeText('${userAddr}').then(()=>showToast('복사됨'))">${shortAddr(userAddr)}</span>`;
  }

  if (el("statusOwner"))    el("statusOwner").textContent    = ownerAddr ? shortAddr(ownerAddr) : "-";
  if (el("statusContract")) el("statusContract").textContent = contractOk ? "✅ 연결됨" : "❌ 미연결";

  const roleEl = el("statusRole");
  if (roleEl) {
    if (!contractOk) {
      roleEl.textContent = "컨트랙트 미연결";
      roleEl.style.color = "var(--text-muted)";
    } else if (isOwner) {
      roleEl.innerHTML = `<span style="color:var(--accent-green)">⚙️ 관리자 (오너)</span>`;
    } else {
      roleEl.innerHTML = `<span style="color:var(--accent-blue)">👤 피보험자</span>`;
    }
  }

  // 피보험자명 표시
  const nameEl = el("statusPolicyName");
  if (nameEl) {
    if (policyLabel) {
      nameEl.style.display = "flex";
      el("statusPolicyNameVal").textContent = policyLabel;
    } else {
      nameEl.style.display = "none";
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  컨트랙트 로드
// ═══════════════════════════════════════════════════════════════
async function loadContracts(usdcAddress, insAddress) {
  addLog("step", "컨트랙트 로드 시작");
  try {
    if (!provider) {
      addLog("error", "컨트랙트 로드 실패", "provider 없음 - MetaMask를 먼저 연결하세요.");
      showToast("먼저 MetaMask를 연결해주세요.", "warning");
      return;
    }
    if (!ethers.isAddress(usdcAddress)) {
      addLog("error", "USDC 주소 오류", `입력값: "${usdcAddress}"\n→ 올바른 0x 주소가 아닙니다.`);
      showToast("올바른 USDC 주소를 입력하세요.", "error");
      return;
    }
    if (!ethers.isAddress(insAddress)) {
      addLog("error", "보험 컨트랙트 주소 오류", `입력값: "${insAddress}"\n→ 올바른 0x 주소가 아닙니다.`);
      showToast("올바른 보험 컨트랙트 주소를 입력하세요.", "error");
      return;
    }

    usdcAddr = usdcAddress;
    insAddr  = insAddress;

    // 통화 전환(switchCurrency) 시 이 함수가 다시 호출되면서 insCtx가 새 Contract
    // 인스턴스로 교체된다. provider는 세션 내내 재사용되는 공유 객체라, 예전 insCtx에
    // attachEventListeners()로 걸어둔 리스너(PolicyCreated 등)를 여기서 정리하지
    // 않으면 provider 쪽에는 계속 살아있게 된다 — USDC↔KRW를 여러 번 오가면 같은
    // 통화로 돌아올 때마다 리스너가 하나씩 더 쌓여, 실제 이벤트 1건에 이메일/Slack
    // 알림이 통화 전환 횟수만큼 중복 발송되는 버그가 있었음 (2026-09-18 발견 — 사용자가
    // 같은 증권 발급 이메일을 5통씩 받음). 새 인스턴스를 만들기 전에 이전 것부터 정리.
    if (insCtx) insCtx.removeAllListeners();

    addLog("info", "컨트랙트 인스턴스 생성",
      `USDC : ${usdcAddr}\n보험 : ${insAddr}`);

    usdcCtx  = new ethers.Contract(usdcAddr, USDC_ABI, provider);
    insCtx   = new ethers.Contract(insAddr,  INSURANCE_ABI, provider);
    usdcSign = new ethers.Contract(usdcAddr, USDC_ABI, signer);
    insSign  = new ethers.Contract(insAddr,  INSURANCE_ABI, signer);

    if (reserveAddr && ethers.isAddress(reserveAddr)) {
      reserveCtx  = new ethers.Contract(reserveAddr, RESERVE_ABI, provider);
      reserveSign = new ethers.Contract(reserveAddr, RESERVE_ABI, signer);
    } else {
      reserveCtx = null; reserveSign = null;
    }

    // insCtx와 동일한 이유로, 통화 전환 시 재생성 전에 이전 리스너를 정리한다
    // (안 하면 통화를 오갈 때마다 리스너가 쌓여 조기해지 이메일이 중복 발송됨).
    if (altInvestCtx) altInvestCtx.removeAllListeners();
    if (altInvestAddr && ethers.isAddress(altInvestAddr)) {
      altInvestCtx  = new ethers.Contract(altInvestAddr, ALTINVEST_ABI, provider);
      altInvestSign = new ethers.Contract(altInvestAddr, ALTINVEST_ABI, signer);
    } else {
      altInvestCtx = null; altInvestSign = null;
    }

    // insCtx/altInvestCtx와 동일한 이유로 재생성 전에 이전 리스너를 정리한다.
    if (paramCtx) paramCtx.removeAllListeners();
    if (paramAddr && ethers.isAddress(paramAddr)) {
      paramCtx  = new ethers.Contract(paramAddr, PARAM_ABI, provider);
      paramSign = new ethers.Contract(paramAddr, PARAM_ABI, signer);
    } else {
      paramCtx = null; paramSign = null;
    }

    if (reinsuranceCtx) reinsuranceCtx.removeAllListeners();
    if (reinsuranceAddr && ethers.isAddress(reinsuranceAddr)) {
      reinsuranceCtx  = new ethers.Contract(reinsuranceAddr, REINSURANCE_ABI, provider);
      reinsuranceSign = new ethers.Contract(reinsuranceAddr, REINSURANCE_ABI, signer);
    } else {
      reinsuranceCtx = null; reinsuranceSign = null;
    }

    // 오너 조회
    addLog("call", "owner() 조회 중...");
    const ownerAddr = await insCtx.owner();
    isOwner = ownerAddr.toLowerCase() === userAddr.toLowerCase();

    addLog("success", "컨트랙트 오너 확인",
      `오너 주소 : ${ownerAddr}\n내   주소 : ${userAddr}\n일치 여부 : ${isOwner ? "✅ 일치 → 관리자" : "❌ 불일치 → 피보험자"}`);

    el("usdcAddr").value = usdcAddr;
    el("insAddr").value  = insAddr;

    updateAdminOnlyVisibility();
    if (isOwner) {
      el("adminBadge").classList.remove("hidden");
      addLog("success", "✅ 관리자 권한 활성화됨 - 보험증권 생성·청구 심사·보험금 지급 가능");
    } else {
      el("adminBadge").classList.add("hidden");
      addLog("info", `👤 피보험자 모드 활성화\n관리자 주소: ${shortAddr(ownerAddr)}\n→ 관리자 기능 사용 시 Account #0 으로 전환 후 새로고침`);
    }

    await updateStatusPanel(ownerAddr, true);
    await renderHeaderName();   // 컨트랙트 연결 후 이름 재조회

    if (!eventListenersAttached) {
      attachEventListeners();
      eventListenersAttached = true;
      addLog("info", "📡 실시간 이벤트 리스너 활성화됨");
    }

    addLog("step", "컨트랙트 데이터 로드 중...");
    await refreshAll();
    showToast(isOwner ? "✅ 관리자로 연결됨!" : "✅ 컨트랙트 연결 완료!", "success");

  } catch (err) {
    addLog("error", "컨트랙트 로드 실패", parseError(err));
    showToast("로드 실패: " + (err.shortMessage || err.message), "error");
    await updateStatusPanel(null, false);
  }
}

async function loadContractsFromInputs() {
  addLog("step", "[컨트랙트 연결] 버튼 클릭됨");
  await loadContracts(el("usdcAddr").value.trim(), el("insAddr").value.trim());
}

// ── config.json 로드 ─────────────────────────────────────────
async function tryLoadConfig() {
  try {
    addLog("call", "config.json 로드 시도...");
    const res = await fetch("config.json?t=" + Date.now());
    if (!res.ok) {
      addLog("warning", "config.json 없음 또는 로드 실패",
        `HTTP ${res.status}: ${res.statusText}\n→ 먼저 배포를 실행하세요.`);
      return;
    }
    const cfg = await res.json();
    configCache = cfg;
    if (typeof cfg.krwPerUsd === "number" && cfg.krwPerUsd > 0) {
      KRW_PER_USD = cfg.krwPerUsd; // scripts/deploy.js가 기록한 값 — 백엔드(mock-provider.js)와 동일한 소스
    }
    if (cfg.contracts) {
      applyConfigForCurrency();
      addLog("success", "config.json 로드 완료",
        `네트워크  : ${cfg.network} (chainId: ${cfg.chainId})\n` +
        `배포자    : ${cfg.deployer}\n` +
        `배포일    : ${cfg.deployedAt}\n` +
        `MockUSDC  : ${cfg.contracts.MockUSDC}\n` +
        `MockKRW   : ${cfg.contracts.MockKRW || "없음"}\n` +
        `Insurance(USDC) : ${cfg.contracts.DentalInsurance}\n` +
        `Insurance(KRW)  : ${cfg.contracts.DentalInsuranceKRW || "없음"}`);
    } else {
      addLog("warning", "config.json 에 contracts 항목 없음", JSON.stringify(cfg, null, 2));
    }
  } catch (err) {
    addLog("warning", "config.json 파싱 오류", parseError(err));
  }
}

// ── 통화별 컨트랙트 주소 적용 ────────────────────────────────
function applyConfigForCurrency() {
  if (!configCache?.contracts) return;
  if (currencyMode === 'KRW') {
    el("usdcAddr").value = configCache.contracts.MockKRW            || "";
    el("insAddr").value  = configCache.contracts.DentalInsuranceKRW || "";
    reserveAddr = configCache.contracts.ReserveFundKRW || "";
    altInvestAddr = configCache.contracts.AltInvestmentFundKRW || "";
    paramAddr = configCache.contracts.ParametricInsuranceKRW || "";
    reinsuranceAddr = configCache.contracts.ReinsurancePoolKRW || "";
    if (el("tokenAddrLabel")) el("tokenAddrLabel").textContent = "📄 MockKRW 컨트랙트 주소";
    if (el("insAddrLabel"))   el("insAddrLabel").textContent   = "🏥 DentalInsurance(KRW) 컨트랙트 주소";
  } else {
    el("usdcAddr").value = configCache.contracts.MockUSDC        || "";
    el("insAddr").value  = configCache.contracts.DentalInsurance || "";
    reserveAddr = configCache.contracts.ReserveFund || "";
    altInvestAddr = configCache.contracts.AltInvestmentFund || "";
    paramAddr = configCache.contracts.ParametricInsurance || "";
    reinsuranceAddr = configCache.contracts.ReinsurancePool || "";
    if (el("tokenAddrLabel")) el("tokenAddrLabel").textContent = "📄 MockUSDC 컨트랙트 주소";
    if (el("insAddrLabel"))   el("insAddrLabel").textContent   = "🏥 DentalInsurance 컨트랙트 주소";
  }
}

// ── 통화별 UI 레이블 갱신 ────────────────────────────────────
function updateCurrencyLabels() {
  const isKrw = currencyMode === 'KRW';
  const sym   = stableName();

  // 버튼 활성화 상태
  const btnUSDC = document.getElementById("btnCurrUSDC");
  const btnKRW  = document.getElementById("btnCurrKRW");
  if (btnUSDC) btnUSDC.classList.toggle("active", !isKrw);
  if (btnKRW)  btnKRW.classList.toggle("active",   isKrw);

  // 헤더 배지
  const badge = document.getElementById("currencyVersionBadge");
  if (badge) badge.textContent = isKrw ? '🇰🇷 원화 KRW' : '💵 USDC';

  // 파우셋 섹션
  if (el("faucetCardTitle")) el("faucetCardTitle").textContent =
    `💰 테스트 ${sym} 수령 (파우셋)`;
  if (el("faucetLabel")) el("faucetLabel").textContent = `수령 금액 (${sym})`;
  if (el("faucetBtnText")) el("faucetBtnText").textContent = `${sym} 수령하기`;
  if (el("faucetReserveBtnText")) el("faucetReserveBtnText").textContent = `준비금 계좌에 예치`;
  if (el("faucetDesc")) el("faucetDesc").textContent = isKrw
    ? "이것은 테스트용 가상 원화(KRW)입니다. 최대 1회 1,000만원 수령 가능하며, 보험료 납입 및 테스트에 사용됩니다."
    : "이것은 테스트용 가상 USDC입니다. 최대 1회 10,000 USDC 수령 가능하며, 보험료 납입 및 테스트에 사용됩니다.";

  // 파우셋 빠른 금액 버튼
  const quickBtns = el("faucetQuickBtns");
  if (quickBtns) {
    if (isKrw) {
      quickBtns.innerHTML = `
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='100000'">100,000원</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='500000'">500,000원</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='1000000'">100만원</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='5000000'">500만원</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='10000000'">1,000만원</button>`;
    } else {
      quickBtns.innerHTML = `
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='100'">100 USDC</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='500'">500 USDC</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='1000'">1,000 USDC</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='5000'">5,000 USDC</button>
        <button class="btn btn-ghost" onclick="el('faucetAmount').value='10000'">10,000 USDC</button>`;
    }
  }

  // 잔액 표시
  if (el("balanceCurrencyLabel"))    el("balanceCurrencyLabel").textContent    = sym;
  if (el("balanceCurrencySubLabel")) el("balanceCurrencySubLabel").textContent = `${sym} (Mock)`;

  // 청구 금액 레이블
  if (el("claimAmountLabel")) el("claimAmountLabel").textContent =
    isKrw ? "청구 금액 (원화 KRW)" : "청구 금액 (USDC)";

  // ── 계약 심사 탭 ──────────────────────────────────────────
  if (el("appPremiumLabel"))  el("appPremiumLabel").textContent  =
    isKrw ? "월 보험료 (원화 KRW)" : "월 보험료 (USDC)";
  if (el("appCoverageLabel")) el("appCoverageLabel").textContent =
    isKrw ? "보장 한도 (원화 KRW)" : "보장 한도 (USDC)";
  if (el("appMinPremiumRule")) el("appMinPremiumRule").innerHTML  =
    isKrw
      ? `최소 월 보험료: <strong style="color:var(--text-primary)">10,000원 이상</strong>`
      : `최소 월 보험료: <strong style="color:var(--text-primary)">1 USDC 이상</strong>`;
  if (el("appApproveNote")) el("appApproveNote").textContent =
    isKrw
      ? `승인 시 보험증권이 자동 생성됩니다. 피보험자에게 KRW가 사전에 있어야 보험료 납입이 가능합니다.`
      : `승인 시 보험증권이 자동 생성됩니다. 피보험자에게 USDC가 사전에 있어야 보험료 납입이 가능합니다.`;
  if (typeof recalcApplicationPremium === "function") recalcApplicationPremium();

  // ── 약관대출 탭 ───────────────────────────────────────────
  if (el("loanAmountLabel")) el("loanAmountLabel").textContent =
    isKrw ? "대출 금액 (원화 KRW)" : "대출 금액 (USDC)";
  if (el("loanRepayNote")) el("loanRepayNote").innerHTML =
    isKrw
      ? `상환 전 KRW 잔액을 확인하세요. 원금 + 이자를 한 번에 상환합니다.<br>상환 시 KRW approve → repay 순으로 처리됩니다.`
      : `상환 전 USDC 잔액을 확인하세요. 원금 + 이자를 한 번에 상환합니다.<br>상환 시 USDC approve → repay 순으로 처리됩니다.`;
  if (el("loanExampleBox")) el("loanExampleBox").innerHTML = isKrw
    ? `납입 보험료 100,000원, 환급율 70% 기준:<br>
       해지환급금 = 100,000 × 70% = <strong style="color:var(--accent-green)">70,000원</strong><br>
       최대 대출액 = 70,000 × 80% = <strong style="color:var(--accent-blue)">56,000원</strong>`
    : `납입 보험료 100 USDC, 환급율 70% 기준:<br>
       해지환급금 = 100 × 70% = <strong style="color:var(--accent-green)">70 USDC</strong><br>
       최대 대출액 = 70 × 80% = <strong style="color:var(--accent-blue)">56 USDC</strong>`;

  // ── 준비금 계좌 탭 ────────────────────────────────────────
  if (el("reserveDepositLabel"))  el("reserveDepositLabel").textContent  = `송금 금액 (${sym})`;
  if (el("reserveWithdrawLabel")) el("reserveWithdrawLabel").textContent = `인출 금액 (${sym})`;

  // ── 보험료 납입 탭 ────────────────────────────────────────
  if (el("premiumApproveNote")) el("premiumApproveNote").textContent =
    `보험료 납입 시 자동으로 ${sym} approve → payPremium 순서로 처리됩니다 (선택한 증권이 실제로 속한 통화 기준). MetaMask에서 2번의 서명이 필요할 수 있습니다.`;
  if (el("premiumCurrencyNote")) el("premiumCurrencyNote").textContent =
    `보험료는 그 증권이 등록된 통화(USDC 또는 KRW)로 납입됩니다 — 현재 화면 통화: ${sym}`;
  if (el("premiumBalanceNote")) el("premiumBalanceNote").textContent =
    `납입 전 충분한 ${sym} 잔액이 있어야 합니다 (다른 통화 증권을 납입하려면 그 통화 잔액 필요)`;
  if (el("premiumMyBalanceLabel")) el("premiumMyBalanceLabel").textContent = `내 ${sym} 잔액`;

  // ── 관리자 패널: 준비금 입금 / 토큰 민팅 (현재 화면 통화 컨트랙트 기준) ──
  if (el("depositAmountLabel")) el("depositAmountLabel").textContent = `입금 금액 (${sym})`;
  if (el("depositAmountNote")) el("depositAmountNote").textContent =
    `* 관리자 ${sym} 잔액에서 컨트랙트로 이전됩니다. approve가 자동 처리됩니다.`;
  if (el("mintCardTitle")) el("mintCardTitle").textContent = `💵 ${sym} 관리자 민팅`;
  if (el("mintAmountLabel")) el("mintAmountLabel").textContent = `민팅 금액 (${sym})`;
  if (el("mintBtnText")) el("mintBtnText").textContent = `💵 ${sym} 민팅 (무제한)`;

  // ── 블록체인 상태 탭 ──────────────────────────────────────
  if (el("stateMyBalLabel")) el("stateMyBalLabel").textContent = `내 ${sym} 잔액`;
  if (el("stateUsdcSupplyLabel")) el("stateUsdcSupplyLabel").textContent = `${sym} 총 발행량`;
}

// ── 통화 전환 ────────────────────────────────────────────────
function clearLoanDisplay() {
  ["loanTotalPaid","loanSurrenderVal","loanMaxAmount","loanActiveStatus",
   "loanPrincipal","loanInterest","loanRepayTotal","loanBorrowedAt"].forEach(id => {
    if (el(id)) el(id).textContent = "-";
  });
  if (el("loanInfoBox"))   el("loanInfoBox").style.display   = "none";
  if (el("loanRequestBox"))el("loanRequestBox").style.display= "block";
  if (el("loanRepayBox"))  el("loanRepayBox").style.display  = "none";
  if (el("loanCurBox"))    el("loanCurBox").style.display    = "none";
  _loanMaxAmount = 0n;
}

async function switchCurrency(mode) {
  if (currencyMode === mode) return;
  currencyMode = mode;

  // UI 레이블 갱신
  updateCurrencyLabels();
  // 이전 통화의 대출 표시 초기화
  clearLoanDisplay();
  addLog("step", `통화 전환: ${mode}`);

  // 컨트랙트 주소 교체
  applyConfigForCurrency();

  // 컨트랙트 재연결
  const newUsdcAddr = el("usdcAddr").value.trim();
  const newInsAddr  = el("insAddr").value.trim();
  if (newUsdcAddr && newInsAddr) {
    eventListenersAttached = false; // 이벤트 리스너 재등록 허용
    await loadContracts(newUsdcAddr, newInsAddr);
  } else {
    addLog("warning", "통화 전환", `${mode} 컨트랙트 주소 없음 — 배포 후 재시도하세요.`);
    showToast(`${mode} 컨트랙트 주소가 없습니다. 배포 후 재시도하세요.`, "warning");
  }
}

// ═══════════════════════════════════════════════════════════════
//  이벤트 리스너
// ═══════════════════════════════════════════════════════════════
function attachEventListeners() {
  insCtx.on("PolicyCreated", (policyId, patient, name, premium, limit, ts, event) => {
    addLog("event", `📋 보험증권 생성 이벤트: #${policyId} - ${name}`,
      `피보험자 : ${patient}\n월보험료 : ${fmtUsdc(premium)}\n보장한도 : ${fmtUsdc(limit)}\n블록     : ${event.log.blockNumber}`,
      event.log.transactionHash);
    refreshAll();
    // 이 지갑(patient) 주소로 등록해둔 이메일이 있으면 email-service.js에 발송 요청 —
    // certificate-service.js가 PDF를 만드는 데 몇 초 걸리므로, email-service.js
    // 쪽에서 짧게 대기한 뒤 PDF를 첨부해 이메일로 보내는 구조를 전제로 함.
    notifyCertReady(policyId, patient, name);
  });
  insCtx.on("PremiumPaid", (policyId, patient, amount, totalPaid, ts, event) => {
    addLog("event", `💳 보험료 납입 이벤트: 증권 #${policyId}`,
      `납입자   : ${patient}\n납입금액 : ${fmtUsdc(amount)}\n누적납입 : ${fmtUsdc(totalPaid)}`,
      event.log.transactionHash);
    refreshAll();
  });
  insCtx.on("ClaimSubmitted", (claimId, policyId, patient, amount, code, ts, event) => {
    addLog("event", `🦷 보험금 청구 이벤트: #${claimId} (증권 #${policyId})`,
      `청구자   : ${patient}\n청구금액 : ${fmtUsdc(amount)}\n치료코드 : ${code}`,
      event.log.transactionHash);
    refreshAll();
  });
  insCtx.on("ClaimApproved", (claimId, policyId, amount, ts, event) => {
    addLog("event", `✅ 청구 승인 이벤트: 청구 #${claimId}`,
      `증권 ID  : #${policyId}\n승인금액 : ${fmtUsdc(amount)}`,
      event.log.transactionHash);
    refreshAll();
    notifyClaimUpdate("claim_approved", claimId);
  });
  insCtx.on("ClaimRejected", (claimId, policyId, reason, ts, event) => {
    addLog("event", `❌ 청구 거절 이벤트: 청구 #${claimId}`,
      `증권 ID  : #${policyId}\n거절사유 : ${reason}`,
      event.log.transactionHash);
    refreshAll();
    notifyClaimUpdate("claim_rejected", claimId, { reason });
  });
  insCtx.on("ClaimPaid", (claimId, policyId, patient, amount, ts, event) => {
    addLog("event", `💰 보험금 지급 이벤트: 청구 #${claimId}`,
      `수령자   : ${patient}\n지급금액 : ${fmtUsdc(amount)}`,
      event.log.transactionHash);
    refreshAll();
    notifyClaimUpdate("claim_paid", claimId);
  });
  insCtx.on("FundsDeposited", (depositor, amount, ts, event) => {
    addLog("event", `🏦 준비금 입금 이벤트: ${fmtUsdc(amount)} USDC`,
      `입금자: ${depositor}`,
      event.log.transactionHash);
    refreshAll();
  });
  insCtx.on("MaturityRefundPaid", (policyId, patient, refundAmount, ts, event) => {
    addLog("event", `💎 만기환급금 지급 이벤트: 증권 #${policyId}`,
      `수령자   : ${patient}\n환급금액 : ${fmtUsdc(refundAmount)}`,
      event.log.transactionHash);
    showToast(`💎 증권 #${policyId} 만기환급금 ${fmtUsdc(refundAmount)} 지급 완료!`, "success");
    refreshAll();
    refreshMaturity();
  });
  insCtx.on("PremiumAutoCollected", (policyId, patient, amount, totalPaid, ts, event) => {
    addLog("event", `🔄 자동납부 수납 이벤트: 증권 #${policyId}`,
      `피보험자 : ${patient}\n수납금액 : ${fmtUsdc(amount)}\n누적납입 : ${fmtUsdc(totalPaid)}`,
      event.log.transactionHash);
    showToast(`🔄 증권 #${policyId} 자동납부 ${fmtUsdc(amount)} 수납 완료!`, "success");
    refreshAll();
    refreshAutopaySchedule();
  });
  insCtx.on("ClaimOracleVerified", (claimId, approved, dataHash, hospitalName, ts, event) => {
    addLog("event", `🏥 오라클 검증 이벤트: 청구 #${claimId}`,
      `결과     : ${approved ? "✅ 승인 → 자동 지급" : "❌ 거절"}\n병원명   : ${hospitalName}\n데이터해시: ${dataHash}`,
      event.log.transactionHash);
    showToast(
      approved
        ? `🏥 청구 #${claimId} 오라클 승인 — 보험금 자동 지급!`
        : `🏥 청구 #${claimId} 오라클 거절 (${hospitalName || "사유 확인 필요"})`,
      approved ? "success" : "error"
    );
    refreshAll();
  });

  if (reserveCtx) {
    reserveCtx.on("ReserveDeposited", (patient, amount, newPrincipal, ts, event) => {
      addLog("event", `🏛️ 준비금 송금 이벤트: ${fmtUsdc(amount)}`,
        `고객     : ${patient}\n이후 원금: ${fmtUsdc(newPrincipal)}`,
        event.log.transactionHash);
      refreshAll();
    });
    reserveCtx.on("ReserveWithdrawn", (patient, amount, newPrincipal, ts, event) => {
      addLog("event", `🏛️ 준비금 인출 이벤트: ${fmtUsdc(amount)}`,
        `고객     : ${patient}\n이후 원금: ${fmtUsdc(newPrincipal)}`,
        event.log.transactionHash);
      refreshAll();
    });
    reserveCtx.on("InterestAccrued", (patient, interestAmount, newPrincipal, ts, event) => {
      refreshAll();
    });
  }

  if (altInvestCtx) {
    altInvestCtx.on("Invested", (investor, fundId, amount, newPrincipal, unlockTime, ts, event) => {
      addLog("event", `🪙 대체투자 이벤트: ${fmtUsdc(amount)}`,
        `투자자   : ${investor}\n펀드ID   : #${fundId}\n이후 원금: ${fmtUsdc(newPrincipal)}`,
        event.log.transactionHash);
      refreshAll();
      const fund = _altInvestFundsCache[Number(fundId)];
      notifyAltInvestUpdate("altinvest_invested", investor, fundId, {
        amountFormatted: fmtByCcy(amount, currencyMode),
        aprFormatted: fund ? `${(Number(fund.aprBps) / 100).toFixed(1)}%` : "-",
        unlockDateFormatted: tsToDate(unlockTime),
      });
    });
    altInvestCtx.on("Withdrawn", (investor, fundId, amount, newPrincipal, ts, event) => {
      addLog("event", `💰 대체투자 인출 이벤트: ${fmtUsdc(amount)}`,
        `투자자   : ${investor}\n펀드ID   : #${fundId}\n잔여 원금: ${fmtUsdc(newPrincipal)}`,
        event.log.transactionHash);
      refreshAll();
    });
    altInvestCtx.on("EarlyWithdrawn", (investor, fundId, amount, penalty, payout, newPrincipal, ts, event) => {
      addLog("event", `⚠️ 대체투자 조기해지 이벤트: ${fmtUsdc(amount)}`,
        `투자자   : ${investor}\n펀드ID   : #${fundId}\n페널티   : ${fmtUsdc(penalty)}\n실수령   : ${fmtUsdc(payout)}`,
        event.log.transactionHash);
      refreshAll();
      notifyAltInvestUpdate("altinvest_early_exit", investor, fundId, {
        amountFormatted: fmtByCcy(amount, currencyMode),
        penaltyFormatted: fmtByCcy(penalty, currencyMode),
        payoutFormatted: fmtByCcy(payout, currencyMode),
      });
    });
    altInvestCtx.on("InterestAccrued", (investor, fundId, interestAmount, newPrincipal, ts, event) => {
      refreshAll();
    });
  }

  if (paramCtx) {
    paramCtx.on("CoveragePurchased", (coverageId, holder, productId, premium, expiryTime, ts, event) => {
      addLog("event", `🌦️ 파라메트릭 커버리지 구매 이벤트: #${coverageId}`,
        `가입자   : ${holder}\n상품ID   : #${productId}\n보험료   : ${fmtUsdc(premium)}`,
        event.log.transactionHash);
      refreshAll();
    });
    paramCtx.on("CoverageResolved", async (coverageId, status, observedValue, payoutAmount, ts, event) => {
      const cov = await paramCtx.getCoverage(coverageId).catch(() => null);
      const statusLabel = Number(status) === 1 ? "🎯 트리거(자동지급)" : "⌛ 만료(미지급)";
      addLog("event", `${statusLabel} 파라메트릭 이벤트: #${coverageId}`,
        `관측값   : ${observedValue}\n지급액   : ${fmtUsdc(payoutAmount)}`,
        event.log.transactionHash);
      showToast(`${statusLabel} — 커버리지 #${coverageId}`, Number(status) === 1 ? "success" : "warning");
      refreshAll();
      if (cov) {
        const product = _paramProductsCache[Number(cov.productId)];
        notifyParametricUpdate(Number(status) === 1 ? "parametric_triggered" : "parametric_expired", cov.holder, coverageId, {
          productName: product ? product.name : `상품 #${cov.productId}`,
          observedValue: Number(observedValue),
          thresholdFormatted: product ? String(product.triggerThreshold) : "-",
          payoutFormatted: fmtByCcy(payoutAmount, currencyMode),
        });
      }
    });
  }

  if (reinsuranceCtx) {
    reinsuranceCtx.on("Deposited", (investor, amount, sharesMinted, newShares, ts, event) => {
      addLog("event", `🛡️ 재보험풀 예치 이벤트: ${fmtUsdc(amount)}`,
        `투자자   : ${investor}\n발행 지분: ${sharesMinted}`,
        event.log.transactionHash);
      refreshAll();
      reinsuranceCtx.previewShareValue(investor).then(pos => {
        notifyReinsuranceUpdate("reinsurance_deposit", investor, event.log.transactionHash, {
          amountFormatted: fmtByCcy(amount, currencyMode),
          assetValueFormatted: fmtByCcy(pos.assetValue, currencyMode),
        });
      }).catch(() => {});
    });
    reinsuranceCtx.on("Withdrawn", (investor, shareAmount, amountPaid, newShares, ts, event) => {
      addLog("event", `🛡️ 재보험풀 인출 이벤트: ${fmtUsdc(amountPaid)}`,
        `투자자   : ${investor}\n소각 지분: ${shareAmount}`,
        event.log.transactionHash);
      refreshAll();
      reinsuranceCtx.previewShareValue(investor).then(pos => {
        notifyReinsuranceUpdate("reinsurance_withdraw", investor, event.log.transactionHash, {
          amountFormatted: fmtByCcy(amountPaid, currencyMode),
          assetValueFormatted: fmtByCcy(pos.assetValue, currencyMode),
        });
      }).catch(() => {});
    });
    reinsuranceCtx.on("ClaimDrawUsed", (to, amount, ts, event) => {
      addLog("event", `⚠️ 재보험풀 청구 백스톱 인출 이벤트: ${fmtUsdc(amount)}`,
        `수령자(관리자): ${to}`,
        event.log.transactionHash);
      showToast(`⚠️ 재보험풀에서 ${fmtUsdc(amount)} 인출됨 (청구 지급 재원 보전)`, "warning");
      refreshAll();
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  데이터 새로고침
// ═══════════════════════════════════════════════════════════════
async function refreshAll() {
  if (!insCtx) return;
  try {
    await Promise.all([
      refreshStats(),
      refreshPolicies(),
      refreshClaims(),
      refreshOracleStatus(),
      refreshBlockchainState(),
      refreshMyBalance(),
      refreshMaturity(),
      refreshApplications(),
      refreshLoanPolicies(),
      refreshPremiumHistory(),
      refreshAutopaySchedule(),
      refreshClaimCoverageInfo(),
      refreshReserve(),
      refreshAltInvest(),
      refreshParametric(),
      refreshReinsurance()
    ]);
  } catch (err) {
    addLog("error", "데이터 새로고침 실패", parseError(err));
  }
}

async function refreshStats() {
  const handle = getContractsForCcy(currencyMode);
  if (!handle?.ctx) return;
  try {
    // 현재 화면 통화(currencyMode)의 계약만 집계 — 관리자: 전체 계정 합산 / 일반: 본인 데이터만
    let policyRows = (await fetchAllPoliciesBothCcy()).filter(r => r.ccy === currencyMode);   // [{p, ccy, decimals}]
    let claimRows  = (await fetchAllClaimsBothCcy()).filter(r => r.ccy === currencyMode);     // [{c, ov, ccy}]
    let appRows    = (await fetchAllApplicationsBothCcy()).filter(r => r.ccy === currencyMode); // [{a, ccy}]
    if (!isOwner) {
      policyRows = policyRows.filter(({ p }) => p.patient.toLowerCase() === userAddr?.toLowerCase());
      claimRows  = claimRows.filter(({ c }) => c.patient.toLowerCase() === userAddr?.toLowerCase());
      appRows    = appRows.filter(({ a }) => a.applicant.toLowerCase() === userAddr?.toLowerCase());
    }

    // ── 계정별 라벨 문구 (관리자: 전체 합산 / 일반: 본인 합계) ──
    const labelPremiumsEl = el("labelStatPremiums");
    if (labelPremiumsEl) labelPremiumsEl.textContent = isOwner ? "💳 총 보험료 수납" : "💳 납입 보험료 합계";
    const labelClaimsEl = el("labelStatClaims");
    if (labelClaimsEl) labelClaimsEl.textContent = isOwner ? "💰 총 보험금 지급" : "💰 지급받은 보험금 합계";

    // ── 보험료 수납 / 보험금 지급 ────────────────────────────
    if (isOwner) {
      let totalPremiums = 0n, totalClaimsPaid = 0n, totalClaimsCount = 0;
      try {
        const stats = await handle.ctx.getStats();
        totalPremiums    = stats.premiumsCollected;
        totalClaimsPaid  = stats.claimsPaid;
        totalClaimsCount = Number(stats.claimsCount);
      } catch (e) {
        addLog("error", `[${currencyMode}] 통계 조회 실패`, e.message);
      }
      el("statPremiums").textContent  = fmtByCcy(totalPremiums, currencyMode);
      el("statClaims").textContent    = fmtByCcy(totalClaimsPaid, currencyMode);
      el("statClaimsNum").textContent = totalClaimsCount.toString();
    } else {
      const totalPremiums = policyRows.reduce((sum, { p }) => sum + BigInt(p.totalPaid), 0n);
      el("statPremiums").textContent = fmtByCcy(totalPremiums, currencyMode);
    }

    // ── 보험사(컨트랙트) 잔액 ──────────────────────────────────
    try {
      const balance = await handle.ctx.getContractBalance();
      el("statBalance").textContent = fmtByCcy(balance, currencyMode);
    } catch (e) {
      addLog("error", `[${currencyMode}] 컨트랙트 잔액 조회 실패`, e.message);
    }

    // ── 준비금 잔액: 일반 계정은 본인 것만("내 준비금 잔액"), 관리자는 전체 합계("보험사 준비금 잔액") ───
    if (el("statReserveBalance")) {
      el("statReserveBalance").textContent = fmtByCcy(await getViewerReserveBalance(), currencyMode);
    }

    // ── 보험증권: 전체 vs 활성 ──────────────────────────────────
    const activeCount = policyRows.filter(({ p }) => p.active).length;
    el("statPolicies").textContent      = activeCount.toString();
    el("statPoliciesTotal").textContent = isOwner ? `전체 ${policyRows.length}건` : `내 증권 ${policyRows.length}건`;

    // ── 청구 ────────────────────────────────────────────────────
    const pendingClaims = claimRows.filter(({ c }) => Number(c.status) === 0).length;
    el("statClaimsPending").textContent = `대기 ${pendingClaims}건`;
    if (!isOwner) {
      el("statClaimsNum").textContent = claimRows.length.toString();
      const myClaimsPaid = claimRows.reduce((sum, { c }) =>
        Number(c.status) === 3 ? sum + BigInt(c.amount) : sum, 0n);
      el("statClaims").textContent = fmtByCcy(myClaimsPaid, currencyMode);
    }

    // ── 청약 심사 현황 ────────────────────────────────────────
    el("statAppPending").textContent  = appRows.filter(({ a }) => Number(a.status) === 0).length.toString();
    el("statAppApproved").textContent = appRows.filter(({ a }) => Number(a.status) === 1).length.toString();
    el("statAppRejected").textContent = appRows.filter(({ a }) => Number(a.status) === 2).length.toString();

    // ── 약관대출 현황 (본인/전체 증권 기준) ─────────────────────
    const loanEntries = await Promise.all(policyRows.map(({ p }) => handle.ctx.getPolicyLoan(p.id).catch(() => null)));
    const activeLoans  = loanEntries.filter(loan => loan && loan.active);
    const totalLoanAmt = activeLoans.reduce((sum, loan) => sum + BigInt(loan.loanAmount), 0n);
    el("statLoanCount").textContent  = activeLoans.length.toString();
    el("statLoanAmount").textContent = activeLoans.length > 0
      ? `총 ${fmtByCcy(totalLoanAmt, currencyMode)}` : "없음";

    // ── 만기환급 현황 (실제 지급액은 MaturityRefundPaid 이벤트에서 합산 —
    //    약관대출이 있었던 건은 원리금 차감 후 순액이 지급되고 현재 상태로는
    //    복원 불가하므로, totalPaid×refundRate% gross 재계산 대신 이벤트 로그 사용) ─
    const matured = policyRows.filter(({ p }) => p.maturityPaid);
    let totalMatAmt = 0n;
    try {
      let events = await handle.ctx.queryFilter(handle.ctx.filters.MaturityRefundPaid()).catch(() => []);
      if (!isOwner) events = events.filter(ev => ev.args.patient.toLowerCase() === userAddr?.toLowerCase());
      totalMatAmt = events.reduce((sum, ev) => sum + BigInt(ev.args.refundAmount), 0n);
    } catch (e) {
      addLog("error", `[${currencyMode}] 만기환급 이벤트 조회 실패`, e.message);
    }
    el("statMaturityCount").textContent  = matured.length.toString();
    el("statMaturityAmount").textContent = matured.length > 0
      ? `총 ${fmtByCcy(totalMatAmt, currencyMode)}` : "없음";

  } catch (err) {
    addLog("error", "통계 조회 실패", parseError(err));
  }
}

// 일반 계정: 본인 준비금 잔액만 / 관리자: 전체 고객 준비금 합산액(보험사 준비금 잔액)
async function getViewerReserveBalance() {
  if (!reserveCtx) return 0n;
  if (isOwner) {
    const holders  = await reserveCtx.getAllHolders().catch(() => []);
    const previews = await Promise.all(holders.map(a => reserveCtx.previewBalance(a).catch(() => ({ projectedPrincipal: 0n }))));
    return previews.reduce((s, p) => s + p.projectedPrincipal, 0n);
  }
  if (!userAddr) return 0n;
  const preview = await reserveCtx.previewBalance(userAddr).catch(() => ({ projectedPrincipal: 0n }));
  return preview.projectedPrincipal;
}

// refreshStats() 전용 — 두 통화 준비금계좌를 합쳐 현재 화면 통화로 환산한 합계를 반환
async function getViewerReserveBalance() {
  const handle = getReserveForCcy(currencyMode);
  if (!handle?.ctx) return 0n;
  try {
    if (isOwner) {
      const holders  = await handle.ctx.getAllHolders().catch(() => []);
      const previews = await Promise.all(holders.map(a => handle.ctx.previewBalance(a).catch(() => ({ projectedPrincipal: 0n }))));
      return previews.reduce((s, p) => s + p.projectedPrincipal, 0n);
    } else if (userAddr) {
      const preview = await handle.ctx.previewBalance(userAddr).catch(() => ({ projectedPrincipal: 0n }));
      return preview.projectedPrincipal;
    }
  } catch (e) {
    addLog("error", `[${currencyMode}] 준비금 잔액 조회 실패`, e.message);
  }
  return 0n;
}

async function refreshMyBalance() {
  if (!usdcCtx || !userAddr) return;
  try {
    // 관리자는 거래 주체가 아니므로 개인 지갑 잔액은 0으로 표시
    const bal = isOwner ? 0n : await usdcCtx.balanceOf(userAddr);
    el("myUsdcBal").textContent     = fmtUsdc(bal);
    el("statMyBalance").textContent = fmtUsdc(bal);
    const premBalEl = el("premiumMyBalance");
    if (premBalEl) premBalEl.textContent = fmtUsdc(bal);

    if (el("myReserveBal")) el("myReserveBal").textContent = fmtUsdc(await getViewerReserveBalance());
  } catch (err) {
    addLog("error", "잔액 조회 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  공통 트랜잭션 전송 (모든 단계 로깅)
// ═══════════════════════════════════════════════════════════════
async function sendTx(txFn, label, onSuccess) {
  addLog("step", `[TX 시작] ${label}`);
  let tx = null;
  try {
    addLog("info", "MetaMask 서명 요청 중...", "MetaMask 팝업에서 확인을 클릭하세요.");
    tx = await txFn();

    addLog("info", `[TX 제출됨] 컨펌 대기 중...`,
      `TxHash: ${tx.hash}\nNonce : ${tx.nonce}\nGas   : ${tx.gasLimit?.toString() || "-"}\nTo    : ${tx.to}`,
      tx.hash);

    const receipt = await tx.wait();

    if (receipt.status === 0) {
      addLog("error", `[TX 실패] ${label}`,
        `블록    : ${receipt.blockNumber}\nGasUsed : ${receipt.gasUsed}\nStatus  : 0 (실패)\n→ Solidity 조건 위반 가능성 확인`,
        tx.hash);
      showToast("트랜잭션 실패 (revert)", "error");
      return;
    }

    addLog("success", `[TX 완료] ${label}`,
      `블록     : ${receipt.blockNumber}\nGasUsed  : ${receipt.gasUsed.toString()}\nStatus   : 1 (성공)\nTxHash   : ${tx.hash}`,
      tx.hash);
    showToast(`완료: ${label}`, "success");

    if (onSuccess) await onSuccess();

  } catch (err) {
    const detail = parseError(err);
    addLog("error", `[TX 실패] ${label}`, detail + (tx ? `\n\nTxHash: ${tx.hash}` : ""));
    showToast("실패: " + (err.shortMessage || err.reason || err.message || "오류").slice(0, 80), "error");
  }
}

// ═══════════════════════════════════════════════════════════════
//  USDC 파우셋
// ═══════════════════════════════════════════════════════════════
async function useFaucet() {
  const tokenName = stableName();
  addLog("step", `[파우셋] ${tokenName} 수령 시작`);
  if (!usdcSign) {
    addLog("error", "파우셋 실패", "컨트랙트를 먼저 연결하세요.");
    showToast("컨트랙트를 먼저 연결하세요.", "warning");
    return;
  }
  const rawVal = el("faucetAmount").value;
  const amount = parseUsdc(rawVal);
  // 통화별 최대 파우셋 한도
  const MAX = currencyMode === 'KRW'
    ? ethers.parseUnits("10000000", 0)   // 최대 1천만원
    : ethers.parseUnits("10000",    6);  // 최대 $10,000

  addLog("info", "파우셋 입력값 확인",
    `입력: ${rawVal} ${tokenName} | 변환: ${amount.toString()} | 최대: ${fmtUsdc(MAX)}`);

  if (amount <= 0n) {
    addLog("error", "파우셋 입력 오류", `금액 0 이하: ${rawVal}`);
    showToast("금액을 입력하세요.", "warning");
    return;
  }
  if (amount > MAX) {
    addLog("error", "파우셋 한도 초과", `요청: ${fmtUsdc(amount)} > 최대: ${fmtUsdc(MAX)}`);
    showToast(`최대 ${fmtUsdc(MAX)}까지 수령 가능합니다.`, "warning");
    return;
  }

  // 잔액 사전 확인
  const balBefore = await usdcCtx.balanceOf(userAddr).catch(() => 0n);
  addLog("info", "파우셋 전 잔액", fmtUsdc(balBefore));

  await sendTx(
    async () => usdcSign.faucet(amount),
    `${tokenName} 파우셋: ${fmtUsdc(amount)}`,
    async () => {
      await refreshMyBalance();
      const balAfter = await usdcCtx.balanceOf(userAddr).catch(() => 0n);
      addLog("success", "파우셋 완료",
        `수령 전: ${fmtUsdc(balBefore)}\n수령 후: ${fmtUsdc(balAfter)}\n수령량: ${fmtUsdc(amount)}`);
      showToast(`${fmtUsdc(amount)} ${tokenName} 수령 완료!`, "success");
    }
  );
}

// 파우셋 탭에서 입력한 금액을 그대로 준비금 계좌에 예치 (기존 지갑 잔액에서 차감)
// USDC 수령과는 완전히 별개의 독립된 동작 — depositReserve()를 그대로 재사용
async function depositFaucetAmountToReserve() {
  if (el("reserveDepositAmount")) el("reserveDepositAmount").value = el("faucetAmount")?.value || "";
  await depositReserve();
}

// ═══════════════════════════════════════════════════════════════
//  보험증권
// ═══════════════════════════════════════════════════════════════
async function createPolicy() {
  addLog("step", "[보험증권 생성] 시작");
  if (!insSign) {
    addLog("error", "증권 생성 실패", "insSign 없음 - 컨트랙트 연결 필요");
    showToast("컨트랙트를 먼저 연결하세요.", "warning"); return;
  }
  if (!isOwner) {
    addLog("error", "증권 생성 권한 없음",
      `내 주소: ${userAddr}\n→ 관리자(Account #0)만 생성 가능`);
    showToast("관리자만 보험증권을 생성할 수 있습니다.", "error"); return;
  }

  const patient  = el("policyPatient").value.trim();
  const name     = el("policyName").value.trim();
  const premiumRaw  = el("policyPremium").value;
  const coverageRaw = el("policyCoverage").value;
  const premium  = parseUsdc(premiumRaw);
  const coverage = parseUsdc(coverageRaw);

  addLog("info", "증권 생성 입력값",
    `피보험자 주소 : ${patient}\n피보험자 이름 : ${name}\n월 보험료     : ${premiumRaw} → ${fmtUsdc(premium)}\n보장 한도     : ${coverageRaw} → ${fmtUsdc(coverage)}`);

  if (!ethers.isAddress(patient)) {
    addLog("error", "입력 오류: 피보험자 주소", `"${patient}" 은(는) 유효한 주소가 아닙니다.`);
    showToast("올바른 피보험자 주소를 입력하세요.", "error"); return;
  }
  if (!name) {
    addLog("error", "입력 오류: 피보험자 이름", "이름이 비어있습니다.");
    showToast("피보험자 이름을 입력하세요.", "warning"); return;
  }
  if (premium <= 0n) {
    addLog("error", "입력 오류: 월 보험료", `입력값: "${premiumRaw}" → 0 이하`);
    showToast("월 보험료를 입력하세요.", "warning"); return;
  }
  if (coverage <= 0n) {
    addLog("error", "입력 오류: 보장 한도", `입력값: "${coverageRaw}" → 0 이하`);
    showToast("보장 한도를 입력하세요.", "warning"); return;
  }

  const maturityDaysRaw  = el("policyMaturityDays")?.value || "365";
  const maturityRateRaw  = el("policyMaturityRate")?.value || "70";
  const maturityDays     = parseInt(maturityDaysRaw) || 365;
  const maturityRate     = parseInt(maturityRateRaw) || 70;
  const maturityDate     = Math.floor(Date.now() / 1000) + maturityDays * 86400;

  addLog("info", "만기 설정",
    `만기일  : ${new Date(maturityDate * 1000).toLocaleDateString("ko-KR")} (${maturityDays}일 후)\n환급율  : ${maturityRate}%`);

  const flexiblePayment = !!el("policyFlexiblePayment")?.checked;

  await sendTx(
    async () => insSign.createPolicy(patient, name, premium, coverage, maturityDate, maturityRate, flexiblePayment),
    `보험증권 생성: ${name}`,
    async () => {
      el("policyName").value = "";
      el("policyPatient").value = "";
      el("policyPremium").value = "";
      el("policyCoverage").value = "";
      if (el("policyFlexiblePayment")) el("policyFlexiblePayment").checked = false;
      await refreshPolicies();
    }
  );
}

// 두 통화 컨트랙트에서 증권 목록을 함께 가져와 {p, ccy, decimals} 형태로 합침.
// 하나가 없거나 조회에 실패해도(예: KRW 컨트랙트 미배포) 나머지 통화는 그대로 보여준다.
async function fetchAllPoliciesBothCcy() {
  const handles = [getContractsForCcy('USDC'), getContractsForCcy('KRW')].filter(h => h && h.ctx);
  const lists = await Promise.all(handles.map(async (h) => {
    try {
      const ids = await h.ctx.getAllPolicyIds();
      const policies = await Promise.all(ids.map(id => h.ctx.getPolicy(id)));
      return policies.map(p => ({ p, ccy: h.ccy, decimals: h.decimals }));
    } catch (e) {
      addLog("error", `[${h.ccy}] 보험증권 목록 조회 실패`, e.message);
      return [];
    }
  }));
  return lists.flat();
}

// ── 검색/필터/CSV 내보내기 공용 헬퍼 ──────────────────────────
// 테이블마다 마지막으로 조회한(소유자 필터까지 적용된) 원본 행을 캐시해두고,
// 검색어 입력 시 재조회 없이 이 캐시만 다시 필터링해서 그려준다.
function tableSearchMatch(term, fields) {
  if (!term) return true;
  const t = term.toLowerCase();
  return fields.some(f => String(f ?? "").toLowerCase().includes(t));
}

// CSV 문자열 이스케이프 + 다운로드 트리거 (엑셀 한글 깨짐 방지용 BOM 포함)
function exportRowsToCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")].concat(rows.map(r => r.map(esc).join(",")));
  const csv = "﻿" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  addLog("info", `${filename} 내보내기 완료 (${rows.length}건)`);
}

let _policyRowsCache = [];

function renderPolicyRows(rows) {
  const tbody = el("policyTableBody");
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color:var(--text-muted);padding:30px">${_policyRowsCache.length === 0 ? "보험증권이 없습니다" : "검색 결과가 없습니다"}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(({ p, ccy }) => `
    <tr>
      <td><strong>#${p.id}</strong></td>
      <td><span class="badge" style="background:${ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${ccy}</span></td>
      <td>${p.patientName}</td>
      <td class="addr-short" onclick="copyToClip('${p.patient}')" title="${p.patient}">${shortAddr(p.patient)}</td>
      <td class="text-right" style="color:var(--accent-blue)">${fmtByCcy(p.monthlyPremium, ccy)}<div style="font-size:10px;color:var(--text-muted)">${convertedAmountLabel(p.monthlyPremium, ccy)}</div></td>
      <td class="text-right" style="color:var(--accent-cyan)">${fmtByCcy(p.coverageLimit, ccy)}<div style="font-size:10px;color:var(--text-muted)">${convertedAmountLabel(p.coverageLimit, ccy)}</div></td>
      <td class="text-right" style="color:var(--accent-green)">${fmtByCcy(p.totalPaid, ccy)}</td>
      <td>${tsToDate(p.lastPaymentTime)}</td>
      <td>
        <span class="badge ${p.active ? "badge-active" : "badge-inactive"}">${p.active ? "활성" : "비활성"}</span>
        ${isOwner && p.active ? `<button class="btn btn-danger btn-sm" onclick="deactivatePolicy('${compositeId(ccy, p.id)}')" style="margin-left:6px">비활성화</button>` : ""}
      </td>
    </tr>`).join("");
}

function filterPolicyTable() {
  const term = el("policySearchInput")?.value.trim() || "";
  const filtered = _policyRowsCache.filter(({ p, ccy }) =>
    tableSearchMatch(term, [p.id, ccy, p.patientName, p.patient])
  );
  renderPolicyRows(filtered);
}

function exportPolicyTableCsv() {
  const rows = _policyRowsCache.map(({ p, ccy }) => [
    p.id.toString(), ccy, p.patientName, p.patient,
    fmtByCcy(p.monthlyPremium, ccy), fmtByCcy(p.coverageLimit, ccy), fmtByCcy(p.totalPaid, ccy),
    tsToDate(p.lastPaymentTime), p.active ? "활성" : "비활성",
  ]);
  exportRowsToCsv(`보험증권_목록_${new Date().toISOString().slice(0,10)}.csv`,
    ["ID", "통화", "피보험자", "지갑주소", "월보험료", "보장한도", "누적납입", "최근납입", "상태"], rows);
}

async function refreshPolicies() {
  if (!insCtx) return;
  try {
    let rows = await fetchAllPoliciesBothCcy();
    if (!el("policyTableBody")) return;
    if (!isOwner) {
      rows = rows.filter(({ p }) => p.patient.toLowerCase() === userAddr?.toLowerCase());
    }
    // 보험금청구/보험료납입/자동납부/약관대출/만기환급 5개 탭의 드롭다운도 currencyMode로 필터링됨
    updateActivePolicySelects(rows);
    // 목록 테이블은 현재 화면 통화(currencyMode)의 계약만 보여준다 — 다른 통화 계약과 섞이지 않도록
    _policyRowsCache = rows.filter(({ ccy }) => ccy === currencyMode);
    addLog("call", `보험증권 목록 조회 (${currencyMode}): ${_policyRowsCache.length}건`);
    filterPolicyTable();
  } catch (err) {
    addLog("error", "보험증권 목록 조회 실패", parseError(err));
  }
}

function updateAdminOnlyVisibility() {
  ["tabBtnAdmin", "cardCreatePolicy", "cardManualMaturity", "cardAdminAppReview", "cardReserveAdmin", "cardAltInvestAdmin", "cardAltInvestAdminHolders", "cardParamAdmin", "cardParamAdminHolders", "cardReinsuranceAdmin", "cardReinsuranceAdminHolders"].forEach(id => {
    const elm = el(id);
    if (!elm) return;
    elm.classList.toggle("hidden", !isOwner);
  });
  // 관리자는 거래 주체가 아니므로 "내 잔액"/"내 준비금 계좌"/"내 만기 설정" 카드는 숨김
  el("cardMyBalance")?.classList.toggle("hidden", isOwner);
  el("cardReserveMine")?.classList.toggle("hidden", isOwner);
  el("cardAltInvestMine")?.classList.toggle("hidden", isOwner);
  el("cardMaturityMine")?.classList.toggle("hidden", isOwner);
  el("cardParamMine")?.classList.toggle("hidden", isOwner);
  el("cardReinsuranceMine")?.classList.toggle("hidden", isOwner);
  // 관리자는 테스트 USDC를 받을 필요가 없으므로 파우셋 버튼은 숨김
  el("faucetBtn")?.classList.toggle("hidden", isOwner);
  if (el("reserveHistoryPatientCol")) el("reserveHistoryPatientCol").style.display = isOwner ? "" : "none";
  if (el("reserveHistoryTitle")) el("reserveHistoryTitle").textContent = isOwner ? "📜 전체 송금/인출 내역" : "📜 내 송금/인출 내역";
  // 준비금 잔액 라벨: 관리자는 "보험사 준비금 잔액"(전체 합계), 일반 계정은 "내 준비금 잔액"(본인 것)
  const reserveLabel = isOwner ? "🏛️ 보험사 준비금 잔액" : "🏛️ 내 준비금 잔액";
  if (el("labelStatReserve")) el("labelStatReserve").textContent = reserveLabel;
  if (el("labelMyReserve"))   el("labelMyReserve").textContent   = reserveLabel;
  // 관리자 전용 탭이 열려있는 상태에서 권한을 잃으면(계정 전환 등) 다른 탭으로 이동
  if (!isOwner && el("tab-admin")?.classList.contains("active")) {
    showTab("faucet");
  }
}

// 현재 화면 통화(currencyMode)의 증권만 채워 넣는 공통 드롭다운 채우기 —
// 실제 값은 "USDC-3"/"KRW-3" 같은 합성 ID로 저장해 어느 컨트랙트로 보낼지 구분한다.
// 보험금청구/보험료납입/자동납부/약관대출/만기환급 5개 탭 모두 이 함수로 채워지며,
// 목록 테이블(보험증권 관리/청구 내역)과 동일하게 currencyMode와 다른 통화의 증권은
// 섞이지 않도록 제외한다 — 다른 통화 증권을 다루려면 상단에서 통화를 전환해야 한다.
function populateCompositeSelect(selId, rows) {
  const sel = el(selId);
  if (!sel) return;
  const allMyRows = userAddr
    ? rows.filter(({ p }) => p.patient.toLowerCase() === userAddr.toLowerCase())
    : [];
  const myRows = allMyRows.filter(({ ccy }) => ccy === currencyMode);
  const hasOtherCcy = myRows.length === 0 && allMyRows.length > 0;
  const cur = sel.value;
  const placeholder = hasOtherCcy
    ? `<option value="">-- ${currencyMode === 'KRW' ? 'USDC' : 'KRW'} 증권만 있습니다. 상단에서 통화를 전환하세요 --</option>`
    : `<option value="">-- 증권 선택 --</option>`;
  sel.innerHTML = placeholder +
    myRows.map(({ p, ccy }) => {
      const val = compositeId(ccy, p.id);
      return `<option value="${val}" ${val === cur ? "selected" : ""}>[${ccy}] #${p.id} - ${p.patientName} (월 ${fmtByCcy(p.monthlyPremium, ccy)})</option>`;
    }).join("");
}

function updateActivePolicySelects(rows) {
  const activeRows = rows.filter(r => r.p.active);
  ["claimPolicyId", "premiumPolicyId", "autopayPolicyId", "loanPolicyId", "maturityPolicyId"]
    .forEach(selId => populateCompositeSelect(selId, activeRows));
}

async function deactivatePolicy(policyIdOrComposite) {
  const parsed = parseCompositeId(policyIdOrComposite);
  const ccy    = parsed ? parsed.ccy : currencyMode;
  const id     = parsed ? parsed.id  : policyIdOrComposite;
  const handle = getContractsForCcy(ccy);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  addLog("step", `[증권 비활성화] [${ccy}] #${id}`);
  if (!confirm(`[${ccy}] 증권 #${id}를 비활성화하시겠습니까?`)) {
    addLog("info", `증권 #${id} 비활성화 취소됨`); return;
  }
  await sendTx(
    async () => handle.sign.deactivatePolicy(id),
    `[${ccy}] 증권 #${id} 비활성화`,
    async () => refreshPolicies()
  );
}

// ═══════════════════════════════════════════════════════════════
//  보험료 납입 (approve + payPremium 각 단계 로깅)
// ═══════════════════════════════════════════════════════════════
function updatePremiumCcyHint() {
  updateCcyHint("premiumCcyHint", el("premiumPolicyId")?.value, { convert: false });
}

async function payPremium() {
  addLog("step", "[보험료 납입] 시작");
  const composite = parseCompositeId(el("premiumPolicyId").value);
  if (!composite) {
    addLog("error", "납입 실패", "증권이 선택되지 않았습니다.");
    showToast("증권을 선택하세요.", "warning"); return;
  }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  const token  = getTokenForCcy(ccy);
  if (!handle?.sign || !token?.sign) {
    addLog("error", "납입 실패", `[${ccy}] 컨트랙트 연결 필요`);
    showToast("컨트랙트를 먼저 연결하세요.", "warning"); return;
  }
  addLog("info", `납입 대상 증권: [${ccy}] #${policyId}`);

  // 증권 정보 조회 (항상 그 증권이 실제로 속한 통화 컨트랙트 기준)
  let policy;
  try {
    addLog("call", `[${ccy}] getPolicy(${policyId}) 조회 중...`);
    policy = await handle.ctx.getPolicy(policyId);
    addLog("info", "증권 정보 확인",
      `피보험자 : ${policy.patientName}\n월보험료 : ${fmtByCcy(policy.monthlyPremium, ccy)}\n활성여부 : ${policy.active ? "✅ 활성" : "❌ 비활성"}\n피보험자 주소: ${policy.patient}`);
  } catch (err) {
    addLog("error", `getPolicy(${policyId}) 실패`, parseError(err));
    showToast("증권 조회 실패", "error"); return;
  }

  if (policy.patient.toLowerCase() !== userAddr.toLowerCase()) {
    addLog("error", "납입 권한 없음",
      `증권 피보험자 : ${policy.patient}\n내 주소       : ${userAddr}\n→ 본인 증권만 납입 가능합니다.`);
    showToast("본인 증권만 납입 가능합니다.", "error"); return;
  }

  const amount = policy.monthlyPremium;
  const insTarget = handle.ctx.target;

  // 잔액 확인
  try {
    const bal = await token.ctx.balanceOf(userAddr);
    addLog("info", `${ccy} 잔액 확인`,
      `보유 잔액 : ${fmtByCcy(bal, ccy)}\n필요 금액 : ${fmtByCcy(amount, ccy)}\n충분 여부 : ${bal >= amount ? "✅ 충분" : "❌ 부족"}`);
    if (bal < amount) {
      addLog("error", `${ccy} 잔액 부족`,
        `보유: ${fmtByCcy(bal, ccy)}\n필요: ${fmtByCcy(amount, ccy)}\n→ 파우셋 탭에서 먼저 ${ccy}를 수령하세요.`);
      showToast(`${ccy} 잔액이 부족합니다. 파우셋에서 먼저 수령하세요.`, "error"); return;
    }
  } catch (err) {
    addLog("error", "잔액 조회 실패", parseError(err));
  }

  // Allowance 확인
  try {
    addLog("call", `allowance(${shortAddr(userAddr)}, ${shortAddr(insTarget)}) 조회 중...`);
    const allowance = await token.ctx.allowance(userAddr, insTarget);
    addLog("info", `${ccy} Allowance 확인`,
      `현재 allowance : ${fmtByCcy(allowance, ccy)}\n필요 금액      : ${fmtByCcy(amount, ccy)}\n추가 승인 필요 : ${allowance < amount ? "✅ 예" : "❌ 아니오 (이미 충분)"}`);

    if (allowance < amount) {
      addLog("step", `[단계 1/2] ${ccy} approve 실행 중...`);
      let approveTx;
      try {
        approveTx = await token.sign.approve(insTarget, amount);
        addLog("info", "approve 트랜잭션 제출됨",
          `금액  : ${fmtByCcy(amount, ccy)}\nSpender: ${insTarget}`,
          approveTx.hash);
        const approveReceipt = await approveTx.wait();
        addLog("success", `${ccy} approve 완료`,
          `블록: ${approveReceipt.blockNumber} | GasUsed: ${approveReceipt.gasUsed}`,
          approveTx.hash);
      } catch (err) {
        addLog("error", `${ccy} approve 실패`, parseError(err));
        showToast(`${ccy} 승인 실패: ` + (err.shortMessage || err.message), "error"); return;
      }
    } else {
      addLog("info", "approve 생략 (기존 allowance 충분)");
    }
  } catch (err) {
    addLog("error", "Allowance 조회 실패", parseError(err));
  }

  addLog("step", "[단계 2/2] payPremium 실행 중...");
  await sendTx(
    async () => handle.sign.payPremium(policyId),
    `보험료 납입: [${ccy}] 증권 #${policyId} (${fmtByCcy(amount, ccy)})`,
    async () => {
      await Promise.all([refreshMyBalance(), refreshPolicies(), refreshStats(), refreshPremiumHistory()]);
      showToast(`보험료 ${fmtByCcy(amount, ccy)} 납입 완료!`, "success");
    }
  );
}

// ── 납입 이력 (수동 payPremium + 자동 collectPremium, 현재 화면 통화(currencyMode)만) ──
async function refreshPremiumHistory() {
  const tbody = el("premiumHistoryBody");
  if (!tbody) return;
  try {
    let rows = [];
    for (const ccy of [currencyMode]) {
      const handle = getContractsForCcy(ccy);
      if (!handle?.ctx) continue;
      try {
        const policyIds = await handle.ctx.getAllPolicyIds();
        let policies = await Promise.all(policyIds.map(id => handle.ctx.getPolicy(id)));
        if (!isOwner) {
          policies = policies.filter(p => p.patient.toLowerCase() === userAddr?.toLowerCase());
        }
        for (const p of policies) {
          const [paidEvents, autoEvents, wellnessEvents] = await Promise.all([
            handle.ctx.queryFilter(handle.ctx.filters.PremiumPaid(p.id)).catch(() => []),
            handle.ctx.queryFilter(handle.ctx.filters.PremiumAutoCollected(p.id)).catch(() => []),
            handle.ctx.queryFilter(handle.ctx.filters.WellnessPremiumAdjusted(p.id)).catch(() => [])
          ]);
          const autoTxHashes = new Set(autoEvents.map(ev => ev.transactionHash));
          paidEvents.forEach(ev => rows.push({
            ccy,
            policyId: p.id,
            patientName: p.patientName,
            amount: ev.args.amount,
            totalPaid: ev.args.totalPaid,
            timestamp: ev.args.timestamp,
            isAuto: autoTxHashes.has(ev.transactionHash),
            isWellness: false,
          }));
          // 웰니스(건강개선) 연동 보험료 조정 — 실제 납입이 아니라 이후 보험료가 바뀐 이벤트라
          // "누적" 대신 조정 사유를 표시하고, 방식 배지도 별도로 구분한다.
          wellnessEvents.forEach(ev => rows.push({
            ccy,
            policyId: p.id,
            patientName: p.patientName,
            amount: ev.args.newAmount,
            totalPaid: null,
            reason: ev.args.reason,
            timestamp: ev.args.timestamp,
            isAuto: false,
            isWellness: true,
          }));
        }
      } catch (e) {
        addLog("error", `[${ccy}] 납입 이력 조회 실패`, e.message);
      }
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--text-muted);padding:20px">납입 이력이 없습니다 (아직 1회도 납입 안 됨)</td></tr>`;
      return;
    }

    rows.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><span class="badge" style="font-size:10px;background:${r.ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${r.ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${r.ccy}</span></td>
        <td>#${r.policyId}${isOwner ? ` (${r.patientName})` : ""}</td>
        <td style="font-size:11px">${tsToDate(r.timestamp)}</td>
        <td class="text-right" style="color:var(--accent-blue)">${fmtByCcy(r.amount, r.ccy)}</td>
        <td>${
          r.isWellness ? `<span class="badge" style="font-size:10px;background:rgba(63,185,80,0.15);color:var(--accent-green)" title="${r.reason || ''}">🩺 웰니스조정</span>`
          : r.isAuto ? `<span class="badge badge-approved" style="font-size:10px">🔄 자동</span>`
          : `<span class="badge" style="font-size:10px;background:rgba(139,148,158,0.15);color:var(--text-muted)">✋ 수동</span>`
        }</td>
        <td class="text-right" style="color:var(--text-muted)">${r.isWellness ? "새 보험료" : fmtByCcy(r.totalPaid, r.ccy)}</td>
      </tr>`).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--accent-red)">조회 실패</td></tr>`;
    addLog("error", "납입 이력 조회 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  보험금 청구
// ═══════════════════════════════════════════════════════════════
async function submitClaim() {
  addLog("step", "[보험금 청구] 시작");

  const composite = parseCompositeId(el("claimPolicyId").value);
  if (!composite) {
    addLog("error", "청구 입력 오류", "증권이 선택되지 않았습니다."); showToast("증권을 선택하세요.", "warning"); return;
  }
  const { ccy: policyCcy, id: policyId } = composite;
  const handle = getContractsForCcy(policyCcy);
  if (!handle?.sign) {
    addLog("error", "청구 실패", `[${policyCcy}] 컨트랙트 연결 필요`);
    showToast("컨트랙트를 먼저 연결하세요.", "warning"); return;
  }

  const amountInputRaw = el("claimAmount").value;
  const displayAmount  = parseUsdc(amountInputRaw); // 현재 화면(currencyMode) 단위로 입력한 값
  const amount = convertRawAmount(displayAmount, currencyMode, policyCcy); // 실제 증권 통화로 환산
  const code   = el("claimCode").value.trim();
  const desc   = el("claimDesc").value.trim();

  const crossCcyNote = policyCcy !== currencyMode
    ? `\n※ 이 증권은 [${policyCcy}] 계약이라 입력하신 ${fmtByCcy(displayAmount, currencyMode)}을(를) ${fmtByCcy(amount, policyCcy)}(으)로 환산해 전송합니다.`
    : "";
  addLog("info", "청구 입력값 확인",
    `증권    : [${policyCcy}] #${policyId}\n청구금액: ${amountInputRaw} → ${fmtByCcy(amount, policyCcy)}${crossCcyNote}\n치료코드: ${code || "(미선택)"}\n설명    : ${desc || "(없음)"}`);

  if (amount <= 0n) {
    addLog("error", "청구 입력 오류", `금액 0 이하: "${amountInputRaw}"`); showToast("청구 금액을 입력하세요.", "warning"); return;
  }
  if (!code) {
    addLog("error", "청구 입력 오류", "치료 코드가 선택되지 않았습니다."); showToast("치료 코드를 선택하세요.", "warning"); return;
  }

  // 증권 정보 확인 (항상 그 증권이 실제로 속한 통화 컨트랙트 기준)
  try {
    addLog("call", `[${policyCcy}] getPolicy(${policyId}) 조회 중...`);
    const policy = await handle.ctx.getPolicy(policyId);
    const remaining = policy.coverageLimit - policy.totalClaimed;
    addLog("info", "청구 전 증권 상태 확인",
      `피보험자  : ${policy.patientName}\n누적납입  : ${fmtByCcy(policy.totalPaid, policyCcy)}\n보장한도  : ${fmtByCcy(policy.coverageLimit, policyCcy)}\n누적지급액: ${fmtByCcy(policy.totalClaimed, policyCcy)}\n잔여한도  : ${fmtByCcy(remaining, policyCcy)}\n청구금액  : ${fmtByCcy(amount, policyCcy)}\n한도초과  : ${amount > remaining ? "❌ 초과 (거절됨)" : "✅ 범위내"}\n납입여부  : ${policy.totalPaid > 0n ? "✅ 납입 이력 있음" : "❌ 납입 이력 없음 (청구 불가)"}`);

    if (policy.totalPaid === 0n) {
      addLog("error", "청구 불가: 납입 이력 없음",
        "보험료 납입 탭에서 먼저 보험료를 납입해야 청구 가능합니다.");
      showToast("먼저 보험료를 납입하세요.", "error"); return;
    }
    if (amount > remaining) {
      addLog("error", "청구 불가: 보장 한도 초과",
        `청구금액 ${fmtByCcy(amount, policyCcy)} > 잔여한도 ${fmtByCcy(remaining, policyCcy)} (보장한도 ${fmtByCcy(policy.coverageLimit, policyCcy)} - 누적지급액 ${fmtByCcy(policy.totalClaimed, policyCcy)})`);
      showToast("보장 한도를 초과하는 금액입니다.", "error"); return;
    }
  } catch (err) {
    addLog("error", "증권 사전 확인 실패", parseError(err));
  }

  await sendTx(
    async () => handle.sign.submitClaim(policyId, amount, code, desc || ""),
    `보험금 청구: [${policyCcy}] 증권 #${policyId} - ${fmtByCcy(amount, policyCcy)} (${code})`,
    async () => {
      el("claimAmount").value = "";
      el("claimDesc").value   = "";
      await Promise.all([refreshClaims(), refreshClaimCoverageInfo()]);
      showToast("보험금 청구가 접수되었습니다.", "success");
    }
  );
}

// ── 선택된 증권의 보장한도/누적지급액/청구가능액 표시 ──────────
async function refreshClaimCoverageInfo() {
  const box = el("claimCoverageInfo");
  if (!box) return;
  const rawValue = el("claimPolicyId")?.value;
  updateCcyHint("claimCcyHint", rawValue, { convert: true });
  const composite = parseCompositeId(rawValue);
  if (!composite) { box.style.display = "none"; return; }
  const handle = getContractsForCcy(composite.ccy);
  if (!handle?.ctx) { box.style.display = "none"; return; }

  try {
    const policy = await handle.ctx.getPolicy(composite.id);
    const available = policy.coverageLimit - policy.totalClaimed;
    el("claimCoverageLimit").textContent = fmtByCcy(policy.coverageLimit, composite.ccy);
    el("claimTotalClaimed").textContent  = fmtByCcy(policy.totalClaimed, composite.ccy);
    el("claimAvailable").textContent     = fmtByCcy(available, composite.ccy);
    box.style.display = "block";
  } catch (err) {
    box.style.display = "none";
    addLog("error", "보장한도 조회 실패", parseError(err));
  }
}

async function fetchAllClaimsBothCcy() {
  const handles = [getContractsForCcy('USDC'), getContractsForCcy('KRW')].filter(h => h && h.ctx);
  const lists = await Promise.all(handles.map(async (h) => {
    try {
      const ids = await h.ctx.getAllClaimIds();
      const [claims, oracleVerifs] = await Promise.all([
        Promise.all(ids.map(id => h.ctx.getClaim(id))),
        Promise.all(ids.map(id => h.ctx.getOracleVerification(id).catch(() => null)))
      ]);
      return claims.map((c, i) => ({ c, ov: oracleVerifs[i], ccy: h.ccy }));
    } catch (e) {
      addLog("error", `[${h.ccy}] 청구 목록 조회 실패`, e.message);
      return [];
    }
  }));
  return lists.flat();
}

let _claimRowsCache = [];

function renderClaimRows(rows) {
  const tbody = el("claimTableBody");
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="color:var(--text-muted);padding:30px">${_claimRowsCache.length === 0 ? "청구 내역이 없습니다" : "검색 결과가 없습니다"}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(({ c, ov, ccy }) => {
    const statusIdx = Number(c.status);
    const isMine    = c.patient.toLowerCase() === userAddr?.toLowerCase();
    const isOracle  = ov && ov.exists;
    const cid       = compositeId(ccy, c.id);
    const oracleBadge = isOracle
      ? `<span style="font-size:10px;background:${ov.approved ? "rgba(35,134,54,0.15)" : "rgba(218,54,51,0.15)"};color:${ov.approved ? "var(--accent-green)" : "var(--accent-red)"};padding:1px 5px;border-radius:3px;margin-left:4px" title="오라클 검증: ${ov.verificationCode}&#10;병원: ${ov.hospitalName}">🏥 ${ov.approved ? "오라클승인" : "오라클거절"}</span>`
      : "";
    return `
    <tr ${isMine ? 'style="background:rgba(47,129,247,0.04)"' : ""}>
      <td><strong>#${c.id}</strong></td>
      <td><span class="badge" style="background:${ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${ccy}</span></td>
      <td>#${c.policyId}</td>
      <td class="addr-short" title="${c.patient}">${shortAddr(c.patient)} ${isMine ? '<span style="color:var(--accent-blue);font-size:10px">(나)</span>' : ""}</td>
      <td class="text-right" style="color:var(--accent-yellow)">${fmtByCcy(c.amount, ccy)}<div style="font-size:10px;color:var(--text-muted)">${convertedAmountLabel(c.amount, ccy)}</div></td>
      <td><code style="font-size:11px">${c.treatmentCode}</code></td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.description}">${c.description || "-"}</td>
      <td><span class="badge ${CLAIM_STATUS_CLASS[statusIdx]}">${CLAIM_STATUS[statusIdx]}</span>${oracleBadge}</td>
      <td style="font-size:11px;color:var(--text-muted)">${tsToDate(c.submittedAt)}</td>
      <td>
        ${isOwner && statusIdx === 0 ? `
          <button class="btn btn-success btn-sm" onclick="approveClaim('${cid}')">승인</button>
          <button class="btn btn-danger btn-sm" onclick="rejectClaimPrompt('${cid}')" style="margin-left:4px">거절</button>` : ""}
        ${isOwner && statusIdx === 1 ? `
          <button class="btn btn-primary btn-sm" onclick="payClaim('${cid}')">💰 지급</button>` : ""}
        ${statusIdx === 2 && c.rejectReason ? `<span style="font-size:11px;color:var(--accent-red)" title="${c.rejectReason}">사유있음</span>` : ""}
        ${isOracle ? `<button class="btn btn-sm" style="font-size:10px;background:rgba(130,80,255,0.15);color:#a78bfa;margin-left:2px" onclick="showOracleDetail('${cid}')">상세</button>` : ""}
      </td>
    </tr>`;
  }).join("");
}

function filterClaimTable() {
  const term = el("claimSearchInput")?.value.trim() || "";
  const filtered = _claimRowsCache.filter(({ c, ccy }) =>
    tableSearchMatch(term, [c.id, ccy, c.policyId, c.patient, c.treatmentCode, c.description, CLAIM_STATUS[Number(c.status)]])
  );
  renderClaimRows(filtered);
}

function exportClaimTableCsv() {
  const rows = _claimRowsCache.map(({ c, ccy }) => [
    c.id.toString(), ccy, c.policyId.toString(), c.patient,
    fmtByCcy(c.amount, ccy), c.treatmentCode, c.description || "",
    CLAIM_STATUS[Number(c.status)], tsToDate(c.submittedAt), c.rejectReason || "",
  ]);
  exportRowsToCsv(`보험금청구_목록_${new Date().toISOString().slice(0,10)}.csv`,
    ["청구ID", "통화", "증권ID", "청구자", "청구금액", "치료코드", "설명", "상태", "청구일시", "거절사유"], rows);
}

async function refreshClaims() {
  if (!insCtx) return;
  try {
    let rows = await fetchAllClaimsBothCcy();
    if (!el("claimTableBody")) return;
    if (!isOwner) {
      rows = rows.filter(({ c }) => c.patient.toLowerCase() === userAddr?.toLowerCase());
    }
    // 목록 테이블은 현재 화면 통화(currencyMode)의 청구만 보여준다 — 다른 통화 청구와 섞이지 않도록
    _claimRowsCache = rows.filter(({ ccy }) => ccy === currencyMode);
    addLog("call", `청구 목록 조회 (${currencyMode}): ${_claimRowsCache.length}건`);
    filterClaimTable();
  } catch (err) {
    addLog("error", "청구 목록 조회 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  관리자 기능
// ═══════════════════════════════════════════════════════════════
async function approveClaim(claimIdOrComposite) {
  const parsed = parseCompositeId(claimIdOrComposite);
  const ccy     = parsed ? parsed.ccy : currencyMode;
  const claimId = parsed ? parsed.id  : claimIdOrComposite;
  const handle  = getContractsForCcy(ccy);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  addLog("step", `[청구 승인] [${ccy}] 청구 #${claimId}`);
  if (!confirm(`[${ccy}] 청구 #${claimId}를 승인하시겠습니까?`)) {
    addLog("info", `청구 #${claimId} 승인 취소됨`); return;
  }

  // 청구 정보 사전 확인
  try {
    const claim = await handle.ctx.getClaim(claimId);
    addLog("info", `청구 #${claimId} 정보 확인`,
      `청구자   : ${claim.patient}\n청구금액 : ${fmtByCcy(claim.amount, ccy)}\n치료코드 : ${claim.treatmentCode}\n현재상태 : ${CLAIM_STATUS[Number(claim.status)]}`);
    if (Number(claim.status) !== 0) {
      addLog("error", "승인 불가",
        `청구 #${claimId} 현재 상태: "${CLAIM_STATUS[Number(claim.status)]}"\n→ 대기중(Pending) 상태만 승인 가능합니다.`);
      showToast("대기중 상태의 청구만 승인 가능합니다.", "error"); return;
    }
    // 보장한도 잔여액 확인 (실제 차감은 지급 시점에 검증되지만 미리 안내)
    const policy    = await handle.ctx.getPolicy(claim.policyId);
    const remaining = policy.coverageLimit - policy.totalClaimed;
    addLog("info", "보장한도 확인",
      `보장한도   : ${fmtByCcy(policy.coverageLimit, ccy)}\n누적지급액 : ${fmtByCcy(policy.totalClaimed, ccy)}\n잔여한도   : ${fmtByCcy(remaining, ccy)}\n이 청구금액: ${fmtByCcy(claim.amount, ccy)}\n한도초과여부: ${claim.amount > remaining ? "⚠️ 초과 (지급 단계에서 revert 예상)" : "✅ 범위내"}`);
    // 보험사 잔액 사전 확인
    const contractBal = await handle.ctx.getContractBalance();
    addLog("info", "보험사 잔액 확인",
      `보험사 잔액   : ${fmtByCcy(contractBal, ccy)}\n청구 금액      : ${fmtByCcy(claim.amount, ccy)}\n지급 가능 여부 : ${contractBal >= claim.amount ? "✅ 가능" : "⚠️ 잔액 부족 (지급 단계에서 실패 가능)"}`);
  } catch (err) {
    addLog("error", "청구 사전 확인 실패", parseError(err));
  }

  await sendTx(
    async () => handle.sign.approveClaim(claimId),
    `[${ccy}] 청구 #${claimId} 승인`,
    async () => refreshAll()
  );
}

async function rejectClaimPrompt(claimIdOrComposite) {
  const parsed = parseCompositeId(claimIdOrComposite);
  const ccy     = parsed ? parsed.ccy : currencyMode;
  const claimId = parsed ? parsed.id  : claimIdOrComposite;
  const handle  = getContractsForCcy(ccy);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  addLog("step", `[청구 거절] [${ccy}] 청구 #${claimId}`);
  const reason = prompt(`[${ccy}] 청구 #${claimId} 거절 사유를 입력하세요:`);
  if (!reason) {
    addLog("info", `청구 #${claimId} 거절 취소됨`); return;
  }
  addLog("info", `거절 사유 입력됨: "${reason}"`);
  await sendTx(
    async () => handle.sign.rejectClaim(claimId, reason),
    `[${ccy}] 청구 #${claimId} 거절 (사유: ${reason})`,
    async () => refreshClaims()
  );
}

async function payClaim(claimIdOrComposite) {
  const parsed = parseCompositeId(claimIdOrComposite);
  const ccy     = parsed ? parsed.ccy : currencyMode;
  const claimId = parsed ? parsed.id  : claimIdOrComposite;
  const handle  = getContractsForCcy(ccy);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  addLog("step", `[보험금 지급] [${ccy}] 청구 #${claimId}`);
  if (!confirm(`[${ccy}] 청구 #${claimId}에 대한 보험금을 지급하시겠습니까?`)) {
    addLog("info", `청구 #${claimId} 지급 취소됨`); return;
  }

  // 사전 확인
  try {
    const claim       = await handle.ctx.getClaim(claimId);
    const policy      = await handle.ctx.getPolicy(claim.policyId);
    const remaining   = policy.coverageLimit - policy.totalClaimed;
    const contractBal = await handle.ctx.getContractBalance();
    addLog("info", `지급 전 확인 (청구 #${claimId})`,
      `수령자        : ${claim.patient}\n청구금액      : ${fmtByCcy(claim.amount, ccy)}\n보장한도      : ${fmtByCcy(policy.coverageLimit, ccy)}\n누적지급액    : ${fmtByCcy(policy.totalClaimed, ccy)}\n잔여한도      : ${fmtByCcy(remaining, ccy)}\n한도초과여부  : ${claim.amount > remaining ? "⚠️ 초과 → TX 실패 예상" : "✅ 범위내"}\n보험사잔액    : ${fmtByCcy(contractBal, ccy)}\n지급가능여부  : ${contractBal >= claim.amount ? "✅ 가능" : "❌ 잔액 부족 → TX 실패 예상"}\n현재상태      : ${CLAIM_STATUS[Number(claim.status)]}`);
    if (Number(claim.status) !== 1) {
      addLog("error", "지급 불가",
        `청구 #${claimId} 현재 상태: "${CLAIM_STATUS[Number(claim.status)]}"\n→ 승인됨(Approved) 상태만 지급 가능합니다.`);
      showToast("승인된 청구만 지급 가능합니다.", "error"); return;
    }
    if (claim.amount > remaining) {
      addLog("error", "보장한도 초과",
        `청구금액 ${fmtByCcy(claim.amount, ccy)} > 잔여한도 ${fmtByCcy(remaining, ccy)} (보장한도 ${fmtByCcy(policy.coverageLimit, ccy)} - 누적지급액 ${fmtByCcy(policy.totalClaimed, ccy)})`);
      showToast("보장 한도를 초과하는 청구입니다.", "error"); return;
    }
    if (contractBal < claim.amount) {
      addLog("error", "보험사 잔액 부족",
        `필요: ${fmtByCcy(claim.amount, ccy)}\n보유: ${fmtByCcy(contractBal, ccy)}\n→ 관리자 패널 > 준비금 입금에서 먼저 입금하세요.`);
      showToast("보험사 잔액이 부족합니다. 준비금을 먼저 입금하세요.", "error"); return;
    }
  } catch (err) {
    addLog("error", "지급 사전 확인 실패", parseError(err));
  }

  await sendTx(
    async () => handle.sign.payClaim(claimId),
    `[${ccy}] 청구 #${claimId} 보험금 지급`,
    async () => { await Promise.all([refreshClaims(), refreshStats()]); }
  );
}

// ── Oracle 상세 팝업 ────────────────────────────────────────────
async function showOracleDetail(claimIdOrComposite) {
  const parsed  = parseCompositeId(claimIdOrComposite);
  const ccy     = parsed ? parsed.ccy : currencyMode;
  const claimId = parsed ? parsed.id  : claimIdOrComposite;
  const handle  = getContractsForCcy(ccy);
  if (!handle?.ctx) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  try {
    const [claim, ov] = await Promise.all([
      handle.ctx.getClaim(claimId),
      handle.ctx.getOracleVerification(claimId)
    ]);
    const lines = [
      `[${ccy}] 청구 #${claimId} 오라클 검증 결과`,
      `─────────────────────────────`,
      `결과       : ${ov.approved ? "✅ 승인 (자동 지급)" : "❌ 거절"}`,
      `병원명     : ${ov.hospitalName || "-"}`,
      `검증 코드  : ${ov.verificationCode}`,
      `검증 시각  : ${tsToDate(ov.verifiedAt)}`,
      `데이터 해시: ${ov.dataHash}`,
      `─────────────────────────────`,
      `치료 코드  : ${claim.treatmentCode}`,
      `청구 금액  : ${fmtByCcy(claim.amount, ccy)}`,
      `청구 상태  : ${CLAIM_STATUS[Number(claim.status)]}`,
    ];
    if (!ov.approved) lines.push(`거절 사유  : ${claim.rejectReason}`);
    alert(lines.join("\n"));
  } catch(e) {
    addLog("error", "오라클 상세 조회 실패", parseError(e));
  }
}

// ── Oracle 모드 관리 (관리자) ──────────────────────────────────
async function setOracleMode(enabled) {
  addLog("step", `[Oracle] 오라클 모드 ${enabled ? "활성화" : "비활성화"} 중...`);
  await sendTx(
    async () => insSign.setOracleMode(enabled),
    `오라클 모드 ${enabled ? "활성화" : "비활성화"}`,
    async () => refreshOracleStatus()
  );
}

async function refreshOracleStatus() {
  if (!insCtx) return;
  try {
    const [enabled, addr] = await Promise.all([
      insCtx.oracleModeEnabled(),
      insCtx.oracleAddress()
    ]);
    const badge = el("oracleModeBadge");
    const addrEl = el("oracleAddrDisplay");
    if (badge) {
      badge.textContent = enabled ? "활성화" : "비활성화";
      badge.style.background = enabled ? "rgba(35,134,54,0.15)" : "rgba(139,148,158,0.15)";
      badge.style.color = enabled ? "var(--accent-green)" : "var(--text-muted)";
    }
    if (addrEl) addrEl.textContent = addr === "0x0000000000000000000000000000000000000000" ? "미설정" : shortAddr(addr);
  } catch(e) {}
}

async function adminApproveClaim() {
  const id = el("adminClaimId").value;
  if (!id) { addLog("error", "청구 ID 없음", "청구 ID를 입력하세요."); showToast("청구 ID를 입력하세요.", "warning"); return; }
  await approveClaim(parseInt(id));
}
async function adminRejectClaim() {
  const id     = el("adminClaimId").value;
  const reason = el("adminRejectReason").value.trim();
  if (!id)     { addLog("error", "청구 ID 없음", ""); showToast("청구 ID를 입력하세요.", "warning"); return; }
  if (!reason) { addLog("error", "거절 사유 없음", ""); showToast("거절 사유를 입력하세요.", "warning"); return; }
  const handle = getContractsForCcy(currencyMode);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  addLog("step", `[관리자 패널] [${currencyMode}] 청구 #${id} 거절 - 사유: ${reason}`);
  await sendTx(
    async () => handle.sign.rejectClaim(parseInt(id), reason),
    `[${currencyMode}] 청구 #${id} 거절 (사유: ${reason})`,
    async () => refreshClaims()
  );
}
async function adminPayClaim() {
  const id = el("adminClaimId").value;
  if (!id) { addLog("error", "청구 ID 없음", ""); showToast("청구 ID를 입력하세요.", "warning"); return; }
  await payClaim(parseInt(id));
}

async function adminDepositFunds() {
  addLog("step", "[준비금 입금] 시작");
  if (!isOwner) {
    addLog("error", "권한 없음", "관리자만 준비금 입금 가능합니다."); showToast("관리자만 가능합니다.", "error"); return;
  }
  const amountRaw = el("depositAmount").value;
  const amount    = parseUsdc(amountRaw);
  addLog("info", "입금 금액 확인", `입력: ${amountRaw} → ${fmtUsdc(amount)}`);
  if (amount <= 0n) {
    addLog("error", "입력 오류", "금액이 0 이하입니다."); showToast("금액을 입력하세요.", "warning"); return;
  }

  // 잔액 확인
  const bal = await usdcCtx.balanceOf(userAddr).catch(() => 0n);
  addLog("info", "관리자 USDC 잔액", `${fmtUsdc(bal)} (입금 필요: ${fmtUsdc(amount)})`);
  if (bal < amount) {
    addLog("error", "잔액 부족", `보유: ${fmtUsdc(bal)}\n필요: ${fmtUsdc(amount)}`);
    showToast("USDC 잔액이 부족합니다.", "error"); return;
  }

  // Approve
  try {
    const allowance = await usdcCtx.allowance(userAddr, insAddr);
    addLog("info", "준비금 입금 allowance 확인",
      `현재: ${fmtUsdc(allowance)}\n필요: ${fmtUsdc(amount)}\n추가 승인 필요: ${allowance < amount}`);
    if (allowance < amount) {
      addLog("step", "[단계 1/2] USDC approve 실행 중...");
      const tx = await usdcSign.approve(insAddr, amount);
      addLog("info", "approve 제출됨", tx.hash, tx.hash);
      await tx.wait();
      addLog("success", "approve 완료");
    } else {
      addLog("info", "approve 생략 (기존 allowance 충분)");
    }
  } catch (err) {
    addLog("error", "approve 실패", parseError(err)); return;
  }

  addLog("step", "[단계 2/2] depositFunds 실행 중...");
  await sendTx(
    async () => insSign.depositFunds(amount),
    `준비금 입금: ${fmtUsdc(amount)} USDC`,
    async () => { el("depositAmount").value = ""; await refreshStats(); }
  );
}

async function adminMintUsdc() {
  addLog("step", "[USDC 민팅] 시작");
  if (!isOwner) {
    addLog("error", "권한 없음", "관리자만 민팅 가능합니다."); showToast("관리자만 가능합니다.", "error"); return;
  }
  const to        = el("mintTo").value.trim();
  const amountRaw = el("mintAmount").value;
  const amount    = parseUsdc(amountRaw);
  addLog("info", "민팅 입력값", `수령 주소: ${to}\n금액: ${amountRaw} → ${fmtUsdc(amount)}`);
  if (!ethers.isAddress(to)) {
    addLog("error", "주소 오류", `"${to}" 은(는) 유효한 주소가 아닙니다.`); showToast("올바른 주소를 입력하세요.", "error"); return;
  }
  if (amount <= 0n) {
    addLog("error", "금액 오류", "0 이하의 금액"); showToast("금액을 입력하세요.", "warning"); return;
  }
  await sendTx(
    async () => usdcSign.mint(to, amount),
    `USDC 민팅: ${fmtUsdc(amount)} → ${shortAddr(to)}`,
    async () => { el("mintAmount").value = ""; el("mintTo").value = ""; }
  );
}

// ═══════════════════════════════════════════════════════════════
//  통계 차트 (외부 라이브러리 없이 인라인 SVG/CSS로 렌더링)
// ═══════════════════════════════════════════════════════════════

// 도넛 차트 — segments: [{label, value(숫자), display(표시용 문자열), color}]
function renderDonutChart(containerId, segments) {
  const box = el(containerId);
  if (!box) return;
  const total = segments.reduce((s, x) => s + x.value, 0);

  const legend = segments.map(s => `
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);margin-top:4px">
      <span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;flex-shrink:0"></span>
      <span>${s.label}</span>
      <span style="color:var(--text-primary);font-weight:600;margin-left:auto">${s.display}</span>
      <span style="color:var(--text-muted);min-width:42px;text-align:right">${total > 0 ? ((s.value / total) * 100).toFixed(1) : "0.0"}%</span>
    </div>`).join("");

  if (total <= 0) {
    box.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:24px 0;font-size:13px">아직 데이터가 없습니다</div>${legend}`;
    return;
  }

  const r = 52, cx = 64, cy = 64, strokeWidth = 22;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.filter(s => s.value > 0).map(s => {
    const frac = s.value / total;
    const dash = Math.max(frac * circumference, 0.0001);
    const gap = circumference - dash;
    const rotate = (offset / total) * 360 - 90;
    offset += s.value;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${strokeWidth}"
      stroke-dasharray="${dash} ${gap}" transform="rotate(${rotate} ${cx} ${cy})">
      <title>${s.label}: ${s.display} (${(frac * 100).toFixed(1)}%)</title>
    </circle>`;
  }).join("");

  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="비중 도넛 차트" style="flex-shrink:0">${arcs}</svg>
      <div style="display:flex;flex-direction:column;flex:1;min-width:160px">${legend}</div>
    </div>`;
}

// 가로 막대 차트 — bars: [{label, value(숫자, 막대 길이 비율 계산용), display(표시용 문자열), color}]
function renderBarChart(containerId, bars) {
  const box = el(containerId);
  if (!box) return;
  const max = Math.max(1, ...bars.map(b => b.value));
  const anyData = bars.some(b => b.value > 0);
  box.innerHTML = bars.map(b => {
    const pct = b.value > 0 ? Math.max(3, (b.value / max) * 100) : 0;
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:4px">
          <span>${b.label}</span>
          <span style="color:var(--text-primary);font-weight:600">${b.display}</span>
        </div>
        <div style="background:var(--bg-input);border-radius:5px;height:12px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${b.color};border-radius:5px;transition:width .3s"
               title="${b.label}: ${b.display}"></div>
        </div>
      </div>`;
  }).join("") + (anyData ? "" : `<div style="text-align:center;color:var(--text-muted);padding:8px 0;font-size:12px">아직 데이터가 없습니다</div>`);
}

// 4개 통계 차트를 USDC+KRW 통합 데이터로 갱신 — refreshBlockchainState()에서 호출됨
async function refreshStatCharts() {
  if (!getContractsForCcy(currencyMode)?.ctx) return;
  const sym = stableName();
  if (el("chartCcySplitUnit"))    el("chartCcySplitUnit").textContent    = sym;
  if (el("chartAppStatusUnit"))   el("chartAppStatusUnit").textContent   = sym;
  if (el("chartClaimStatusUnit")) el("chartClaimStatusUnit").textContent = sym;
  if (el("chartFundsFlowUnit"))   el("chartFundsFlowUnit").textContent   = sym;

  try {
    // ── 1) 통화별 보험료 수납 비중 ──────────────────────────
    let usdcPremiumRaw = 0n, krwPremiumRaw = 0n;
    for (const ccy of ['USDC', 'KRW']) {
      const handle = getContractsForCcy(ccy);
      if (!handle?.ctx) continue;
      try {
        const stats = await handle.ctx.getStats();
        const converted = convertRawAmount(stats.premiumsCollected, ccy, currencyMode);
        if (ccy === 'USDC') usdcPremiumRaw = converted; else krwPremiumRaw = converted;
      } catch (e) { addLog("error", `[${ccy}] 차트용 통계 조회 실패`, e.message); }
    }
    const dec = decimalsForCcy(currencyMode);
    const toHuman = (raw) => Number(ethers.formatUnits(raw, dec));
    renderDonutChart("chartCcySplit", [
      { label: "USDC 계약", value: toHuman(usdcPremiumRaw), display: fmtByCcy(usdcPremiumRaw, currencyMode), color: "var(--accent-blue)" },
      { label: "KRW 계약",  value: toHuman(krwPremiumRaw),  display: fmtByCcy(krwPremiumRaw, currencyMode),  color: "var(--accent-yellow)" },
    ]);

    // ── 2) 청약 심사 현황 (현재 화면 통화만) ─────────────────
    const appRows = (await fetchAllApplicationsBothCcy()).filter(({ ccy }) => ccy === currencyMode);
    const appCounts = [0, 0, 0];
    appRows.forEach(({ a }) => appCounts[Number(a.status)]++);
    renderBarChart("chartAppStatus", [
      { label: "⏳ 대기중", value: appCounts[0], display: `${appCounts[0]}건`, color: "var(--accent-yellow)" },
      { label: "✅ 승인됨", value: appCounts[1], display: `${appCounts[1]}건`, color: "var(--accent-blue)" },
      { label: "❌ 거절됨", value: appCounts[2], display: `${appCounts[2]}건`, color: "var(--accent-red)" },
    ]);

    // ── 3) 청구 상태별 건수 (현재 화면 통화만) ───────────────
    const claimRows = (await fetchAllClaimsBothCcy()).filter(({ ccy }) => ccy === currencyMode);
    const claimCounts = [0, 0, 0, 0];
    claimRows.forEach(({ c }) => claimCounts[Number(c.status)]++);
    renderBarChart("chartClaimStatus", [
      { label: "⏳ 대기중",   value: claimCounts[0], display: `${claimCounts[0]}건`, color: "var(--accent-yellow)" },
      { label: "✅ 승인됨",   value: claimCounts[1], display: `${claimCounts[1]}건`, color: "var(--accent-blue)" },
      { label: "❌ 거절됨",   value: claimCounts[2], display: `${claimCounts[2]}건`, color: "var(--accent-red)" },
      { label: "💰 지급완료", value: claimCounts[3], display: `${claimCounts[3]}건`, color: "var(--accent-green)" },
    ]);

    // ── 4) 자금 흐름 (현재 화면 통화만) ───────────────────────
    let totalPremiumsRaw = 0n, totalClaimsRaw = 0n, totalReserveRaw = 0n;
    {
      const handle = getContractsForCcy(currencyMode);
      if (handle?.ctx) {
        try {
          const stats = await handle.ctx.getStats();
          totalPremiumsRaw = stats.premiumsCollected;
          totalClaimsRaw   = stats.claimsPaid;
        } catch (e) { addLog("error", `[${currencyMode}] 차트용 통계 조회 실패`, e.message); }
      }
      const rHandle = getReserveForCcy(currencyMode);
      if (rHandle?.ctx) {
        try {
          const holders = await rHandle.ctx.getAllHolders();
          const previews = await Promise.all(holders.map(a => rHandle.ctx.previewBalance(a).catch(() => ({ projectedPrincipal: 0n }))));
          totalReserveRaw = previews.reduce((s, p) => s + p.projectedPrincipal, 0n);
        } catch (e) { addLog("error", `[${currencyMode}] 차트용 준비금 조회 실패`, e.message); }
      }
    }
    // 대체투자 잔액 — 준비금과 완전히 동일한 패턴(투자자 × 펀드 전수 조회 후 합산)
    let totalAltInvestRaw = 0n;
    {
      const aHandle = getAltInvestForCcy(currencyMode);
      if (aHandle?.ctx) {
        try {
          const [holders, funds] = await Promise.all([aHandle.ctx.getAllHolders(), aHandle.ctx.getFunds()]);
          for (const holder of holders) {
            for (let fundId = 0; fundId < funds.length; fundId++) {
              const preview = await aHandle.ctx.previewPosition(holder, fundId).catch(() => ({ projectedPrincipal: 0n }));
              totalAltInvestRaw += preview.projectedPrincipal;
            }
          }
        } catch (e) { addLog("error", `[${currencyMode}] 차트용 대체투자 조회 실패`, e.message); }
      }
    }
    // 약관대출 총액(활성 대출만, 현재 화면 통화의 증권만)
    const policyRows = (await fetchAllPoliciesBothCcy()).filter(({ ccy }) => ccy === currencyMode);
    const loanAmounts = await Promise.all(policyRows.map(async ({ p, ccy }) => {
      const handle = getContractsForCcy(ccy);
      if (!handle?.ctx) return 0n;
      const loan = await handle.ctx.getPolicyLoan(p.id).catch(() => null);
      return loan && loan.active ? loan.loanAmount : 0n;
    }));
    const totalLoansRaw = loanAmounts.reduce((s, v) => s + v, 0n);

    renderBarChart("chartFundsFlow", [
      { label: "💳 보험료 수납", value: toHuman(totalPremiumsRaw), display: fmtByCcy(totalPremiumsRaw, currencyMode), color: "var(--accent-blue)" },
      { label: "💰 보험금 지급", value: toHuman(totalClaimsRaw),   display: fmtByCcy(totalClaimsRaw, currencyMode),   color: "var(--accent-red)" },
      { label: "🏛️ 준비금 잔액", value: toHuman(totalReserveRaw), display: fmtByCcy(totalReserveRaw, currencyMode), color: "var(--accent-cyan)" },
      { label: "💵 약관대출 잔액", value: toHuman(totalLoansRaw), display: fmtByCcy(totalLoansRaw, currencyMode),   color: "var(--accent-purple)" },
      { label: "🪙 대체투자 잔액", value: toHuman(totalAltInvestRaw), display: fmtByCcy(totalAltInvestRaw, currencyMode), color: "var(--accent-green)" },
    ]);
  } catch (err) {
    addLog("error", "통계 차트 갱신 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  블록체인 상태
// ═══════════════════════════════════════════════════════════════
async function refreshBlockchainState() {
  if (!insCtx || !usdcCtx) return;
  try {
    addLog("call", "블록체인 상태 조회 중...");
    // 다른 탭들과 동일하게 현재 화면 통화(currencyMode)의 계약만 집계한다 —
    // 예전엔 보험료수납/지급/증권수/청구수/손익을 두 통화 합쳐 환산해 보여줬으나,
    // 관리자 대시보드도 통화별로 분리해달라는 사용자 요청에 따라 다른 탭들과
    // 통일함 (2026-09-18).
    const [block, ownerAddr, totalSupply, myBal, networkInfo] = await Promise.all([
      provider.getBlock("latest"),
      insCtx.owner(),
      usdcCtx.totalSupply(),
      usdcCtx.balanceOf(userAddr),
      provider.getNetwork()
    ]);

    let totalContractBal = 0n, totalPremiums = 0n, totalPaid = 0n, totalPolicies = 0, totalClaims = 0;
    for (const ccy of [currencyMode]) {
      const handle = getContractsForCcy(ccy);
      if (!handle?.ctx) continue;
      try {
        const stats = await handle.ctx.getStats();
        totalContractBal += stats.contractBalance;
        totalPremiums     += stats.premiumsCollected;
        totalPaid          += stats.claimsPaid;
        totalPolicies      += Number(stats.policiesCount);
        totalClaims         += Number(stats.claimsCount);
      } catch (e) {
        addLog("error", `[${ccy}] 통계 조회 실패`, e.message);
      }
    }

    el("stateBlockNum").textContent    = block.number.toLocaleString();
    el("stateNetwork").textContent     = networkInfo.name === "unknown" ? `Hardhat (${networkInfo.chainId})` : networkInfo.name;
    el("stateChainId").textContent     = networkInfo.chainId.toString();
    el("stateOwner").textContent       = shortAddr(ownerAddr);
    el("stateOwner").title             = ownerAddr;
    el("stateUsdcSupply").textContent  = `${parseFloat(fmt(totalSupply)).toLocaleString("ko-KR")} ${stableName()}`;
    el("stateContractBal").textContent = fmtByCcy(totalContractBal, currencyMode);
    el("stateMyBal").textContent       = fmtUsdc(myBal);
    el("statePremiums").textContent    = fmtByCcy(totalPremiums, currencyMode);
    el("statePaid").textContent        = fmtByCcy(totalPaid, currencyMode);
    el("statePolicies2").textContent   = totalPolicies.toString();
    el("stateClaims2").textContent     = totalClaims.toString();
    el("stateInsAddr").textContent     = shortAddr(insAddr);
    el("stateUsdcAddr").textContent    = shortAddr(usdcAddr);
    el("stateTimestamp").textContent   = new Date(Number(block.timestamp) * 1000).toLocaleString("ko-KR");

    const profit = totalPremiums - totalPaid;
    el("stateProfit").textContent = fmtByCcy(profit < 0n ? 0n : profit, currencyMode);
    el("stateProfit").className   = `kv-value ${profit >= 0n ? "green" : "red"}`;

    addLog("call", "블록체인 상태 조회 완료",
      `블록 #${block.number} | 보험사잔액(${currencyMode}): ${fmtByCcy(totalContractBal, currencyMode)} | 내잔액: ${fmtUsdc(myBal)}`);

    refreshStatCharts();
  } catch (err) {
    addLog("error", "블록체인 상태 조회 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  만기환급금
// ═══════════════════════════════════════════════════════════════
async function refreshMaturity() {
  try {
    let rows = await fetchAllPoliciesBothCcy();
    const tbody = el("maturityTableBody");
    if (!tbody) return;
    // 다른 4개 탭(청구/납입/자동납부/약관대출)의 목록과 동일하게 현재 화면 통화(currencyMode)의
    // 증권만 보여준다 — 다른 통화 증권과 섞이지 않도록
    rows = rows.filter(({ ccy }) => ccy === currencyMode);
    if (!isOwner) {
      rows = rows.filter(({ p }) => p.patient.toLowerCase() === userAddr?.toLowerCase());
    }
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color:var(--text-muted);padding:30px">보험증권이 없습니다</td></tr>`;
      el("maturityAlertBadge") && (el("maturityAlertBadge").textContent = "");
      el("maturityPaidCount") && (el("maturityPaidCount").textContent = "0");
      el("maturityPendingCount") && (el("maturityPendingCount").textContent = "0");
      return;
    }

    const block = await provider.getBlock("latest");
    const blockTs = Number(block.timestamp);

    tbody.innerHTML = rows.map(({ p, ccy }) => {
      const matDate    = Number(p.maturityDate);
      const rate       = Number(p.maturityRefundRate);
      const refundAmt  = (BigInt(p.totalPaid) * BigInt(rate)) / 100n;
      const isMatured  = blockTs >= matDate && p.active && !p.maturityPaid;
      const remaining  = matDate - blockTs;

      let statusBadge;
      if (p.maturityPaid) {
        statusBadge = `<span class="badge badge-paid">💎 지급완료</span>`;
      } else if (!p.active) {
        statusBadge = `<span class="badge badge-inactive">비활성</span>`;
      } else if (isMatured) {
        statusBadge = `<span class="badge badge-approved">⏰ 만기도달</span>`;
      } else {
        const days  = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);
        const mins  = Math.floor((remaining % 3600) / 60);
        const label = days > 0 ? `${days}일 ${hours}시간` : hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
        statusBadge = `<span class="badge badge-pending">⏳ ${label} 후</span>`;
      }

      const actionBtn = (isOwner && isMatured)
        ? `<button class="btn btn-primary btn-sm" onclick="processMaturityRefund('${compositeId(ccy, p.id)}')">💎 환급 지급</button>`
        : "-";

      return `
        <tr>
          <td><strong>#${p.id}</strong></td>
          <td><span class="badge" style="font-size:10px;background:${ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${ccy}</span></td>
          <td>${p.patientName}</td>
          <td class="text-right" style="color:var(--accent-blue)">${fmtByCcy(p.totalPaid, ccy)}</td>
          <td class="text-right" style="color:var(--accent-cyan)">${rate}%</td>
          <td class="text-right" style="color:var(--accent-green)">${fmtByCcy(refundAmt, ccy)}</td>
          <td style="font-size:12px">${new Date(matDate * 1000).toLocaleString("ko-KR")}</td>
          <td>${statusBadge}</td>
          <td>${actionBtn}</td>
        </tr>`;
    }).join("");

    // 만기 카운트 업데이트 (현재 화면 통화 기준)
    const maturedCount = rows.filter(({ p }) => blockTs >= Number(p.maturityDate) && p.active && !p.maturityPaid).length;
    const paidCount    = rows.filter(({ p }) => p.maturityPaid).length;
    const el2 = el("maturityAlertBadge");
    if (el2) el2.textContent = maturedCount > 0 ? ` 🔴 ${maturedCount}건 만기 도달!` : "";
    const el3 = el("maturityPaidCount"); if (el3) el3.textContent = paidCount;
    const el4 = el("maturityPendingCount"); if (el4) el4.textContent = maturedCount;

  } catch (err) {
    addLog("error", "만기환급 목록 조회 실패", parseError(err));
  }
}

// 관리자가 직접 숫자 ID를 입력하는 조회 도구 — 현재 토글된 통화(currencyMode)의
// 컨트랙트를 대상으로 함 (다른 통화 증권을 조회하려면 먼저 상단에서 통화를 전환)
async function queryMaturityRefund() {
  const handle = getContractsForCcy(currencyMode);
  if (!handle?.ctx) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const id = el("queryMaturityPolicyId").value;
  if (!id) { showToast("증권 ID를 입력하세요.", "warning"); return; }
  const ccy = currencyMode;
  try {
    const p = await handle.ctx.getPolicy(id);
    const block     = await provider.getBlock("latest");
    const blockTs   = Number(block.timestamp);
    const matDate   = Number(p.maturityDate);
    const rate      = Number(p.maturityRefundRate);
    const refundAmt = (BigInt(p.totalPaid) * BigInt(rate)) / 100n;
    const remaining = matDate - blockTs;

    const loan = await handle.ctx.getPolicyLoan(id);
    let netRefundAmt = refundAmt;
    let loanTotal = 0n;
    if (loan.active) {
      const interest = await handle.ctx.getCurrentInterest(id);
      loanTotal = BigInt(loan.loanAmount) + BigInt(interest);
      netRefundAmt = loanTotal >= refundAmt ? 0n : refundAmt - loanTotal;
    }

    let statusText;
    if (p.maturityPaid)        statusText = "💎 지급완료";
    else if (!p.active)        statusText = "비활성";
    else if (remaining <= 0)   statusText = "⏰ 만기도달 (미지급)";
    else {
      const days  = Math.floor(remaining / 86400);
      const hours = Math.floor((remaining % 86400) / 3600);
      const mins  = Math.floor((remaining % 3600) / 60);
      statusText  = days > 0 ? `⏳ ${days}일 ${hours}시간 후` : hours > 0 ? `⏳ ${hours}시간 ${mins}분 후` : `⏳ ${mins}분 후`;
    }

    const result = {
      "통화":         ccy,
      "증권 ID":      p.id.toString(),
      "피보험자":     p.patientName,
      "지갑 주소":    p.patient,
      "납입 보험료 합계": fmtByCcy(p.totalPaid, ccy),
      "만기환급율":   rate + "%",
      "총환급액":     fmtByCcy(refundAmt, ccy),
      ...(loan.active ? {
        "약관대출 원리금": fmtByCcy(loanTotal, ccy),
        "실지급 예상액":   fmtByCcy(netRefundAmt, ccy)
      } : {}),
      "만기일":       new Date(matDate * 1000).toLocaleString("ko-KR"),
      "현재 상태":    statusText,
      "지급 완료 여부": p.maturityPaid ? "✅ 완료" : "❌ 미지급"
    };

    el("maturityQueryResult").textContent = JSON.stringify(result, null, 2);
    addLog("success", `만기환급 조회 완료 ([${ccy}] 증권 #${id})`,
      loan.active
        ? `총환급액: ${fmtByCcy(refundAmt, ccy)} | 대출원리금: ${fmtByCcy(loanTotal, ccy)} | 실지급 예상액: ${fmtByCcy(netRefundAmt, ccy)} | 상태: ${statusText}`
        : `환급 예정액: ${fmtByCcy(refundAmt, ccy)} | 상태: ${statusText}`);
  } catch (err) {
    el("maturityQueryResult").textContent = "오류: " + err.message;
    addLog("error", `만기환급 조회 실패 ([${ccy}] 증권 #${id})`, parseError(err));
  }
}

async function processMaturityRefund(policyIdOrComposite) {
  const parsed  = parseCompositeId(policyIdOrComposite);
  const ccy     = parsed ? parsed.ccy : currencyMode;
  const policyId = parsed ? parsed.id  : policyIdOrComposite;
  const handle  = getContractsForCcy(ccy);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  addLog("step", `[만기환급 지급] [${ccy}] 증권 #${policyId}`);
  if (!isOwner) {
    showToast("관리자만 만기환급 지급 가능합니다.", "error"); return;
  }
  try {
    const policy = await handle.ctx.getPolicy(policyId);

    // 컨트랙트의 require() 조건과 동일한 순서로 미리 검사 — 실패 사유를 온체인
    // revert 메시지("No premiums paid" 등)에 기대지 않고 화면에 바로 안내한다.
    // (2026-09-19 발견: 수동 만기환급이 실패해도 토스트에 사유가 안 보여
    // 사용자가 원인을 알 수 없었음 — sendTx()는 tx가 이미 블록에 채굴되어
    // status 0으로 실패한 경우 구체적 revert 사유를 보여주지 못한다.)
    if (policy.maturityPaid) {
      showToast("이미 만기환급이 지급된 증권입니다.", "error"); return;
    }
    // 관리자 수동 지급은 만기 도래 여부와 무관하게 가능 (2026-09-19 결정) —
    // 자동 워처(maturity-watcher.js)만 실제 만기 도달을 요구하며, 이 경로는
    // 컨트랙트의 adminPayMaturityRefund()를 호출해 만기일 조건을 건너뛴다.
    const block = await provider.getBlock("latest");
    if (Number(block.timestamp) < Number(policy.maturityDate)) {
      addLog("info", "만기 전 조기 지급", `만기일: ${tsToDate(policy.maturityDate)} — 관리자 재량으로 조기 지급 진행`);
    }
    if (BigInt(policy.totalPaid) === 0n) {
      showToast("보험료가 한 번도 납입되지 않아 만기환급을 지급할 수 없습니다.", "error"); return;
    }

    const refundAmt    = (BigInt(policy.totalPaid) * BigInt(policy.maturityRefundRate)) / 100n;
    const loan         = await handle.ctx.getPolicyLoan(policyId);
    let netRefundAmt   = refundAmt;
    let loanLine        = "";
    if (loan.active) {
      const interest  = await handle.ctx.getCurrentInterest(policyId);
      const loanTotal = BigInt(loan.loanAmount) + BigInt(interest);
      netRefundAmt    = loanTotal >= refundAmt ? 0n : refundAmt - loanTotal;
      loanLine        = `\n약관대출 활성 : 원리금 ${fmtByCcy(loanTotal, ccy)} (원금 ${fmtByCcy(loan.loanAmount, ccy)}+이자 ${fmtByCcy(interest, ccy)}) 차감 예정`;
    }
    if (refundAmt === 0n) {
      showToast("환급율 또는 납입액이 0이라 환급액이 0원입니다.", "error"); return;
    }
    const contractBal = await handle.ctx.getContractBalance();
    addLog("info", `만기환급 사전 확인 ([${ccy}] 증권 #${policyId})`,
      `피보험자    : ${policy.patientName}\n납입 합계   : ${fmtByCcy(policy.totalPaid, ccy)}\n환급율      : ${policy.maturityRefundRate}%\n총환급액    : ${fmtByCcy(refundAmt, ccy)}${loanLine}\n실지급 예상액: ${fmtByCcy(netRefundAmt, ccy)}\n보험사잔액  : ${fmtByCcy(contractBal, ccy)}`);
    if (contractBal < netRefundAmt) {
      showToast("보험사 잔액 부족. 준비금을 먼저 입금하세요.", "error"); return;
    }
  } catch (err) {
    addLog("error", "사전 확인 실패", parseError(err));
    showToast("증권 조회 실패 — 증권 ID/통화를 확인하세요.", "error"); return;
  }
  await sendTx(
    async () => handle.sign.adminPayMaturityRefund(policyId),
    `[${ccy}] 증권 #${policyId} 만기환급금 지급 (관리자 수동)`,
    async () => { await Promise.all([refreshMaturity(), refreshStats()]); }
  );
}

async function loadMyMaturitySetting() {
  const rawValue = el("maturityPolicyId")?.value;
  updateCcyHint("maturityCcyHint", rawValue, { convert: false });
  const composite = parseCompositeId(rawValue);
  const box = el("myMaturityCurrentBox");
  if (!box) return;
  if (!composite) { box.textContent = ""; return; }
  const handle = getContractsForCcy(composite.ccy);
  if (!handle?.ctx) { box.textContent = ""; return; }

  try {
    const p = await handle.ctx.getPolicy(composite.id);
    box.textContent = p.maturityPaid
      ? "💎 이미 만기환급이 지급된 증권입니다 (변경 불가)"
      : `현재 만기일: ${tsToDate(p.maturityDate)}`;
  } catch (err) {
    addLog("error", "만기 설정 조회 실패", parseError(err));
  }
}

async function setMyMaturityInterval() {
  const composite = parseCompositeId(el("maturityPolicyId")?.value);
  if (!composite) { showToast("증권을 선택하세요.", "error"); return; }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const interval = el("maturityIntervalSelect")?.value;
  if (!interval) { showToast("만기 시점을 선택하세요.", "warning"); return; }

  addLog("step", `[만기 변경] [${ccy}] 증권 #${policyId} — ${fmtInterval(interval)} 후`);
  await sendTx(
    async () => handle.sign.setMyMaturityInterval(policyId, interval),
    `만기 변경 ([${ccy}] 증권 #${policyId}): ${fmtInterval(interval)} 후`,
    async () => {
      await Promise.all([loadMyMaturitySetting(), refreshMaturity()]);
      showToast("만기 설정이 변경되었습니다.", "success");
    }
  );
}

// ═══════════════════════════════════════════════════════════════
//  자동납부 (Auto Premium Payment)
// ═══════════════════════════════════════════════════════════════

async function refreshAutopaySchedule() {
  const tbody = el("autopayScheduleBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">조회 중...</td></tr>`;

  try {
    let dueCount = 0, onCount = 0, offCount = 0;
    let rows = "";
    let any = false;

    // 다른 4개 탭과 동일하게 현재 화면 통화(currencyMode)의 증권만 보여준다
    for (const ccy of [currencyMode]) {
      const handle = getContractsForCcy(ccy);
      const token  = getTokenForCcy(ccy);
      if (!handle?.ctx) continue;
      any = true;
      const ids = await handle.ctx.getAllPolicyIds();

      for (const id of ids) {
        const p = await handle.ctx.getPolicy(id);
        if (!p.active) continue;
        if (!isOwner && p.patient.toLowerCase() !== userAddr?.toLowerCase()) continue;

        const now      = Math.floor(Date.now() / 1000);
        const isDue    = now >= Number(p.nextDueTime);
        const dueStr   = tsToDate(p.nextDueTime);
        const secLeft  = Number(p.nextDueTime) - now;

        // allowance 확인 (해당 통화 토큰 컨트랙트 기준)
        let allowance = 0n;
        try { allowance = token ? await token.ctx.allowance(p.patient, handle.ctx.target) : 0n; } catch {}
        const autoOn = allowance >= p.monthlyPremium;

        if (isDue) dueCount++;
        if (autoOn) onCount++; else offCount++;

        const statusBadge = isDue
          ? `<span class="badge badge-pending">⏰ 기한 초과</span>`
          : `<span style="font-size:12px;color:var(--text-muted)">⏳ ${secLeft < 3600 ? secLeft+'초' : Math.round(secLeft/3600)+'시간'} 후</span>`;

        const autoBadge = autoOn
          ? `<span class="badge badge-approved">🟢 ON</span>`
          : `<span class="badge badge-rejected">🔴 OFF</span>`;

        rows += `<tr>
          <td><span class="badge" style="font-size:10px;background:${ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${ccy}</span></td>
          <td>#${p.id}</td>
          <td>${p.patientName}</td>
          <td class="text-right">${fmtByCcy(p.monthlyPremium, ccy)}</td>
          <td style="font-size:12px">${dueStr}</td>
          <td>${autoBadge}</td>
          <td>${statusBadge}</td>
        </tr>`;
      }
    }

    if (!any) { tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--text-muted);padding:20px">컨트랙트를 연결하면 표시됩니다</td></tr>`; return; }
    tbody.innerHTML = rows || `<tr><td colspan="7" class="text-center" style="color:var(--text-muted);padding:20px">활성 증권이 없습니다</td></tr>`;

    // 요약 카드 업데이트
    const dueEl = el("autopayDueCount");
    const onEl  = el("autopayOnCount");
    const offEl = el("autopayOffCount");
    const badge = el("autopayAlertBadge");
    if (dueEl) dueEl.textContent = dueCount;
    if (onEl)  onEl.textContent  = onCount;
    if (offEl) offEl.textContent = offCount;
    if (badge) badge.textContent = dueCount > 0 ? ` (${dueCount})` : "";

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--accent-red)">${err.message}</td></tr>`;
    addLog("error", "자동납부 일정 조회 실패", parseError(err));
  }
}

async function loadAutopayStatus() {
  const rawValue = el("autopayPolicyId")?.value;
  updateCcyHint("autopayCcyHint", rawValue, { convert: false });
  const composite = parseCompositeId(rawValue);
  const box    = el("autopayStatusBox");
  const onBtn  = el("autopayOnBtn");
  const offBtn = el("autopayOffBtn");
  if (!composite) {
    if (box) box.style.display = "none";
    if (onBtn)  onBtn.disabled = true;
    if (offBtn) offBtn.disabled = true;
    return;
  }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  const token  = getTokenForCcy(ccy);
  if (!handle?.ctx || !token?.ctx) {
    if (box) box.style.display = "none";
    if (onBtn)  onBtn.disabled = true;
    if (offBtn) offBtn.disabled = true;
    return;
  }

  try {
    const p         = await handle.ctx.getPolicy(policyId);
    const allowance = await token.ctx.allowance(p.patient, handle.ctx.target);
    const autoOn    = allowance >= p.monthlyPremium;
    const now       = Math.floor(Date.now() / 1000);
    const isDue     = now >= Number(p.nextDueTime);

    if (box) box.style.display = "block";

    const badge = el("autopayStatusBadge");
    if (badge) {
      badge.textContent  = autoOn ? `🟢 자동납부 ON [${ccy}]` : `🔴 자동납부 OFF [${ccy}]`;
      badge.className    = "badge " + (autoOn ? "badge-approved" : "badge-rejected");
    }

    const allowEl = el("autopayAllowance");
    if (allowEl) allowEl.textContent = allowance >= ethers.MaxUint256 / 2n
      ? "무제한 (MaxUint256)"
      : fmtByCcy(allowance, ccy);

    const premEl = el("autopayPremiumAmt");
    if (premEl) premEl.textContent = fmtByCcy(p.monthlyPremium, ccy);

    const dueEl = el("autopayNextDue");
    if (dueEl) dueEl.textContent = isDue
      ? "⏰ 납입 기한 초과!"
      : tsToDate(p.nextDueTime);

    const intervalEl = el("autopayCurrentInterval");
    if (intervalEl) intervalEl.textContent = fmtInterval(p.premiumInterval);
    const intervalSel = el("premiumIntervalSelect");
    if (intervalSel) intervalSel.value = p.premiumInterval.toString();

    if (onBtn)  onBtn.disabled  = false;
    if (offBtn) offBtn.disabled = false;

  } catch (err) {
    addLog("error", "자동납부 상태 조회 실패", parseError(err));
  }
}

async function setMyPremiumInterval() {
  const composite = parseCompositeId(el("autopayPolicyId")?.value);
  if (!composite) { showToast("증권을 선택하세요.", "error"); return; }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  if (!handle?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const interval = el("premiumIntervalSelect")?.value;
  if (!interval) { showToast("자동이체 주기를 선택하세요.", "warning"); return; }

  addLog("step", `[자동이체 주기 변경] [${ccy}] 증권 #${policyId} — ${fmtInterval(interval)}`);
  await sendTx(
    async () => handle.sign.setMyPremiumInterval(policyId, interval),
    `자동이체 주기 변경 ([${ccy}] 증권 #${policyId}): ${fmtInterval(interval)}`,
    async () => {
      await Promise.all([loadAutopayStatus(), refreshAutopaySchedule()]);
      showToast("자동이체 주기가 변경되었습니다.", "success");
    }
  );
}

async function enableAutoPay() {
  const composite = parseCompositeId(el("autopayPolicyId")?.value);
  if (!composite) { showToast("증권을 선택하세요.", "error"); return; }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  const token  = getTokenForCcy(ccy);
  if (!handle?.ctx || !token?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  try {
    const p = await handle.ctx.getPolicy(policyId);
    const insTarget = handle.ctx.target;
    addLog("step", `[자동납부 ON] [${ccy}] 증권 #${policyId} — ${p.patientName}`,
      `approve(${insTarget}, MaxUint256) 실행 예정\n본인 지갑(${userAddr})에서 서명하세요.`);

    const tx = await token.sign.approve(insTarget, ethers.MaxUint256);
    addLog("info", "approve 트랜잭션 전송됨", `TX: ${tx.hash}`);
    const receipt = await tx.wait();
    addLog("success", `자동납부 ON 완료 ([${ccy}] 증권 #${policyId})`,
      `TX: ${receipt.hash}\n이제 스케줄러가 납입 기한마다 자동으로 수납합니다.`, receipt.hash);
    showToast("자동납부가 활성화되었습니다.", "success");

    await Promise.all([loadAutopayStatus(), refreshAutopaySchedule()]);
  } catch (err) {
    addLog("error", "자동납부 ON 실패", parseError(err));
    showToast("자동납부 ON 실패: " + (err.reason || err.message), "error");
  }
}

async function disableAutoPay() {
  const composite = parseCompositeId(el("autopayPolicyId")?.value);
  if (!composite) { showToast("증권을 선택하세요.", "error"); return; }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  const token  = getTokenForCcy(ccy);
  if (!handle?.ctx || !token?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  try {
    const p = await handle.ctx.getPolicy(policyId);
    const insTarget = handle.ctx.target;
    addLog("step", `[자동납부 OFF] [${ccy}] 증권 #${policyId} — ${p.patientName}`,
      `approve(${insTarget}, 0) — Allowance 취소`);

    const tx = await token.sign.approve(insTarget, 0n);
    addLog("info", "approve(0) 트랜잭션 전송됨", `TX: ${tx.hash}`);
    const receipt = await tx.wait();
    addLog("success", `자동납부 OFF 완료 ([${ccy}] 증권 #${policyId})`,
      `TX: ${receipt.hash}`, receipt.hash);
    showToast("자동납부가 비활성화되었습니다.", "success");

    await Promise.all([loadAutopayStatus(), refreshAutopaySchedule()]);
  } catch (err) {
    addLog("error", "자동납부 OFF 실패", parseError(err));
    showToast("자동납부 OFF 실패: " + (err.reason || err.message), "error");
  }
}

// ═══════════════════════════════════════════════════════════════
//  청약 심사 (Underwriting)
// ═══════════════════════════════════════════════════════════════

const APP_STATUS       = ["대기중", "승인됨", "거절됨"];
const APP_STATUS_CLASS = ["badge-pending", "badge-approved", "badge-rejected"];

// ── 담보 선택 & 보험료 자동 산정 ──────────────────────────────
// 라이나생명 "THE 치아보험" 실제 담보 구성(임플란트/크라운/충전/브릿지/틀니/
// 신경치료/스케일링)을 참고한 원화(KRW) 기준 요율표.
// ⚠️ 공식 요율표를 그대로 옮긴 것이 아니라 담보 구조를 참고해 만든 추정치이며,
//    실제 라이나생명 보험료와 다를 수 있음 (데모/교육용).
const DENTAL_COVERAGE_OPTIONS = [
  { id: "implant",   label: "임플란트",   desc: "1개당 보장 (대기기간 90일)",             coverageKrw: 1000000, premiumKrw: 8000 },
  { id: "crown",     label: "크라운",     desc: "심미/보철 크라운 1개당",                  coverageKrw: 400000,  premiumKrw: 4000 },
  { id: "filling",   label: "충전치료",   desc: "인레이·충전(금/세라믹 기준) 1개당",       coverageKrw: 150000,  premiumKrw: 2000 },
  { id: "bridge",    label: "브릿지",     desc: "고정성 가공의치 (대기기간 90일)",         coverageKrw: 600000,  premiumKrw: 5000 },
  { id: "denture",   label: "틀니",       desc: "가철성 의치 (대기기간 90일)",             coverageKrw: 1200000, premiumKrw: 6000 },
  { id: "rootcanal", label: "신경치료",   desc: "근관치료 1개당",                          coverageKrw: 150000,  premiumKrw: 2500 },
  { id: "scaling",   label: "스케일링",   desc: "건강보험 적용 시 연 1회 한도",            coverageKrw: 100000,  premiumKrw: 1500 },
];

// USDC↔KRW 환산 환율 — scripts/deploy.js가 config.json에 기록한 krwPerUsd로 로드 시
// 덮어써짐(tryLoadConfig 참고). mock-provider.js/oracle-service.js도 같은 config.json
// 값을 읽으므로 세 곳이 따로 하드코딩해서 어긋나는 일이 없음. config.json 로드 전
// 잠깐 쓰이거나 값이 없는 옛 배포본을 위한 기본값으로 1400을 폴백함.
// 관리자가 admin 패널에서 직접 조정하면(applyExchangeRateOverride) 이 브라우저의
// localStorage에 저장되어, config.json 값보다 우선 적용된다(재배포 없이 데모 중
// 환율 변동 시나리오를 보여줄 수 있게 하려는 것 — 온체인 계약이나 config.json
// 자체를 바꾸는 것은 아니고, 프론트엔드가 화면에 보여주는 환산 계산에만 영향).
let KRW_PER_USD = 1400;

function krwOverrideStorageKey() { return "krwPerUsdOverride"; }

function loadKrwRateOverride() {
  try {
    const raw = localStorage.getItem(krwOverrideStorageKey());
    const v = Number(raw);
    if (raw && v > 0) KRW_PER_USD = v;
  } catch (_) { /* 무시 */ }
  const input = el("krwPerUsdInput");
  if (input) input.value = KRW_PER_USD;
}

function applyExchangeRateOverride() {
  const v = Number(el("krwPerUsdInput")?.value);
  if (!v || v <= 0) { showToast("올바른 환율을 입력하세요.", "warning"); return; }
  KRW_PER_USD = v;
  try { localStorage.setItem(krwOverrideStorageKey(), String(v)); } catch (_) { /* 무시 */ }
  addLog("info", `💱 환율 수동 설정: 1 USD = ${v}원`,
    "이 브라우저에만 적용되는 화면 표시/환산용 값입니다. config.json이나 온체인 상태는 바뀌지 않습니다.");
  showToast(`환율이 1 USD = ${v.toLocaleString("ko-KR")}원으로 적용되었습니다.`, "success");
  refreshStats();
  refreshBlockchainState();
}

function resetExchangeRateOverride() {
  try { localStorage.removeItem(krwOverrideStorageKey()); } catch (_) { /* 무시 */ }
  KRW_PER_USD = configCache?.krwPerUsd || 1400;
  const input = el("krwPerUsdInput");
  if (input) input.value = KRW_PER_USD;
  addLog("info", `💱 환율을 배포 시 설정값(1 USD = ${KRW_PER_USD}원)으로 되돌렸습니다.`);
  showToast("환율이 기본값으로 초기화되었습니다.", "success");
  refreshStats();
  refreshBlockchainState();
}

// 라이나 상품 구조(연령대별 위험도 반영)를 참고한 나이 배율 — 실제 요율표가 아닌 참고 추정치
function ageMultiplier(age) {
  const a = Number(age) || 0;
  if (a < 30) return 0.7;
  if (a < 40) return 0.85;
  if (a < 50) return 1.0;
  if (a < 60) return 1.4;
  if (a < 70) return 1.9;
  return 2.5;
}

// 원화(KRW) 금액을 현재 통화 모드의 최소단위 BigInt로 변환
function convertKrw(krwAmount) {
  if (currencyMode === 'KRW') return BigInt(Math.round(krwAmount));
  const usd = krwAmount / KRW_PER_USD;
  return ethers.parseUnits(usd.toFixed(6), stableDecimals());
}

// BigInt(최소단위)를 입력창에 넣기 좋은 문자열로 변환 (KRW=정수, USDC=소수 2자리)
function rawToInputValue(raw) {
  const str = ethers.formatUnits(raw, stableDecimals());
  return stableDecimals() === 0 ? str : parseFloat(str).toFixed(2);
}

function renderCoverageOptions() {
  const container = el("coverageOptionsList");
  if (!container) return;
  container.innerHTML = DENTAL_COVERAGE_OPTIONS.map(opt => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer">
      <input type="checkbox" class="coverage-option-checkbox" data-id="${opt.id}" onchange="recalcApplicationPremium()">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${opt.label}</div>
        <div style="font-size:11px;color:var(--text-muted)">${opt.desc}</div>
      </div>
      <div style="text-align:right;font-size:12px;color:var(--text-secondary)" class="coverage-option-price" data-id="${opt.id}">-</div>
    </label>
  `).join("");
  updateCoverageOptionPrices();
}

function updateCoverageOptionPrices() {
  DENTAL_COVERAGE_OPTIONS.forEach(opt => {
    const priceEl = document.querySelector(`.coverage-option-price[data-id="${opt.id}"]`);
    if (!priceEl) return;
    priceEl.textContent = `보장 ${fmtUsdc(convertKrw(opt.coverageKrw))}`;
  });
}

function recalcApplicationPremium() {
  const selectedIds = Array.from(document.querySelectorAll(".coverage-option-checkbox:checked"))
    .map(cb => cb.dataset.id);
  const selected = DENTAL_COVERAGE_OPTIONS.filter(opt => selectedIds.includes(opt.id));

  const mult = ageMultiplier(el("appAge")?.value);
  const totalCoverageKrw = selected.reduce((sum, opt) => sum + opt.coverageKrw, 0);
  const totalPremiumKrw  = Math.round(selected.reduce((sum, opt) => sum + opt.premiumKrw, 0) * mult);

  const coverageRaw = convertKrw(totalCoverageKrw);
  const premiumRaw  = convertKrw(totalPremiumKrw);

  if (el("appCoverage")) el("appCoverage").value = rawToInputValue(coverageRaw);
  if (el("appPremium"))  el("appPremium").value  = rawToInputValue(premiumRaw);

  if (el("coverageSummaryCoverage")) {
    el("coverageSummaryCoverage").textContent = selected.length ? fmtUsdc(coverageRaw) : "-";
  }
  if (el("coverageSummaryPremium")) {
    el("coverageSummaryPremium").textContent = selected.length
      ? `${fmtUsdc(premiumRaw)} (원화 환산 전 ${totalPremiumKrw.toLocaleString("ko-KR")}원 기준)`
      : "-";
  }

  updateCoverageOptionPrices();
}

async function submitApplication() {
  addLog("step", "[청약 신청] 시작");
  if (!insSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  const name        = el("appName")?.value.trim();
  const age         = parseInt(el("appAge")?.value || "0");
  const email       = el("appEmail")?.value.trim();
  const premium     = parseUsdc(el("appPremium")?.value);
  const coverage    = parseUsdc(el("appCoverage")?.value);
  const matDays     = parseInt(el("appMaturityDays")?.value || "365");
  const refundRate  = parseInt(el("appRefundRate")?.value || "70");

  if (!name)        { showToast("청약자 이름을 입력하세요.", "warning"); return; }
  if (!age || age < 1) { showToast("나이를 입력하세요.", "warning"); return; }
  if (premium <= 0n || coverage <= 0n) {
    showToast("담보를 최소 1개 이상 선택하세요.", "warning");
    return;
  }

  const selectedLabels = DENTAL_COVERAGE_OPTIONS
    .filter(opt => document.querySelector(`.coverage-option-checkbox[data-id="${opt.id}"]:checked`))
    .map(opt => opt.label);
  const coverageCount = selectedLabels.length;

  if (email && !isValidEmail(email)) {
    showToast("이메일 형식이 올바르지 않습니다. 확인 후 다시 입력하거나 비워두세요.", "warning");
    return;
  }
  if (email) rememberCertEmail(userAddr, email);

  addLog("info", "청약 입력값",
    `이름: ${name} / 나이: ${age}세${email ? ` / 이메일: ${email}` : ""}\n선택 담보(${coverageCount}개): ${selectedLabels.join(", ") || "-"}\n` +
    `월보험료: ${fmtUsdc(premium)} / 보장한도: ${fmtUsdc(coverage)}\n기간: ${matDays}일 / 환급율: ${refundRate}%`);

  const flexiblePayment = !!el("appFlexiblePayment")?.checked;

  await sendTx(
    async () => insSign.submitApplication(name, age, premium, coverage, matDays, refundRate, coverageCount, flexiblePayment),
    `청약 신청: ${name} (${age}세)`,
    async () => {
      await refreshApplications();
      showToast("청약 신청 완료! 심사 결과를 청약 목록에서 확인하세요.", "success");
    }
  );
}

// adminAppId는 관리자가 직접 입력하는 숫자 ID — 현재 토글된 통화(currencyMode)의
// 컨트랙트를 대상으로 함 (다른 통화 청약을 승인/거절하려면 먼저 상단에서 통화를 전환)
async function approveApplication() {
  const handle = getContractsForCcy(currencyMode);
  if (!handle?.sign || !isOwner) { showToast("관리자만 처리 가능합니다.", "error"); return; }
  const appId = el("adminAppId")?.value;
  if (!appId) { showToast("청약 ID를 입력하세요.", "warning"); return; }

  addLog("step", `[청약 승인] [${currencyMode}] 청약 #${appId} 승인 처리`);
  await sendTx(
    async () => handle.sign.approveApplication(appId),
    `[${currencyMode}] 청약 #${appId} 승인 → 보험증권 자동 생성`,
    async () => {
      await Promise.all([refreshApplications(), refreshPolicies()]);
      showToast(`청약 #${appId} 승인 완료! 보험증권이 생성되었습니다.`, "success");
    }
  );
}

async function rejectApplicationAdmin() {
  const handle = getContractsForCcy(currencyMode);
  if (!handle?.sign || !isOwner) { showToast("관리자만 처리 가능합니다.", "error"); return; }
  const appId  = el("adminAppId")?.value;
  const reason = el("adminAppRejectReason")?.value.trim();
  if (!appId)  { showToast("청약 ID를 입력하세요.", "warning"); return; }
  if (!reason) { showToast("거절 사유를 입력하세요.", "warning"); return; }

  addLog("step", `[청약 거절] [${currencyMode}] 청약 #${appId} 거절 처리`, `사유: ${reason}`);
  await sendTx(
    async () => handle.sign.rejectApplication(appId, reason),
    `[${currencyMode}] 청약 #${appId} 거절: ${reason}`,
    async () => {
      await refreshApplications();
      showToast(`청약 #${appId} 거절 처리 완료.`, "success");
    }
  );
}

// 두 통화 컨트랙트에서 청약 목록을 함께 가져와 {a, ccy} 형태로 합침.
// refreshApplications()와 refreshStats() 둘 다 사용.
async function fetchAllApplicationsBothCcy() {
  let rows = [];
  for (const ccy of ['USDC', 'KRW']) {
    const handle = getContractsForCcy(ccy);
    if (!handle?.ctx) continue;
    try {
      const ids  = await handle.ctx.getAllApplicationIds();
      const apps = await Promise.all(ids.map(id => handle.ctx.getApplication(id)));
      apps.forEach(a => rows.push({ a, ccy }));
    } catch (e) {
      addLog("error", `[${ccy}] 청약 목록 조회 실패`, e.message);
    }
  }
  return rows;
}

let _appRowsCache = [];

function renderAppRows(rows) {
  const tbody = el("appTableBody");
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center" style="color:var(--text-muted);padding:30px">${_appRowsCache.length === 0 ? "청약 내역이 없습니다" : "검색 결과가 없습니다"}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(({ a, ccy }) => {
    const statusIdx = Number(a.status);
    const riskColor = a.riskScore >= 60 ? "var(--accent-red)" : a.riskScore >= 30 ? "var(--accent-yellow)" : "var(--accent-green)";
    return `<tr>
      <td><strong>#${a.id}</strong></td>
      <td><span class="badge" style="font-size:10px;background:${ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${ccy}</span></td>
      <td><code style="font-size:10px">${shortAddr(a.applicant)}</code></td>
      <td>${a.applicantName}</td>
      <td>${a.age}세</td>
      <td class="text-right">${fmtByCcy(a.monthlyPremium, ccy)}</td>
      <td class="text-right">${fmtByCcy(a.coverageLimit, ccy)}</td>
      <td class="text-center">${a.maturityDays}일</td>
      <td class="text-center">${a.coverageCount}개</td>
      <td class="text-center"><span style="color:${riskColor};font-weight:600">${a.riskScore}점</span></td>
      <td><span class="badge ${APP_STATUS_CLASS[statusIdx]}">${APP_STATUS[statusIdx]}</span></td>
      <td>${a.policyId > 0n ? `<strong>#${a.policyId}</strong>` : "-"}</td>
      <td style="font-size:11px">${tsToDate(a.submittedAt)}</td>
      <td style="font-size:11px;color:var(--accent-red)">${a.rejectReason || "-"}</td>
    </tr>`;
  }).join("");
}

function filterAppTable() {
  const term = el("appSearchInput")?.value.trim() || "";
  const filtered = _appRowsCache.filter(({ a, ccy }) =>
    tableSearchMatch(term, [a.id, ccy, a.applicant, a.applicantName, APP_STATUS[Number(a.status)], a.rejectReason])
  );
  renderAppRows(filtered);
}

function exportAppTableCsv() {
  const rows = _appRowsCache.map(({ a, ccy }) => [
    a.id.toString(), ccy, a.applicant, a.applicantName, a.age.toString(),
    fmtByCcy(a.monthlyPremium, ccy), fmtByCcy(a.coverageLimit, ccy), a.maturityDays.toString(),
    a.coverageCount.toString(), a.riskScore.toString(), APP_STATUS[Number(a.status)],
    a.policyId > 0n ? a.policyId.toString() : "", tsToDate(a.submittedAt), a.rejectReason || "",
  ]);
  exportRowsToCsv(`청약_목록_${new Date().toISOString().slice(0,10)}.csv`,
    ["청약ID", "통화", "청약자주소", "이름", "나이", "월보험료", "보장한도", "만기(일)", "담보개수", "위험점수", "상태", "증권ID", "청약일", "거절사유"], rows);
}

async function refreshApplications() {
  addLog("call", `getAllApplicationIds() 조회 (${currencyMode})`);
  try {
    let rows = await fetchAllApplicationsBothCcy();
    if (!el("appTableBody")) return;

    // 다른 탭들과 동일하게 현재 화면 통화(currencyMode)의 청약만 보여준다
    rows = rows.filter(({ ccy }) => ccy === currencyMode);
    if (!isOwner) {
      rows = rows.filter(({ a }) => a.applicant.toLowerCase() === userAddr?.toLowerCase());
    }
    rows.sort((x, y) => Number(y.a.submittedAt) - Number(x.a.submittedAt));
    _appRowsCache = rows;
    filterAppTable();

    addLog("success", `청약 목록 조회 완료 (${rows.length}건)`);
  } catch (err) {
    addLog("error", "청약 목록 조회 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  약관대출 (Policy Loan)
// ═══════════════════════════════════════════════════════════════

let _loanMaxAmount = 0n;
let _loanCcy       = 'USDC'; // 현재 선택된 증권이 실제로 속한 통화 (금액 환산 기준)

async function refreshLoanInfo() {
  const rawValue = el("loanPolicyId")?.value;
  updateCcyHint("loanCcyHint", rawValue, { convert: true });
  const composite = parseCompositeId(rawValue);
  const infoBox  = el("loanInfoBox");
  const reqBox   = el("loanRequestBox");
  const repayBox = el("loanRepayBox");
  const curBox   = el("loanCurrentBox");
  if (!composite) {
    if (infoBox) infoBox.style.display = "none";
    return;
  }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  if (!handle?.ctx) {
    if (infoBox) infoBox.style.display = "none";
    return;
  }
  _loanCcy = ccy;

  try {
    const [policy, maxLoan, loan, repay] = await Promise.all([
      handle.ctx.getPolicy(policyId),
      handle.ctx.getMaxLoanAmount(policyId),
      handle.ctx.getPolicyLoan(policyId),
      handle.ctx.getLoanRepayAmount(policyId)
    ]);

    _loanMaxAmount = maxLoan;

    const surrenderVal = (policy.totalPaid * policy.maturityRefundRate) / 100n;

    el("loanTotalPaid").textContent   = fmtByCcy(policy.totalPaid, ccy);
    el("loanSurrenderVal").textContent= fmtByCcy(surrenderVal, ccy);
    el("loanMaxAmount").textContent   = fmtByCcy(maxLoan, ccy) + (ccy !== currencyMode ? ` (${convertedAmountLabel(maxLoan, ccy)})` : "");

    if (infoBox) infoBox.style.display = "block";

    if (loan.active) {
      el("loanActiveStatus").innerHTML = `<span class="badge badge-pending">대출중 [${ccy}]</span>`;
      el("loanPrincipal").textContent  = fmtByCcy(repay.principal, ccy);
      el("loanInterest").textContent   = fmtByCcy(repay.interest, ccy);
      el("loanRepayTotal").textContent = fmtByCcy(repay.total, ccy);
      el("loanBorrowedAt").textContent = tsToDate(loan.borrowedAt);
      if (curBox) curBox.style.display = "block";
      if (reqBox)   reqBox.style.display   = "none";
      if (repayBox) repayBox.style.display = "block";
    } else {
      el("loanActiveStatus").innerHTML = `<span class="badge badge-approved">없음</span>`;
      if (curBox)   curBox.style.display   = "none";
      if (reqBox)   reqBox.style.display   = "block";
      if (repayBox) repayBox.style.display = "none";
    }
  } catch (err) {
    addLog("error", "대출 정보 조회 실패", parseError(err));
  }
}

// 대출 한도(_loanMaxAmount, 증권의 실제 통화 단위)를 현재 화면 통화로 환산해 입력칸에 채움
function setLoanAmount(ratio) {
  if (!el("loanPolicyId")?.value) { showToast("증권을 먼저 선택하세요.", "warning"); return; }
  if (_loanMaxAmount <= 0n) { showToast("보험료 납입 후 약관대출 가능합니다.", "warning"); return; }
  const amtNative = (_loanMaxAmount * BigInt(Math.floor(ratio * 100))) / 100n;
  const amtDisplay = convertRawAmount(amtNative, _loanCcy, currencyMode);
  const dec = decimalsForCcy(currencyMode);
  el("loanAmount").value = dec === 0
    ? amtDisplay.toString()
    : parseFloat(ethers.formatUnits(amtDisplay, dec)).toFixed(2);
}

async function requestPolicyLoan() {
  const composite = parseCompositeId(el("loanPolicyId")?.value);
  if (!composite) { showToast("보험증권을 선택하세요.", "warning"); return; }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  const token  = getTokenForCcy(ccy);
  if (!handle?.sign || !token?.ctx) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  const displayAmount = parseUsdc(el("loanAmount")?.value); // 현재 화면 통화 기준 입력값
  const amount = convertRawAmount(displayAmount, currencyMode, ccy); // 증권의 실제 통화로 환산
  if (amount <= 0n) { showToast("대출 금액을 입력하세요.", "warning"); return; }

  const crossCcyNote = ccy !== currencyMode
    ? `\n※ 이 증권은 [${ccy}] 계약이라 ${fmtByCcy(amount, ccy)}(으)로 환산해 전송합니다.`
    : "";
  addLog("step", `[약관대출] [${ccy}] 증권 #${policyId} — ${fmtByCcy(amount, ccy)} 대출 신청${crossCcyNote}`);

  const balBefore = await token.ctx.balanceOf(userAddr).catch(() => 0n);
  await sendTx(
    async () => handle.sign.requestPolicyLoan(policyId, amount),
    `약관대출 신청 ([${ccy}] 증권 #${policyId}): ${fmtByCcy(amount, ccy)}`,
    async () => {
      const balAfter = await token.ctx.balanceOf(userAddr).catch(() => 0n);
      addLog("success", "약관대출 완료",
        `대출금액 : ${fmtByCcy(amount, ccy)}\n잔액 전   : ${fmtByCcy(balBefore, ccy)}\n잔액 후   : ${fmtByCcy(balAfter, ccy)}`);
      await Promise.all([refreshMyBalance(), refreshLoanInfo(), refreshLoanPolicies()]);
      showToast(`${fmtByCcy(amount, ccy)} 대출 완료!`, "success");
    }
  );
}

async function repayPolicyLoan() {
  const composite = parseCompositeId(el("loanPolicyId")?.value);
  if (!composite) { showToast("보험증권을 선택하세요.", "warning"); return; }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  const token  = getTokenForCcy(ccy);
  if (!handle?.sign || !token?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  addLog("step", `[약관대출 상환] [${ccy}] 증권 #${policyId} — 원금+이자 상환 시작`);

  try {
    // 상환액 조회
    const repay = await handle.ctx.getLoanRepayAmount(policyId);
    const total = repay.total;
    addLog("info", "상환 금액 확인",
      `원금: ${fmtByCcy(repay.principal, ccy)} / 이자: ${fmtByCcy(repay.interest, ccy)} / 합계: ${fmtByCcy(total, ccy)}`);

    // 잔액 확인
    const bal = await token.ctx.balanceOf(userAddr).catch(() => 0n);
    if (bal < total) {
      addLog("error", "잔액 부족",
        `필요: ${fmtByCcy(total, ccy)} / 보유: ${fmtByCcy(bal, ccy)}\n파우셋에서 ${ccy}을 추가로 수령하세요.`);
      showToast(`잔액 부족: ${fmtByCcy(total, ccy)} 필요`, "error");
      return;
    }

    // approve → repay (MaxUint256로 여유 있게 approve — 이자 정밀도 차이 방지)
    const insTarget = handle.ctx.target;
    addLog("step", `[1단계] ${ccy} approve(${fmtByCcy(total, ccy)}) 요청`);
    const approveTx = await token.sign.approve(insTarget, ethers.MaxUint256);
    await approveTx.wait();
    addLog("success", "[1단계] approve 완료", `TX: ${approveTx.hash}`);

    await sendTx(
      async () => handle.sign.repayPolicyLoan(policyId),
      `약관대출 상환 ([${ccy}] 증권 #${policyId}): ${fmtByCcy(total, ccy)}`,
      async () => {
        await Promise.all([refreshMyBalance(), refreshLoanInfo(), refreshLoanPolicies()]);
        showToast("대출 상환 완료!", "success");
      }
    );
  } catch (err) {
    addLog("error", "대출 상환 실패", parseError(err));
    showToast("상환 실패: " + (err.reason || err.message), "error");
  }
}

async function repayPolicyLoanPartial() {
  const composite = parseCompositeId(el("loanPolicyId")?.value);
  if (!composite) { showToast("보험증권을 선택하세요.", "warning"); return; }
  const { ccy, id: policyId } = composite;
  const handle = getContractsForCcy(ccy);
  const token  = getTokenForCcy(ccy);
  if (!handle?.sign || !token?.sign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }

  const amountRaw = el("loanPartialAmount")?.value;
  const displayAmount = parseUsdc(amountRaw); // 현재 화면 통화 기준 입력값
  const amount = convertRawAmount(displayAmount, currencyMode, ccy); // 증권의 실제 통화로 환산
  if (amount <= 0n) { showToast("상환 금액을 입력하세요.", "warning"); return; }

  addLog("step", `[약관대출 부분상환] [${ccy}] 증권 #${policyId} — ${fmtByCcy(amount, ccy)} 상환 시도`);

  try {
    const repay = await handle.ctx.getLoanRepayAmount(policyId);
    addLog("info", "현재 상환 정보 확인",
      `원금: ${fmtByCcy(repay.principal, ccy)} / 이자: ${fmtByCcy(repay.interest, ccy)} / 총 상환액: ${fmtByCcy(repay.total, ccy)}\n입력 금액: ${fmtByCcy(amount, ccy)}`);

    if (amount < repay.interest) {
      addLog("error", "이자 미달", `발생 이자(${fmtByCcy(repay.interest, ccy)})보다 적은 금액은 부분상환할 수 없습니다. 이자를 먼저 전액 충당해야 합니다.`);
      showToast(`최소 이자(${fmtByCcy(repay.interest, ccy)}) 이상 입력하세요.`, "error"); return;
    }
    if (amount > repay.total) {
      addLog("error", "총 상환액 초과", `총 상환액(${fmtByCcy(repay.total, ccy)})보다 큰 금액입니다. 전액 상환은 [대출 상환하기] 버튼을 이용하세요.`);
      showToast("총 상환액을 초과했습니다. 전액 상환 버튼을 이용하세요.", "error"); return;
    }

    const bal = await token.ctx.balanceOf(userAddr).catch(() => 0n);
    if (bal < amount) {
      addLog("error", "잔액 부족", `필요: ${fmtByCcy(amount, ccy)} / 보유: ${fmtByCcy(bal, ccy)}`);
      showToast(`잔액 부족: ${fmtByCcy(amount, ccy)} 필요`, "error"); return;
    }

    const insTarget = handle.ctx.target;
    const allowance = await token.ctx.allowance(userAddr, insTarget);
    if (allowance < amount) {
      addLog("step", `[1단계] ${ccy} approve(${fmtByCcy(amount, ccy)}) 요청`);
      const approveTx = await token.sign.approve(insTarget, ethers.MaxUint256);
      await approveTx.wait();
      addLog("success", "[1단계] approve 완료", `TX: ${approveTx.hash}`);
    }

    await sendTx(
      async () => handle.sign.repayPolicyLoanPartial(policyId, amount),
      `약관대출 부분상환 ([${ccy}] 증권 #${policyId}): ${fmtByCcy(amount, ccy)}`,
      async () => {
        el("loanPartialAmount").value = "";
        await Promise.all([refreshMyBalance(), refreshLoanInfo(), refreshLoanPolicies()]);
        showToast("부분 상환 완료!", "success");
      }
    );
  } catch (err) {
    addLog("error", "부분 상환 실패", parseError(err));
    showToast("부분 상환 실패: " + (err.reason || err.message), "error");
  }
}

async function refreshLoanPolicies() {
  const tbody = el("loanPolicyTable");
  if (!tbody) return;
  try {
    let rows = [];
    // 다른 4개 탭과 동일하게 현재 화면 통화(currencyMode)의 증권만 보여준다
    for (const ccy of [currencyMode]) {
      const handle = getContractsForCcy(ccy);
      if (!handle?.ctx) continue;
      try {
        // 관리자: 전체 증권 현황 조회 / 일반 계정: 본인 증권만
        const ids = isOwner ? await handle.ctx.getAllPolicyIds() : await handle.ctx.getPatientPolicies(userAddr);
        const ccyRows = await Promise.all(ids.map(async id => {
          const [policy, maxLoan, loan] = await Promise.all([
            handle.ctx.getPolicy(id),
            handle.ctx.getMaxLoanAmount(id),
            handle.ctx.getPolicyLoan(id)
          ]);
          return { id, ccy, policy, maxLoan, loan };
        }));
        rows.push(...ccyRows);
      } catch (e) {
        addLog("error", `[${ccy}] 약관대출 현황 조회 실패`, e.message);
      }
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--text-muted);padding:20px">보험증권이 없습니다</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(({ id, ccy, policy, maxLoan, loan }) => {
        const loanBadge = loan.active
          ? `<span class="badge badge-pending">대출중</span>`
          : `<span class="badge" style="background:rgba(139,148,158,0.15);color:var(--text-muted)">없음</span>`;
        const loanAmountText = loan.active
          ? `<span style="color:var(--accent-yellow)">${fmtByCcy(loan.loanAmount, ccy)}</span>`
          : `<span style="color:var(--text-muted)">-</span>`;
        return `<tr>
          <td><span class="badge" style="font-size:10px;background:${ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${ccy}</span></td>
          <td><strong>#${id}</strong></td>
          <td>${policy.patientName}</td>
          <td class="text-right">${fmtByCcy(policy.totalPaid, ccy)}</td>
          <td class="text-right" style="color:var(--accent-green)">${fmtByCcy(maxLoan, ccy)}</td>
          <td class="text-right">${loanAmountText}</td>
          <td>${loanBadge}</td>
        </tr>`;
      }).join("");
    }

    // 선택된 증권의 대출 정보 업데이트
    if (el("loanPolicyId")?.value) await refreshLoanInfo();
  } catch (err) {
    addLog("error", "약관대출 현황 조회 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  준비금 계좌 (Reserve Fund)
// ═══════════════════════════════════════════════════════════════
let _reserveProjected = 0n;
let _reserveWalletBal = 0n;

async function depositReserve() {
  addLog("step", "[준비금 송금] 시작");
  if (!reserveSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const amount = parseUsdc(el("reserveDepositAmount")?.value);
  if (amount <= 0n) { showToast("송금 금액을 입력하세요.", "warning"); return; }

  const bal = await usdcCtx.balanceOf(userAddr).catch(() => 0n);
  if (bal < amount) {
    addLog("error", "잔액 부족", `보유: ${fmtUsdc(bal)} / 필요: ${fmtUsdc(amount)}`);
    showToast(`${stableName()} 잔액이 부족합니다.`, "error"); return;
  }

  try {
    const allowance = await usdcCtx.allowance(userAddr, reserveAddr);
    if (allowance < amount) {
      addLog("step", `[1/2] ${stableName()} approve(${fmtUsdc(amount)}) 요청`);
      const approveTx = await usdcSign.approve(reserveAddr, amount);
      await approveTx.wait();
      addLog("success", "approve 완료", "", approveTx.hash);
    }
  } catch (err) {
    addLog("error", "approve 실패", parseError(err));
    showToast("승인 실패: " + (err.shortMessage || err.message), "error"); return;
  }

  await sendTx(
    async () => reserveSign.depositReserve(amount),
    `준비금 송금: ${fmtUsdc(amount)}`,
    async () => {
      el("reserveDepositAmount").value = "";
      await Promise.all([refreshMyBalance(), refreshReserve(), refreshStats()]);
    }
  );
}

function setReserveWithdrawMax() {
  if (_reserveProjected <= 0n) { showToast("인출 가능한 준비금이 없습니다.", "warning"); return; }
  const dec = stableDecimals();
  el("reserveWithdrawAmount").value = dec === 0
    ? _reserveProjected.toString()
    : parseFloat(ethers.formatUnits(_reserveProjected, dec)).toFixed(2);
}

function setReserveDepositMax() {
  if (_reserveWalletBal <= 0n) { showToast("송금 가능한 지갑 잔액이 없습니다.", "warning"); return; }
  const dec = stableDecimals();
  el("reserveDepositAmount").value = dec === 0
    ? _reserveWalletBal.toString()
    : parseFloat(ethers.formatUnits(_reserveWalletBal, dec)).toFixed(2);
}

async function withdrawReserve() {
  addLog("step", "[준비금 인출] 시작");
  if (!reserveSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const amount = parseUsdc(el("reserveWithdrawAmount")?.value);
  if (amount <= 0n) { showToast("인출 금액을 입력하세요.", "warning"); return; }

  await sendTx(
    async () => reserveSign.withdrawReserve(amount),
    `준비금 인출: ${fmtUsdc(amount)}`,
    async () => {
      el("reserveWithdrawAmount").value = "";
      await Promise.all([refreshMyBalance(), refreshReserve(), refreshStats()]);
    }
  );
}

let _reserveAdminRowsCache = [];

function exportReserveTableCsv() {
  const rows = _reserveAdminRowsCache.map(r => {
    const info = getAccountInfo(r.addr);
    return [
      r.ccy, info ? info.name : r.addr, r.addr,
      fmtByCcy(r.acc.principal, r.ccy), fmtByCcy(r.preview.projectedPrincipal, r.ccy),
      fmtByCcy(r.acc.totalInterestEarned + r.preview.pendingInterest, r.ccy),
      fmtByCcy(r.acc.totalDeposited, r.ccy), fmtByCcy(r.acc.totalWithdrawn, r.ccy),
    ];
  });
  exportRowsToCsv(`준비금계좌_현황_${new Date().toISOString().slice(0,10)}.csv`,
    ["통화", "고객", "지갑주소", "원금(확정)", "예상잔액(이자포함)", "누적이자", "누적송금", "누적인출"], rows);
}

async function refreshReserve() {
  try {
    // ── 내 계좌 현황 (일반 계정) — 현재 토글된 통화 기준 ────────
    if (!isOwner && userAddr) {
      const handle = getReserveForCcy(currencyMode);
      const token  = getTokenForCcy(currencyMode);
      if (handle?.ctx) {
        const [acc, preview, walletBal] = await Promise.all([
          handle.ctx.getAccount(userAddr),
          handle.ctx.previewBalance(userAddr),
          token ? token.ctx.balanceOf(userAddr).catch(() => 0n) : 0n
        ]);
        _reserveProjected = preview.projectedPrincipal;
        _reserveWalletBal = walletBal;
        el("reserveMyPrincipal").textContent       = fmtByCcy(acc.principal, currencyMode);
        el("reserveMyProjected").textContent       = fmtByCcy(preview.projectedPrincipal, currencyMode);
        el("reserveMyPendingInterest").textContent = fmtByCcy(preview.pendingInterest, currencyMode);
        el("reserveMyTotalInterest").textContent   = fmtByCcy(acc.totalInterestEarned + preview.pendingInterest, currencyMode);
        el("reserveMyTotalDeposited").textContent  = fmtByCcy(acc.totalDeposited, currencyMode);
        el("reserveMyTotalWithdrawn").textContent  = fmtByCcy(acc.totalWithdrawn, currencyMode);
        if (el("reserveMyWalletBal")) el("reserveMyWalletBal").textContent = fmtByCcy(walletBal, currencyMode);
      }

      // 다른 통화 계좌도 참고로 함께 표시 (입출금은 상단에서 통화 전환 후 진행)
      const otherCcy = currencyMode === 'KRW' ? 'USDC' : 'KRW';
      const otherHandle = getReserveForCcy(otherCcy);
      const otherBox = el("reserveOtherCcyBox");
      if (otherBox) {
        if (otherHandle?.ctx) {
          try {
            const otherPreview = await otherHandle.ctx.previewBalance(userAddr);
            otherBox.style.display = "block";
            otherBox.innerHTML = `📎 [${otherCcy}] 준비금 계좌 예상 잔액: <strong>${fmtByCcy(otherPreview.projectedPrincipal, otherCcy)}</strong>` +
              ` (${convertedAmountLabel(otherPreview.projectedPrincipal, otherCcy)}) — 상단 통화 버튼으로 전환하면 이 계좌를 입출금할 수 있습니다.`;
          } catch { otherBox.style.display = "none"; }
        } else {
          otherBox.style.display = "none";
        }
      }
    }

    // ── 전체 고객 현황 (관리자) — 다른 탭들과 동일하게 현재 화면 통화만 ──
    if (isOwner) {
      let rows = [];
      for (const ccy of [currencyMode]) {
        const handle = getReserveForCcy(ccy);
        if (!handle?.ctx) continue;
        try {
          const holders = await handle.ctx.getAllHolders();
          const ccyRows = await Promise.all(holders.map(async addr => {
            const [acc, preview] = await Promise.all([
              handle.ctx.getAccount(addr),
              handle.ctx.previewBalance(addr)
            ]);
            return { addr, acc, preview, ccy };
          }));
          rows.push(...ccyRows);
        } catch (e) {
          addLog("error", `[${ccy}] 준비금 현황 조회 실패`, e.message);
        }
      }

      _reserveAdminRowsCache = rows;

      const totalProjected = rows.reduce((s, r) => s + r.preview.projectedPrincipal, 0n);
      const totalInterest  = rows.reduce((s, r) => s + r.acc.totalInterestEarned + r.preview.pendingInterest, 0n);
      el("reserveAdminHolderCount").textContent   = rows.length.toString();
      el("reserveAdminTotal").textContent         = fmtByCcy(totalProjected, currencyMode);
      el("reserveAdminTotalInterest").textContent = fmtByCcy(totalInterest, currencyMode);

      const tbody = el("reserveAdminTable");
      if (tbody) {
        tbody.innerHTML = rows.length === 0
          ? `<tr><td colspan="7" class="text-center" style="color:var(--text-muted);padding:20px">준비금 계좌가 없습니다</td></tr>`
          : rows.map(r => {
              const info = getAccountInfo(r.addr);
              return `<tr>
                <td><span class="badge" style="font-size:10px;background:${r.ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${r.ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${r.ccy}</span></td>
                <td>${info ? info.name : shortAddr(r.addr)}</td>
                <td class="text-right">${fmtByCcy(r.acc.principal, r.ccy)}</td>
                <td class="text-right" style="color:var(--accent-green)">${fmtByCcy(r.preview.projectedPrincipal, r.ccy)}</td>
                <td class="text-right" style="color:var(--accent-cyan)">${fmtByCcy(r.acc.totalInterestEarned + r.preview.pendingInterest, r.ccy)}</td>
                <td class="text-right">${fmtByCcy(r.acc.totalDeposited, r.ccy)}</td>
                <td class="text-right">${fmtByCcy(r.acc.totalWithdrawn, r.ccy)}</td>
              </tr>`;
            }).join("");
      }
    }

    // ── 송금/인출 내역 (다른 탭들과 동일하게 현재 화면 통화만) ──────
    const historyBody = el("reserveHistoryBody");
    if (historyBody) {
      let hrows = [];
      for (const ccy of [currencyMode]) {
        const handle = getReserveForCcy(ccy);
        if (!handle?.ctx) continue;
        try {
          const [depEvents, wdEvents] = await Promise.all([
            handle.ctx.queryFilter(isOwner ? handle.ctx.filters.ReserveDeposited() : handle.ctx.filters.ReserveDeposited(userAddr)).catch(() => []),
            handle.ctx.queryFilter(isOwner ? handle.ctx.filters.ReserveWithdrawn() : handle.ctx.filters.ReserveWithdrawn(userAddr)).catch(() => [])
          ]);
          hrows.push(
            ...depEvents.map(ev => ({ ccy, type: "송금", patient: ev.args.patient, amount: ev.args.amount, newPrincipal: ev.args.newPrincipal, ts: ev.args.timestamp })),
            ...wdEvents.map(ev => ({ ccy, type: "인출", patient: ev.args.patient, amount: ev.args.amount, newPrincipal: ev.args.newPrincipal, ts: ev.args.timestamp }))
          );
        } catch (e) {
          addLog("error", `[${ccy}] 준비금 내역 조회 실패`, e.message);
        }
      }
      hrows.sort((a, b) => Number(b.ts) - Number(a.ts));

      const histColspan = isOwner ? 6 : 5;
      historyBody.innerHTML = hrows.length === 0
        ? `<tr><td colspan="${histColspan}" class="text-center" style="color:var(--text-muted);padding:20px">내역 없음</td></tr>`
        : hrows.map(r => {
            const info = getAccountInfo(r.patient);
            return `<tr>
              <td><span class="badge" style="font-size:10px;background:${r.ccy === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${r.ccy === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${r.ccy}</span></td>
              <td>${r.type === "송금" ? `<span class="badge badge-approved">💸 송금</span>` : `<span class="badge badge-pending">💰 인출</span>`}</td>
              ${isOwner ? `<td>${info ? info.name : shortAddr(r.patient)}</td>` : ""}
              <td class="text-right">${fmtByCcy(r.amount, r.ccy)}</td>
              <td class="text-right" style="color:var(--text-muted)">${fmtByCcy(r.newPrincipal, r.ccy)}</td>
              <td style="font-size:11px">${tsToDate(r.ts)}</td>
            </tr>`;
          }).join("");
    }
  } catch (err) {
    addLog("error", "준비금 조회 실패", parseError(err));
  }
}

// ═══════════════════════════════════════════════════════════════
//  대체투자형 준비금 (Alt Investment Fund)
// ═══════════════════════════════════════════════════════════════
let _altInvestReserveBal = 0n;  // 투자 재원 = 준비금 계좌 잔액(더 이상 개인 지갑 잔액이 아님)
let _altInvestFundsCache = [];      // 현재 통화의 펀드 목록 (index = fundId)
let _altInvestPositionsCache = [];  // 내 포지션 캐시 [{fundId, principal, projected, pending, unlockTime}]

function altFundStatusLabel(unlockTime) {
  const now = Math.floor(Date.now() / 1000);
  const unlock = Number(unlockTime);
  if (unlock <= now) return `<span class="badge badge-approved">🔓 해제됨</span>`;
  const daysLeft = Math.ceil((unlock - now) / 86400);
  return `<span class="badge badge-pending">🔒 D-${daysLeft}</span>`;
}

async function renderFundOptions() {
  const container = el("altInvestFundList");
  if (!container) return;
  const handle = getAltInvestForCcy(currencyMode);
  if (!handle?.ctx) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:8px">컨트랙트를 먼저 연결하세요.</div>`;
    return;
  }
  try {
    const funds = await handle.ctx.getFunds();
    _altInvestFundsCache = funds;
    if (funds.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:8px">등록된 펀드가 없습니다.</div>`;
      return;
    }
    const prevChecked = document.querySelector('input[name="fundChoice"]:checked')?.dataset.id;
    container.innerHTML = funds.map((f, id) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;${f.active ? "" : "opacity:0.5"}">
        <input type="radio" name="fundChoice" class="fund-option-radio" data-id="${id}" ${!f.active ? "disabled" : ""} ${String(id) === prevChecked ? "checked" : ""}>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${f.name}${f.active ? "" : " (비활성)"}</div>
          <div style="font-size:11px;color:var(--text-muted)">${f.assetClass} · 락업 ${f.lockupDays}일 · 조기해지 페널티 ${(Number(f.earlyExitPenaltyBps) / 100).toFixed(1)}%</div>
        </div>
        <div style="text-align:right;font-size:13px;font-weight:700;color:var(--accent-green)">연 ${(Number(f.aprBps) / 100).toFixed(1)}%</div>
      </label>
    `).join("");
  } catch (err) {
    addLog("error", "펀드 목록 조회 실패", parseError(err));
    container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:8px">펀드 목록을 불러오지 못했습니다.</div>`;
  }
}

function setAltInvestMax() {
  if (_altInvestReserveBal <= 0n) { showToast("투자 가능한 준비금 잔액이 없습니다.", "warning"); return; }
  const dec = stableDecimals();
  el("altInvestAmount").value = dec === 0
    ? _altInvestReserveBal.toString()
    : parseFloat(ethers.formatUnits(_altInvestReserveBal, dec)).toFixed(2);
}

// 대체투자 인출/조기해지로 지갑에 잠깐 들어온 원금+이자를 다시 준비금 계좌로
// 돌려보낸다 — "준비금을 굴렸다가 회수한다"는 흐름을 그대로 반영해, 지갑에
// 머무르지 않고 항상 준비금 계좌로 귀결되게 한다 (사용자 확정 결정, 2026-09-19).
async function depositToReserveAfterAltInvest(amount) {
  if (amount <= 0n || !reserveSign) return;
  try {
    const allowance = await usdcCtx.allowance(userAddr, reserveAddr);
    if (allowance < amount) {
      addLog("step", `[준비금 회수] ${stableName()} approve(${fmtUsdc(amount)}) 요청`);
      const approveTx = await usdcSign.approve(reserveAddr, amount);
      await approveTx.wait();
      addLog("success", "approve 완료", "", approveTx.hash);
    }
  } catch (err) {
    addLog("error", "준비금 회수 approve 실패", parseError(err));
    showToast("준비금 회수 승인 실패: " + (err.shortMessage || err.message), "error");
    return;
  }
  await sendTx(
    async () => reserveSign.depositReserve(amount),
    `준비금 회수: ${fmtUsdc(amount)}`,
    async () => { await Promise.all([refreshMyBalance(), refreshReserve(), refreshStats()]); }
  );
}

// 대체투자는 "준비금을 어떻게 굴릴지의 대안"이므로, 재원은 개인 지갑이 아니라
// 준비금 계좌에서 나가야 한다(사용자 확정 결정, 2026-09-19). 새 컨트랙트 연동
// 없이 기존 검증된 함수만으로: 준비금 인출(ReserveFund → 지갑) → 투자(지갑 →
// AltInvestmentFund) 순서로 서명 2회를 이어서 실행한다.
async function investAltFund() {
  addLog("step", "[대체투자] 투자 시작");
  if (!altInvestSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  if (!reserveSign) { showToast("준비금 계좌 컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const selected = document.querySelector('input[name="fundChoice"]:checked');
  if (!selected) { showToast("투자할 펀드를 선택하세요.", "warning"); return; }
  const fundId = Number(selected.dataset.id);
  const amount = parseUsdc(el("altInvestAmount")?.value);
  if (amount <= 0n) { showToast("투자 금액을 입력하세요.", "warning"); return; }

  const reservePreview = await reserveCtx.previewBalance(userAddr).catch(() => ({ projectedPrincipal: 0n }));
  if (reservePreview.projectedPrincipal < amount) {
    addLog("error", "준비금 잔액 부족", `준비금: ${fmtUsdc(reservePreview.projectedPrincipal)} / 필요: ${fmtUsdc(amount)}`);
    showToast("준비금 계좌 잔액이 부족합니다.", "error"); return;
  }

  // 조기해지 시 이메일 알림을 받으려면 이메일이 필요한데, 청약 신청과 달리
  // 투자 전용 사용자는 rememberCertEmail이 한 번도 호출된 적이 없을 수 있음 —
  // 투자 카드 자체에 선택 입력을 두고 여기서 같은 저장소에 등록한다.
  const email = el("altInvestEmail")?.value.trim();
  if (email && isValidEmail(email)) rememberCertEmail(userAddr, email);

  await sendTx(
    async () => reserveSign.withdrawReserve(amount),
    `대체투자 재원 마련 — 준비금 인출: ${fmtUsdc(amount)}`,
    async () => {
      await refreshReserve();

      try {
        const allowance = await usdcCtx.allowance(userAddr, altInvestAddr);
        if (allowance < amount) {
          addLog("step", `[1/2] ${stableName()} approve(${fmtUsdc(amount)}) 요청`);
          const approveTx = await usdcSign.approve(altInvestAddr, amount);
          await approveTx.wait();
          addLog("success", "approve 완료", "", approveTx.hash);
        }
      } catch (err) {
        addLog("error", "approve 실패", parseError(err));
        showToast("승인 실패: " + (err.shortMessage || err.message), "error"); return;
      }

      await sendTx(
        async () => altInvestSign.invest(fundId, amount),
        `대체투자: ${fmtUsdc(amount)} → ${_altInvestFundsCache[fundId]?.name || `펀드 #${fundId}`}`,
        async () => {
          el("altInvestAmount").value = "";
          await Promise.all([refreshMyBalance(), refreshAltInvest(), refreshStats()]);
        }
      );
    }
  );
}

async function withdrawAltFund(fundId) {
  if (!altInvestSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  if (!reserveSign) { showToast("준비금 계좌 컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const pos = _altInvestPositionsCache.find(p => p.fundId === fundId);
  if (!pos || pos.projected <= 0n) { showToast("인출 가능한 금액이 없습니다.", "warning"); return; }
  const amount = pos.projected;
  await sendTx(
    async () => altInvestSign.withdraw(fundId, amount),
    `대체투자 인출: ${fmtUsdc(amount)}`,
    async () => {
      await refreshAltInvest();
      await depositToReserveAfterAltInvest(amount);
    }
  );
}

async function earlyWithdrawAltFund(fundId) {
  if (!altInvestSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  if (!reserveSign) { showToast("준비금 계좌 컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const pos = _altInvestPositionsCache.find(p => p.fundId === fundId);
  if (!pos || pos.projected <= 0n) { showToast("해지 가능한 금액이 없습니다.", "warning"); return; }
  const fund = _altInvestFundsCache[fundId];
  const penaltyPct = fund ? (Number(fund.earlyExitPenaltyBps) / 100).toFixed(1) : "?";
  if (!confirm(`조기 해지 시 원금+이자의 ${penaltyPct}%가 페널티로 차감됩니다. 계속할까요?`)) return;
  const amount = pos.projected;
  // earlyWithdraw()의 실수령액(payout) 계산과 동일한 공식 — 컨트랙트에 남는
  // 페널티분은 준비금으로 회수하지 않는다(손실 시뮬레이션 그대로 유지).
  const penalty = fund ? (amount * fund.earlyExitPenaltyBps) / 10000n : 0n;
  const payout  = amount - penalty;
  await sendTx(
    async () => altInvestSign.earlyWithdraw(fundId, amount),
    `대체투자 조기해지: ${fmtUsdc(amount)} (페널티 ${penaltyPct}%)`,
    async () => {
      await refreshAltInvest();
      await depositToReserveAfterAltInvest(payout);
    }
  );
}

async function addAltFund() {
  if (!altInvestSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const name = el("altFundName")?.value.trim();
  const assetClass = el("altFundAssetClass")?.value.trim();
  const apr = Number(el("altFundApr")?.value);
  const lockupDays = Number(el("altFundLockupDays")?.value);
  const penalty = Number(el("altFundPenalty")?.value);
  if (!name || !assetClass || !(apr >= 0) || !(lockupDays >= 0) || !(penalty >= 0)) {
    showToast("모든 항목을 올바르게 입력하세요.", "warning"); return;
  }
  await sendTx(
    async () => altInvestSign.addFund(name, assetClass, Math.round(apr * 100), lockupDays, Math.round(penalty * 100)),
    `펀드 추가: ${name}`,
    async () => {
      el("altFundName").value = ""; el("altFundAssetClass").value = "";
      el("altFundApr").value = ""; el("altFundLockupDays").value = ""; el("altFundPenalty").value = "";
      await refreshAltInvest();
    }
  );
}

async function toggleAltFundActive(fundId, nextActive) {
  if (!altInvestSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  await sendTx(
    async () => altInvestSign.setFundActive(fundId, nextActive),
    `펀드 ${nextActive ? "활성화" : "비활성화"}: #${fundId}`,
    async () => { await refreshAltInvest(); }
  );
}

async function refreshAltInvest() {
  try {
    await renderFundOptions();

    // ── 투자 재원 = 준비금 계좌 잔액 (투자 입력창 안내용) ────────
    if (userAddr && reserveCtx) {
      const reservePreview = await reserveCtx.previewBalance(userAddr).catch(() => ({ projectedPrincipal: 0n }));
      _altInvestReserveBal = reservePreview.projectedPrincipal;
      if (el("altInvestWalletBal")) el("altInvestWalletBal").textContent = fmtByCcy(_altInvestReserveBal, currencyMode);
    }
    if (el("altInvestAmountLabel")) el("altInvestAmountLabel").textContent = stableName();

    // ── 내 포지션 현황 (일반 계정) ────────────────────────────
    const myTable = el("altInvestMyTable");
    if (myTable && userAddr && !isOwner) {
      const handle = getAltInvestForCcy(currencyMode);
      const rows = [];
      if (handle?.ctx && _altInvestFundsCache.length > 0) {
        for (let fundId = 0; fundId < _altInvestFundsCache.length; fundId++) {
          const pos = await handle.ctx.getPosition(userAddr, fundId).catch(() => null);
          if (!pos || !pos.exists || pos.principal === 0n) continue;
          const preview = await handle.ctx.previewPosition(userAddr, fundId).catch(() => null);
          if (!preview) continue;
          rows.push({
            fundId, principal: pos.principal,
            projected: preview.projectedPrincipal, pending: preview.pendingInterest,
            unlockTime: preview.unlockTime,
          });
        }
      }
      _altInvestPositionsCache = rows;
      const myUnlockedCount = rows.filter(r => Number(r.unlockTime) <= Math.floor(Date.now() / 1000)).length;
      if (el("altInvestAlertBadge")) el("altInvestAlertBadge").textContent = myUnlockedCount > 0 ? ` 🔓${myUnlockedCount}` : "";
      myTable.innerHTML = rows.length === 0
        ? `<tr><td colspan="5" class="text-center" style="color:var(--text-muted);padding:20px">투자 내역 없음</td></tr>`
        : rows.map(r => {
            const fund = _altInvestFundsCache[r.fundId];
            const unlocked = Number(r.unlockTime) <= Math.floor(Date.now() / 1000);
            return `<tr>
              <td>${fund ? fund.name : `펀드 #${r.fundId}`}</td>
              <td class="text-right">${fmtByCcy(r.principal, currencyMode)}</td>
              <td class="text-right" style="color:var(--accent-green)">${fmtByCcy(r.projected, currencyMode)}</td>
              <td>${altFundStatusLabel(r.unlockTime)}</td>
              <td>
                <button class="btn btn-ghost btn-sm" ${unlocked ? "" : "disabled"} onclick="withdrawAltFund(${r.fundId})">인출</button>
                <button class="btn btn-ghost btn-sm" onclick="earlyWithdrawAltFund(${r.fundId})">조기해지</button>
              </td>
            </tr>`;
          }).join("");
    }

    // ── 관리자: 펀드 관리 테이블 ────────────────────────────────
    if (isOwner) {
      const adminTable = el("altFundAdminTable");
      if (adminTable) {
        adminTable.innerHTML = _altInvestFundsCache.length === 0
          ? `<tr><td colspan="5" class="text-center" style="color:var(--text-muted);padding:20px">등록된 펀드가 없습니다</td></tr>`
          : _altInvestFundsCache.map((f, id) => `
              <tr>
                <td>${f.name}<div style="font-size:11px;color:var(--text-muted)">${f.assetClass}</div></td>
                <td class="text-right">${(Number(f.aprBps) / 100).toFixed(1)}%</td>
                <td class="text-right">${f.lockupDays}일</td>
                <td>${f.active ? `<span class="badge badge-approved">활성</span>` : `<span class="badge badge-rejected">비활성</span>`}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="toggleAltFundActive(${id}, ${!f.active})">${f.active ? "비활성화" : "활성화"}</button></td>
              </tr>
            `).join("");
      }

      // ── 관리자: 전체 투자자 현황 (다른 탭들과 동일하게 현재 화면 통화만) ──
      const holdersTable = el("altInvestAdminTable");
      if (holdersTable) {
        const handle = getAltInvestForCcy(currencyMode);
        let rows = [];
        if (handle?.ctx && _altInvestFundsCache.length > 0) {
          try {
            const holders = await handle.ctx.getAllHolders();
            for (const addr of holders) {
              for (let fundId = 0; fundId < _altInvestFundsCache.length; fundId++) {
                const pos = await handle.ctx.getPosition(addr, fundId).catch(() => null);
                if (!pos || !pos.exists || pos.principal === 0n) continue;
                const preview = await handle.ctx.previewPosition(addr, fundId).catch(() => null);
                if (!preview) continue;
                rows.push({ addr, fundId, principal: pos.principal, projected: preview.projectedPrincipal, unlockTime: preview.unlockTime, ccy: currencyMode });
              }
            }
          } catch (e) {
            addLog("error", `[${currencyMode}] 대체투자 현황 조회 실패`, e.message);
          }
        }
        _altInvestAdminRowsCache = rows;
        const nowTs = Math.floor(Date.now() / 1000);
        const unlockedCount = rows.filter(r => Number(r.unlockTime) <= nowTs).length;
        if (el("altInvestAlertBadge")) el("altInvestAlertBadge").textContent = unlockedCount > 0 ? ` 🔓${unlockedCount}` : "";
        holdersTable.innerHTML = rows.length === 0
          ? `<tr><td colspan="6" class="text-center" style="color:var(--text-muted);padding:20px">투자 내역 없음</td></tr>`
          : rows.map(r => {
              const info = getAccountInfo(r.addr);
              const fund = _altInvestFundsCache[r.fundId];
              return `<tr>
                <td><span class="badge" style="font-size:10px;background:${currencyMode === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${currencyMode === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${currencyMode}</span></td>
                <td>${info ? info.name : shortAddr(r.addr)}</td>
                <td>${fund ? fund.name : `#${r.fundId}`}</td>
                <td class="text-right">${fmtByCcy(r.principal, currencyMode)}</td>
                <td class="text-right" style="color:var(--accent-green)">${fmtByCcy(r.projected, currencyMode)}</td>
                <td>${altFundStatusLabel(r.unlockTime)}</td>
              </tr>`;
            }).join("");
      }
    }
  } catch (err) {
    addLog("error", "대체투자 조회 실패", parseError(err));
  }
}

let _altInvestAdminRowsCache = [];

function exportAltInvestTableCsv() {
  const rows = _altInvestAdminRowsCache.map(r => {
    const info = getAccountInfo(r.addr);
    const fund = _altInvestFundsCache[r.fundId];
    const unlocked = Number(r.unlockTime) <= Math.floor(Date.now() / 1000);
    return [
      r.ccy, info ? info.name : r.addr, r.addr,
      fund ? fund.name : `#${r.fundId}`,
      fmtByCcy(r.principal, r.ccy), fmtByCcy(r.projected, r.ccy),
      tsToDate(r.unlockTime), unlocked ? "해제됨" : "락업중",
    ];
  });
  exportRowsToCsv(`대체투자_현황_${new Date().toISOString().slice(0,10)}.csv`,
    ["통화", "투자자", "지갑주소", "펀드", "원금(확정)", "예상잔액(이자포함)", "락업해제일", "상태"], rows);
}

// ═══════════════════════════════════════════════════════════════
//  파라메트릭(자동집행) 보험
// ═══════════════════════════════════════════════════════════════
let _paramProductsCache = [];   // 현재 통화의 상품 목록 (index = productId)
let _paramMyCoveragesCache = [];
let _paramAdminRowsCache = [];

const PARAM_COVERAGE_STATUS_LABEL = ["가입중(관측대기)", "지급완료(트리거)", "만료(미지급)"];

function paramStatusBadge(status) {
  const s = Number(status);
  if (s === 1) return `<span class="badge badge-approved">🎯 지급완료</span>`;
  if (s === 2) return `<span class="badge badge-rejected">⌛ 만료</span>`;
  return `<span class="badge badge-pending">⏳ 관측대기</span>`;
}

async function renderParametricProductOptions() {
  const container = el("paramProductList");
  if (!container || !paramCtx) return;
  try {
    const products = await paramCtx.getProducts();
    _paramProductsCache = products;
    if (products.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:8px">등록된 상품이 없습니다.</div>`;
      return;
    }
    const prevChecked = document.querySelector('input[name="paramProductChoice"]:checked')?.dataset.id;
    container.innerHTML = products.map((p, id) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;${p.active ? "" : "opacity:0.5"}">
        <input type="radio" name="paramProductChoice" class="param-option-radio" data-id="${id}" ${!p.active ? "disabled" : ""} ${String(id) === prevChecked ? "checked" : ""}>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${p.name}${p.active ? "" : " (비활성)"}</div>
          <div style="font-size:11px;color:var(--text-muted)">${p.metricLabel} ≥ ${p.triggerThreshold} 시 자동지급 · 보험료 ${fmtByCcy(p.premium, currencyMode)}</div>
        </div>
        <div style="text-align:right;font-size:13px;font-weight:700;color:var(--accent-green)">지급 ${fmtByCcy(p.payoutAmount, currencyMode)}</div>
      </label>
    `).join("");
  } catch (err) {
    addLog("error", "파라메트릭 상품 목록 조회 실패", parseError(err));
    container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:8px">상품 목록을 불러오지 못했습니다.</div>`;
  }
}

async function purchaseParametricCoverage() {
  addLog("step", "[파라메트릭] 커버리지 구매 시작");
  if (!paramSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const selected = document.querySelector('input[name="paramProductChoice"]:checked');
  if (!selected) { showToast("가입할 상품을 선택하세요.", "warning"); return; }
  const productId = Number(selected.dataset.id);
  const product = _paramProductsCache[productId];
  if (!product) { showToast("상품 정보를 불러오지 못했습니다.", "error"); return; }
  const premium = product.premium;

  const email = el("paramEmail")?.value.trim();
  if (email && isValidEmail(email)) rememberCertEmail(userAddr, email);

  try {
    const allowance = await usdcCtx.allowance(userAddr, paramAddr);
    if (allowance < premium) {
      addLog("step", `[1/2] ${stableName()} approve(${fmtByCcy(premium, currencyMode)}) 요청`);
      const approveTx = await usdcSign.approve(paramAddr, premium);
      await approveTx.wait();
      addLog("success", "approve 완료", "", approveTx.hash);
    }
  } catch (err) {
    addLog("error", "approve 실패", parseError(err));
    showToast("승인 실패: " + (err.shortMessage || err.message), "error"); return;
  }

  await sendTx(
    async () => paramSign.purchaseCoverage(productId),
    `파라메트릭 가입: ${product.name}`,
    async () => { await Promise.all([refreshMyBalance(), refreshParametric(), refreshStats()]); }
  );
}

async function toggleParamProductActive(productId, nextActive) {
  if (!paramSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  await sendTx(
    async () => paramSign.setProductActive(productId, nextActive),
    `상품 ${nextActive ? "활성화" : "비활성화"}: #${productId}`,
    async () => { await refreshParametric(); }
  );
}

async function addParamProduct() {
  if (!paramSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const name = el("paramProductName")?.value.trim();
  const metricLabel = el("paramProductMetric")?.value.trim();
  const threshold = Number(el("paramProductThreshold")?.value);
  const payout = parseUsdc(el("paramProductPayout")?.value);
  const premium = parseUsdc(el("paramProductPremium")?.value);
  const durationDays = Number(el("paramProductDurationDays")?.value);
  if (!name || !metricLabel || !(threshold >= 0) || payout <= 0n || premium <= 0n || !(durationDays > 0)) {
    showToast("모든 항목을 올바르게 입력하세요.", "warning"); return;
  }
  await sendTx(
    async () => paramSign.addProduct(name, metricLabel, threshold, payout, premium, durationDays * 86400),
    `파라메트릭 상품 추가: ${name}`,
    async () => {
      el("paramProductName").value = ""; el("paramProductMetric").value = "";
      el("paramProductThreshold").value = ""; el("paramProductPayout").value = "";
      el("paramProductPremium").value = ""; el("paramProductDurationDays").value = "";
      await refreshParametric();
    }
  );
}

async function depositParamFunds() {
  if (!paramSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const amount = parseUsdc(el("paramDepositAmount")?.value);
  if (amount <= 0n) { showToast("입금할 금액을 입력하세요.", "warning"); return; }
  try {
    const allowance = await usdcCtx.allowance(userAddr, paramAddr);
    if (allowance < amount) {
      const approveTx = await usdcSign.approve(paramAddr, amount);
      await approveTx.wait();
    }
  } catch (err) {
    showToast("승인 실패: " + (err.shortMessage || err.message), "error"); return;
  }
  await sendTx(
    async () => paramSign.depositFunds(amount),
    `파라메트릭 지급 재원 입금: ${fmtByCcy(amount, currencyMode)}`,
    async () => { el("paramDepositAmount").value = ""; await refreshParametric(); }
  );
}

async function refreshParametric() {
  try {
    await renderParametricProductOptions();
    if (el("paramAmountLabel")) el("paramAmountLabel").textContent = stableName();

    // ── 내 커버리지 (일반 계정) ──────────────────────────────
    const myTable = el("paramMyTable");
    if (myTable && userAddr && paramCtx && !isOwner) {
      const rows = [];
      try {
        const ids = await paramCtx.getHolderCoverages(userAddr);
        for (const id of ids) {
          const cov = await paramCtx.getCoverage(id).catch(() => null);
          if (cov) rows.push({
            id: cov.id, holder: cov.holder, productId: cov.productId,
            purchaseTime: cov.purchaseTime, expiryTime: cov.expiryTime,
            status: cov.status, observedValue: cov.observedValue, resolvedAt: cov.resolvedAt,
          });
        }
      } catch (e) { /* 무시 - 아래 빈 목록으로 표시 */ }
      _paramMyCoveragesCache = rows;
      myTable.innerHTML = rows.length === 0
        ? `<tr><td colspan="5" class="text-center" style="color:var(--text-muted);padding:20px">가입 내역 없음</td></tr>`
        : rows.map(cov => {
            const product = _paramProductsCache[Number(cov.productId)];
            return `<tr>
              <td>${product ? product.name : `상품 #${cov.productId}`}</td>
              <td>${paramStatusBadge(cov.status)}</td>
              <td class="text-right">${Number(cov.status) === 0 ? "-" : cov.observedValue}</td>
              <td class="text-right" style="color:var(--accent-green)">${product ? fmtByCcy(product.payoutAmount, currencyMode) : "-"}</td>
              <td>${tsToDate(cov.expiryTime)}</td>
            </tr>`;
          }).join("");
    }

    // ── 관리자: 상품 관리 + 전체 커버리지 현황 ────────────────
    if (isOwner && paramCtx) {
      const adminProductTable = el("paramProductAdminTable");
      if (adminProductTable) {
        adminProductTable.innerHTML = _paramProductsCache.length === 0
          ? `<tr><td colspan="5" class="text-center" style="color:var(--text-muted);padding:20px">등록된 상품이 없습니다</td></tr>`
          : _paramProductsCache.map((p, id) => `
              <tr>
                <td>${p.name}<div style="font-size:11px;color:var(--text-muted)">${p.metricLabel} ≥ ${p.triggerThreshold}</div></td>
                <td class="text-right">${fmtByCcy(p.premium, currencyMode)}</td>
                <td class="text-right">${fmtByCcy(p.payoutAmount, currencyMode)}</td>
                <td>${p.active ? `<span class="badge badge-approved">활성</span>` : `<span class="badge badge-rejected">비활성</span>`}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="toggleParamProductActive(${id}, ${!p.active})">${p.active ? "비활성화" : "활성화"}</button></td>
              </tr>
            `).join("");
      }

      const adminCovTable = el("paramAdminTable");
      if (adminCovTable) {
        let rows = [];
        try {
          const ids = await paramCtx.getAllCoverageIds();
          for (const id of ids) {
            const cov = await paramCtx.getCoverage(id).catch(() => null);
            if (cov) rows.push({
              id: cov.id, holder: cov.holder, productId: cov.productId,
              purchaseTime: cov.purchaseTime, expiryTime: cov.expiryTime,
              status: cov.status, observedValue: cov.observedValue, resolvedAt: cov.resolvedAt,
              ccy: currencyMode,
            });
          }
        } catch (e) {
          addLog("error", `[${currencyMode}] 파라메트릭 현황 조회 실패`, e.message);
        }
        _paramAdminRowsCache = rows;
        adminCovTable.innerHTML = rows.length === 0
          ? `<tr><td colspan="6" class="text-center" style="color:var(--text-muted);padding:20px">가입 내역 없음</td></tr>`
          : rows.map(cov => {
              const info = getAccountInfo(cov.holder);
              const product = _paramProductsCache[Number(cov.productId)];
              return `<tr>
                <td><span class="badge" style="font-size:10px;background:${currencyMode === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${currencyMode === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${currencyMode}</span></td>
                <td>${info ? info.name : shortAddr(cov.holder)}</td>
                <td>${product ? product.name : `#${cov.productId}`}</td>
                <td>${paramStatusBadge(cov.status)}</td>
                <td class="text-right">${product ? fmtByCcy(product.payoutAmount, currencyMode) : "-"}</td>
                <td>${tsToDate(cov.expiryTime)}</td>
              </tr>`;
            }).join("");
      }
    }
  } catch (err) {
    addLog("error", "파라메트릭보험 조회 실패", parseError(err));
  }
}

function exportParametricTableCsv() {
  const rows = _paramAdminRowsCache.map(cov => {
    const info = getAccountInfo(cov.holder);
    const product = _paramProductsCache[Number(cov.productId)];
    return [
      cov.ccy, info ? info.name : cov.holder, cov.holder,
      product ? product.name : `#${cov.productId}`,
      PARAM_COVERAGE_STATUS_LABEL[Number(cov.status)],
      product ? fmtByCcy(product.payoutAmount, cov.ccy) : "-",
      tsToDate(cov.expiryTime),
    ];
  });
  exportRowsToCsv(`파라메트릭보험_현황_${new Date().toISOString().slice(0,10)}.csv`,
    ["통화", "가입자", "지갑주소", "상품", "상태", "지급액", "만료일"], rows);
}

// ═══════════════════════════════════════════════════════════════
//  재보험풀 (외부 유동성 공급)
// ═══════════════════════════════════════════════════════════════
let _reinsuranceAdminRowsCache = [];

async function depositReinsurance() {
  addLog("step", "[재보험풀] 예치 시작");
  if (!reinsuranceSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const amount = parseUsdc(el("reinsuranceDepositAmount")?.value);
  if (amount <= 0n) { showToast("예치 금액을 입력하세요.", "warning"); return; }

  const email = el("reinsuranceEmail")?.value.trim();
  if (email && isValidEmail(email)) rememberCertEmail(userAddr, email);

  try {
    const allowance = await usdcCtx.allowance(userAddr, reinsuranceAddr);
    if (allowance < amount) {
      addLog("step", `[1/2] ${stableName()} approve(${fmtByCcy(amount, currencyMode)}) 요청`);
      const approveTx = await usdcSign.approve(reinsuranceAddr, amount);
      await approveTx.wait();
      addLog("success", "approve 완료", "", approveTx.hash);
    }
  } catch (err) {
    addLog("error", "approve 실패", parseError(err));
    showToast("승인 실패: " + (err.shortMessage || err.message), "error"); return;
  }

  await sendTx(
    async () => reinsuranceSign.deposit(amount),
    `재보험풀 예치: ${fmtByCcy(amount, currencyMode)}`,
    async () => {
      el("reinsuranceDepositAmount").value = "";
      await Promise.all([refreshMyBalance(), refreshReinsurance(), refreshStats()]);
    }
  );
}

async function withdrawReinsurance() {
  if (!reinsuranceSign || !reinsuranceCtx) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  if (!userAddr) return;
  const myShares = await reinsuranceCtx.shares(userAddr).catch(() => 0n);
  if (myShares <= 0n) { showToast("보유 지분이 없습니다.", "warning"); return; }
  await sendTx(
    async () => reinsuranceSign.withdraw(myShares),
    `재보험풀 전액 인출 (지분 ${myShares})`,
    async () => { await Promise.all([refreshMyBalance(), refreshReinsurance(), refreshStats()]); }
  );
}

async function adminSetCedingBps() {
  if (!insSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const pct = Number(el("cedingBpsInput")?.value);
  if (!(pct >= 0) || pct > 30) { showToast("0~30 사이의 비율(%)을 입력하세요.", "warning"); return; }
  await sendTx(
    async () => insSign.setCedingBps(Math.round(pct * 100)),
    `ceding 비율 설정: ${pct}%`,
    async () => { await refreshReinsurance(); }
  );
}

async function adminDrawForClaim() {
  if (!reinsuranceSign) { showToast("컨트랙트를 먼저 연결하세요.", "warning"); return; }
  const amount = parseUsdc(el("reinsuranceDrawAmount")?.value);
  if (amount <= 0n) { showToast("인출할 금액을 입력하세요.", "warning"); return; }
  if (!confirm(`재보험풀에서 ${fmtByCcy(amount, currencyMode)}를 인출해 관리자 지갑으로 보냅니다. 이후 직접 DentalInsurance에 재입금(준비금 예치)해야 합니다. 계속할까요?`)) return;
  await sendTx(
    async () => reinsuranceSign.drawForClaim(amount),
    `재보험풀 청구 백스톱 인출: ${fmtByCcy(amount, currencyMode)}`,
    async () => { el("reinsuranceDrawAmount").value = ""; await refreshReinsurance(); }
  );
}

async function refreshReinsurance() {
  try {
    if (el("reinsuranceAmountLabel")) el("reinsuranceAmountLabel").textContent = stableName();
    if (el("reinsuranceAmountLabel2")) el("reinsuranceAmountLabel2").textContent = stableName();

    if (userAddr && reinsuranceCtx) {
      const pos = await reinsuranceCtx.previewShareValue(userAddr).catch(() => ({ shareBalance: 0n, assetValue: 0n }));
      if (el("reinsuranceMyShares")) el("reinsuranceMyShares").textContent = pos.shareBalance.toString();
      if (el("reinsuranceMyValue")) el("reinsuranceMyValue").textContent = fmtByCcy(pos.assetValue, currencyMode);
    }

    if (reinsuranceCtx) {
      const stats = await reinsuranceCtx.getPoolStats().catch(() => null);
      if (stats) {
        if (el("reinsurancePoolAssets")) el("reinsurancePoolAssets").textContent = fmtByCcy(stats.assets, currencyMode);
        if (el("reinsurancePoolShares")) el("reinsurancePoolShares").textContent = stats.shareSupply.toString();
        if (el("reinsurancePoolHolders")) el("reinsurancePoolHolders").textContent = stats.holderCount.toString();
      }
    }
    if (insCtx) {
      const bps = await insCtx.cedingBps().catch(() => 0n);
      if (el("reinsuranceCedingDisplay")) el("reinsuranceCedingDisplay").textContent = `${(Number(bps) / 100).toFixed(1)}%`;
      if (el("cedingBpsInput") && document.activeElement !== el("cedingBpsInput")) {
        el("cedingBpsInput").value = (Number(bps) / 100).toFixed(1);
      }
    }

    if (isOwner && reinsuranceCtx) {
      const table = el("reinsuranceAdminTable");
      if (table) {
        let rows = [];
        try {
          const holders = await reinsuranceCtx.getHolders();
          for (const addr of holders) {
            const pos = await reinsuranceCtx.previewShareValue(addr).catch(() => null);
            if (!pos || pos.shareBalance === 0n) continue;
            rows.push({ addr, shareBalance: pos.shareBalance, assetValue: pos.assetValue, ccy: currencyMode });
          }
        } catch (e) {
          addLog("error", `[${currencyMode}] 재보험풀 현황 조회 실패`, e.message);
        }
        _reinsuranceAdminRowsCache = rows;
        table.innerHTML = rows.length === 0
          ? `<tr><td colspan="4" class="text-center" style="color:var(--text-muted);padding:20px">예치 내역 없음</td></tr>`
          : rows.map(r => {
              const info = getAccountInfo(r.addr);
              return `<tr>
                <td><span class="badge" style="font-size:10px;background:${currencyMode === 'KRW' ? 'rgba(255,159,10,0.15)' : 'rgba(47,129,247,0.15)'};color:${currencyMode === 'KRW' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}">${currencyMode}</span></td>
                <td>${info ? info.name : shortAddr(r.addr)}</td>
                <td class="text-right">${r.shareBalance}</td>
                <td class="text-right" style="color:var(--accent-green)">${fmtByCcy(r.assetValue, currencyMode)}</td>
              </tr>`;
            }).join("");
      }
    }
  } catch (err) {
    addLog("error", "재보험풀 조회 실패", parseError(err));
  }
}

function exportReinsuranceTableCsv() {
  const rows = _reinsuranceAdminRowsCache.map(r => {
    const info = getAccountInfo(r.addr);
    return [r.ccy, info ? info.name : r.addr, r.addr, r.shareBalance.toString(), fmtByCcy(r.assetValue, r.ccy)];
  });
  exportRowsToCsv(`재보험풀_현황_${new Date().toISOString().slice(0,10)}.csv`,
    ["통화", "투자자", "지갑주소", "보유지분", "지분가치"], rows);
}

// ── 탭 전환 ──────────────────────────────────────────────────
function showTab(tabName) {
  if (tabName === "admin" && !isOwner) {
    showToast("관리자 계정만 접근할 수 있습니다.", "error");
    return;
  }
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  const tabEl = el(`tab-${tabName}`);
  const btnEl = document.querySelector(`[data-tab="${tabName}"]`);
  if (tabEl) tabEl.classList.add("active");
  if (btnEl) btnEl.classList.add("active");
  if (tabName === "state")          refreshBlockchainState();
  if (tabName === "policy")         refreshPolicies();
  if (tabName === "premium")        refreshPremiumHistory();
  if (tabName === "claim" || tabName === "admin") refreshClaims();
  if (tabName === "claim")          refreshClaimCoverageInfo();
  if (tabName === "log")            updateLogCounters();
  if (tabName === "maturity")       refreshMaturity();
  if (tabName === "autopay")        refreshAutopaySchedule();
  if (tabName === "underwriting")   refreshApplications();
  if (tabName === "loan")           refreshLoanPolicies();
  if (tabName === "reserve")        refreshReserve();
  if (tabName === "altinvest")      refreshAltInvest();
  if (tabName === "parametric")     refreshParametric();
  if (tabName === "reinsurance")    refreshReinsurance();
  if (tabName === "admin")          loadKrwRateOverride();
}

// ── 내 주소 복사 ──────────────────────────────────────────────
function copyMyAddr() {
  if (!userAddr) return;
  copyToClip(userAddr);
}

// ── 초기화 ───────────────────────────────────────────────────
window.addEventListener("load", async () => {
  addLog("info", "═══ 덴탈보험 블록체인 시스템 시작 ═══",
    `시각: ${new Date().toLocaleString("ko-KR")}\n브라우저: ${navigator.userAgent.slice(0,60)}`);
  addLog("info", "MetaMask 감지 확인",
    `window.ethereum 존재: ${!!window.ethereum}\nisMetaMask: ${window.ethereum?.isMetaMask || false}`);
  // 챗봇의 "블록체인 가입 시작" 버튼이 대체투자 추천에서 눌리면 백엔드가
  // URL에 #altinvest를 붙여서 창을 연다 — 해당 탭으로 바로 열리게 해시를 확인한다
  // (해시가 없거나 존재하지 않는 탭이면 기존과 동일하게 파우셋 탭).
  const hashTab = location.hash.slice(1);
  const initialTab = (hashTab && document.querySelector(`[data-tab="${hashTab}"]`)) ? hashTab : "faucet";
  showTab(initialTab);
  renderCoverageOptions();
  updateCurrencyLabels();
  await tryLoadConfig();
  loadKrwRateOverride(); // config.json 로드 이후 — localStorage에 저장된 관리자 환율 오버라이드가 있으면 최종 적용
});
