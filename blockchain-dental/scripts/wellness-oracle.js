#!/usr/bin/env node
/**
 * wellness-oracle.js
 * 챗봇(insurance_agent)의 submit_wellness_checkin 도구가 subprocess로 호출하는
 * 1회성 스크립트 — 웰니스(건강개선) 연동 보험료 조정을 온체인에 실제로 반영한다.
 * query-*.js와 달리 상태를 변경하는 트랜잭션을 보내지만, 출력 규약은 동일하게
 * 유지한다: 성공/실패 무관하게 항상 유효한 JSON 한 줄을 stdout에 출력하고
 * exit code 0으로 끝난다 (Python 쪽 예외 처리를 단순화하기 위함).
 *
 * 사용법: node scripts/wellness-oracle.js <policyId> <newAmount> <reason> <currency>
 *   policyId  : 증권 ID (정수)
 *   newAmount : 새 보험료 (해당 통화의 최소 단위 정수 — USDC는 6자리, KRW는 0자리)
 *   reason    : 조정 사유 문자열
 *   currency  : "USDC" 또는 "KRW" (기본 USDC)
 */
const fs   = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL     = process.env.RPC_URL    || "http://127.0.0.1:8545";
const ORACLE_KEY  = process.env.ORACLE_KEY || "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

const INSURANCE_ABI = [
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid, uint256 premiumInterval, bool flexiblePayment, uint256 baselinePremiumAmount))",
  "function applyWellnessAdjustment(uint256 policyId, uint256 newPremiumAmount, string reason) external",
];

function output(obj) {
  console.log(JSON.stringify(obj));
}

async function main() {
  const [policyIdArg, newAmountArg, reasonArg, currencyArg] = process.argv.slice(2);
  const currency = (currencyArg || "USDC").toUpperCase();

  if (!policyIdArg || !newAmountArg) {
    output({ ok: false, error: "policyId와 newAmount는 필수입니다." });
    return;
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    output({ ok: false, error: "블록체인 앱이 아직 배포되지 않았습니다." });
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const addr = currency === "KRW" ? config.contracts?.DentalInsuranceKRW : config.contracts?.DentalInsurance;
  if (!addr) {
    output({ ok: false, error: `${currency} DentalInsurance 컨트랙트 주소가 config.json에 없습니다.` });
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  try {
    await provider.getBlockNumber();
  } catch (e) {
    output({ ok: false, error: "블록체인 노드에 연결할 수 없습니다." });
    return;
  }

  const oracle = new ethers.Wallet(ORACLE_KEY, provider);
  const contract = new ethers.Contract(addr, INSURANCE_ABI, oracle);

  const policyId = Number(policyIdArg);
  const newAmount = BigInt(newAmountArg);
  const reason = reasonArg || "웰니스(건강개선) 연동 보험료 조정";

  let oldAmount;
  try {
    const policy = await contract.getPolicy(policyId);
    oldAmount = policy.monthlyPremium;
  } catch (e) {
    output({ ok: false, error: "증권 조회에 실패했습니다: " + (e.message || String(e)) });
    return;
  }

  try {
    const tx = await contract.applyWellnessAdjustment(policyId, newAmount, reason);
    const receipt = await tx.wait();
    output({
      ok: true,
      policyId,
      currency,
      oldAmount: oldAmount.toString(),
      newAmount: newAmount.toString(),
      reason,
      txHash: receipt.hash,
    });
  } catch (e) {
    output({ ok: false, error: "온체인 보험료 조정에 실패했습니다: " + (e.reason || e.message || String(e)) });
  }
}

main().catch(e => output({ ok: false, error: e.message || String(e) }));
