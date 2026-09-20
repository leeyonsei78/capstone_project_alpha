#!/usr/bin/env node
/**
 * query-reinsurance.js
 * 재보험풀(ReinsurancePool) 통계 + 특정 지갑주소(LP)의 포지션을 JSON으로
 * 출력하는 읽기 전용 조회 스크립트. query-altinvest.js와 동일한 관례를 따른다.
 * 소매 고객용 챗봇 도구가 아니라 기관/LP 조회용 — 향후 관리자 Slack 커맨드나
 * 대시보드 확장 시 재사용할 수 있도록 query-*.js 패턴 그대로 작성해둔다.
 * USDC 계약만 조회한다 (다른 query-*.js와 동일 원칙).
 *
 * 사용법: node scripts/query-reinsurance.js <지갑주소>
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL     = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONFIG_PATH = path.join(__dirname, "..", "frontend", "config.json");

const POOL_ABI = [
  "function getPoolStats() view returns (uint256 assets, uint256 shareSupply, uint256 holderCount)",
  "function previewShareValue(address investor) view returns (uint256 shareBalance, uint256 assetValue)",
];

function fmtAmount(raw, decimals) {
  const n = Number(ethers.formatUnits(raw, decimals));
  return decimals === 0 ? `₩${Math.round(n).toLocaleString("ko-KR")}` : `$${n.toFixed(2)}`;
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
    output({ ok: false, error: "블록체인 앱이 아직 배포되지 않았습니다." });
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const addr = config.contracts?.ReinsurancePool;
  if (!addr) {
    output({ ok: false, error: "재보험풀 컨트랙트 주소가 config.json에 없습니다. 배포를 확인해주세요." });
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  try {
    await provider.getBlockNumber();
  } catch (e) {
    output({ ok: false, error: "블록체인 노드에 연결할 수 없습니다." });
    return;
  }

  const decimals = 6; // USDC
  const contract = new ethers.Contract(addr, POOL_ABI, provider);

  try {
    const [stats, position] = await Promise.all([
      contract.getPoolStats(),
      contract.previewShareValue(wallet),
    ]);

    output({
      ok: true,
      wallet,
      pool: {
        totalAssets:  fmtAmount(stats.assets, decimals),
        totalShares:  stats.shareSupply.toString(),
        holderCount:  Number(stats.holderCount),
      },
      myPosition: {
        shareBalance: position.shareBalance.toString(),
        assetValue:   fmtAmount(position.assetValue, decimals),
      },
    });
  } catch (e) {
    output({ ok: false, error: "재보험풀 조회에 실패했습니다: " + (e.message || String(e)) });
  }
}

main().catch(e => output({ ok: false, error: e.message || String(e) }));
