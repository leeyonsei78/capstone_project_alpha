/**
 * premium-scheduler.js
 * 월 보험료 자동 수납 스케줄러 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/premium-scheduler.js
 *
 * 동작:
 *  - 30초마다 전체 보험증권 납입 기한(nextDueTime) 확인 (USDC / KRW 모두)
 *  - 기한 도달 + 피보험자 잔액/allowance 충분 → collectPremium() 자동 호출
 *  - 기한 도달했는데 자동납부 미설정/잔액 부족 + 씬파일러 유연납입(flexiblePayment) 대상 →
 *    autoCoverArrearsWithLoan()으로 약관대출 자동 대환 시도, 성공하면 Slack 알림 없이 넘어감
 *  - 위 대환도 안 되거나(한도초과/기존대출 미상환) 유연납입 대상이 아니면 → Slack 알림
 *    (기존엔 콘솔 로그만 남기고 아무도 모르게 방치되던 부분)
 *  - 납입 기한이 임박(REMINDER_SEC 이내)했지만 아직 도래하지 않은 증권 →
 *    Slack 사전 알림 (기한당 1회만, 재알림 스팸 방지)
 *
 * 환경변수 (.env):
 *  RPC_URL       : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  ADMIN_KEY     : 관리자 개인키 (기본: Hardhat Account #0)
 *  POLL_SEC      : 폴링 간격 초 (기본: 30)
 *  REMINDER_SEC  : 납입 기한 사전 알림 기준 (기본: 259200 = 3일)
 *  SLACK_WEBHOOK_URL : 실패/사전 알림용 (없으면 콘솔에만 출력)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

const { postToSlack } = require("./lib/slack");

// ethers v6 이벤트 필터 폴링(FilterIdEventSubscriber)이 드물게 내부 오류를 던져
// 처리되지 않은 Promise 거부로 전체 프로세스가 종료되는 것을 방지 (스케줄러는 계속 실행돼야 함)
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL      = process.env.RPC_URL     || "http://127.0.0.1:8545";
const ADMIN_KEY    = process.env.ADMIN_KEY   || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const POLL_SEC     = parseInt(process.env.POLL_SEC || "30", 10);
const REMINDER_SEC = parseInt(process.env.REMINDER_SEC || "259200", 10); // 기본 3일
const CONFIG_PATH  = path.join(__dirname, "..", "frontend", "config.json");

// 알림 중복 방지 (증권ID+납입기한 단위로 1회만) — 프로세스 재시작 시 초기화됨,
// 다른 워처들의 in-memory dedup(Set)과 동일한 방식
const alertedFailure = new Set();
const remindedUpcoming = new Set();

// ── ABI ───────────────────────────────────────────────────────────
const INSURANCE_ABI = [
  "function getAllPolicyIds() view returns (uint256[])",
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid, uint256 premiumInterval, bool flexiblePayment))",
  "function isDue(uint256) view returns (bool)",
  "function collectPremium(uint256) external",
  "function autoCoverArrearsWithLoan(uint256) external",
  "function getMaxLoanAmount(uint256) view returns (uint256)",
  "function getPolicyLoan(uint256) view returns (tuple(uint256 policyId, uint256 loanAmount, uint256 borrowedAt, uint256 interestRate, bool active))",
  "event PremiumAutoCollected(uint256 indexed policyId, address indexed patient, uint256 amount, uint256 totalPaid, uint256 timestamp)",
  "event ArrearsCoveredByLoan(uint256 indexed policyId, uint256 amount, uint256 timestamp)",
];
const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toLocaleTimeString("ko-KR")}] ❌ ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}

// 씬파일러 유연납입 대상 증권의 연체를 약관대출로 자동 대환 시도.
// 성공하면 true(Slack "미설정/잔액부족" 알림을 생략해도 됨), 실패(대상 아님/한도초과/
// 기존대출 미상환)하면 false를 반환해 기존 Slack 알림 경로로 폴백한다.
async function tryAutoCoverArrears(contract, policyId, policy, decimals, currency) {
  if (!policy.flexiblePayment) return false;
  try {
    const tx = await contract.autoCoverArrearsWithLoan(policyId);
    const receipt = await tx.wait();
    log(`   🔁 [${currency}] 유연납입 — 증권 #${policyId} 연체 보험료를 약관대출로 자동 대환 완료 (TX: ${receipt.hash})`);
    await postToSlack(
      `🔁 *[${currency} 덴탈보험] 유연납입 자동 대환 — 증권 #${policyId}*\n` +
      `피보험자: ${policy.patientName} | 대환 금액: ${fmtAmount(policy.monthlyPremium, decimals)}\n` +
      `납입 대신 약관대출로 자동 처리되었습니다 (씬파일러 신용보완 유연납입 대상).`
    );
    return true;
  } catch (e) {
    warn(`   유연납입 자동 대환 실패 — 증권 #${policyId}: ${e.reason || e.message}`);
    return false;
  }
}

// ── 컨트랙트별 수납 처리 ─────────────────────────────────────────
async function collectDuePremiums(contract, tokenContract, insAddr, decimals, currency) {
  let policyIds;
  try {
    policyIds = await contract.getAllPolicyIds();
  } catch (e) {
    warn(`[${currency}] 증권 목록 조회 실패: ${e.message}`);
    return;
  }
  if (policyIds.length === 0) return;

  for (const id of policyIds) {
    const policyId = Number(id);

    let policy;
    try { policy = await contract.getPolicy(policyId); } catch { continue; }
    if (!policy.active) continue;

    const dueKey = `${policyId}-${policy.nextDueTime}`;
    const secLeft = Number(policy.nextDueTime) - Math.floor(Date.now() / 1000);

    // 아직 기한 전인데 임박한 경우 — 사전 알림 1회
    if (secLeft > 0) {
      if (secLeft <= REMINDER_SEC && !remindedUpcoming.has(dueKey)) {
        remindedUpcoming.add(dueKey);
        const dueDate = new Date(Number(policy.nextDueTime) * 1000).toLocaleString("ko-KR");
        log(`⏳ [${currency}] 증권 #${policyId} [${policy.patientName}] 납입 기한 임박 (${dueDate})`);
        await postToSlack(
          `⏳ *[${currency} 덴탈보험] 납입 기한 임박 — 증권 #${policyId}*\n` +
          `피보험자: ${policy.patientName} | 월 보험료: ${fmtAmount(policy.monthlyPremium, decimals)} | ` +
          `납입 기한: ${dueDate}`
        );
      }
      continue;
    }

    const amount  = policy.monthlyPremium;
    const patient = policy.patient;

    let balance, allowance;
    try {
      balance   = await tokenContract.balanceOf(patient);
      allowance = await tokenContract.allowance(patient, insAddr);
    } catch (e) {
      warn(`[${currency}] 증권 #${policyId} 잔액/허용량 조회 실패: ${e.message}`);
      continue;
    }

    log(`⏰ [${currency}] 증권 #${policyId} [${policy.patientName}] 납입 기한 도달`);
    log(`   월 보험료: ${fmtAmount(amount, decimals)}`);
    log(`   잔액: ${fmtAmount(balance, decimals)}  허용량: ${fmtAmount(allowance, decimals)}`);

    if (allowance < amount) {
      if (await tryAutoCoverArrears(contract, policyId, policy, decimals, currency)) { alertedFailure.delete(dueKey); continue; }
      warn(`   ⛔ 자동납부 미설정 — 피보험자가 UI에서 [자동납부 ON] 버튼을 눌러야 합니다.`);
      if (!alertedFailure.has(dueKey)) {
        alertedFailure.add(dueKey);
        await postToSlack(
          `🚨 *[${currency} 덴탈보험] 자동납부 미설정 — 증권 #${policyId}*\n` +
          `피보험자: ${policy.patientName} | 월 보험료: ${fmtAmount(amount, decimals)}\n` +
          `자동납부가 꺼져 있어 납입 기한이 지났는데도 수납되지 않았습니다. 피보험자에게 [자동납부 ON] 안내가 필요합니다.`
        );
      }
      continue;
    }
    if (balance < amount) {
      if (await tryAutoCoverArrears(contract, policyId, policy, decimals, currency)) { alertedFailure.delete(dueKey); continue; }
      warn(`   ⛔ 잔액 부족 — ${fmtAmount(balance, decimals)} / 필요: ${fmtAmount(amount, decimals)}`);
      if (!alertedFailure.has(dueKey)) {
        alertedFailure.add(dueKey);
        await postToSlack(
          `🚨 *[${currency} 덴탈보험] 잔액 부족으로 자동납부 실패 — 증권 #${policyId}*\n` +
          `피보험자: ${policy.patientName} | 필요 금액: ${fmtAmount(amount, decimals)} | ` +
          `현재 잔액: ${fmtAmount(balance, decimals)}\n` +
          `잔액 충전 전까지 매 폴링마다 재시도하며, 미납이 계속되면 보험금 청구가 제한될 수 있습니다.`
        );
      }
      continue;
    }

    try {
      log(`   collectPremium(${policyId}) 실행 중...`);
      const tx = await contract.collectPremium(policyId);
      const receipt = await tx.wait();
      const newTotal = BigInt(policy.totalPaid) + BigInt(amount);
      log(`   ✅ 수납 완료! ${fmtAmount(amount, decimals)} → 컨트랙트  TX: ${receipt.hash}`);
      log(`   누적 납입: ${fmtAmount(newTotal, decimals)}`);
      alertedFailure.delete(dueKey);
    } catch (txErr) {
      err(`   collectPremium(${policyId}) 실패: ${txErr.reason || txErr.message}`);
    }
  }
}

async function printSchedule(contract, tokenContract, insAddr, decimals, currency) {
  try {
    const ids = await contract.getAllPolicyIds();
    if (ids.length === 0) return;
    console.log(`\n[ 납입 일정 — ${currency} ]`);
    for (const id of ids) {
      const p = await contract.getPolicy(id);
      if (!p.active) continue;
      const due     = new Date(Number(p.nextDueTime) * 1000).toLocaleString("ko-KR");
      const secLeft = Number(p.nextDueTime) - Math.floor(Date.now() / 1000);
      const status  = secLeft <= 0 ? "⏰ 납입 기한 초과" : `⏳ ${secLeft}초 후`;
      const allow   = await tokenContract.allowance(p.patient, insAddr);
      const autoOn  = allow >= p.monthlyPremium ? "🟢 자동납부 ON" : "🔴 자동납부 OFF";
      log(`증권 #${id}: ${p.patientName} | 다음 납입: ${due} | ${status} | ${autoOn}`);
    }
    console.log("-".repeat(60));
  } catch (_) {}
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    err("frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const admin    = new ethers.Wallet(ADMIN_KEY, provider);

  const usdcInsAddr = config.contracts?.DentalInsurance;
  const usdcTknAddr = config.contracts?.MockUSDC;
  const krwInsAddr  = config.contracts?.DentalInsuranceKRW;
  const krwTknAddr  = config.contracts?.MockKRW;

  const usdcContract = usdcInsAddr ? new ethers.Contract(usdcInsAddr, INSURANCE_ABI, admin) : null;
  const usdcToken    = usdcTknAddr ? new ethers.Contract(usdcTknAddr, TOKEN_ABI, provider)   : null;
  const krwContract  = krwInsAddr  ? new ethers.Contract(krwInsAddr,  INSURANCE_ABI, admin)  : null;
  const krwToken     = krwTknAddr  ? new ethers.Contract(krwTknAddr,  TOKEN_ABI, provider)   : null;

  console.log("=".repeat(60));
  console.log("  🔄 월 보험료 자동 수납 스케줄러 시작 (USDC + KRW)");
  console.log("=".repeat(60));
  log(`USDC Insurance : ${usdcInsAddr || "없음"}`);
  log(`KRW  Insurance : ${krwInsAddr  || "없음"}`);
  log(`관리자 계정    : ${admin.address}`);
  log(`폴링 간격      : ${POLL_SEC}초`);
  console.log("-".repeat(60));

  async function runAll() {
    if (usdcContract && usdcToken) await collectDuePremiums(usdcContract, usdcToken, usdcInsAddr, 6, "USDC");
    if (krwContract  && krwToken)  await collectDuePremiums(krwContract,  krwToken,  krwInsAddr,  0, "KRW");
  }

  // 초기 일정 출력
  if (usdcContract && usdcToken) await printSchedule(usdcContract, usdcToken, usdcInsAddr, 6, "USDC");
  if (krwContract  && krwToken)  await printSchedule(krwContract,  krwToken,  krwInsAddr,  0, "KRW");

  // 초기 실행
  await runAll();

  // 폴링 루프
  setInterval(runAll, POLL_SEC * 1000);
  log(`✅ 스케줄러 실행 중 (매 ${POLL_SEC}초마다 검사, Ctrl+C 로 종료)`);
}

main().catch(e => {
  console.error("치명적 오류:", e);
  process.exit(1);
});
