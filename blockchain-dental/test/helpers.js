/**
 * test/helpers.js
 * DentalInsurance/ReserveFund 테스트 공용 배포 픽스처.
 *
 * USDC(6 decimals)·KRW(0 decimals) 두 버전 모두 같은 컨트랙트 코드를 쓰므로,
 * 테스트도 raw 정수 단위(예: 2_000_000n)를 그대로 양쪽에 동일하게 사용해
 * 하나의 스펙으로 두 통화를 함께 검증한다 (decimals 차이 자체는 컨트랙트
 * 로직에 영향을 주지 않고 표시 단위만 다르므로, 로직 검증에는 영향 없음).
 */
const { ethers } = require("hardhat");

// submitApplication 시 기본 심사 룰(minMonthlyPremium=1_000_000)을 넉넉히 넘기는 값들.
// 두 통화 인스턴스 모두 setUnderwritingRules 없이 "컨트랙트 기본값" 그대로 테스트한다.
const PREMIUM        = 2_000_000n;
const COVERAGE       = 40_000_000n;  // premium의 20배 — 대출/청구 테스트에 여유롭게
const MATURITY_DAYS  = 365;
const REFUND_RATE    = 70n;          // %

async function deployToken(decimals) {
  if (decimals === 6) {
    const Token = await ethers.getContractFactory("MockUSDC");
    return Token.deploy();
  }
  const Token = await ethers.getContractFactory("MockKRW");
  return Token.deploy();
}

/**
 * @param decimals 6(USDC 시나리오) 또는 0(KRW 시나리오)
 */
async function deployInsuranceFixture(decimals) {
  const [owner, patient, patient2, oracle, other] = await ethers.getSigners();

  const token = await deployToken(decimals);
  const tokenAddr = await token.getAddress();

  const Insurance = await ethers.getContractFactory("DentalInsurance");
  const insurance = await Insurance.deploy(tokenAddr);
  const insuranceAddr = await insurance.getAddress();

  // 테스트 계정들에 파우셋으로 토큰 지급 (MockUSDC는 1회 최대 10,000 USDC 제한,
  // MockKRW는 무제한 — 아래 값은 두 한도 모두 넉넉히 통과)
  const faucetAmount = 1_000_000_000n; // USDC 기준 1,000 USDC 상당, KRW 기준 10억원 상당
  for (const signer of [patient, patient2]) {
    await token.connect(signer).faucet(faucetAmount);
  }
  // 컨트랙트 준비금(청구 지급/대출 재원)을 위해 owner도 보유 후 depositFunds
  await token.connect(owner).faucet(faucetAmount);
  await token.connect(owner).approve(insuranceAddr, faucetAmount);
  await insurance.connect(owner).depositFunds(faucetAmount);

  return { owner, patient, patient2, oracle, other, token, tokenAddr, insurance, insuranceAddr, decimals };
}

/** 증권 생성 후 1회 납입까지 마친 상태를 만들어주는 헬퍼 (대출/청구 테스트 공용) */
async function createFundedPolicy(ctx, patientSigner = ctx.patient, flexiblePayment = false) {
  const { insurance, token, insuranceAddr } = ctx;
  const now = await currentBlockTimestamp();
  const maturityDate = now + MATURITY_DAYS * 24 * 60 * 60;

  await insurance.connect(ctx.owner).createPolicy(
    patientSigner.address, "테스트 피보험자", PREMIUM, COVERAGE, maturityDate, REFUND_RATE, flexiblePayment
  );
  const ids = await insurance.getAllPolicyIds();
  const policyId = ids[ids.length - 1];

  await token.connect(patientSigner).approve(insuranceAddr, PREMIUM);
  await insurance.connect(patientSigner).payPremium(policyId);

  return policyId;
}

async function currentBlockTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

module.exports = {
  PREMIUM, COVERAGE, MATURITY_DAYS, REFUND_RATE,
  deployInsuranceFixture, createFundedPolicy,
  currentBlockTimestamp, increaseTime,
};
