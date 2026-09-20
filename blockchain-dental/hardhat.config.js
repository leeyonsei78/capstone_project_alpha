require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("dotenv").config();

// .env.example의 PRIVATE_KEY 예시값("your_private_key_without_0x_prefix")처럼
// 실제 32바이트 hex 키가 아닌 값이 들어있으면(placeholder 미교체 등) sepolia
// 계정으로 넣지 않고 조용히 건너뜀 — Sepolia 배포를 안 쓰는 로컬 테스트에서
// 이 값 때문에 hardhat 명령 자체가 HH8 에러로 죽는 것을 방지.
const rawPrivateKey = (process.env.PRIVATE_KEY || "").replace(/^0x/i, "");
const sepoliaAccounts = /^[0-9a-fA-F]{64}$/.test(rawPrivateKey) ? [rawPrivateKey] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      // 트랜잭션이 없어도 block.timestamp가 실제 시간을 따라 계속 전진하도록 함.
      // 이게 없으면 아무 거래도 없을 때 시간이 멈춰서, 만기환급/자동납부 워처가
      // 실제로는 기한이 지났는데도 이를 감지하지 못하는 문제가 있었음.
      mining: { auto: true, interval: 4000 },
      // DentalInsurance.sol이 신규 사업 확장(유연납입/웰니스/재보험풀 ceding)
      // 추가로 EIP-170(24576바이트) 배포 크기 한도를 넘어섰음 — 이 프로젝트는
      // 로컬 Hardhat 노드에서만 구동되고 메인넷 배포 스크립트가 없으므로(hardhat.config.js
      // 상 mainnet 네트워크 자체가 정의돼 있지 않음) 로컬 개발 편의를 위해 크기 제한을
      // 끈다. 실제 메인넷 배포 시에는 컨트랙트 분리가 필요하다는 점을 기억할 것.
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: sepoliaAccounts,
      chainId: 11155111
    }
  },
  paths: {
    sources: "./contracts",
    scripts: "./scripts",
    artifacts: "./artifacts"
  }
};
