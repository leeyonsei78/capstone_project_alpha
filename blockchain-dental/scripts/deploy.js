const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("  덴탈보험 블록체인 시스템 배포 (USDC + KRW)");
  console.log("=".repeat(60));
  console.log(`  네트워크  : ${network.name} (chainId: ${network.chainId})`);
  console.log(`  배포자    : ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`  잔액      : ${ethers.formatEther(bal)} ETH`);
  console.log("-".repeat(60));

  const accounts = await ethers.getSigners();

  // USDC↔KRW 환산에 쓰는 고정 환율 (KRW 샘플 데이터를 USDC 금액에서 환산할 때도,
  // config.json에 저장할 때도 이 값 하나만 사용해 두 곳이 어긋나지 않게 함).
  const KRW_PER_USD = 1400;

  // ─────────────────────────────────────────────────────────────
  // ── USDC 시스템 ─────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────

  // 1. MockUSDC 배포
  console.log("\n[1/10] MockUSDC 배포 중...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`  ✅ MockUSDC 배포 완료: ${usdcAddress}`);

  // 2. DentalInsurance(USDC) 배포
  console.log("\n[2/10] DentalInsurance(USDC) 배포 중...");
  const DentalInsurance = await ethers.getContractFactory("DentalInsurance");
  const insurance = await DentalInsurance.deploy(usdcAddress);
  await insurance.waitForDeployment();
  const insuranceAddress = await insurance.getAddress();
  console.log(`  ✅ DentalInsurance(USDC) 배포 완료: ${insuranceAddress}`);

  // 3. USDC 준비금 입금 (50,000 USDC) + 관리자 시작 잔액(1,000 USDC — 다른 계정과 동일)
  console.log("\n[3/10] USDC 준비금 입금 중... (50,000 USDC)");
  const usdcReserve = ethers.parseUnits("50000", 6);
  const adminStartBalance = ethers.parseUnits("1000", 6);
  let tx = await usdc.mint(deployer.address, usdcReserve + adminStartBalance);
  await tx.wait();
  tx = await usdc.approve(insuranceAddress, usdcReserve);
  await tx.wait();
  tx = await insurance.depositFunds(usdcReserve);
  await tx.wait();
  console.log(`  ✅ USDC 준비금 입금 완료: 50,000 USDC (관리자 잔액 1,000 USDC로 시작)`);

  // 4. USDC 샘플 보험증권
  console.log("\n[4/10] USDC 샘플 보험증권 생성 중...");
  const latestBlock = await ethers.provider.getBlock("latest");
  const now = Number(latestBlock.timestamp);
  const maturityIn30Min = now + 30 * 60;
  const maturityIn45Min = now + 45 * 60;
  const refundRate = 70;

  // 데모 만기(30~45분 후)가 기본 납입주기(30일)보다 훨씬 빨라 컨트랙트 기본값 그대로면
  // 만기 전까지 보험료가 단 한 번도 자동 징수되지 못해 totalPaid가 항상 0으로 남고,
  // 수동 만기환급(processMaturityRefund)이 "No premiums paid"로 항상 revert됨
  // (2026-09-18 발견). 아래 두 증권은 납입주기를 PREMIUM_INTERVAL_TEST(5분)로 줄이고
  // 고객 계좌가 보험사에 자동이체를 승인(approve)하도록 해, premium-scheduler.js가
  // 만기 전에 실제로 몇 차례 보험료를 징수할 수 있게 함.
  const testInterval = await insurance.PREMIUM_INTERVAL_TEST();

  // 계정 #1 - 김덴탈 (월 50 USDC)
  if (accounts.length > 1) {
    tx = await insurance.createPolicy(
      accounts[1].address, "김덴탈",
      ethers.parseUnits("50", 6), ethers.parseUnits("1000", 6),
      maturityIn30Min, refundRate, false
    );
    await tx.wait();
    await usdc.connect(accounts[1]).faucet(ethers.parseUnits("1000", 6));
    await usdc.connect(accounts[1]).approve(insuranceAddress, ethers.MaxUint256);
    await insurance.setPremiumInterval(1, testInterval);
    console.log(`  ✅ USDC 증권 #1: 김덴탈 | 월 $50 | 한도 $1,000 | 1,000 USDC 지급 | 납입주기 5분(테스트)`);
  }

  // 계정 #2 - 이치과 (월 80 USDC)
  if (accounts.length > 2) {
    tx = await insurance.createPolicy(
      accounts[2].address, "이치과",
      ethers.parseUnits("80", 6), ethers.parseUnits("2000", 6),
      maturityIn45Min, refundRate, true // 씬파일러 유연납입 데모용 — 관리자 화면에서 배지 확인 가능
    );
    await tx.wait();
    await usdc.connect(accounts[2]).faucet(ethers.parseUnits("1000", 6));
    await usdc.connect(accounts[2]).approve(insuranceAddress, ethers.MaxUint256);
    await insurance.setPremiumInterval(2, testInterval);
    console.log(`  ✅ USDC 증권 #2: 이치과 | 월 $80 | 한도 $2,000 | 1,000 USDC 지급 | 납입주기 5분(테스트) | 유연납입 ON`);
  }

  // ─────────────────────────────────────────────────────────────
  // ── KRW 시스템 ──────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────

  // 5. MockKRW 배포
  console.log("\n[5/10] MockKRW 배포 중...");
  const MockKRW = await ethers.getContractFactory("MockKRW");
  const krw = await MockKRW.deploy();
  await krw.waitForDeployment();
  const krwAddress = await krw.getAddress();
  console.log(`  ✅ MockKRW 배포 완료: ${krwAddress}`);

  // 6. DentalInsurance(KRW) 배포
  console.log("\n[6/10] DentalInsurance(KRW) 배포 중...");
  const insuranceKrw = await DentalInsurance.deploy(krwAddress);
  await insuranceKrw.waitForDeployment();
  const insuranceKrwAddress = await insuranceKrw.getAddress();
  console.log(`  ✅ DentalInsurance(KRW) 배포 완료: ${insuranceKrwAddress}`);

  // KRW 심사 룰 조정 (최소 보험료: 10,000 KRW)
  // setUnderwritingRules(minAge, maxAge, maxCoverageCount, autoApproveCoverageCount, minMonthlyPremium, maxActivePolicies)
  tx = await insuranceKrw.setUnderwritingRules(18, 75, 7, 2, 10000, 3);
  await tx.wait();
  console.log(`  ✅ KRW 심사 룰 설정 완료: 최소 보험료 10,000원 (담보 2개 자동승인 / 7개 전체선택 자동거절)`);

  // KRW 준비금 입금 (10,000,000원) + 관리자 시작 잔액(1,000,000원 — 다른 계정과 동일)
  const krwReserve = BigInt("10000000"); // 1천만원 (0 decimals)
  const krwAdminStartBalance = BigInt("1000000"); // 100만원
  // 배포자에게 준비금 + 시작잔액만큼 먼저 KRW 민팅
  tx = await krw.faucet(krwReserve + krwAdminStartBalance);
  await tx.wait();
  tx = await krw.approve(insuranceKrwAddress, krwReserve);
  await tx.wait();
  tx = await insuranceKrw.depositFunds(krwReserve);
  await tx.wait();
  console.log(`  ✅ KRW 준비금 입금 완료: 10,000,000 KRW (관리자 잔액 1,000,000 KRW로 시작)`);

  // KRW 샘플 보험증권
  const krwMaturity30 = now + 30 * 60;
  const krwMaturity45 = now + 45 * 60;

  // USDC와 동일한 이유로 KRW 쪽도 납입주기를 5분(테스트)으로 줄이고 approve 필요
  // (위 "데모 만기가 기본 납입주기보다 빠름" 주석 참고).
  const testIntervalKrw = await insuranceKrw.PREMIUM_INTERVAL_TEST();

  // 계정 #1 - 김덴탈 (월 70,000원)
  if (accounts.length > 1) {
    tx = await insuranceKrw.createPolicy(
      accounts[1].address, "김덴탈",
      BigInt("70000"),    // 월 70,000원
      BigInt("1400000"),  // 보장한도 140만원
      krwMaturity30, refundRate, false
    );
    await tx.wait();
    await krw.connect(accounts[1]).faucet(BigInt("1000000")); // 100만원
    await krw.connect(accounts[1]).approve(insuranceKrwAddress, ethers.MaxUint256);
    await insuranceKrw.setPremiumInterval(1, testIntervalKrw);
    console.log(`  ✅ KRW 증권 #1: 김덴탈 | 월 ₩70,000 | 한도 ₩1,400,000 | 100만원 지급 | 납입주기 5분(테스트)`);
  }

  // 계정 #2 - 이치과 (월 112,000원)
  if (accounts.length > 2) {
    tx = await insuranceKrw.createPolicy(
      accounts[2].address, "이치과",
      BigInt("112000"),   // 월 112,000원
      BigInt("2800000"),  // 보장한도 280만원
      krwMaturity45, refundRate, true // USDC 쪽과 동일하게 유연납입 데모용
    );
    await tx.wait();
    await krw.connect(accounts[2]).faucet(BigInt("1000000")); // 100만원
    await krw.connect(accounts[2]).approve(insuranceKrwAddress, ethers.MaxUint256);
    await insuranceKrw.setPremiumInterval(2, testIntervalKrw);
    console.log(`  ✅ KRW 증권 #2: 이치과 | 월 ₩112,000 | 한도 ₩2,800,000 | 100만원 지급 | 납입주기 5분(테스트) | 유연납입 ON`);
  }

  // ── 샘플 청약 신청 (USDC 계약 기준) ─────────────────────────
  console.log("\n[7/10] 샘플 청약 신청 중... (자동심사 테스트용)");

  if (accounts.length > 4) {
    await usdc.connect(accounts[4]).faucet(ethers.parseUnits("1000", 6));
    // 담보 2개 선택 → 즉시 자동승인
    tx = await insurance.connect(accounts[4]).submitApplication(
      "박청약", 35, ethers.parseUnits("60", 6), ethers.parseUnits("500", 6), 365, 70, 2, true // 씬파일러 유연납입 신청 데모
    );
    await tx.wait();
    console.log(`  ✅ 청약 #1: 박청약 (35세) — 담보 2개 선택, 즉시 자동승인 및 증권 생성 | 유연납입 신청 | ${accounts[4].address}`);
  }

  if (accounts.length > 5) {
    await usdc.connect(accounts[5]).faucet(ethers.parseUnits("1000", 6));
    // 담보 4개 선택 (1개도 전체도 아님) → 관리자 심사 대기
    tx = await insurance.connect(accounts[5]).submitApplication(
      "최이십", 20, ethers.parseUnits("40", 6), ethers.parseUnits("2000", 6), 180, 60, 4, false
    );
    await tx.wait();
    console.log(`  ✅ 청약 #2: 최이십 (20세) — 담보 4개 선택, 관리자 심사 대기중 | ${accounts[5].address}`);
  }

  if (accounts.length > 6) {
    tx = await insurance.connect(accounts[6]).submitApplication(
      "노거절", 80, ethers.parseUnits("50", 6), ethers.parseUnits("1000", 6), 365, 70, 3, false
    );
    await tx.wait();
    console.log(`  ✅ 청약 #3: 노거절 (80세) — 자동 심사 거절 (연령 초과)`);
  }

  if (accounts.length > 7) {
    await usdc.connect(accounts[7]).faucet(ethers.parseUnits("1000", 6));
    // 담보 7개(전체) 선택 → 즉시 자동거절
    tx = await insurance.connect(accounts[7]).submitApplication(
      "전체담보", 30, ethers.parseUnits("80", 6), ethers.parseUnits("2500", 6), 365, 70, 7, false
    );
    await tx.wait();
    console.log(`  ✅ 청약 #4: 전체담보 (30세) — 담보 7개(전체) 선택, 즉시 자동거절 | ${accounts[7].address}`);
  }

  // ── 동일한 샘플 청약을 KRW 계약에도 동일하게 신청 (금액만 환산) ─────
  // USDC 쪽 4건(자동승인 1 / 관리자심사대기 1 / 자동거절 2)과 나이·담보개수가
  // 같으므로, KRW 심사 룰(위에서 setUnderwritingRules로 맞춰둔 최소보험료 10,000원
  // 등)도 동일하게 통과해 USDC와 완전히 같은 결과(승인/대기/거절)로 자동 심사된다.
  console.log("\n[8/10] 동일한 샘플 청약을 KRW 계약에도 신청 중... (USDC 금액 환산)");

  if (accounts.length > 4) {
    await krw.connect(accounts[4]).faucet(BigInt(1000000));
    tx = await insuranceKrw.connect(accounts[4]).submitApplication(
      "박청약", 35, BigInt(60 * KRW_PER_USD), BigInt(500 * KRW_PER_USD), 365, 70, 2, true
    );
    await tx.wait();
    console.log(`  ✅ [KRW] 청약 #1: 박청약 (35세) — 담보 2개 선택, 즉시 자동승인 및 증권 생성 | 유연납입 신청 | ${accounts[4].address}`);
  }

  if (accounts.length > 5) {
    await krw.connect(accounts[5]).faucet(BigInt(1000000));
    tx = await insuranceKrw.connect(accounts[5]).submitApplication(
      "최이십", 20, BigInt(40 * KRW_PER_USD), BigInt(2000 * KRW_PER_USD), 180, 60, 4, false
    );
    await tx.wait();
    console.log(`  ✅ [KRW] 청약 #2: 최이십 (20세) — 담보 4개 선택, 관리자 심사 대기중 | ${accounts[5].address}`);
  }

  if (accounts.length > 6) {
    tx = await insuranceKrw.connect(accounts[6]).submitApplication(
      "노거절", 80, BigInt(50 * KRW_PER_USD), BigInt(1000 * KRW_PER_USD), 365, 70, 3, false
    );
    await tx.wait();
    console.log(`  ✅ [KRW] 청약 #3: 노거절 (80세) — 자동 심사 거절 (연령 초과)`);
  }

  if (accounts.length > 7) {
    tx = await insuranceKrw.connect(accounts[7]).submitApplication(
      "전체담보", 30, BigInt(80 * KRW_PER_USD), BigInt(2500 * KRW_PER_USD), 365, 70, 7, false
    );
    await tx.wait();
    console.log(`  ✅ [KRW] 청약 #4: 전체담보 (30세) — 담보 7개(전체) 선택, 즉시 자동거절 | ${accounts[7].address}`);
  }

  // ── Oracle 설정 (USDC + KRW 양쪽) ───────────────────────────
  console.log("\n[9/10] Oracle 설정 중...");
  const ORACLE_ADDRESS = accounts.length > 3
    ? accounts[3].address
    : "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

  // USDC 컨트랙트 Oracle — 주소 등록. oracleModeEnabled는 컨트랙트 기본값이 true라
  // 별도 호출 없이도 보장한도 20% 이하 소액 청구는 제출 즉시 자동지급되고,
  // 20% 초과 청구는 오라클 모드와 무관하게 항상 관리자 수동 심사로 남는다.
  tx = await insurance.setOracleAddress(ORACLE_ADDRESS);
  await tx.wait();

  // KRW 컨트랙트 Oracle
  tx = await insuranceKrw.setOracleAddress(ORACLE_ADDRESS);
  await tx.wait();

  console.log(`  ✅ Oracle 주소 등록  : ${ORACLE_ADDRESS}`);
  console.log(`  ✅ Oracle 모드       : USDC + KRW 양쪽 기본 활성화 (20% 이하 소액청구 자동지급 / 초과는 항상 관리자 수동심사)`);

  // ── 준비금 계좌(ReserveFund) 시스템 배포 (USDC + KRW) ────────
  console.log("\n[10/10] ReserveFund(준비금 계좌) 배포 중...");
  const ReserveFund = await ethers.getContractFactory("ReserveFund");
  const reserveFund = await ReserveFund.deploy(usdcAddress);
  await reserveFund.waitForDeployment();
  const reserveFundAddress = await reserveFund.getAddress();
  const reserveFundKrw = await ReserveFund.deploy(krwAddress);
  await reserveFundKrw.waitForDeployment();
  const reserveFundKrwAddress = await reserveFundKrw.getAddress();
  console.log(`  ✅ ReserveFund(USDC) 배포 완료: ${reserveFundAddress}`);
  console.log(`  ✅ ReserveFund(KRW)  배포 완료: ${reserveFundKrwAddress}`);

  // ── 준비금 계좌 초기 세팅 (내 잔액 == 준비금 잔액이 되도록 별도로 추가 지급 후 예치) ──
  async function seedReserve(token, reserveContract, account, amount) {
    await (await token.connect(account).faucet(amount)).wait();
    await (await token.connect(account).approve(await reserveContract.getAddress(), amount)).wait();
    await (await reserveContract.connect(account).depositReserve(amount)).wait();
  }

  if (accounts.length > 1) {
    await seedReserve(usdc, reserveFund,    accounts[1], ethers.parseUnits("1000", 6));
    await seedReserve(krw,  reserveFundKrw, accounts[1], BigInt("1000000"));
  }
  if (accounts.length > 2) {
    await seedReserve(usdc, reserveFund,    accounts[2], ethers.parseUnits("1000", 6));
    await seedReserve(krw,  reserveFundKrw, accounts[2], BigInt("1000000"));
  }
  if (accounts.length > 4) {
    await seedReserve(usdc, reserveFund, accounts[4], ethers.parseUnits("1000", 6));
  }
  if (accounts.length > 5) {
    await seedReserve(usdc, reserveFund, accounts[5], ethers.parseUnits("1000", 6));
  }
  console.log(`  ✅ 준비금 계좌 초기 세팅 완료: 김덴탈/이치과 (USDC 1,000 + KRW 100만원), 박청약/최이십 (USDC 1,000) — 내 잔액과 동일하게 맞춤`);

  // ── 대체투자형 준비금(AltInvestmentFund) 배포 (USDC + KRW) ──
  // ReserveFund(연 5% 고정)와 나란히 두는 "대체투자형" 상품. 금리/락업일수는
  // 통화와 무관한 숫자이므로 KRW_PER_USD 환산 없이 USDC·KRW 인스턴스에 동일하게 시드.
  console.log("\n[대체투자] AltInvestmentFund(대체투자형 준비금) 배포 중...");
  const AltInvestmentFund = await ethers.getContractFactory("AltInvestmentFund");
  const altFund = await AltInvestmentFund.deploy(usdcAddress);
  await altFund.waitForDeployment();
  const altFundAddress = await altFund.getAddress();
  const altFundKrw = await AltInvestmentFund.deploy(krwAddress);
  await altFundKrw.waitForDeployment();
  const altFundKrwAddress = await altFundKrw.getAddress();
  console.log(`  ✅ AltInvestmentFund(USDC) 배포 완료: ${altFundAddress}`);
  console.log(`  ✅ AltInvestmentFund(KRW)  배포 완료: ${altFundKrwAddress}`);

  // 3개 펀드를 USDC·KRW 양쪽에 동일하게 시드 (수익률↑ ↔ 락업↑ ↔ 페널티↑ 순서로 구성)
  const ALT_FUND_SEEDS = [
    { name: "그린인프라 대체투자 펀드",     assetClass: "인프라·신재생에너지", aprBps: 750,  lockupDays: 90,  penaltyBps: 300 },
    { name: "프라임오피스 리츠 펀드",       assetClass: "상업용 부동산 리츠",   aprBps: 900,  lockupDays: 180, penaltyBps: 500 },
    { name: "글로벌 프라이빗에쿼티 펀드",   assetClass: "사모펀드(PE)",         aprBps: 1200, lockupDays: 365, penaltyBps: 800 },
  ];
  for (const f of ALT_FUND_SEEDS) {
    tx = await altFund.addFund(f.name, f.assetClass, f.aprBps, f.lockupDays, f.penaltyBps);
    await tx.wait();
    tx = await altFundKrw.addFund(f.name, f.assetClass, f.aprBps, f.lockupDays, f.penaltyBps);
    await tx.wait();
    console.log(`  ✅ 펀드 등록: ${f.name} | ${f.assetClass} | 연 ${(f.aprBps / 100).toFixed(1)}% | 락업 ${f.lockupDays}일 | 조기해지 페널티 ${(f.penaltyBps / 100).toFixed(1)}%`);
  }

  // 샘플 투자 시드 (ReserveFund와 동일하게 "내 잔액 == 투자 잔액"이 되도록 별도 지급 후 투자)
  async function seedFund(token, fundContract, account, fundId, amount) {
    await (await token.connect(account).faucet(amount)).wait();
    await (await token.connect(account).approve(await fundContract.getAddress(), amount)).wait();
    await (await fundContract.connect(account).invest(fundId, amount)).wait();
  }

  if (accounts.length > 1) {
    await seedFund(usdc, altFund,    accounts[1], 0, ethers.parseUnits("500", 6)); // 김덴탈 → 그린인프라
    await seedFund(krw,  altFundKrw, accounts[1], 0, BigInt("500000"));
  }
  if (accounts.length > 2) {
    await seedFund(usdc, altFund,    accounts[2], 1, ethers.parseUnits("800", 6)); // 이치과 → 프라임오피스 리츠
    await seedFund(krw,  altFundKrw, accounts[2], 1, BigInt("800000"));
  }
  console.log(`  ✅ 대체투자 샘플 시드 완료: 김덴탈→그린인프라(USDC 500 + KRW 50만원), 이치과→프라임오피스리츠(USDC 800 + KRW 80만원)`);

  // ── 파라메트릭(자동집행) 보험 배포 (USDC + KRW) ──────────────
  // 관찰값이 조건을 충족하면 청구 절차 없이 오라클이 즉시 지급하는 신규 상품군.
  // parametric-oracle-service.js가 관측값을 시뮬레이션해 resolveCoverage를 호출한다.
  console.log("\n[파라메트릭] ParametricInsurance 배포 중...");
  const ParametricInsurance = await ethers.getContractFactory("ParametricInsurance");
  const paramFund = await ParametricInsurance.deploy(usdcAddress);
  await paramFund.waitForDeployment();
  const paramAddress = await paramFund.getAddress();
  const paramFundKrw = await ParametricInsurance.deploy(krwAddress);
  await paramFundKrw.waitForDeployment();
  const paramKrwAddress = await paramFundKrw.getAddress();
  console.log(`  ✅ ParametricInsurance(USDC) 배포 완료: ${paramAddress}`);
  console.log(`  ✅ ParametricInsurance(KRW)  배포 완료: ${paramKrwAddress}`);

  await (await paramFund.setOracleAddress(ORACLE_ADDRESS)).wait();
  await (await paramFundKrw.setOracleAddress(ORACLE_ADDRESS)).wait();

  // 상품 2종을 USDC·KRW 양쪽에 동일하게 시드 (금액만 KRW_PER_USD로 환산)
  const PARAM_PRODUCT_SEEDS = [
    {
      name: "항공편 지연 보장", metricLabel: "지연시간(분)", triggerThreshold: 120,
      payoutUsd: 100, premiumUsd: 5, coverageDurationSecs: 3 * 24 * 60 * 60,
    },
    {
      name: "폭염특보 보장", metricLabel: "폭염특보 발령일수", triggerThreshold: 3,
      payoutUsd: 150, premiumUsd: 8, coverageDurationSecs: 30 * 24 * 60 * 60,
    },
  ];
  for (const p of PARAM_PRODUCT_SEEDS) {
    tx = await paramFund.addProduct(
      p.name, p.metricLabel, p.triggerThreshold,
      ethers.parseUnits(String(p.payoutUsd), 6), ethers.parseUnits(String(p.premiumUsd), 6),
      p.coverageDurationSecs
    );
    await tx.wait();
    tx = await paramFundKrw.addProduct(
      p.name, p.metricLabel, p.triggerThreshold,
      BigInt(p.payoutUsd * KRW_PER_USD), BigInt(p.premiumUsd * KRW_PER_USD),
      p.coverageDurationSecs
    );
    await tx.wait();
    console.log(`  ✅ 상품 등록: ${p.name} | 임계치 ${p.triggerThreshold}(${p.metricLabel}) | 지급 $${p.payoutUsd} | 보험료 $${p.premiumUsd}`);
  }

  // 지급 재원 시딩 (관리자 계정 — USDC는 onlyOwner mint로, KRW는 무제한 faucet으로 충분히 추가 발행 후 예치)
  await (await usdc.mint(deployer.address, ethers.parseUnits("2000", 6))).wait();
  await (await usdc.approve(paramAddress, ethers.parseUnits("2000", 6))).wait();
  await (await paramFund.depositFunds(ethers.parseUnits("2000", 6))).wait();
  await (await krw.faucet(BigInt(2000 * KRW_PER_USD))).wait();
  await (await krw.approve(paramKrwAddress, BigInt(2000 * KRW_PER_USD))).wait();
  await (await paramFundKrw.depositFunds(BigInt(2000 * KRW_PER_USD))).wait();
  console.log(`  ✅ 파라메트릭 지급 재원 시딩 완료: USDC 2,000 + KRW ${(2000 * KRW_PER_USD).toLocaleString()}원`);

  // 샘플 커버리지 구매 (accounts[1]/[2] — 각각 항공편 지연 보장 구매)
  async function purchaseParamCoverage(token, contract, account, productId, premium) {
    await (await token.connect(account).faucet(premium)).wait();
    await (await token.connect(account).approve(await contract.getAddress(), premium)).wait();
    await (await contract.connect(account).purchaseCoverage(productId)).wait();
  }
  if (accounts.length > 1) {
    await purchaseParamCoverage(usdc, paramFund,    accounts[1], 0, ethers.parseUnits("5", 6));
    await purchaseParamCoverage(krw,  paramFundKrw, accounts[1], 0, BigInt(5 * KRW_PER_USD));
  }
  if (accounts.length > 2) {
    await purchaseParamCoverage(usdc, paramFund,    accounts[2], 1, ethers.parseUnits("8", 6));
    await purchaseParamCoverage(krw,  paramFundKrw, accounts[2], 1, BigInt(8 * KRW_PER_USD));
  }
  console.log(`  ✅ 파라메트릭 샘플 커버리지 구매 완료: 김덴탈→항공편지연, 이치과→폭염특보 (USDC+KRW 양쪽)`);

  // ── 재보험풀(ReinsurancePool) 배포 — 외부 유동성 공급 (USDC + KRW) ──
  // DentalInsurance가 보험료 수취 시마다 cedingBps 비율만큼 이 풀로 이체하고,
  // 풀 지분가치는 그 프리미엄 유입에 의해서만 오른다(고정 APR이 아님).
  console.log("\n[재보험풀] ReinsurancePool 배포 중...");
  const ReinsurancePool = await ethers.getContractFactory("ReinsurancePool");
  const reinsurancePool = await ReinsurancePool.deploy(usdcAddress);
  await reinsurancePool.waitForDeployment();
  const reinsurancePoolAddress = await reinsurancePool.getAddress();
  const reinsurancePoolKrw = await ReinsurancePool.deploy(krwAddress);
  await reinsurancePoolKrw.waitForDeployment();
  const reinsurancePoolKrwAddress = await reinsurancePoolKrw.getAddress();
  console.log(`  ✅ ReinsurancePool(USDC) 배포 완료: ${reinsurancePoolAddress}`);
  console.log(`  ✅ ReinsurancePool(KRW)  배포 완료: ${reinsurancePoolKrwAddress}`);

  const CEDING_BPS = 500; // 5%
  await (await insurance.setReinsurancePool(reinsurancePoolAddress)).wait();
  await (await insurance.setCedingBps(CEDING_BPS)).wait();
  await (await insuranceKrw.setReinsurancePool(reinsurancePoolKrwAddress)).wait();
  await (await insuranceKrw.setCedingBps(CEDING_BPS)).wait();
  console.log(`  ✅ ceding 설정 완료: 보험료 수취 시 ${(CEDING_BPS / 100).toFixed(1)}%를 재보험풀로 이체 (USDC+KRW)`);

  // 샘플 LP 예치 — accounts[8]을 "외부 투자자" 페르소나로 사용
  if (accounts.length > 8) {
    async function seedPool(token, poolContract, account, amount) {
      await (await token.connect(account).faucet(amount)).wait();
      await (await token.connect(account).approve(await poolContract.getAddress(), amount)).wait();
      await (await poolContract.connect(account).deposit(amount)).wait();
    }
    await seedPool(usdc, reinsurancePool,    accounts[8], ethers.parseUnits("2000", 6));
    await seedPool(krw,  reinsurancePoolKrw, accounts[8], BigInt(2000 * KRW_PER_USD));
    console.log(`  ✅ 외부 투자자(LP) 샘플 예치 완료: USDC 2,000 + KRW ${(2000 * KRW_PER_USD).toLocaleString()}원 | ${accounts[8].address}`);
  }

  // ── 대체투자: "리스크연동형" 신규 펀드 등록 (기존 고정APR 3종은 그대로 유지) ──
  // AltInvestmentFund에 ReinsurancePool 주소를 물려서, 이 펀드에 투자하면 고정
  // 이율이 아니라 재보험풀의 실제 지분가치(보험료 유입에 의해서만 오르고 청구
  // 지급 시 실제로 줄어듦)를 그대로 따라간다. ReinsurancePool 배포 이후에만
  // 등록 가능해 이 시점(대체투자 배포 블록 이후)에 별도로 둔다.
  console.log("\n[대체투자] 리스크연동형 신규 펀드 등록 중...");
  tx = await altFund.addRiskLinkedFund(
    "재보험풀 연동 인컴 펀드", "재보험(리스크연동)", reinsurancePoolAddress, 30, 200
  );
  await tx.wait();
  tx = await altFundKrw.addRiskLinkedFund(
    "재보험풀 연동 인컴 펀드", "재보험(리스크연동)", reinsurancePoolKrwAddress, 30, 200
  );
  await tx.wait();
  console.log(`  ✅ 리스크연동형 펀드 등록 완료: 재보험풀 연동 인컴 펀드 | 락업 30일 | 조기해지 페널티 2.0% (수익률은 재보험풀 실제 성과를 따라감, 고정 아님)`);

  // ── 배포 정보 저장 ────────────────────────────────────────────
  const config = {
    network:         network.name,
    chainId:         network.chainId.toString(),
    deployer:        deployer.address,
    deployedAt:      new Date().toISOString(),
    oracleAddress:   ORACLE_ADDRESS,
    // USDC↔KRW 환산에 쓰는 고정 환율. frontend/app.js와 scripts/hospital-provider/
    // mock-provider.js가 각자 하드코딩하던 걸 여기 하나로 모아, 두 곳이 따로 값을
    // 바꿔서 어긋나는 일이 없도록 함 (두 곳 다 이 값이 없으면 1400으로 폴백).
    krwPerUsd:       KRW_PER_USD,
    contracts: {
      MockUSDC:              usdcAddress,
      DentalInsurance:       insuranceAddress,
      MockKRW:               krwAddress,
      DentalInsuranceKRW:    insuranceKrwAddress,
      ReserveFund:           reserveFundAddress,
      ReserveFundKRW:        reserveFundKrwAddress,
      AltInvestmentFund:     altFundAddress,
      AltInvestmentFundKRW:  altFundKrwAddress,
      ParametricInsurance:     paramAddress,
      ParametricInsuranceKRW:  paramKrwAddress,
      ReinsurancePool:         reinsurancePoolAddress,
      ReinsurancePoolKRW:      reinsurancePoolKrwAddress
    }
  };

  const frontendDir = path.join(__dirname, "..", "frontend");
  if (!fs.existsSync(frontendDir)) fs.mkdirSync(frontendDir, { recursive: true });
  fs.writeFileSync(
    path.join(frontendDir, "config.json"),
    JSON.stringify(config, null, 2)
  );

  console.log("\n" + "=".repeat(60));
  console.log("  배포 완료!");
  console.log("=".repeat(60));
  console.log(`  [USDC 시스템]`);
  console.log(`    MockUSDC           : ${usdcAddress}`);
  console.log(`    DentalInsurance    : ${insuranceAddress}`);
  console.log(`  [KRW 시스템]`);
  console.log(`    MockKRW            : ${krwAddress}`);
  console.log(`    DentalInsuranceKRW : ${insuranceKrwAddress}`);
  console.log(`  Oracle 주소          : ${ORACLE_ADDRESS}`);
  console.log(`  [준비금 계좌]`);
  console.log(`    ReserveFund        : ${reserveFundAddress}`);
  console.log(`    ReserveFundKRW     : ${reserveFundKrwAddress}`);
  console.log(`  [대체투자형 준비금]`);
  console.log(`    AltInvestmentFund      : ${altFundAddress}`);
  console.log(`    AltInvestmentFundKRW   : ${altFundKrwAddress}`);
  console.log(`  [파라메트릭보험]`);
  console.log(`    ParametricInsurance    : ${paramAddress}`);
  console.log(`    ParametricInsuranceKRW : ${paramKrwAddress}`);
  console.log(`  [재보험풀]`);
  console.log(`    ReinsurancePool        : ${reinsurancePoolAddress}`);
  console.log(`    ReinsurancePoolKRW     : ${reinsurancePoolKrwAddress}`);
  console.log(`  config.json 저장     : frontend/config.json`);
  console.log("\n  ▶ 웹 UI: http://localhost:3000");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("배포 실패:", error);
    process.exit(1);
  });
