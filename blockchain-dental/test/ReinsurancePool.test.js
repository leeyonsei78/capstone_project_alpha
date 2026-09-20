/**
 * test/ReinsurancePool.test.js
 * ReinsurancePool.sol 지분형 볼트 로직 테스트 — USDC(6 decimals)/KRW(0 decimals).
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

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

  describe(`ReinsurancePool — ${label}`, function () {
    let owner, lp1, lp2, insurer;
    let token, tokenAddr, pool, poolAddr;

    beforeEach(async function () {
      [owner, lp1, lp2, insurer] = await ethers.getSigners();

      token = await deployToken(decimals);
      tokenAddr = await token.getAddress();

      const Pool = await ethers.getContractFactory("ReinsurancePool");
      pool = await Pool.deploy(tokenAddr);
      poolAddr = await pool.getAddress();

      for (const signer of [lp1, lp2, insurer]) {
        await token.connect(signer).faucet(1_000_000n);
        await token.connect(signer).approve(poolAddr, 1_000_000n);
      }
    });

    it("최초 예치자는 1:1로 지분을 받는다", async function () {
      await expect(pool.connect(lp1).deposit(100_000n))
        .to.emit(pool, "Deposited")
        .withArgs(lp1.address, 100_000n, 100_000n, 100_000n, anyValue);

      expect(await pool.shares(lp1.address)).to.equal(100_000n);
      expect(await pool.totalShares()).to.equal(100_000n);
      expect(await pool.totalAssets()).to.equal(100_000n);
    });

    it("프리미엄 유입(직접 이체)으로 자산이 늘면 이후 예치자는 더 적은 지분을 받는다", async function () {
      await pool.connect(lp1).deposit(100_000n);
      // DentalInsurance._cedeToPool과 동일한 방식(순수 ERC20 전송)으로 풀 자산이 증가하는 상황을 시뮬레이션
      await token.connect(insurer).transfer(poolAddr, 50_000n);

      // 이제 totalAssets=150,000, totalShares=100,000 → 지분가치 1.5
      await pool.connect(lp2).deposit(150_000n);
      expect(await pool.shares(lp2.address)).to.equal(100_000n); // 150,000 * 100,000 / 150,000
    });

    it("인출 시 지분 비율만큼 자산을 돌려받는다", async function () {
      await pool.connect(lp1).deposit(100_000n);
      await token.connect(insurer).transfer(poolAddr, 100_000n); // 지분가치 2배로

      const balBefore = await token.balanceOf(lp1.address);
      await expect(pool.connect(lp1).withdraw(50_000n))
        .to.emit(pool, "Withdrawn");

      expect(await token.balanceOf(lp1.address)).to.equal(balBefore + 100_000n); // 50,000주 * 2배
      expect(await pool.shares(lp1.address)).to.equal(50_000n);
    });

    it("보유 지분보다 많은 인출은 revert된다", async function () {
      await pool.connect(lp1).deposit(100_000n);
      await expect(pool.connect(lp1).withdraw(100_001n)).to.be.revertedWith("Invalid share amount");
    });

    it("관리자만 drawForClaim을 호출할 수 있고, 호출 시 자산이 관리자에게 이체된다", async function () {
      await pool.connect(lp1).deposit(100_000n);

      await expect(pool.connect(lp1).drawForClaim(10_000n))
        .to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");

      const balBefore = await token.balanceOf(owner.address);
      await expect(pool.connect(owner).drawForClaim(30_000n))
        .to.emit(pool, "ClaimDrawUsed")
        .withArgs(owner.address, 30_000n, anyValue);

      expect(await token.balanceOf(owner.address)).to.equal(balBefore + 30_000n);
      expect(await pool.totalAssets()).to.equal(70_000n);
    });

    it("풀 잔액을 초과하는 drawForClaim은 revert된다", async function () {
      await pool.connect(lp1).deposit(100_000n);
      await expect(pool.connect(owner).drawForClaim(100_001n))
        .to.be.revertedWith("Insufficient pool balance");
    });

    it("previewShareValue/getPoolStats가 정확한 값을 반환한다", async function () {
      await pool.connect(lp1).deposit(100_000n);
      await pool.connect(lp2).deposit(50_000n);

      const [shareBalance, assetValue] = await pool.previewShareValue(lp1.address);
      expect(shareBalance).to.equal(100_000n);
      expect(assetValue).to.equal(100_000n); // 아직 프리미엄 유입 없어 1:1

      const [assets, shareSupply, holderCount] = await pool.getPoolStats();
      expect(assets).to.equal(150_000n);
      expect(shareSupply).to.equal(150_000n);
      expect(holderCount).to.equal(2n);
    });
  });
}

