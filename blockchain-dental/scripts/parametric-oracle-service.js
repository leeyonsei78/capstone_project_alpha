/**
 * parametric-oracle-service.js
 * 파라메트릭(자동집행) 보험 오라클 서비스 (USDC + KRW 양쪽 처리)
 *
 * 실행: node scripts/parametric-oracle-service.js
 *
 * ⚠️ 항공편 지연 상품(metricLabel="지연시간(분)")은 여전히 데모용 시뮬레이션이다 —
 *    무료 항공편 지연 API가 마땅치 않아 결정론적(coverageId 기반) 의사난수를 그대로
 *    쓴다. 반면 폭염특보 상품(metricLabel에 "폭염" 포함)은 2026-09-21부터 실제
 *    기상 데이터(Open-Meteo, 무료·API키 불필요)로 서울의 일 최고기온을 조회해
 *    관측값을 만든다 (fetchSeoulHeatwaveDays 참고) — API 호출이 실패하면(네트워크
 *    장애 등) 이번 회차만 기존 시뮬레이션 값으로 안전하게 폴백한다.
 *    다른 상품을 실 API로 전환할 때도 이 파일의 관측값 생성 부분만 교체하면 되고,
 *    ParametricInsurance.sol의 인터페이스는 그대로 유지된다.
 *
 * 동작:
 *  - POLL_SEC마다 전체 커버리지(Active만) 순회
 *  - 각 커버리지마다 "관측 시각"(purchaseTime + 결정론적 지연)이 지났으면
 *    결정론적 관측값을 생성해 resolveCoverage() 호출 → 조건 충족 시 즉시 지급
 *  - 만료 시각이 지난 커버리지도 resolveCoverage 호출 시 컨트랙트가 자동으로
 *    Expired 처리 (지급 없음)
 *
 * 환경변수 (.env):
 *  RPC_URL   : JSON-RPC 엔드포인트 (기본: http://127.0.0.1:8545)
 *  ORACLE_KEY: 오라클 개인키 (기본: Hardhat Account #3, oracle-service.js와 동일 키 재사용)
 *  POLL_SEC  : 폴링 간격 초 (기본: 20)
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

const RPC_URL     = process.env.RPC_URL      || "http://127.0.0.1:8545";
const ORACLE_KEY  = process.env.ORACLE_KEY   || "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const POLL_SEC    = parseInt(process.env.POLL_SEC || "20", 10);
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

const PARAM_ABI = [
  "function getAllCoverageIds() view returns (uint256[])",
  "function getCoverage(uint256) view returns (tuple(uint256 id, address holder, uint256 productId, uint256 purchaseTime, uint256 expiryTime, uint8 status, uint256 observedValue, uint256 resolvedAt))",
  "function getProduct(uint256) view returns (tuple(string name, string metricLabel, uint256 triggerThreshold, uint256 payoutAmount, uint256 premium, uint256 coverageDurationSecs, bool active))",
  "function resolveCoverage(uint256 coverageId, uint256 observedValue) external",
  "event CoveragePurchased(uint256 indexed coverageId, address indexed holder, uint256 indexed productId, uint256 premium, uint256 expiryTime, uint256 timestamp)",
];

function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toLocaleTimeString("ko-KR")}] ❌ ${msg}`); }

/** coverageId + salt로 결정론적 의사난수를 생성 (0 <= n < mod) — 재시작해도 동일 결과 */
function pseudoRandom(coverageId, salt, mod) {
  if (mod <= 0) return 0;
  const hash = ethers.keccak256(ethers.toUtf8Bytes(`parametric:${coverageId}:${salt}`));
  return Number(BigInt(hash) % BigInt(mod));
}

// 서울 좌표 — 폭염특보 상품의 실제 관측지점으로 사용
const WEATHER_LAT = 37.5665;
const WEATHER_LON = 126.9780;
const HEATWAVE_TEMP_C = 33; // 기상청 폭염경보 발령 기준(일 최고기온 33도 이상) 준용

/**
 * Open-Meteo(무료, API키 불필요)에서 서울의 일별 최고기온을 조회해, 구간 내
 * 33도 이상인 날짜 수(=폭염특보 발령일수 근사치)를 센다.
 * Node 22 내장 fetch 사용 — 별도 HTTP 의존성 추가 없음.
 */
