/**
 * altinvest-watcher.js
 * 대체투자(AltInvestmentFund) 락업 해제 임박 사전 알림 워처 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/altinvest-watcher.js
 *
 * maturity-watcher.js와 달리 이 워처는 **아무 트랜잭션도 실행하지 않는다** —
 * 준비금 계좌의 만기환급은 관리자가 대신 처리해줄 수 있지만, 대체투자 포지션은
 * 투자자 본인이 직접 withdraw()/earlyWithdraw()를 호출해야 하므로 이 워처는
 * "락업이 곧 풀립니다" 사전 알림만 보낸다 (읽기 전용).
 *
 * 이메일 알림이 없는 이유: 등록된 이메일 주소는 frontend/app.js의
 * localStorage(지갑주소별, rememberCertEmail/lookupCertEmail)에만 저장되며
 * 이건 브라우저 전용 저장소라 이 Node 백엔드 워처는 접근할 수 없다
 * (reserve-monitor.js가 같은 이유로 Slack 전용인 것과 동일한 제약).
 * 조기해지(EarlyWithdrawn)는 온체인 이벤트라 프론트엔드가 이미 감지 중이므로
 * 그쪽에서 이메일까지 함께 보낸다(frontend/app.js 참고).
 *
 * 환경변수 (.env):
 *  ALTINVEST_REMINDER_SEC : 락업 해제 사전 알림 기준 초 (기본: 604800 = 7일)
 *  SLACK_WEBHOOK_URL       : 사전 알림용 (없으면 콘솔에만 출력)
 *  POLL_SEC                : 폴링 간격 초 (기본: 30)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const { postToSlack } = require("./lib/slack");

process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const RPC_URL     = process.env.RPC_URL || "http://127.0.0.1:8545";
const POLL_SEC     = parseInt(process.env.POLL_SEC || "30", 10);
const ALTINVEST_REMINDER_SEC = parseInt(process.env.ALTINVEST_REMINDER_SEC || "604800", 10); // 기본 7일
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

// ── ABI (읽기 전용) ──────────────────────────────────────────────
const ABI = [
  "function getFunds() view returns (tuple(string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps, bool active, bool riskLinked, address linkedPool)[])",
  "function getPosition(address investor, uint256 fundId) view returns (tuple(uint256 principal, uint256 lastAccrualTime, uint256 depositTime, uint256 totalDeposited, uint256 totalWithdrawn, uint256 totalInterestEarned, bool exists))",
  "function previewPosition(address investor, uint256 fundId) view returns (uint256 projectedPrincipal, uint256 pendingInterest, uint256 unlockTime)",
  "function previewRiskLinkedPosition(address investor, uint256 fundId) view returns (uint256 poolShareBalance, uint256 currentValue, uint256 unlockTime)",
  "function getAllHolders() view returns (address[])",
];

// ── 유틸 ──────────────────────────────────────────────────────────
function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function shortAddr(addr) { return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "-"; }
function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}

// ── 컨트랙트별 워처 ───────────────────────────────────────────────
async function watchContract(contract, decimals, currency, reminded, provider) {
  let funds, holders;
  try {
    [funds, holders] = await Promise.all([contract.getFunds(), contract.getAllHolders()]);
  } catch (e) {
    log(`⚠️  [${currency}] 조회 오류: ${e.message}`);
    return;
  }
  if (funds.length === 0 || holders.length === 0) return;

  const blockTs = Number((await provider.getBlock("latest")).timestamp);

  for (const investor of holders) {
    for (let fundId = 0; fundId < funds.length; fundId++) {
      const key = `${currency}-${investor}-${fundId}`;
      if (reminded.has(key)) continue;

      const fund = funds[fundId];
      let unlockTime, projectedAmount;
      if (fund.riskLinked) {
        const rl = await contract.previewRiskLinkedPosition(investor, fundId).catch(() => null);
        if (!rl || rl.poolShareBalance === 0n) continue;
        unlockTime = rl.unlockTime; projectedAmount = rl.currentValue;
      } else {
        const [pos, preview] = await Promise.all([
          contract.getPosition(investor, fundId).catch(() => null),
          contract.previewPosition(investor, fundId).catch(() => null),
        ]);
        if (!pos || !preview || !pos.exists || pos.principal === 0n) continue;
        unlockTime = preview.unlockTime; projectedAmount = preview.projectedPrincipal;
      }

      const remainingSec = Number(unlockTime) - blockTs;
      if (remainingSec <= 0 || remainingSec > ALTINVEST_REMINDER_SEC) continue;

      reminded.add(key);
      const unlockDate = new Date(Number(unlockTime) * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      log(`⏳ [${currency}] ${fund.name} — 투자자 ${shortAddr(investor)} 락업 해제 임박 (${unlockDate})`);
      await postToSlack(
        `⏳ *[${currency} 대체투자] 락업 해제 임박 — ${fund.name}*\n` +
        `투자자: ${shortAddr(investor)} | 해제일: ${unlockDate}\n` +
        `현재 예상 잔액: ${fmtAmount(projectedAmount, decimals)} (${fund.riskLinked ? "재보험풀 실적 연동 평가액" : "원금+이자, 조기해지 아님"})`
      );
    }
  }
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("❌ frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log("=".repeat(65));
  console.log("  🪙 대체투자 락업 해제 임박 알림 워처 시작 (USDC + KRW)");
  console.log("=".repeat(65));

  const usdcAddr = config.contracts?.AltInvestmentFund;
  const krwAddr  = config.contracts?.AltInvestmentFundKRW;

  const usdcContract = usdcAddr ? new ethers.Contract(usdcAddr, ABI, provider) : null;
  const krwContract  = krwAddr  ? new ethers.Contract(krwAddr,  ABI, provider) : null;

  log(`USDC AltInvestmentFund : ${usdcAddr || "없음"}`);
  log(`KRW  AltInvestmentFund : ${krwAddr  || "없음"}`);
  log(`사전 알림 기준         : ${ALTINVEST_REMINDER_SEC}초 (${(ALTINVEST_REMINDER_SEC / 86400).toFixed(1)}일)`);
  log(`폴링 간격              : ${POLL_SEC}초`);
  console.log("-".repeat(65));

  if (!usdcContract && !krwContract) {
    console.error("❌ 점검할 컨트랙트가 없습니다. config.json을 확인하세요.");
    process.exit(1);
  }

  const reminded = new Set();

  async function checkAll() {
    if (usdcContract) await watchContract(usdcContract, 6, "USDC", reminded, provider);
    if (krwContract)  await watchContract(krwContract,  0, "KRW",  reminded, provider);
  }

  await checkAll();
  setInterval(() => {
    checkAll().catch(e => log(`⚠️  폴링 오류: ${e.message}`));
  }, POLL_SEC * 1000);
  log(`✅ 워처 실행 중 (매 ${POLL_SEC}초마다 검사, Ctrl+C 로 종료)`);
}

main().catch(e => {
  console.error("치명적 오류:", e.message);
  process.exit(1);
});
