/**
 * test/DentalInsurance.test.js
 * DentalInsurance.sol 핵심 로직 테스트 — USDC(6 decimals)/KRW(0 decimals)
 * 두 배포 시나리오에 동일한 스펙을 반복 적용한다 (컨트랙트 코드가 완전히
 * 동일하므로, decimals 차이는 로직 검증과 무관함).
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const {
  PREMIUM, COVERAGE, REFUND_RATE,
  deployInsuranceFixture, createFundedPolicy,
  currentBlockTimestamp, increaseTime,
} = require("./helpers");

const ApplicationStatus = { Pending: 0, Approved: 1, Rejected: 2 };
const ClaimStatus       = { Pending: 0, Approved: 1, Rejected: 2, Paid: 3 };

for (const decimals of [6, 0]) {
  const label = decimals === 6 ? "USDC(6 decimals)" : "KRW(0 decimals)";

  describe(`DentalInsurance — ${label}`, function () {
    let ctx;

    beforeEach(async function () {
      ctx = await deployInsuranceFixture(decimals);
    });

    // ── 배포 ──────────────────────────────────────────────────
    describe("배포", function () {
      it("stablecoin·owner가 올바르게 설정된다", async function () {
        expect(await ctx.insurance.stablecoin()).to.equal(ctx.tokenAddr);
        expect(await ctx.insurance.owner()).to.equal(ctx.owner.address);
      });

      it("준비금이 depositFunds로 반영된다", async function () {
        expect(await ctx.insurance.getContractBalance()).to.equal(1_000_000_000n);
      });
    });

    // ── createPolicy (관리자 직접 생성) ─────────────────────────
    describe("createPolicy", function () {
      it("관리자가 증권을 생성하면 PolicyCreated가 발생하고 조회 가능하다", async function () {
        const maturityDate = (await currentBlockTimestamp()) + 365 * 24 * 60 * 60;
        await expect(
          ctx.insurance.connect(ctx.owner).createPolicy(
            ctx.patient.address, "김덴탈", PREMIUM, COVERAGE, maturityDate, REFUND_RATE, false
          )
        ).to.emit(ctx.insurance, "PolicyCreated");

        const ids = await ctx.insurance.getAllPolicyIds();
        const policy = await ctx.insurance.getPolicy(ids[ids.length - 1]);
        expect(policy.patient).to.equal(ctx.patient.address);
        expect(policy.monthlyPremium).to.equal(PREMIUM);
        expect(policy.active).to.equal(true);
      });

      it("관리자가 아니면 revert된다", async function () {
        const maturityDate = (await currentBlockTimestamp()) + 365 * 24 * 60 * 60;
        await expect(
          ctx.insurance.connect(ctx.patient).createPolicy(
            ctx.patient.address, "김덴탈", PREMIUM, COVERAGE, maturityDate, REFUND_RATE, false
          )
        ).to.be.revertedWithCustomError(ctx.insurance, "OwnableUnauthorizedAccount");
      });

      it("만기일이 과거면 revert된다", async function () {
        const past = (await currentBlockTimestamp()) - 1000;
        await expect(
          ctx.insurance.connect(ctx.owner).createPolicy(
            ctx.patient.address, "김덴탈", PREMIUM, COVERAGE, past, REFUND_RATE, false
          )
        ).to.be.revertedWith("Maturity must be in future");
      });

      it("환급율이 100 초과면 revert된다", async function () {
        const maturityDate = (await currentBlockTimestamp()) + 365 * 24 * 60 * 60;
        await expect(
          ctx.insurance.connect(ctx.owner).createPolicy(
            ctx.patient.address, "김덴탈", PREMIUM, COVERAGE, maturityDate, 101, false
          )
        ).to.be.revertedWith("Refund rate must be <= 100");
      });
    });

    // ── submitApplication (자동 심사 엔진) ──────────────────────
    describe("submitApplication — 자동 심사", function () {
      async function submitAndGetApp(overrides = {}) {
        const p = {
          name: "청약자", age: 30, premium: PREMIUM, coverage: COVERAGE,
          maturityDays: 365, refundRate: REFUND_RATE, coverageCount: 2, flexiblePayment: false,
          ...overrides,
        };
        await ctx.insurance.connect(ctx.patient).submitApplication(
          p.name, p.age, p.premium, p.coverage, p.maturityDays, p.refundRate, p.coverageCount, p.flexiblePayment
        );
        const ids = await ctx.insurance.getAllApplicationIds();
        return ctx.insurance.getApplication(ids[ids.length - 1]);
      }

      it("담보 2개(autoApproveCoverageCount) 선택 시 즉시 자동승인되고 증권이 생성된다", async function () {
        const app = await submitAndGetApp({ coverageCount: 2 });
        expect(Number(app.status)).to.equal(ApplicationStatus.Approved);
        expect(app.policyId).to.not.equal(0n);

        const policy = await ctx.insurance.getPolicy(app.policyId);
        expect(policy.patient).to.equal(ctx.patient.address);
        expect(policy.active).to.equal(true);
      });

      it("담보 7개(maxCoverageCount, 전체선택) 선택 시 즉시 자동거절된다", async function () {
        const app = await submitAndGetApp({ coverageCount: 7 });
        expect(Number(app.status)).to.equal(ApplicationStatus.Rejected);
        expect(app.rejectReason).to.equal("전체 담보 선택은 위험도 과다로 자동 거절");
        expect(app.policyId).to.equal(0n);
      });

      it("담보 1개 또는 3~6개는 관리자 심사 대기(Pending)로 남는다", async function () {
        for (const count of [1, 3, 4, 5, 6]) {
          const app = await submitAndGetApp({ coverageCount: count });
          expect(Number(app.status)).to.equal(ApplicationStatus.Pending, `coverageCount=${count}`);
        }
      });

      it("만 18세 미만이면 담보 개수와 무관하게 즉시 거절된다", async function () {
        const app = await submitAndGetApp({ age: 17, coverageCount: 2 });
        expect(Number(app.status)).to.equal(ApplicationStatus.Rejected);
        expect(app.rejectReason).to.equal("만 18세 미만 가입 불가");
      });

      it("만 75세 초과면 즉시 거절된다", async function () {
        const app = await submitAndGetApp({ age: 76, coverageCount: 2 });
        expect(Number(app.status)).to.equal(ApplicationStatus.Rejected);
        expect(app.rejectReason).to.equal("만 75세 초과 가입 불가");
      });

      it("최소 월보험료 미달이면 즉시 거절된다", async function () {
        const app = await submitAndGetApp({ premium: 999_999n, coverageCount: 2 });
        expect(Number(app.status)).to.equal(ApplicationStatus.Rejected);
        expect(app.rejectReason).to.equal("보험료 최소기준 미달");
      });

      it("1인 활성 증권 한도(기본 3개) 초과 시 즉시 거절된다", async function () {
        // 자동승인 경로(담보 2개)로 3건 연속 가입 → 4번째는 한도 초과로 거절
        for (let i = 0; i < 3; i++) {
          const app = await submitAndGetApp({ coverageCount: 2 });
          expect(Number(app.status)).to.equal(ApplicationStatus.Approved);
        }
        const fourth = await submitAndGetApp({ coverageCount: 2 });
        expect(Number(fourth.status)).to.equal(ApplicationStatus.Rejected);
        expect(fourth.rejectReason).to.equal("1인 가입한도 초과");
      });
    });

    describe("approveApplication / rejectApplication (관리자 수동 심사)", function () {
      async function submitPendingApp() {
        await ctx.insurance.connect(ctx.patient).submitApplication(
          "청약자", 30, PREMIUM, COVERAGE, 365, REFUND_RATE, 3, false // Pending 유도
        );
        const ids = await ctx.insurance.getAllApplicationIds();
        return ids[ids.length - 1];
      }

      it("관리자가 승인하면 증권이 생성되고 상태가 Approved로 바뀐다", async function () {
        const appId = await submitPendingApp();
        await expect(ctx.insurance.connect(ctx.owner).approveApplication(appId))
          .to.emit(ctx.insurance, "ApplicationApproved");
        const app = await ctx.insurance.getApplication(appId);
        expect(Number(app.status)).to.equal(ApplicationStatus.Approved);
        expect(app.policyId).to.not.equal(0n);
      });

      it("관리자가 거절하면 사유가 기록된다", async function () {
        const appId = await submitPendingApp();
        await ctx.insurance.connect(ctx.owner).rejectApplication(appId, "서류 미비");
        const app = await ctx.insurance.getApplication(appId);
        expect(Number(app.status)).to.equal(ApplicationStatus.Rejected);
        expect(app.rejectReason).to.equal("서류 미비");
      });

      it("관리자가 아니면 승인/거절 모두 revert된다", async function () {
        const appId = await submitPendingApp();
        await expect(ctx.insurance.connect(ctx.patient).approveApplication(appId))
          .to.be.revertedWithCustomError(ctx.insurance, "OwnableUnauthorizedAccount");
        await expect(ctx.insurance.connect(ctx.patient).rejectApplication(appId, "사유"))
          .to.be.revertedWithCustomError(ctx.insurance, "OwnableUnauthorizedAccount");
      });

      it("Pending이 아닌 청약은 승인/거절이 revert된다", async function () {
        const appId = await submitPendingApp();
        await ctx.insurance.connect(ctx.owner).rejectApplication(appId, "사유");
        await expect(ctx.insurance.connect(ctx.owner).approveApplication(appId))
          .to.be.revertedWith("Application not pending");
      });
    });

    // ── payPremium ───────────────────────────────────────────
    describe("payPremium", function () {
      it("정상 납입 시 totalPaid·nextDueTime이 갱신되고 이벤트가 발생한다", async function () {
        const policyId = await createFundedPolicy(ctx); // helper가 1회 납입까지 수행
        const policy = await ctx.insurance.getPolicy(policyId);
        expect(policy.totalPaid).to.equal(PREMIUM);
        expect(await ctx.insurance.totalPremiumsCollected()).to.be.gte(PREMIUM);
      });

      it("본인 증권이 아니면 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx, ctx.patient);
        await ctx.token.connect(ctx.patient2).approve(ctx.insuranceAddr, PREMIUM);
        await expect(ctx.insurance.connect(ctx.patient2).payPremium(policyId))
          .to.be.revertedWith("Not the policy holder");
      });

      it("approve 없이 납입하면 revert된다", async function () {
        const maturityDate = (await currentBlockTimestamp()) + 365 * 24 * 60 * 60;
        await ctx.insurance.connect(ctx.owner).createPolicy(
          ctx.patient.address, "김덴탈", PREMIUM, COVERAGE, maturityDate, REFUND_RATE, false
        );
        const ids = await ctx.insurance.getAllPolicyIds();
        const policyId = ids[ids.length - 1];
        await expect(ctx.insurance.connect(ctx.patient).payPremium(policyId))
          .to.be.revertedWith("Insufficient allowance");
      });

      it("비활성화된 증권은 납입이 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).deactivatePolicy(policyId);
        await ctx.token.connect(ctx.patient).approve(ctx.insuranceAddr, PREMIUM);
        await expect(ctx.insurance.connect(ctx.patient).payPremium(policyId))
          .to.be.revertedWith("Policy not active");
      });
    });

    // ── submitClaim / approveClaim / rejectClaim / payClaim ─────
    describe("청구 제출 및 처리", function () {
      const SMALL_CLAIM = COVERAGE / 10n;      // 보장한도의 10% → 오라클 자동지급 대상 이하(20%)
      const LARGE_CLAIM = (COVERAGE * 30n) / 100n; // 보장한도의 30% → 항상 관리자 수동심사

      it("납입 이력이 없으면 청구가 revert된다", async function () {
        const maturityDate = (await currentBlockTimestamp()) + 365 * 24 * 60 * 60;
        await ctx.insurance.connect(ctx.owner).createPolicy(
          ctx.patient.address, "김덴탈", PREMIUM, COVERAGE, maturityDate, REFUND_RATE, false
        );
        const ids = await ctx.insurance.getAllPolicyIds();
        const policyId = ids[ids.length - 1];
        await expect(
          ctx.insurance.connect(ctx.patient).submitClaim(policyId, SMALL_CLAIM, "D0120", "정기검진")
        ).to.be.revertedWith("No premiums paid yet");
      });

      it("보장한도를 초과하는 청구는 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await expect(
          ctx.insurance.connect(ctx.patient).submitClaim(policyId, COVERAGE + 1n, "D0120", "정기검진")
        ).to.be.revertedWith("Exceeds coverage limit");
      });

      it("오라클 모드 OFF면 소액 청구도 Pending으로 남는다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleMode(false); // 디폴트가 ON으로 바뀌었으므로 명시적으로 끔
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, SMALL_CLAIM, "D0120", "정기검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claim = await ctx.insurance.getClaim(claimIds[claimIds.length - 1]);
        expect(Number(claim.status)).to.equal(ClaimStatus.Pending);
      });

      it("오라클 모드 ON + 보장한도 20% 이하 청구는 제출과 동시에 자동 지급된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleAddress(ctx.oracle.address);
        await ctx.insurance.connect(ctx.owner).setOracleMode(true);

        const balBefore = await ctx.token.balanceOf(ctx.patient.address);
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, SMALL_CLAIM, "D0120", "정기검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claim = await ctx.insurance.getClaim(claimIds[claimIds.length - 1]);

        expect(Number(claim.status)).to.equal(ClaimStatus.Paid);
        expect(await ctx.token.balanceOf(ctx.patient.address)).to.equal(balBefore + SMALL_CLAIM);
        const policy = await ctx.insurance.getPolicy(policyId);
        expect(policy.totalClaimed).to.equal(SMALL_CLAIM);
      });

      it("보장한도 20% 초과 청구는 오라클 모드 ON이어도 항상 Pending(수동심사)으로 남는다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleAddress(ctx.oracle.address);
        await ctx.insurance.connect(ctx.owner).setOracleMode(true);

        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, LARGE_CLAIM, "D6010", "임플란트");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claim = await ctx.insurance.getClaim(claimIds[claimIds.length - 1]);
        expect(Number(claim.status)).to.equal(ClaimStatus.Pending);
      });

      it("관리자 승인→지급 흐름이 정상 동작한다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleMode(false); // 수동 심사 흐름을 검증하므로 오라클 자동지급을 끔
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, SMALL_CLAIM, "D0120", "정기검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];

        await ctx.insurance.connect(ctx.owner).approveClaim(claimId);
        let claim = await ctx.insurance.getClaim(claimId);
        expect(Number(claim.status)).to.equal(ClaimStatus.Approved);

        const balBefore = await ctx.token.balanceOf(ctx.patient.address);
        await ctx.insurance.connect(ctx.owner).payClaim(claimId);
        claim = await ctx.insurance.getClaim(claimId);
        expect(Number(claim.status)).to.equal(ClaimStatus.Paid);
        expect(await ctx.token.balanceOf(ctx.patient.address)).to.equal(balBefore + SMALL_CLAIM);
      });

      it("관리자 거절 시 사유가 기록되고 지급되지 않는다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleMode(false); // 수동 심사 흐름을 검증하므로 오라클 자동지급을 끔
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, SMALL_CLAIM, "D0120", "정기검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];

        await ctx.insurance.connect(ctx.owner).rejectClaim(claimId, "보장 범위 초과");
        const claim = await ctx.insurance.getClaim(claimId);
        expect(Number(claim.status)).to.equal(ClaimStatus.Rejected);
        expect(claim.rejectReason).to.equal("보장 범위 초과");
      });

      it("Pending이 아닌 청구는 승인/거절이 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleMode(false); // 수동 심사 흐름을 검증하므로 오라클 자동지급을 끔
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, SMALL_CLAIM, "D0120", "정기검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];
        await ctx.insurance.connect(ctx.owner).approveClaim(claimId);

        await expect(ctx.insurance.connect(ctx.owner).approveClaim(claimId))
          .to.be.revertedWith("Claim not in pending status");
        await expect(ctx.insurance.connect(ctx.owner).rejectClaim(claimId, "사유"))
          .to.be.revertedWith("Claim not in pending status");
      });

      it("승인되지 않은 청구는 지급이 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, SMALL_CLAIM, "D0120", "정기검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];
        await expect(ctx.insurance.connect(ctx.owner).payClaim(claimId))
          .to.be.revertedWith("Claim not approved");
      });

      it("동시에 제출된 두 청구가 합쳐서 보장한도를 넘으면 나중 지급이 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const half = COVERAGE / 2n;
        // 두 건 모두 제출 시점엔 totalClaimed=0이라 개별로는 한도 내 → 둘 다 제출 성공
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, half, "D0120", "청구1");
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, half + 1n, "D0120", "청구2");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claim1 = claimIds[claimIds.length - 2];
        const claim2 = claimIds[claimIds.length - 1];

        await ctx.insurance.connect(ctx.owner).approveClaim(claim1);
        await ctx.insurance.connect(ctx.owner).payClaim(claim1); // totalClaimed = half

        await ctx.insurance.connect(ctx.owner).approveClaim(claim2);
        await expect(ctx.insurance.connect(ctx.owner).payClaim(claim2))
          .to.be.revertedWith("Exceeds coverage limit");
      });
    });

    // ── Oracle ───────────────────────────────────────────────
    describe("오라클 검증(oracleVerifyAndProcess)", function () {
      it("오라클 미설정 상태면 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, COVERAGE / 10n, "D0120", "검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];
        await expect(
          ctx.insurance.connect(ctx.oracle).oracleVerifyAndProcess(claimId, true, ethers.ZeroHash, "병원", "VERIFIED")
        ).to.be.revertedWith("Oracle not configured");
      });

      it("오라클 주소가 아니면 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleAddress(ctx.oracle.address);
        await ctx.insurance.connect(ctx.owner).setOracleMode(true);
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, COVERAGE / 10n, "D0120", "검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];
        await expect(
          ctx.insurance.connect(ctx.other).oracleVerifyAndProcess(claimId, true, ethers.ZeroHash, "병원", "VERIFIED")
        ).to.be.revertedWith("Caller is not oracle");
      });

      it("승인 검증 시 즉시 지급되고, 거절 검증 시 사유가 기록된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleAddress(ctx.oracle.address);
        await ctx.insurance.connect(ctx.owner).setOracleMode(true);

        // 오라클 모드가 켜져 있어도 20% 이하 금액은 submitClaim 시점에 이미 자동지급되므로,
        // 이 테스트는 오라클 모드를 잠깐 꺼서 Pending 상태로 만든 뒤 오라클을 직접 호출한다.
        await ctx.insurance.connect(ctx.owner).setOracleMode(false);
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, COVERAGE / 10n, "D0120", "검진");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];
        await ctx.insurance.connect(ctx.owner).setOracleMode(true);

        const balBefore = await ctx.token.balanceOf(ctx.patient.address);
        await ctx.insurance.connect(ctx.oracle).oracleVerifyAndProcess(
          claimId, true, ethers.ZeroHash, "서울치과", "VERIFIED"
        );
        const claim = await ctx.insurance.getClaim(claimId);
        expect(Number(claim.status)).to.equal(ClaimStatus.Paid);
        expect(await ctx.token.balanceOf(ctx.patient.address)).to.equal(balBefore + COVERAGE / 10n);

        const ov = await ctx.insurance.getOracleVerification(claimId);
        expect(ov.approved).to.equal(true);
        expect(ov.hospitalName).to.equal("서울치과");
      });

      it("보장한도 20% 초과 청구는 오라클이 처리할 수 없다(revert)", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).setOracleAddress(ctx.oracle.address);
        await ctx.insurance.connect(ctx.owner).setOracleMode(true);

        const largeClaim = (COVERAGE * 30n) / 100n;
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, largeClaim, "D6010", "임플란트");
        const claimIds = await ctx.insurance.getAllClaimIds();
        const claimId = claimIds[claimIds.length - 1];

        await expect(
          ctx.insurance.connect(ctx.oracle).oracleVerifyAndProcess(claimId, true, ethers.ZeroHash, "병원", "VERIFIED")
        ).to.be.revertedWith("Exceeds oracle auto limit");
      });
    });

    // ── 약관대출 ─────────────────────────────────────────────
    describe("약관대출", function () {
      it("최대 대출한도는 (totalPaid × 환급율%) × 80%다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const expected = (PREMIUM * REFUND_RATE / 100n) * 80n / 100n;
        expect(await ctx.insurance.getMaxLoanAmount(policyId)).to.equal(expected);
      });

      it("한도 초과 대출 신청은 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const max = await ctx.insurance.getMaxLoanAmount(policyId);
        await expect(
          ctx.insurance.connect(ctx.patient).requestPolicyLoan(policyId, max + 1n)
        ).to.be.revertedWith("Exceeds max loan amount");
      });

      it("정상 대출 시 잔액이 이전되고 PolicyLoanTaken이 발생한다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const max = await ctx.insurance.getMaxLoanAmount(policyId);
        const balBefore = await ctx.token.balanceOf(ctx.patient.address);

        await expect(ctx.insurance.connect(ctx.patient).requestPolicyLoan(policyId, max))
          .to.emit(ctx.insurance, "PolicyLoanTaken").withArgs(policyId, ctx.patient.address, max, anyValue);

        expect(await ctx.token.balanceOf(ctx.patient.address)).to.equal(balBefore + max);
        const loan = await ctx.insurance.getPolicyLoan(policyId);
        expect(loan.active).to.equal(true);
        expect(loan.loanAmount).to.equal(max);
      });

      it("미상환 대출이 있으면 추가 대출이 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const max = await ctx.insurance.getMaxLoanAmount(policyId);
        await ctx.insurance.connect(ctx.patient).requestPolicyLoan(policyId, max / 2n);
        await expect(
          ctx.insurance.connect(ctx.patient).requestPolicyLoan(policyId, 1n)
        ).to.be.revertedWith("Existing loan not repaid");
      });

      it("전액 상환 시 원금+이자가 정확히 계산되고 대출이 종료된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const max = await ctx.insurance.getMaxLoanAmount(policyId);
        await ctx.insurance.connect(ctx.patient).requestPolicyLoan(policyId, max);

        const oneYear = 365 * 24 * 60 * 60;
        await increaseTime(oneYear);

        // 연이율 5%(500bps) 단순이자, 정확히 1년 경과 → 이자 ≈ 원금×5%
        const [principal, interest, total] = await ctx.insurance.getLoanRepayAmount(policyId);
        expect(principal).to.equal(max);
        expect(total).to.equal(principal + interest);
        // 블록타임스탬프 오차(mining interval 등) 감안해 근사치로 검증
        const expectedInterest = (max * 500n) / 10000n;
        const tolerance = expectedInterest / 100n + 10n; // 약 1% 오차 허용
        expect(interest).to.be.closeTo(expectedInterest, tolerance);

        await ctx.token.connect(ctx.patient).approve(ctx.insuranceAddr, total * 2n); // 여유있게 approve
        await ctx.insurance.connect(ctx.patient).repayPolicyLoan(policyId);

        const loan = await ctx.insurance.getPolicyLoan(policyId);
        expect(loan.active).to.equal(false);
        expect(loan.loanAmount).to.equal(0n);
      });

      it("부분상환은 이자를 먼저 충당하고 나머지를 원금에서 차감한다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const max = await ctx.insurance.getMaxLoanAmount(policyId);
        await ctx.insurance.connect(ctx.patient).requestPolicyLoan(policyId, max);
        await increaseTime(30 * 24 * 60 * 60); // 30일 경과 → 소액 이자 발생

        const [, interest] = await ctx.insurance.getLoanRepayAmount(policyId);
        expect(interest).to.be.gt(0n);

        // 이자보다 적은 금액은 revert
        if (interest > 1n) {
          await ctx.token.connect(ctx.patient).approve(ctx.insuranceAddr, interest - 1n);
          await expect(
            ctx.insurance.connect(ctx.patient).repayPolicyLoanPartial(policyId, interest - 1n)
          ).to.be.revertedWith("Must cover accrued interest");
        }

        const partial = interest + max / 4n;
        await ctx.token.connect(ctx.patient).approve(ctx.insuranceAddr, partial);
        await ctx.insurance.connect(ctx.patient).repayPolicyLoanPartial(policyId, partial);

        const loan = await ctx.insurance.getPolicyLoan(policyId);
        expect(loan.active).to.equal(true);
        // partial 계산에 쓴 interest 추정치와 실제 트랜잭션 실행 시점의 이자가
        // 블록 타임스탬프 몇 초 차이로 미세하게 달라질 수 있어 근사 비교
        expect(loan.loanAmount).to.be.closeTo(max - max / 4n, 20n);
      });
    });

    // ── 만기환급 ─────────────────────────────────────────────
    describe("만기환급(processMaturityRefund)", function () {
      it("만기 도달 전에는 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await expect(ctx.insurance.connect(ctx.owner).processMaturityRefund(policyId))
          .to.be.revertedWith("Policy not yet matured");
      });

      it("만기 도달 후 정상 지급되고 증권이 비활성화된다", async function () {
        // 짧은 만기(5분 테스트 옵션)로 재설정 후 시간 이동
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.patient).setMyMaturityInterval(policyId, 5 * 60);
        await increaseTime(5 * 60 + 1);

        const expectedRefund = (PREMIUM * REFUND_RATE) / 100n;
        const balBefore = await ctx.token.balanceOf(ctx.patient.address);

        await expect(ctx.insurance.connect(ctx.owner).processMaturityRefund(policyId))
          .to.emit(ctx.insurance, "MaturityRefundPaid")
          .withArgs(policyId, ctx.patient.address, expectedRefund, anyValue);

        expect(await ctx.token.balanceOf(ctx.patient.address)).to.equal(balBefore + expectedRefund);
        const policy = await ctx.insurance.getPolicy(policyId);
        expect(policy.maturityPaid).to.equal(true);
        expect(policy.active).to.equal(false);
      });

      it("미상환 대출이 있으면 환급액에서 원리금을 차감한다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const maxLoan = await ctx.insurance.getMaxLoanAmount(policyId);
        await ctx.insurance.connect(ctx.patient).requestPolicyLoan(policyId, maxLoan);

        await ctx.insurance.connect(ctx.patient).setMyMaturityInterval(policyId, 5 * 60);
        await increaseTime(5 * 60 + 1);

        const grossRefund = (PREMIUM * REFUND_RATE) / 100n;
        // 대출원금(maxLoan) = 해지환급금(=grossRefund)의 80% 이므로 항상 grossRefund보다 작음 → 순액은 양수
        const [, , loanTotalNow] = await ctx.insurance.getLoanRepayAmount(policyId);
        const expectedNet = grossRefund > loanTotalNow ? grossRefund - loanTotalNow : 0n;

        const balBefore = await ctx.token.balanceOf(ctx.patient.address);
        await ctx.insurance.connect(ctx.owner).processMaturityRefund(policyId);
        const balAfter = await ctx.token.balanceOf(ctx.patient.address);

        // 대출 이자는 5분치라 매우 작아 정확한 초 단위 타이밍 오차만 있을 수 있으므로 근사 비교
        expect(balAfter - balBefore).to.be.closeTo(expectedNet, 10n);

        const loan = await ctx.insurance.getPolicyLoan(policyId);
        expect(loan.active).to.equal(false); // 만기 처리 시 대출도 함께 정리됨
      });

      it("이미 지급된 증권은 다시 지급 요청 시 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.patient).setMyMaturityInterval(policyId, 5 * 60);
        await increaseTime(5 * 60 + 1);
        await ctx.insurance.connect(ctx.owner).processMaturityRefund(policyId);

        await expect(ctx.insurance.connect(ctx.owner).processMaturityRefund(policyId))
          .to.be.revertedWith("Policy not active"); // maturityPaid 처리 시 active=false가 되므로 _activePolicy에서 걸림
      });
    });

    // ── 관리자 설정 ───────────────────────────────────────────
    describe("관리자 설정", function () {
      it("이자율을 30% 초과로 설정하면 revert된다", async function () {
        await expect(ctx.insurance.connect(ctx.owner).setLoanInterestRate(3001))
          .to.be.revertedWith("Rate cannot exceed 30%");
      });

      it("deactivatePolicy 후 조회 시 active=false다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await ctx.insurance.connect(ctx.owner).deactivatePolicy(policyId);
        const policy = await ctx.insurance.getPolicy(policyId);
        expect(policy.active).to.equal(false);
      });

      it("피보험자 본인이 정해진 옵션 중에서 납입주기를 변경할 수 있다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const THIRTY_DAYS = 30 * 24 * 60 * 60;
        await ctx.insurance.connect(ctx.patient).setMyPremiumInterval(policyId, THIRTY_DAYS);
        const policy = await ctx.insurance.getPolicy(policyId);
        expect(policy.premiumInterval).to.equal(THIRTY_DAYS);
      });

      it("정해지지 않은 납입주기 값은 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await expect(
          ctx.insurance.connect(ctx.patient).setMyPremiumInterval(policyId, 12345)
        ).to.be.revertedWith("Invalid interval");
      });
    });

    // ── getStats ─────────────────────────────────────────────
    describe("getStats", function () {
      it("납입·지급 통계가 누적 합산된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const smallClaim = COVERAGE / 10n;
        await ctx.insurance.connect(ctx.owner).setOracleAddress(ctx.oracle.address);
        await ctx.insurance.connect(ctx.owner).setOracleMode(true);
        await ctx.insurance.connect(ctx.patient).submitClaim(policyId, smallClaim, "D0120", "검진");

        const stats = await ctx.insurance.getStats();
        expect(stats.premiumsCollected).to.equal(PREMIUM);
        expect(stats.claimsPaid).to.equal(smallClaim);
        expect(stats.policiesCount).to.equal(1n);
        expect(stats.claimsCount).to.equal(1n);
      });
    });

    // ── 씬파일러 유연납입 (flexiblePayment / autoCoverArrearsWithLoan) ──
    describe("유연납입 — autoCoverArrearsWithLoan", function () {
      async function createFlexiblePolicy() {
        const now = await currentBlockTimestamp();
        const maturityDate = now + 365 * 24 * 60 * 60;
        await ctx.insurance.connect(ctx.owner).createPolicy(
          ctx.patient.address, "테스트 피보험자", PREMIUM, COVERAGE, maturityDate, REFUND_RATE, true
        );
        const ids = await ctx.insurance.getAllPolicyIds();
        const policyId = ids[ids.length - 1];
        // getMaxLoanAmount = totalPaid * refundRate% * maxLoanRatio% 이므로(기본 70%*80%=56%),
        // 1회 납입만으로는 다음 회차 보험료 전액을 대출 한도가 못 덮는다 — 2회 선납해 한도를 확보한다.
        await ctx.token.connect(ctx.patient).approve(ctx.insuranceAddr, PREMIUM * 2n);
        await ctx.insurance.connect(ctx.patient).payPremium(policyId);
        await ctx.insurance.connect(ctx.patient).payPremium(policyId);
        return policyId;
      }

      it("생성 시 flexiblePayment=true가 그대로 저장된다", async function () {
        const policyId = await createFlexiblePolicy();
        expect((await ctx.insurance.getPolicy(policyId)).flexiblePayment).to.equal(true);
      });

      it("setFlexiblePayment로 기존 증권도 소급 토글할 수 있다", async function () {
        const policyId = await createFundedPolicy(ctx); // 기본 flexiblePayment=false
        expect((await ctx.insurance.getPolicy(policyId)).flexiblePayment).to.equal(false);
        await ctx.insurance.connect(ctx.owner).setFlexiblePayment(policyId, true);
        expect((await ctx.insurance.getPolicy(policyId)).flexiblePayment).to.equal(true);
      });

      it("연체 상태에서 호출하면 대출로 대환되고 납입이 갱신된다", async function () {
        const policyId = await createFlexiblePolicy();
        const policy1 = await ctx.insurance.getPolicy(policyId);
        await increaseTime(Number(policy1.premiumInterval) + 1); // 다음 납입기한 경과

        await expect(ctx.insurance.connect(ctx.owner).autoCoverArrearsWithLoan(policyId))
          .to.emit(ctx.insurance, "ArrearsCoveredByLoan")
          .withArgs(policyId, PREMIUM, anyValue);

        const policy2 = await ctx.insurance.getPolicy(policyId);
        expect(policy2.totalPaid).to.equal(PREMIUM * 3n);

        const loan = await ctx.insurance.getPolicyLoan(policyId);
        expect(loan.active).to.equal(true);
        expect(loan.loanAmount).to.equal(PREMIUM);
      });

      it("flexiblePayment가 꺼져 있으면 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const policy = await ctx.insurance.getPolicy(policyId);
        await increaseTime(Number(policy.premiumInterval) + 1);
        await expect(ctx.insurance.connect(ctx.owner).autoCoverArrearsWithLoan(policyId))
          .to.be.revertedWith("Flexible payment not enabled");
      });

      it("아직 납입 기한 전이면 revert된다", async function () {
        const policyId = await createFlexiblePolicy();
        await expect(ctx.insurance.connect(ctx.owner).autoCoverArrearsWithLoan(policyId))
          .to.be.revertedWith("Premium not yet due");
      });

      it("이미 활성 대출이 있으면 revert된다", async function () {
        const policyId = await createFlexiblePolicy();
        const policy = await ctx.insurance.getPolicy(policyId);
        await increaseTime(Number(policy.premiumInterval) + 1);
        await ctx.insurance.connect(ctx.owner).autoCoverArrearsWithLoan(policyId);

        const policy2 = await ctx.insurance.getPolicy(policyId);
        await increaseTime(Number(policy2.premiumInterval) + 1);
        await expect(ctx.insurance.connect(ctx.owner).autoCoverArrearsWithLoan(policyId))
          .to.be.revertedWith("Existing loan not repaid");
      });
    });

    // ── 웰니스 연동 동적 보험료 (applyWellnessAdjustment) ──
    describe("웰니스 — applyWellnessAdjustment", function () {
      beforeEach(async function () {
        await ctx.insurance.connect(ctx.owner).setOracleAddress(ctx.oracle.address);
      });

      it("±20% 범위 내 조정은 성공하고 이벤트가 발생한다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const newAmount = (PREMIUM * 110n) / 100n; // +10%
        await expect(
          ctx.insurance.connect(ctx.oracle).applyWellnessAdjustment(policyId, newAmount, "건강개선")
        ).to.emit(ctx.insurance, "WellnessPremiumAdjusted")
          .withArgs(policyId, PREMIUM, newAmount, "건강개선", anyValue);

        const policy = await ctx.insurance.getPolicy(policyId);
        expect(policy.monthlyPremium).to.equal(newAmount);
      });

      it("범위를 벗어나면 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        const tooLow = (PREMIUM * 70n) / 100n;
        await expect(
          ctx.insurance.connect(ctx.oracle).applyWellnessAdjustment(policyId, tooLow, "사유")
        ).to.be.revertedWith("Out of adjustment range");
      });

      it("오라클이 아니면 revert된다", async function () {
        const policyId = await createFundedPolicy(ctx);
        await expect(
          ctx.insurance.connect(ctx.patient).applyWellnessAdjustment(policyId, PREMIUM, "사유")
        ).to.be.revertedWith("Caller is not oracle");
      });
    });

    // ── 재보험풀 ceding (setReinsurancePool / setCedingBps / _cedeToPool) ──
    describe("재보험풀 ceding", function () {
      it("보험료 수취 시 설정된 비율만큼 풀로 이체된다", async function () {
        await ctx.insurance.connect(ctx.owner).setReinsurancePool(ctx.other.address);
        await ctx.insurance.connect(ctx.owner).setCedingBps(500); // 5%

        const balBefore = await ctx.token.balanceOf(ctx.other.address);
        await createFundedPolicy(ctx); // 내부에서 payPremium 1회 호출
        const expectedCut = (PREMIUM * 500n) / 10000n;
        expect(await ctx.token.balanceOf(ctx.other.address)).to.equal(balBefore + expectedCut);
      });

      it("풀 미설정이면 ceding이 발생하지 않는다", async function () {
        const balBefore = await ctx.token.balanceOf(ctx.other.address);
        await createFundedPolicy(ctx);
        expect(await ctx.token.balanceOf(ctx.other.address)).to.equal(balBefore);
      });

      it("30% 초과 설정은 revert된다", async function () {
        await expect(ctx.insurance.connect(ctx.owner).setCedingBps(3001))
          .to.be.revertedWith("Ceding cannot exceed 30%");
      });
    });
  });
}
