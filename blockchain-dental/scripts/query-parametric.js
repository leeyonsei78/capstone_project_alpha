#!/usr/bin/env node
/**
 * query-parametric.js
 * 챗봇(insurance_agent)이 subprocess로 호출해, 특정 지갑주소의 실시간
 * 파라메트릭(자동집행형) 보험 커버리지 현황을 JSON으로 출력하는 읽기 전용
 * 조회 스크립트. query-policy.js/query-altinvest.js와 동일한 원칙으로
 * USDC 계약만 조회한다 — KRW는 별개 계약이라 챗봇 답변에 혼재시키지 않는다.
 *
 * 사용법: node scripts/query-parametric.js <지갑주소>
 *
 * 어떤 상황에서도(잘못된 주소, 미배포, 노드 다운 등) 항상 유효한 JSON 한 줄을
 * stdout에 출력하고 exit code 0으로 끝난다.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL     = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

const PARAM_ABI = [
  "function getProducts() view returns (tuple(string name, string metricLabel, uint256 triggerThreshold, uint256 payoutAmount, uint256 premium, uint256 coverageDurationSecs, bool active)[])",
  "function getHolderCoverages(address) view returns (uint256[])",
  "function getCoverage(uint256) view returns (tuple(uint256 id, address holder, uint256 productId, uint256 purchaseTime, uint256 expiryTime, uint8 status, uint256 observedValue, uint256 resolvedAt))",
];

const COVERAGE_STATUS = ["가입중(관측 대기)", "지급완료(트리거)", "만료(미지급)"];

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
  const addr = config.contracts?.ParametricInsurance; // USDC 계약만(위 설명 참고)
  if (!addr) {
    output({ ok: false, error: "파라메트릭보험 컨트랙트 주소가 config.json에 없습니다. 배포를 확인해주세요." });
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

  const contract = new ethers.Contract(addr, PARAM_ABI, provider);

  let products;
  try {
    products = await contract.getProducts();
  } catch (e) {
    output({ ok: false, error: "상품 목록 조회에 실패했습니다: " + (e.message || String(e)) });
    return;
  }

  let coverageIds;
  try {
    coverageIds = await contract.getHolderCoverages(wallet);
  } catch (e) {
    output({ ok: false, error: "커버리지 조회에 실패했습니다: " + (e.message || String(e)) });
    return;
  }

  const coverages = [];
  for (const id of coverageIds) {
    let cov;
    try {
      cov = await contract.getCoverage(id);
    } catch (e) {
      continue; // 이 커버리지 조회 실패해도 나머지는 계속 진행
    }
    const product = products[Number(cov.productId)];
    const remainingSec = Number(cov.expiryTime) - nowTs;

    // query-policy.js의 timeUntilMaturity와 동일한 사전계산 패턴 —
    // GPT에게 초 단위 숫자를 직접 넘겨 날짜 산수를 시키지 않는다.
    let timeUntilExpiry;
    if (Number(cov.status) !== 0) {
      timeUntilExpiry = "확정됨";
    } else if (remainingSec <= 0) {
      timeUntilExpiry = "만료 도달(오늘 이전)";
    } else {
      const days  = Math.floor(remainingSec / 86400);
      const hours = Math.floor((remainingSec % 86400) / 3600);
      const mins  = Math.floor((remainingSec % 3600) / 60);
      timeUntilExpiry = days > 0 ? `${days}일 ${hours}시간 후`
        : hours > 0 ? `오늘, ${hours}시간 ${mins}분 후`
        : `오늘, ${mins}분 후`;
    }

    coverages.push({
      coverageId:    Number(cov.id),
      productName:   product ? product.name : `상품#${cov.productId}`,
      metricLabel:   product ? product.metricLabel : null,
      triggerThreshold: product ? Number(product.triggerThreshold) : null,
      payoutAmount:  product ? fmtAmount(product.payoutAmount, decimals) : null,
      status:        COVERAGE_STATUS[Number(cov.status)],
      purchasedAt:   tsToDate(cov.purchaseTime),
      expiryDate:    tsToDate(cov.expiryTime),
      timeUntilExpiry,
      observedValue: Number(cov.status) !== 0 ? Number(cov.observedValue) : null,
      resolvedAt:    Number(cov.status) !== 0 ? tsToDate(cov.resolvedAt) : null,
    });
  }

  output({
    ok: true,
    wallet,
    queriedAt: tsToDate(nowTs),
    coverageCount: coverages.length,
    coverages,
  });
}

main().catch(e => output({ ok: false, error: e.message || String(e) }));
