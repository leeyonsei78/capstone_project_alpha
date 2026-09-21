#!/usr/bin/env node
/**
 * query-altinvest.js
 * 챗봇(insurance_agent)이 subprocess로 호출해, 특정 지갑주소의 실시간
 * 블록체인 대체투자(AltInvestmentFund) 포지션 현황을 JSON으로 출력하는
 * 읽기 전용 조회 스크립트. query-policy.js와 동일한 원칙으로 USDC 계약만
 * 조회한다 — KRW는 별개 계약이라 챗봇 답변에 혼재시키지 않는다.
 *
 * 사용법: node scripts/query-altinvest.js <지갑주소>
 *
 * 어떤 상황에서도(잘못된 주소, 미배포, 노드 다운 등) 항상 유효한 JSON 한 줄을
 * stdout에 출력하고 exit code 0으로 끝난다.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL     = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

const ALTINVEST_ABI = [
  "function getFunds() view returns (tuple(string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps, bool active, bool riskLinked, address linkedPool)[])",
  "function getPosition(address investor, uint256 fundId) view returns (tuple(uint256 principal, uint256 lastAccrualTime, uint256 depositTime, uint256 totalDeposited, uint256 totalWithdrawn, uint256 totalInterestEarned, bool exists))",
  "function previewPosition(address investor, uint256 fundId) view returns (uint256 projectedPrincipal, uint256 pendingInterest, uint256 unlockTime)",
  "function previewRiskLinkedPosition(address investor, uint256 fundId) view returns (uint256 poolShareBalance, uint256 currentValue, uint256 unlockTime)",
];

function fmtAmount(raw, decimals) {
  const n = Number(ethers.formatUnits(raw, decimals));
  return decimals === 0 ? `₩${Math.round(n).toLocaleString("ko-KR")}` : `$${n.toFixed(2)}`;
}
// query-policy.js의 tsToDate()와 동일 — 반드시 KST 라벨을 명시해 프론트엔드
// 표시와 챗봇 답변의 시각이 어긋나지 않게 한다.
function tsToDate(ts) {
  const n = Number(ts);
  if (n === 0) return null;
  return new Date(n * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " (KST)";
}
function output(obj) {
  console.log(JSON.stringify(obj));
}

async function main() {
  const wallet = process.argv[2];
  if (!wallet || !ethers.isAddress(wallet)) {
    output({ ok: false, error: "유효한 지갑 주소가 아닙니다 (0x로 시작하는 42자 주소여야 합니다).", wallet: wallet || null });
    return;
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    output({ ok: false, error: "블록체인 앱이 아직 배포되지 않았습니다. 먼저 블록체인 가입을 시작해 앱을 켜주세요." });
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const addr = config.contracts?.AltInvestmentFund; // USDC 계약만(위 설명 참고)
  if (!addr) {
    output({ ok: false, error: "대체투자 컨트랙트 주소가 config.json에 없습니다. 배포를 확인해주세요." });
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  try {
    await provider.getBlockNumber();
  } catch (e) {
    output({ ok: false, error: "블록체인 노드에 연결할 수 없습니다. 블록체인 앱이 실행 중인지 확인해주세요." });
    return;
  }

  const block = await provider.getBlock("latest");
  const nowTs = Number(block.timestamp);
  const decimals = 6; // USDC

  const contract = new ethers.Contract(addr, ALTINVEST_ABI, provider);

  let funds;
  try {
    funds = await contract.getFunds();
  } catch (e) {
    output({ ok: false, error: "펀드 목록 조회에 실패했습니다: " + (e.message || String(e)) });
    return;
  }

  const positions = [];
  for (let fundId = 0; fundId < funds.length; fundId++) {
    const f = funds[fundId];
    let principal, projectedPrincipal, pendingInterest, unlockTime, totalInterestEarned, totalDeposited, totalWithdrawn, depositTime;
    if (f.riskLinked) {
      // 리스크연동형 펀드는 고정APR 펀드와 조회 함수 자체가 다르다 —
      // "지분 수량"이 principal 역할을 하고, currentValue가 예상잔액에 해당.
      let rl;
      try {
        rl = await contract.previewRiskLinkedPosition(wallet, fundId);
      } catch (e) {
        continue;
      }
      if (rl.poolShareBalance === 0n) continue;
      principal = rl.currentValue; projectedPrincipal = rl.currentValue; pendingInterest = 0n;
      unlockTime = rl.unlockTime; totalInterestEarned = 0n; totalDeposited = rl.currentValue; totalWithdrawn = 0n;
      depositTime = 0n; // 리스크연동형은 별도 가입시각을 추적하지 않음(지분 단위 회계라 principal 리셋 개념이 다름)
    } else {
      let pos, preview;
      try {
        [pos, preview] = await Promise.all([
          contract.getPosition(wallet, fundId),
          contract.previewPosition(wallet, fundId),
        ]);
      } catch (e) {
        continue; // 이 펀드 조회 실패해도 나머지는 계속 진행
      }
      if (!pos.exists || pos.principal === 0n) continue;
      principal = pos.principal; projectedPrincipal = preview.projectedPrincipal; pendingInterest = preview.pendingInterest;
      unlockTime = preview.unlockTime; totalInterestEarned = pos.totalInterestEarned;
      totalDeposited = pos.totalDeposited; totalWithdrawn = pos.totalWithdrawn; depositTime = pos.depositTime;
    }

    const unlockTs = Number(unlockTime);
    const remainingSec = unlockTs - nowTs;
    // query-policy.js의 timeUntilMaturity와 동일한 사전계산 패턴 —
    // GPT에게 초 단위 숫자를 직접 넘겨 날짜 산수를 시키지 않는다.
    let timeUntilUnlock;
    let unlocked;
    if (remainingSec <= 0) {
      timeUntilUnlock = "잠금 해제됨";
      unlocked = true;
    } else {
      unlocked = false;
      const days  = Math.floor(remainingSec / 86400);
      const hours = Math.floor((remainingSec % 86400) / 3600);
      const mins  = Math.floor((remainingSec % 3600) / 60);
      timeUntilUnlock = days > 0 ? `${days}일 ${hours}시간 후`
        : hours > 0 ? `오늘, ${hours}시간 ${mins}분 후`
        : `오늘, ${mins}분 후`;
    }

    positions.push({
      fundId,
      fundName:              f.name,
      assetClass:            f.assetClass,
      riskLinked:            f.riskLinked,
      annualRate:            f.riskLinked ? "재보험풀 실적 연동(고정 아님)" : (Number(f.aprBps) / 100).toFixed(1) + "%",
      lockupDays:            Number(f.lockupDays),
      earlyExitPenaltyRate:  (Number(f.earlyExitPenaltyBps) / 100).toFixed(1) + "%",
      principal:             fmtAmount(principal, decimals),
      projectedBalance:      fmtAmount(projectedPrincipal, decimals),
      pendingInterest:       fmtAmount(pendingInterest, decimals),
      totalInterestEarned:   fmtAmount(totalInterestEarned, decimals),
      totalDeposited:        fmtAmount(totalDeposited, decimals),
      totalWithdrawn:        fmtAmount(totalWithdrawn, decimals),
      investedAt:            f.riskLinked ? null : tsToDate(depositTime),
      unlockDate:            tsToDate(unlockTime),
      unlocked,
      timeUntilUnlock,
    });
  }

  output({
    ok: true,
    wallet,
    queriedAt: tsToDate(nowTs),
    positionCount: positions.length,
    positions,
  });
}

main().catch(e => output({ ok: false, error: e.message || String(e) }));