async function fetchSeoulHeatwaveDays(startTs, endTs) {
  const toDateStr = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
  const startDate = toDateStr(startTs);
  const endDate   = toDateStr(Math.max(endTs, startTs));
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
    `&daily=temperature_2m_max&timezone=Asia%2FSeoul&start_date=${startDate}&end_date=${endDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();
  const maxTemps = data?.daily?.temperature_2m_max;
  if (!Array.isArray(maxTemps)) throw new Error("Open-Meteo 응답에 daily.temperature_2m_max 없음");
  return maxTemps.filter((t) => typeof t === "number" && t >= HEATWAVE_TEMP_C).length;
}

async function checkCoverages(contract, currency) {
  let ids;
  try {
    ids = await contract.getAllCoverageIds();
  } catch (e) {
    warn(`[${currency}] 커버리지 목록 조회 실패: ${e.message}`);
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const id of ids) {
    const coverageId = Number(id);
    let cov;
    try {
      cov = await contract.getCoverage(coverageId);
    } catch (e) {
      continue;
    }
    if (Number(cov.status) !== 0) continue; // Active(0)만 처리 — 이미 확정된 건 스킵

    let product;
    try {
      product = await contract.getProduct(cov.productId);
    } catch (e) {
      continue;
    }

    const duration = Number(product.coverageDurationSecs) || 1;
    // 관측 시각: 구매 시점부터 duration 이내의 결정론적 지연 후 (예: "항공편 도착 시각")
    const observeDelay = pseudoRandom(coverageId, "delay", duration);
    const observeAt = Number(cov.purchaseTime) + observeDelay;
    const expiryTs = Number(cov.expiryTime);

    if (now < observeAt && now <= expiryTs) continue; // 아직 관측 시각 전이고 만료도 안 됨 — 대기

    const threshold = Number(product.triggerThreshold);
    const range = threshold > 0 ? threshold * 2 : 100;

    let observedValue;
    let sourceLabel = "시뮬레이션";
    if (now > expiryTs) {
      observedValue = 0; // 만료 후엔 값 의미 없음(컨트랙트가 Expired 처리)
    } else if (product.metricLabel.includes("폭염")) {
      try {
        observedValue = await fetchSeoulHeatwaveDays(Number(cov.purchaseTime), now);
        sourceLabel = "실제 기상데이터(Open-Meteo, 서울)";
      } catch (e) {
        warn(`  [${currency}] 커버리지 #${coverageId} Open-Meteo 조회 실패(${e.message}) — 이번 회차는 시뮬레이션 값으로 대체`);
        observedValue = pseudoRandom(coverageId, "value", range);
      }
    } else {
      observedValue = pseudoRandom(coverageId, "value", range);
    }

    log(`🌦️  [${currency}] 커버리지 #${coverageId} [${product.name}] 관측 실행 [${sourceLabel}] — 관측값 ${observedValue} / 임계치 ${threshold}`);
    try {
      const tx = await contract.resolveCoverage(coverageId, observedValue);
      const receipt = await tx.wait();
      log(`  ✅ resolveCoverage 완료 (TX: ${receipt.hash})`);
    } catch (e) {
      warn(`  resolveCoverage 실패 — 커버리지 #${coverageId}: ${e.reason || e.message}`);
    }
  }
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    err("frontend/config.json 없음 — 먼저 배포를 실행하세요.");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const oracle   = new ethers.Wallet(ORACLE_KEY, provider);

  const usdcAddr = config.contracts?.ParametricInsurance;
  const krwAddr  = config.contracts?.ParametricInsuranceKRW;
  const usdcContract = usdcAddr ? new ethers.Contract(usdcAddr, PARAM_ABI, oracle) : null;
  const krwContract  = krwAddr  ? new ethers.Contract(krwAddr,  PARAM_ABI, oracle) : null;

  console.log("=".repeat(65));
  console.log("  🌦️  파라메트릭보험 오라클 서비스 시작 (USDC + KRW, 데모 시뮬레이션)");
  console.log("=".repeat(65));
  log(`Oracle 주소  : ${oracle.address}`);
  log(`USDC 컨트랙트: ${usdcAddr || "없음"}`);
  log(`KRW  컨트랙트: ${krwAddr  || "없음"}`);
  log(`폴링 간격    : ${POLL_SEC}초`);
  console.log("-".repeat(65));

  async function runAll() {
    if (usdcContract) await checkCoverages(usdcContract, "USDC");
    if (krwContract)  await checkCoverages(krwContract,  "KRW");
  }

  await runAll();
  setInterval(runAll, POLL_SEC * 1000);
  log(`✅ 오라클 서비스 실행 중 (Ctrl+C 로 종료)`);
}

main().catch(e => {
  err(`치명적 오류: ${e.message}`);
  process.exit(1);
});
