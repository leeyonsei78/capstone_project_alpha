/**
 * slack-notifier.js
 * 블록체인 전(全) 메뉴 행위 슬랙 알림 서비스 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/slack-notifier.js
 *
 * 동작:
 *  - DentalInsurance / ReserveFund / AltInvestmentFund / ParametricInsurance /
 *    ReinsurancePool / MockUSDC 컨트랙트의 모든 이벤트를
 *    SLACK_POLL_SEC 간격으로 폴링(queryFilter)해서 감지 — 프론트엔드 어느
 *    메뉴(탭)에서 호출했든, 스케줄러/오라클/워처가 자동으로 호출했든
 *    상관없이 온체인에 이벤트가 발생하는 모든 행위를 빠짐없이 포착한다.
 *    (다른 워처들과 동일하게 폴링 방식 — ethers v6의 push형 contract.on("*")
 *    필터는 Hardhat 노드에서 첫 이벤트 이후 필터가 stale해져 이후 이벤트를
 *    놓치는 경우가 있어 이 방식으로 통일함)
 *  - 이벤트가 감지되면 사람이 읽기 쉬운 한국어 메시지로 가공해
 *    Slack Incoming Webhook으로 전송한다.
 *
 * 환경변수 (.env):
 *  SLACK_WEBHOOK_URL : Slack Incoming Webhook URL (필수 — 없으면 콘솔에만 출력)
 *  RPC_URL           : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  SLACK_POLL_SEC    : 폴링 간격 초 (기본: 4 — Hardhat 자동 마이닝 간격과 동일, 다른 워처의 POLL_SEC와 별개)
 *
 * 참고: MockKRW.faucet()은 컨트랙트에 이벤트가 정의되어 있지 않아
 *       이벤트 기반으로는 감지할 수 없다 (KRW 파우셋 알림 제외).
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

const { postToSlack: sendSlackWebhook, SLACK_WEBHOOK_URL } = require("./lib/slack");

// ethers v6 이벤트 필터 폴링이 드물게 내부 오류를 던져 처리되지 않은 Promise
// 거부로 전체 프로세스가 종료되는 것을 방지 (알림 서비스는 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL      = process.env.RPC_URL || "http://127.0.0.1:8545";
const POLL_SEC     = parseInt(process.env.SLACK_POLL_SEC || "4", 10);
const CONFIG_PATH  = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI (도메인 이벤트만 등록 — Transfer/Approval 등 잡음성 이벤트는 제외) ──
const INSURANCE_ABI = [
  "event PolicyCreated(uint256 indexed policyId, address indexed patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 timestamp)",
  "event PremiumPaid(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
  "event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId, address indexed patient, uint256 amount, string treatmentCode, uint256 timestamp)",
  "event ClaimApproved(uint256 indexed claimId, uint256 indexed policyId, uint256 amount, uint256 timestamp)",
  "event ClaimRejected(uint256 indexed claimId, uint256 indexed policyId, string reason, uint256 timestamp)",
  "event ClaimPaid(uint256 indexed claimId, uint256 indexed policyId, address indexed patient, uint256 amount, uint256 timestamp)",
  "event PolicyDeactivated(uint256 indexed policyId, uint256 timestamp)",
  "event FundsDeposited(address indexed depositor, uint256 amount, uint256 timestamp)",
  "event ApplicationSubmitted(uint256 indexed appId, address indexed applicant, string applicantName, uint256 riskScore, uint256 timestamp)",
  "event ApplicationApproved(uint256 indexed appId, uint256 indexed policyId, uint256 timestamp)",
  "event ApplicationRejected(uint256 indexed appId, address indexed applicant, string reason, uint256 timestamp)",
  "event PolicyLoanTaken(uint256 indexed policyId, address indexed patient, uint256 loanAmount, uint256 timestamp)",
  "event PolicyLoanRepaid(uint256 indexed policyId, address indexed patient, uint256 principal, uint256 interest, uint256 timestamp)",
  "event MaturityRefundPaid(uint256 indexed policyId, address indexed patient, uint256 refundAmount, uint256 timestamp)",
  "event PremiumAutoCollected(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
  "event OracleAddressSet(address indexed oracle)",
  "event OracleModeSet(bool enabled)",
  "event ClaimOracleVerified(uint256 indexed claimId, bool approved, bytes32 dataHash, string hospitalName, uint256 timestamp)",
];
const RESERVE_ABI = [
  "event ReserveDeposited(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event ReserveWithdrawn(address indexed patient, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event InterestAccrued(address indexed patient, uint256 interestAmount, uint256 newPrincipal, uint256 timestamp)",
];
const FAUCET_ABI = [
  "event FaucetUsed(address indexed user, uint256 amount)",
];
const ALTINVEST_ABI = [
  "event FundCreated(uint256 indexed fundId, string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps)",
  "event FundActiveSet(uint256 indexed fundId, bool active)",
  "event Invested(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 newPrincipal, uint256 unlockTime, uint256 timestamp)",
  "event Withdrawn(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 newPrincipal, uint256 timestamp)",
  "event EarlyWithdrawn(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 penalty, uint256 payout, uint256 newPrincipal, uint256 timestamp)",
  "event InterestAccrued(address indexed investor, uint256 indexed fundId, uint256 interestAmount, uint256 newPrincipal, uint256 timestamp)",
];
// [★캡스톤 편입★] 파라메트릭 자동지급 — CoverageResolved는 지금까지 프론트엔드가
// 브라우저에서 이벤트 리스너로 열려 있을 때만 알림(이메일)을 보냈고, 이 서비스처럼
// "브라우저 없이도 항상 도는" 백엔드 알림에는 빠져 있었음(사용자가 발견 — 폭염특보
// 자동지급이 나도 화면을 안 보고 있으면 아무도 몰랐음). maturity-watcher.js가
// MaturityRefundPaid를 직접 챙기는 것과 동일하게, 여기(전(全) 메뉴 이벤트를 폴링하는
// 공용 서비스)에 등록해 다른 이벤트들과 같은 방식으로 항상 알림이 가도록 함.
const PARAMETRIC_ABI = [
  "event CoveragePurchased(uint256 indexed coverageId, address indexed holder, uint256 indexed productId, uint256 premium, uint256 expiryTime, uint256 timestamp)",
  "event CoverageResolved(uint256 indexed coverageId, uint8 status, uint256 observedValue, uint256 payoutAmount, uint256 timestamp)",
];
// [★캡스톤 편입★] 재보험풀 — 파라메트릭과 같은 이유로 빠져 있던 것을 이어서 등록
// (Deposited/Withdrawn/ClaimDrawUsed도 지금까지 브라우저 리스너에만 의존).
// ⚠️ event Withdrawn은 이름이 ALTINVEST_ABI의 Withdrawn과 겹친다 — 인자 구조가
// 달라(재보험풀은 investor/shareAmount/amountPaid/newShares, 대체투자는
// investor/fundId/amount/newPrincipal) args.fundId 존재 여부로 런타임에 구분한다
// (InterestAccrued를 ReserveFund/AltInvestmentFund로 구분하던 것과 동일한 패턴).
const REINSURANCE_ABI = [
  "event Deposited(address indexed investor, uint256 amount, uint256 sharesMinted, uint256 newShares, uint256 timestamp)",
  "event Withdrawn(address indexed investor, uint256 shareAmount, uint256 amountPaid, uint256 newShares, uint256 timestamp)",
  "event ClaimDrawUsed(address indexed to, uint256 amount, uint256 timestamp)",
];

// ── 이벤트별 아이콘/제목 ──────────────────────────────────────────
const EVENT_META = {
  PolicyCreated:        { icon: "📋", title: "보험증권 생성" },
  PremiumPaid:          { icon: "💳", title: "보험료 납입" },
  ClaimSubmitted:       { icon: "🦷", title: "보험금 청구 접수" },
  ClaimApproved:        { icon: "✅", title: "보험금 청구 승인" },
  ClaimRejected:        { icon: "❌", title: "보험금 청구 거절" },
  ClaimPaid:            { icon: "💰", title: "보험금 지급" },
  PolicyDeactivated:    { icon: "🛑", title: "보험증권 해지" },
  FundsDeposited:       { icon: "🏦", title: "준비금 입금 (관리자)" },
  ApplicationSubmitted: { icon: "📝", title: "청약 신청" },
  ApplicationApproved:  { icon: "✅", title: "청약 승인" },
  ApplicationRejected:  { icon: "❌", title: "청약 거절" },
  PolicyLoanTaken:      { icon: "💵", title: "약관대출 실행" },
  PolicyLoanRepaid:     { icon: "🔁", title: "약관대출 상환" },
  MaturityRefundPaid:   { icon: "💎", title: "만기환급 지급" },
  PremiumAutoCollected: { icon: "🔄", title: "보험료 자동납부" },
  OracleAddressSet:     { icon: "🏥", title: "오라클 주소 설정" },
  OracleModeSet:        { icon: "⚙️", title: "오라클 모드 변경" },
  ClaimOracleVerified:  { icon: "🔍", title: "오라클 진료내역 검증" },
  ReserveDeposited:     { icon: "🏛️", title: "준비금 계좌 예치" },
  ReserveWithdrawn:     { icon: "🏛️", title: "준비금 계좌 출금" },
  InterestAccrued:      { icon: "📈", title: "준비금 이자 적립" },
  FaucetUsed:           { icon: "🚰", title: "테스트 USDC 파우셋" },
  FundCreated:          { icon: "🪙", title: "대체투자 펀드 등록" },
  FundActiveSet:        { icon: "⚙️", title: "대체투자 펀드 활성상태 변경" },
  Invested:             { icon: "🪙", title: "대체투자" },
  Withdrawn:            { icon: "💰", title: "대체투자 인출" },
  EarlyWithdrawn:       { icon: "⚠️", title: "대체투자 조기해지" },
  CoveragePurchased:    { icon: "🌦️", title: "파라메트릭 커버리지 구매" },
  CoverageResolved:     { icon: "🌦️", title: "파라메트릭 커버리지 판정" }, // 아래서 status로 재분류
  Deposited:            { icon: "🛡️", title: "재보험풀 예치" },
  ClaimDrawUsed:        { icon: "🚨", title: "재보험풀 청구 재원 인출" },
};
// CoverageResolved의 status(0=Active/미사용, 1=Triggered, 2=Expired)에 따라
// 제목·아이콘을 다시 고른다 — ParametricInsurance.sol의 CoverageStatus enum과 동일.
const PARAMETRIC_STATUS_META = {
  1: { icon: "🎯", title: "파라메트릭 자동지급 (트리거)" },
  2: { icon: "⌛", title: "파라메트릭 만료 (미지급)" },
};
// ⚠️ InterestAccrued는 ReserveFund(준비금 계좌)와 AltInvestmentFund(대체투자) 양쪽에
// 같은 이벤트 이름으로 존재하지만 인자 구조가 다르다(patient vs investor+fundId) —
// EVENT_META 고정 매핑 하나로는 구분이 안 되어, 아래 pollTarget에서 args.investor
// 존재 여부로 런타임에 제목을 다시 고른다.

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toLocaleTimeString("ko-KR")}] ❌ ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}
function shortAddr(addr) {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Slack 전송 ────────────────────────────────────────────────────
async function postToSlack(text) {
  log(text.replace(/\n/g, " | "));
  if (!SLACK_WEBHOOK_URL) return;
  const result = await sendSlackWebhook(text);
  if (!result.sent) {
    warn(`Slack 전송 실패 (${result.reason}): ${result.detail || ""}`);
  }
}

// ── 이벤트 → 메시지 본문 ──────────────────────────────────────────
function formatEventBody(eventName, args, decimals) {
  const fa = (v) => fmtAmount(v, decimals);
  switch (eventName) {
    case "PolicyCreated":
      return `증권ID: #${args.policyId} | 피보험자: ${args.patientName} (${shortAddr(args.patient)}) | 월보험료: ${fa(args.monthlyPremium)} | 보장한도: ${fa(args.coverageLimit)}`;
    case "PremiumPaid":
      return `증권ID: #${args.policyId} | 납입자: ${shortAddr(args.patient)} | 납입액: ${fa(args.amount)} | 누적납입: ${fa(args.totalPaid)}`;
    case "ClaimSubmitted":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 청구자: ${shortAddr(args.patient)} | 청구액: ${fa(args.amount)} | 치료코드: ${args.treatmentCode}`;
    case "ClaimApproved":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 승인액: ${fa(args.amount)}`;
    case "ClaimRejected":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 사유: ${args.reason}`;
    case "ClaimPaid":
      return `청구ID: #${args.claimId} | 증권ID: #${args.policyId} | 수령자: ${shortAddr(args.patient)} | 지급액: ${fa(args.amount)}`;
    case "PolicyDeactivated":
      return `증권ID: #${args.policyId} 해지 처리됨`;
    case "FundsDeposited":
      return `입금자: ${shortAddr(args.depositor)} | 입금액: ${fa(args.amount)}`;
    case "ApplicationSubmitted":
      return `청약ID: #${args.appId} | 청약자: ${args.applicantName} (${shortAddr(args.applicant)}) | 위험점수: ${args.riskScore}`;
    case "ApplicationApproved":
      return `청약ID: #${args.appId} → 증권ID: #${args.policyId} 생성됨`;
    case "ApplicationRejected":
      return `청약ID: #${args.appId} | 신청자: ${shortAddr(args.applicant)} | 사유: ${args.reason}`;
    case "PolicyLoanTaken":
      return `증권ID: #${args.policyId} | 대출자: ${shortAddr(args.patient)} | 대출금: ${fa(args.loanAmount)}`;
    case "PolicyLoanRepaid":
      return `증권ID: #${args.policyId} | 상환자: ${shortAddr(args.patient)} | 원금: ${fa(args.principal)} | 이자: ${fa(args.interest)}`;
    case "MaturityRefundPaid":
      return `증권ID: #${args.policyId} | 수령자: ${shortAddr(args.patient)} | 환급액: ${fa(args.refundAmount)}`;
    case "PremiumAutoCollected":
      return `증권ID: #${args.policyId} | 피보험자: ${shortAddr(args.patient)} | 자동수납액: ${fa(args.amount)} | 누적납입: ${fa(args.totalPaid)}`;
    case "OracleAddressSet":
      return `오라클 주소: ${shortAddr(args.oracle)}`;
    case "OracleModeSet":
      return `오라클 모드: ${args.enabled ? "✅ 활성화" : "⏸ 비활성화"}`;
    case "ClaimOracleVerified":
      return `청구ID: #${args.claimId} | 결과: ${args.approved ? "승인" : "거절"} | 병원: ${args.hospitalName || "-"}`;
    case "ReserveDeposited":
      return `계좌주: ${shortAddr(args.patient)} | 예치액: ${fa(args.amount)} | 잔액: ${fa(args.newPrincipal)}`;
    case "ReserveWithdrawn":
      return `계좌주: ${shortAddr(args.patient)} | 출금액: ${fa(args.amount)} | 잔액: ${fa(args.newPrincipal)}`;
    case "InterestAccrued":
      if (args.investor !== undefined) {
        return `투자자: ${shortAddr(args.investor)} | 펀드ID: #${args.fundId} | 이자적립: ${fa(args.interestAmount)} | 잔액: ${fa(args.newPrincipal)}`;
      }
      return `계좌주: ${shortAddr(args.patient)} | 이자적립: ${fa(args.interestAmount)} | 잔액: ${fa(args.newPrincipal)}`;
    case "FaucetUsed":
      return `수령자: ${shortAddr(args.user)} | 수령액: ${fa(args.amount)}`;
    case "FundCreated":
      return `펀드ID: #${args.fundId} | ${args.name} (${args.assetClass}) | 연 ${(Number(args.aprBps) / 100).toFixed(1)}% | 락업 ${args.lockupDays}일 | 조기해지 페널티 ${(Number(args.earlyExitPenaltyBps) / 100).toFixed(1)}%`;
    case "FundActiveSet":
      return `펀드ID: #${args.fundId} | 상태: ${args.active ? "✅ 활성" : "⏸ 비활성"}`;
    case "Invested":
      return `투자자: ${shortAddr(args.investor)} | 펀드ID: #${args.fundId} | 투자액: ${fa(args.amount)} | 원금: ${fa(args.newPrincipal)}`;
    case "Withdrawn":
      if (args.fundId === undefined) {
        return `투자자: ${shortAddr(args.investor)} | 인출 지분: ${args.shareAmount} | 실수령: ${fa(args.amountPaid)} | 잔여지분: ${args.newShares}`;
      }
      return `투자자: ${shortAddr(args.investor)} | 펀드ID: #${args.fundId} | 인출액: ${fa(args.amount)} | 잔여원금: ${fa(args.newPrincipal)}`;
    case "Deposited":
      return `투자자: ${shortAddr(args.investor)} | 예치액: ${fa(args.amount)} | 민팅 지분: ${args.sharesMinted} | 보유지분: ${args.newShares}`;
    case "ClaimDrawUsed":
      return `인출 대상: ${shortAddr(args.to)} | 인출액: ${fa(args.amount)}`;
    case "EarlyWithdrawn":
      return `투자자: ${shortAddr(args.investor)} | 펀드ID: #${args.fundId} | 인출액: ${fa(args.amount)} | 페널티: ${fa(args.penalty)} | 실수령: ${fa(args.payout)} | 잔여원금: ${fa(args.newPrincipal)}`;
    case "CoveragePurchased":
      return `커버리지ID: #${args.coverageId} | 가입자: ${shortAddr(args.holder)} | 상품ID: #${args.productId} | 보험료: ${fa(args.premium)}`;
    case "CoverageResolved": {
      const statusLabel = Number(args.status) === 1 ? "트리거(자동지급)" : "만료(미지급)";
      return `커버리지ID: #${args.coverageId} | 판정: ${statusLabel} | 관측값: ${args.observedValue} | 지급액: ${fa(args.payoutAmount)}`;
    }
    default:
      return JSON.stringify(args, (_, v) => typeof v === "bigint" ? v.toString() : v);
  }
}

// ── 컨트랙트 이벤트 폴링 (queryFilter) ───────────────────────────
// 새로 발생한 블록 구간(lastBlock+1 ~ latest)의 전체 이벤트를 한 번에 조회.
// push형 contract.on("*")과 달리 폴링마다 매번 새로 조회하므로 필터가
// stale해져 이후 이벤트를 놓치는 문제가 없다.
async function pollTarget(target, latest) {
  const { contract, label, decimals } = target;
  if (target.lastBlock >= latest) return;
  const fromBlock = target.lastBlock + 1;
  try {
    const events = await contract.queryFilter("*", fromBlock, latest);
    for (const event of events) {
      try {
        const eventName = event.eventName || event.fragment?.name;
        if (!eventName || typeof event.args?.toObject !== "function") continue;
        const args = event.args.toObject();
        let meta = EVENT_META[eventName] || { icon: "🔔", title: eventName };
        // InterestAccrued는 ReserveFund/AltInvestmentFund 양쪽에 같은 이름으로 존재 —
        // args.investor가 있으면 대체투자 쪽 이벤트다 (formatEventBody와 동일한 구분 기준).
        if (eventName === "InterestAccrued" && args.investor !== undefined) {
          meta = { icon: "📈", title: "대체투자 이자 적립" };
        }
        if (eventName === "CoverageResolved") {
          meta = PARAMETRIC_STATUS_META[Number(args.status)] || meta;
        }
        // Withdrawn은 AltInvestmentFund(펀드 인출)와 ReinsurancePool(지분 인출) 양쪽에
        // 같은 이름으로 존재 — fundId가 없으면 재보험풀 쪽 이벤트다.
        if (eventName === "Withdrawn" && args.fundId === undefined) {
          meta = { icon: "🏧", title: "재보험풀 인출" };
        }
        const body = formatEventBody(eventName, args, decimals);
        const txHash = event.transactionHash || "-";

        const text =
          `${meta.icon} *[${label}] ${meta.title}*\n` +
          `${body}\n` +
          `TxHash: \`${txHash}\``;

        await postToSlack(text);
      } catch (e) {
        err(`이벤트 처리 오류 (${label}): ${e.message}`);
      }
    }
  } catch (e) {
    err(`이벤트 조회 오류 (${label}, 블록 ${fromBlock}~${latest}): ${e.message}`);
  }
  target.lastBlock = latest;
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    err("frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log("=".repeat(65));
  console.log("  🔔 블록체인 행위 슬랙 알림 서비스 시작 (USDC + KRW)");
  console.log("=".repeat(65));

  if (!SLACK_WEBHOOK_URL) {
    warn("SLACK_WEBHOOK_URL 미설정 — Slack 전송 없이 콘솔에만 기록합니다.");
    warn(".env에 SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... 를 추가하세요.");
  }

  const c = config.contracts || {};
  const targetDefs = [
    { addr: c.DentalInsurance,    abi: INSURANCE_ABI, label: "USDC 덴탈보험",   decimals: 6 },
    { addr: c.DentalInsuranceKRW, abi: INSURANCE_ABI, label: "KRW 덴탈보험",    decimals: 0 },
    { addr: c.ReserveFund,        abi: RESERVE_ABI,   label: "USDC 준비금계좌", decimals: 6 },
    { addr: c.ReserveFundKRW,     abi: RESERVE_ABI,   label: "KRW 준비금계좌",  decimals: 0 },
    { addr: c.AltInvestmentFund,      abi: ALTINVEST_ABI, label: "USDC 대체투자펀드", decimals: 6 },
    { addr: c.AltInvestmentFundKRW,   abi: ALTINVEST_ABI, label: "KRW 대체투자펀드",  decimals: 0 },
    { addr: c.ParametricInsurance,    abi: PARAMETRIC_ABI, label: "USDC 파라메트릭보험", decimals: 6 },
    { addr: c.ParametricInsuranceKRW, abi: PARAMETRIC_ABI, label: "KRW 파라메트릭보험",  decimals: 0 },
    { addr: c.ReinsurancePool,    abi: REINSURANCE_ABI, label: "USDC 재보험풀", decimals: 6 },
    { addr: c.ReinsurancePoolKRW, abi: REINSURANCE_ABI, label: "KRW 재보험풀",  decimals: 0 },
    { addr: c.MockUSDC,           abi: FAUCET_ABI,    label: "USDC 파우셋",     decimals: 6 },
  ];

  const startBlock = await provider.getBlockNumber();
  const targets = [];
  for (const t of targetDefs) {
    if (!t.addr) { warn(`${t.label} 컨트랙트 주소 없음 — 스킵`); continue; }
    const contract = new ethers.Contract(t.addr, t.abi, provider);
    targets.push({ contract, label: t.label, decimals: t.decimals, lastBlock: startBlock });
    log(`👂 [${t.label}] 이벤트 폴링 등록 완료`);
  }

  if (targets.length === 0) {
    err("리스닝할 컨트랙트가 하나도 없습니다. config.json을 확인하세요.");
    process.exit(1);
  }

  async function pollAll() {
    const latest = await provider.getBlockNumber();
    for (const target of targets) {
      await pollTarget(target, latest);
    }
  }

  console.log("-".repeat(65));
  log(`✅ 슬랙 알림 서비스 실행 중 (${targets.length}개 컨트랙트, ${POLL_SEC}초 간격 폴링, Ctrl+C 로 종료)`);
  await postToSlack("🔔 *블록체인 슬랙 알림 서비스가 시작되었습니다.* 이제부터 모든 메뉴 행위 결과가 이 채널로 전송됩니다.");

  setInterval(() => {
    pollAll().catch(e => err(`폴링 오류: ${e.message}`));
  }, POLL_SEC * 1000);
}

main().catch(e => {
  err(`치명적 오류: ${e.message}`);
  process.exit(1);
});
