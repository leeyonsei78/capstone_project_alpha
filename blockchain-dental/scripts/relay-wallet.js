/**
 * relay-wallet.js — 가스리스(경량 Relayer) 온보딩용 커스터디얼 지갑 서비스
 *
 * 목적: 챗봇으로 블록체인 덴탈보험에 가입하려는 고객이 MetaMask 설치나
 * 가스비(ETH) 마련 없이도 청약을 제출할 수 있게 한다. "진짜" ERC-4337
 * Account Abstraction(번들러/페이마스터 인프라)이 아니라, 그보다 훨씬
 * 가벼운 방식이다:
 *   1. 세션(고객)마다 새 지갑(주소+개인키)을 서버가 생성해 보관
 *   2. 그 지갑에 회사(스폰서) 계정이 가스용 ETH를 대신 채워줌
 *   3. 이후 그 지갑 자신이 서명해 submitApplication()을 직접 호출 —
 *      msg.sender가 실제 그 고객 전용 주소이므로 청약 소유권/증권 소유권은
 *      정상적으로 그 주소에 귀속된다 (관리자나 회사 지갑 명의로 대신
 *      가입해주는 게 아님).
 *
 * ⚠️ 데모/로컬 전용 트레이드오프: 개인키를 서버 JSON 파일에 평문 보관한다.
 *    이 지갑들은 Hardhat 로컬 테스트넷에서만 쓰이고 실가치가 없는 테스트
 *    ETH/USDC만 보유하므로(이 프로젝트의 기존 Hardhat 테스트키 공개 방침과
 *    동일한 성격), 여기서는 허용 가능한 단순화다. 실제 서비스로 전환할 때는
 *    이 부분을 KMS/HSM 기반 키 관리로 반드시 교체해야 한다.
 *
 * 사용법 (둘 다 stdin으로 JSON을 받고 stdout으로 JSON을 출력):
 *   echo '{}' | node scripts/relay-wallet.js create
 *   echo '{"privateKey":"0x..","applicantName":"김철수","age":35,...}' \
 *     | node scripts/relay-wallet.js apply
 *
 * 환경변수 (.env):
 *   RPC_URL             : JSON-RPC 엔드포인트 (기본 http://127.0.0.1:8545)
 *   RELAYER_SPONSOR_KEY : 가스비를 대납하는 회사 계정 개인키
 *                         (기본: Hardhat Account #0, 공개적으로 알려진 테스트키)
 *   RELAYER_GAS_ETH     : 신규 지갑에 대납할 ETH 양 (기본 "1")
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const RPC_URL     = process.env.RPC_URL             || "http://127.0.0.1:8545";
const SPONSOR_KEY = process.env.RELAYER_SPONSOR_KEY  || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const GAS_ETH     = process.env.RELAYER_GAS_ETH      || "1";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

const INS_ABI = [
  "function submitApplication(string applicantName, uint256 age, uint256 monthlyPremium, uint256 coverageLimit, uint256 maturityDays, uint256 maturityRefundRate, uint256 coverageCount, bool flexiblePayment) returns (uint256)",
  "function getApplication(uint256 appId) view returns (tuple(uint256 id, address applicant, string applicantName, uint256 age, uint256 monthlyPremium, uint256 coverageLimit, uint256 maturityDays, uint256 maturityRefundRate, uint8 status, uint256 submittedAt, uint256 processedAt, string rejectReason, uint256 policyId, uint8 riskScore, uint256 coverageCount, bool flexiblePayment))",
  "event ApplicationSubmitted(uint256 indexed appId, address indexed applicant, string applicantName, uint8 riskScore, uint256 timestamp)",
];

const STATUS_LABELS = ["대기(Pending)", "승인(Approved)", "거절(Rejected)"];

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("stdin JSON 파싱 실패: " + e.message));
      }
    });
    process.stdin.on("error", reject);
  });
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj));
}

async function cmdCreate() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sponsor  = new ethers.Wallet(SPONSOR_KEY, provider);

  const wallet = ethers.Wallet.createRandom().connect(provider);

  const tx = await sponsor.sendTransaction({
    to: wallet.address,
    value: ethers.parseEther(GAS_ETH),
  });
  await tx.wait();

  output({
    ok: true,
    address: wallet.address,
    privateKey: wallet.privateKey,
    fundedEth: GAS_ETH,
    fundTxHash: tx.hash,
  });
}

async function cmdApply(input) {
  const {
    privateKey, applicantName, age, monthlyPremium, coverageLimit,
    maturityDays, maturityRefundRate, coverageCount, flexiblePayment, currency,
  } = input;

  if (!privateKey) throw new Error("privateKey 필요");
  if (!fs.existsSync(CONFIG_PATH)) throw new Error("frontend/config.json 없음 — 먼저 배포를 실행하세요.");
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  const insAddr = currency === "KRW" ? config.contracts?.DentalInsuranceKRW : config.contracts?.DentalInsurance;
  if (!insAddr) throw new Error(`DentalInsurance(${currency || "USDC"}) 주소를 config.json에서 찾을 수 없음`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const ins      = new ethers.Contract(insAddr, INS_ABI, wallet);

  const ethBal = await provider.getBalance(wallet.address);
  if (ethBal === 0n) throw new Error("이 지갑에 가스용 ETH가 없습니다 — 먼저 create로 생성/충전하세요.");

  const tx = await ins.submitApplication(
    applicantName, age, monthlyPremium, coverageLimit,
    maturityDays, maturityRefundRate, coverageCount, !!flexiblePayment
  );
  const receipt = await tx.wait();

  const parsed = receipt.logs
    .map((log) => { try { return ins.interface.parseLog(log); } catch { return null; } })
    .find((e) => e && e.name === "ApplicationSubmitted");
  const appId = parsed ? parsed.args.appId : null;

  let application = null;
  if (appId !== null) {
    const app = await ins.getApplication(appId);
    application = {
      appId: appId.toString(),
      status: STATUS_LABELS[Number(app.status)] || String(app.status),
      policyId: app.policyId > 0n ? app.policyId.toString() : null,
      rejectReason: app.rejectReason || null,
      riskScore: Number(app.riskScore),
    };
  }

  output({
    ok: true,
    address: wallet.address,
    txHash: receipt.hash,
    application,
  });
}

async function main() {
  const sub = process.argv[2];
  const input = await readStdin();
  if (sub === "create") return cmdCreate();
  if (sub === "apply") return cmdApply(input);
  throw new Error("사용법: node relay-wallet.js <create|apply>");
}

main().catch((e) => {
  output({ ok: false, error: e.reason || e.message });
  process.exit(1);
});
