/**
 * test/ParametricInsurance.test.js
 * ParametricInsurance.sol 핵심 로직 테스트 — USDC(6 decimals)/KRW(0 decimals)
 * 두 배포 시나리오에 동일한 스펙을 반복 적용한다 (DentalInsurance.test.js와 동일 관례).
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const CoverageStatus = { Active: 0, Triggered: 1, Expired: 2 };

async function deployToken(decimals) {
  if (decimals === 6) {
    const Token = await ethers.getContractFactory("MockUSDC");
    return Token.deploy();
  }
  const Token = await ethers.getContractFactory("MockKRW");
  return Token.deploy();
}

for (const decimals of [6, 0]) {
  const label = decimals === 6 ? "USDC(6 decimals)" : "KRW(0 decimals)";

  describe(`ParametricInsurance — ${label}`, function () {
    let owner, holder, oracle, other;
    let token, tokenAddr, param, paramAddr;

    const PREMIUM = 10_000n;
    const PAYOUT  = 200_000n;
    const THRESHOLD = 120; // 예: 120분 이상 지연
    const DURATION  = 3 * 24 * 60 * 60; // 3일

    beforeEach(async function () {
      [owner, holder, oracle, other] = await ethers.getSigners();

      token = await deployToken(decimals);
      tokenAddr = await token.getAddress();

      const Param = await ethers.getContractFactory("ParametricInsurance");
      param = await Param.deploy(tokenAddr);
      paramAddr = await param.getAddress();

      await param.connect(owner).setOracleAddress(oracle.address);
      await param.connect(owner).addProduct("항공편 지연 보장", "지연시간(분)", THRESHOLD, PAYOUT, PREMIUM, DURATION);

      // 지급 재원 시딩
      const seedAmount = 10_000_000n;
      await token.connect(owner).faucet(seedAmount);
      await token.connect(owner).approve(paramAddr, seedAmount);
      await param.connect(owner).depositFunds(seedAmount);

      // 구매자 보험료 지급
      await token.connect(holder).faucet(1_000_000n);
      await token.connect(holder).approve(paramAddr, 1_000_000n);
    });

    it("상품을 추가하면 ProductAdded가 발생하고 조회 가능하다", async function () {
      const product = await param.getProduct(0);
      expect(product.name).to.equal("항공편 지연 보장");
      expect(product.active).to.equal(true);
      expect(await param.getProductCount()).to.equal(1n);
    });

    it("커버리지 구매 시 보험료가 이체되고 CoveragePurchased가 발생한다", async function () {
      await expect(param.connect(holder).purchaseCoverage(0))
        .to.emit(param, "CoveragePurchased")
        .withArgs(1n, holder.address, 0n, PREMIUM, anyValue, anyValue);

      const cov = await param.getCoverage(1);
      expect(cov.holder).to.equal(holder.address);
      expect(Number(cov.status)).to.equal(CoverageStatus.Active);
      expect(await param.totalPremiumsCollected()).to.equal(PREMIUM);
    });

    it("비활성 상품은 구매가 revert된다", async function () {
      await param.connect(owner).setProductActive(0, false);
      await expect(param.connect(holder).purchaseCoverage(0)).to.be.revertedWith("Product not active");
    });

    it("관측값이 임계치 이상이면 즉시 트리거·지급된다", async function () {
      await param.connect(holder).purchaseCoverage(0);
      const balBefore = await token.balanceOf(holder.address);

      await expect(param.connect(oracle).resolveCoverage(1, THRESHOLD))
        .to.emit(param, "CoverageResolved")
        .withArgs(1n, CoverageStatus.Triggered, BigInt(THRESHOLD), PAYOUT, anyValue);

      expect(await token.balanceOf(holder.address)).to.equal(balBefore + PAYOUT);
      const cov = await param.getCoverage(1);
      expect(Number(cov.status)).to.equal(CoverageStatus.Triggered);
      expect(await param.totalPayoutsPaid()).to.equal(PAYOUT);
    });

    it("관측값이 임계치 미만이면 Active 상태를 유지하고 재관측 가능하다", async function () {
      await param.connect(holder).purchaseCoverage(0);
      await param.connect(oracle).resolveCoverage(1, THRESHOLD - 1);

      const cov = await param.getCoverage(1);
      expect(Number(cov.status)).to.equal(CoverageStatus.Active);

      // 재관측 — 이번엔 조건 충족
      await param.connect(oracle).resolveCoverage(1, THRESHOLD);
      const cov2 = await param.getCoverage(1);
      expect(Number(cov2.status)).to.equal(CoverageStatus.Triggered);
    });

    it("만료 후 관측하면 지급 없이 Expired로 종료된다", async function () {
      await param.connect(holder).purchaseCoverage(0);
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      const balBefore = await token.balanceOf(holder.address);
      await expect(param.connect(oracle).resolveCoverage(1, THRESHOLD))
        .to.emit(param, "CoverageResolved")
        .withArgs(1n, CoverageStatus.Expired, BigInt(THRESHOLD), 0n, anyValue);

      expect(await token.balanceOf(holder.address)).to.equal(balBefore); // 지급 없음
    });

    it("이미 확정된(Resolved) 커버리지는 재호출이 revert된다", async function () {
      await param.connect(holder).purchaseCoverage(0);
      await param.connect(oracle).resolveCoverage(1, THRESHOLD);
      await expect(param.connect(oracle).resolveCoverage(1, THRESHOLD))
        .to.be.revertedWith("Coverage already resolved");
    });

    it("오라클이 아니면 resolveCoverage가 revert된다", async function () {
      await param.connect(holder).purchaseCoverage(0);
      await expect(param.connect(other).resolveCoverage(1, THRESHOLD))
        .to.be.revertedWith("Caller is not oracle");
    });

    it("관리자가 아니면 상품 추가가 revert된다", async function () {
      await expect(
        param.connect(holder).addProduct("x", "y", 1, 1, 1, 1)
      ).to.be.revertedWithCustomError(param, "OwnableUnauthorizedAccount");
    });
  });
}
