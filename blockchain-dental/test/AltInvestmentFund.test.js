/**
 * test/AltInvestmentFund.test.js
 * AltInvestmentFund.sol 테스트 — 특히 2026-09-21 추가된 "리스크연동형" 펀드
 * (addRiskLinkedFund / invest 공용 경로 / withdrawRiskLinked / earlyWithdrawRiskLinked /
 * previewRiskLinkedPosition)가 기존 고정APR 펀드와 완전히 독립적으로 동작하고,
 * ReinsurancePool의 실제 지분가치를 그대로 반영하는지 검증한다.
 *
 * 기존 고정APR 펀드 로직(연 복리 이자) 자체는 이 신규 기능이 건드리지 않았으므로
 * 회귀 검증 목적의 최소 스모크 테스트만 둔다.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

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

  describe(`AltInvestmentFund — ${label}`, function () {
    let owner, investor1, investor2, premiumPayer;
    let token, tokenAddr, altFund, altFundAddr, pool, poolAddr;
    const SEED = 1_000_000n;

    beforeEach(async function () {
      [owner, investor1, investor2, premiumPayer] = await ethers.getSigners();

      token = await deployToken(decimals);
      tokenAddr = await token.getAddress();

      const AltFund = await ethers.getContractFactory("AltInvestmentFund");
      altFund = await AltFund.deploy(tokenAddr);
      altFundAddr = await altFund.getAddress();

      const Pool = await ethers.getContractFactory("ReinsurancePool");
      pool = await Pool.deploy(tokenAddr);
      poolAddr = await pool.getAddress();

      for (const signer of [investor1, investor2, premiumPayer]) {
        await token.connect(signer).faucet(SEED);
        await token.connect(signer).approve(altFundAddr, SEED);
      }
    });

    describe("기존 고정APR 펀드 (회귀 스모크 테스트)", function () {
      let fundId;
      beforeEach(async function () {
        const tx = await altFund.addFund("테스트 펀드", "테스트자산군", 1000, 30, 500);
        const receipt = await tx.wait();
        fundId = 0;
        expect(receipt).to.not.be.null;
      });

      it("투자 후 포지션이 정상 생성된다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);
        const pos = await altFund.getPosition(investor1.address, fundId);
        expect(pos.exists).to.equal(true);
        expect(pos.principal).to.equal(100_000n);
      });

      it("riskLinked 전용 함수는 고정APR 펀드에 쓸 수 없다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);
        await expect(altFund.connect(investor1).withdrawRiskLinked(fundId, 1n))
          .to.be.revertedWith("Not a risk-linked fund");
      });
    });

    describe("신규 리스크연동형 펀드", function () {
      let fundId;
      beforeEach(async function () {
        await altFund.addRiskLinkedFund("재보험풀 연동 펀드", "재보험(리스크연동)", poolAddr, 30, 200);
        fundId = 0;
      });

      it("일반 invest()로 투자하면 내부적으로 ReinsurancePool 지분을 대신 보유한다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);

        expect(await pool.shares(altFundAddr)).to.equal(100_000n); // 최초 예치자라 1:1
        expect(await altFund.getRiskLinkedShares(investor1.address, fundId)).to.equal(100_000n);

        const [poolShareBalance, currentValue] = await altFund.previewRiskLinkedPosition(investor1.address, fundId);
        expect(poolShareBalance).to.equal(100_000n);
        expect(currentValue).to.equal(100_000n); // 아직 보험료 유입/청구 없어 1:1
      });

      it("여러 투자자가 함께 투자하면 지분이 각자 몫대로 정확히 배분된다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);
        await altFund.connect(investor2).invest(fundId, 300_000n);

        expect(await altFund.getRiskLinkedShares(investor1.address, fundId)).to.equal(100_000n);
        expect(await altFund.getRiskLinkedShares(investor2.address, fundId)).to.equal(300_000n);
        expect(await pool.shares(altFundAddr)).to.equal(400_000n);
      });

      it("고정 APR 펀드용 withdraw()/previewPosition()은 리스크연동형 펀드에 쓸 수 없다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);
        await expect(altFund.connect(investor1).withdraw(fundId, 100_000n))
          .to.be.revertedWith("Use withdrawRiskLinked for this fund");
        await expect(altFund.previewPosition(investor1.address, fundId))
          .to.be.revertedWith("Use previewRiskLinkedPosition for this fund");
      });

      it("락업 경과 전에는 withdrawRiskLinked가 거절된다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);
        await expect(altFund.connect(investor1).withdrawRiskLinked(fundId, 100_000n))
          .to.be.revertedWith("Still locked up");
      });

      it("청구로 풀 자산이 줄면(실제 재보험 리스크), 락업 해제 후 인출액도 함께 준다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);

        // ReinsurancePool에 보험료 유입을 흉내: owner가 풀에 추가 자금을 넣지 않고,
        // drawForClaim으로 자산이 빠져나가는 "손실" 시나리오만 검증(입금 없이도
        // 지분가치가 줄어드는 걸 확인하는 편이 더 간단하고 결정적이다).
        await pool.connect(owner).drawForClaim(40_000n); // 풀 자산 100,000 -> 60,000

        await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        const [, currentValue] = await altFund.previewRiskLinkedPosition(investor1.address, fundId);
        expect(currentValue).to.equal(60_000n); // 유일한 투자자이므로 남은 자산 전부가 내 몫

        const before = await token.balanceOf(investor1.address);
        await altFund.connect(investor1).withdrawRiskLinked(fundId, 100_000n);
        const after = await token.balanceOf(investor1.address);
        expect(after - before).to.equal(60_000n);
        expect(await altFund.getRiskLinkedShares(investor1.address, fundId)).to.equal(0n);
      });

      it("earlyWithdrawRiskLinked는 락업 전에도 가능하고 추가 페널티가 적용된다", async function () {
        await altFund.connect(investor1).invest(fundId, 100_000n);

        const before = await token.balanceOf(investor1.address);
        await altFund.connect(investor1).earlyWithdrawRiskLinked(fundId, 100_000n);
        const after = await token.balanceOf(investor1.address);

        // 청구 없었으므로 redeemed == 100,000, penaltyBps=200(2%) => payout = 98,000
        expect(after - before).to.equal(98_000n);
      });
    });
  });
}
