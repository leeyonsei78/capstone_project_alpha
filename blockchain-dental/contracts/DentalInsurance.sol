// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DentalInsurance
 * @dev 덴탈보험 스마트 컨트랙트 - 보험료 납입 및 보험금 지급 처리
 *      스테이블코인(USDC)으로 모든 거래 처리
 */
contract DentalInsurance is Ownable, ReentrancyGuard {

    IERC20 public immutable stablecoin;

    // ─────────────────────────────────────────
    //  Data Structures
    // ─────────────────────────────────────────

    struct Policy {
        uint256 id;
        address patient;
        string  patientName;
        uint256 monthlyPremium;   // USDC (6 decimals)
        uint256 coverageLimit;    // USDC (6 decimals)
        uint256 totalPaid;        // 누적 납입 보험료
        uint256 totalClaimed;     // 누적 지급된 보험금
        uint256 lastPaymentTime;  // 마지막 납입 시각
        uint256 nextDueTime;      // 다음 납입 기한
        bool    active;
        uint256 createdAt;
        uint256 maturityDate;     // 만기일 (timestamp)
        uint256 maturityRefundRate; // 만기환급율 (0~100, totalPaid 대비 %)
        bool    maturityPaid;     // 만기환급 지급 완료 여부
        uint256 premiumInterval;  // 자동이체(납입) 주기 (초 단위, 기본 30일)
        bool    flexiblePayment;      // 씬파일러 유연납입(연체 시 자동 대환) 대상 여부
        uint256 baselinePremiumAmount; // 웰니스 조정 상/하한 기준(생성 시 monthlyPremium으로 고정)
    }

    struct Claim {
        uint256 id;
        uint256 policyId;
        address patient;
        uint256 amount;           // 청구 금액 USDC
        string  treatmentCode;    // 치료 코드 (예: D0120, D2140)
        string  description;      // 치료 설명
        ClaimStatus status;
        uint256 submittedAt;
        uint256 processedAt;
        string  rejectReason;
    }

    enum ClaimStatus { Pending, Approved, Rejected, Paid }

    // ─── Application (청약 심사) ───────────────────────────────

    struct Application {
        uint256 id;
        address applicant;
        string  applicantName;
        uint256 age;               // 나이
        uint256 monthlyPremium;
        uint256 coverageLimit;
        uint256 maturityDays;
        uint256 maturityRefundRate;
        ApplicationStatus status;
        uint256 submittedAt;
        uint256 processedAt;
        string  rejectReason;
        uint256 policyId;          // 승인 시 생성된 증권 ID
        uint8   riskScore;         // 자동 심사 위험 점수 (0~100)
        uint256 coverageCount;     // 선택한 담보 개수 (프론트엔드 담보 선택 UI 기준)
        bool    flexiblePayment;   // 씬파일러 신용보완 유연납입 신청 여부
    }

    enum ApplicationStatus { Pending, Approved, Rejected }

    // ─── Policy Loan (약관대출) ────────────────────────────────

    struct PolicyLoan {
        uint256 policyId;
        uint256 loanAmount;        // 대출 원금 (USDC 6 decimals)
        uint256 borrowedAt;        // 대출 시각
        uint256 interestRate;      // 연 이자율 (basis points, 500 = 5%)
        bool    active;
    }

    // ─────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────

    uint256 public nextPolicyId = 1;
    uint256 public nextClaimId  = 1;

    mapping(uint256 => Policy) public policies;
    mapping(uint256 => Claim)  public claims;
    mapping(address => uint256[]) private _patientPolicies;
    mapping(address => uint256[]) private _patientClaims;

    uint256[] private _allPolicyIds;
    uint256[] private _allClaimIds;

    uint256 public totalPremiumsCollected;
    uint256 public totalClaimsPaid;
    uint256 public totalPoliciesCreated;
    uint256 public totalClaimsSubmitted;

    // ─── Application State ─────────────────────────────────────
    uint256 public nextApplicationId = 1;
    mapping(uint256 => Application) public applications;
    uint256[] private _allApplicationIds;
    mapping(address => uint256[]) private _applicantApplications;

    // 자동 심사 룰 파라미터 (관리자 변경 가능)
    uint256 public minAge                    = 18;
    uint256 public maxAge                    = 75;
    uint256 public maxCoverageCount           = 7;   // 전체 담보 개수 — 모두 선택 시 즉시 거절
    uint256 public autoApproveCoverageCount   = 2;   // 정확히 이 개수 선택 시 즉시 자동승인, 그 외(1개 또는 3~maxCoverageCount-1개)는 관리자 심사
    uint256 public minMonthlyPremium         = 1_000000; // 최소 1 USDC
    uint256 public maxActivePoliciesPerPerson = 3;

    // ─── Policy Loan State ─────────────────────────────────────
    mapping(uint256 => PolicyLoan) public policyLoans;
    uint256 public loanInterestRate = 500;  // 연 5% (basis points)
    uint256 public maxLoanRatio     = 80;   // 해지환급금의 80% 한도

    // ─── Reinsurance State (재보험풀 ceding) ────────────────────
    address public reinsurancePool;
    uint256 public cedingBps; // 보험료 수취 시 재보험풀로 넘기는 비율 (basis points, 최대 3000=30%)

    // ─── Oracle State ──────────────────────────────────────────
    address public oracleAddress;
    bool    public oracleModeEnabled = true; // 디폴트 오라클 활성화 — 소액은 자동승인, 고액은 항상 관리자 수동심사

    struct OracleVerification {
        bool    exists;
        bool    approved;
        bytes32 dataHash;        // keccak256(진료내역 JSON)
        uint256 verifiedAt;
        string  hospitalName;
        string  verificationCode; // 검증 결과 코드 (예: VERIFIED, AMOUNT_EXCEEDED, UNKNOWN_CODE)
    }
    mapping(uint256 => OracleVerification) public oracleVerifications;

    // ─────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────

    event PolicyCreated(
        uint256 indexed policyId,
        address indexed patient,
        string  patientName,
        uint256 monthlyPremium,
        uint256 coverageLimit,
        uint256 timestamp
    );
    event PremiumPaid(
        uint256 indexed policyId,
        address indexed patient,
        uint256 amount,
        uint256 totalPaid,
        uint256 timestamp
    );
    event ClaimSubmitted(
        uint256 indexed claimId,
        uint256 indexed policyId,
        address indexed patient,
        uint256 amount,
        string  treatmentCode,
        uint256 timestamp
    );
    event ClaimApproved(
        uint256 indexed claimId,
        uint256 indexed policyId,
        uint256 amount,
        uint256 timestamp
    );
    event ClaimRejected(
        uint256 indexed claimId,
        uint256 indexed policyId,
        string  reason,
        uint256 timestamp
    );
    event ClaimPaid(
        uint256 indexed claimId,
        uint256 indexed policyId,
        address indexed patient,
        uint256 amount,
        uint256 timestamp
    );
    event PolicyDeactivated(uint256 indexed policyId, uint256 timestamp);
    event FundsDeposited(address indexed depositor, uint256 amount, uint256 timestamp);

    // ─── Application Events ────────────────────────────────────
    event ApplicationSubmitted(
        uint256 indexed appId,
        address indexed applicant,
        string  applicantName,
        uint256 riskScore,
        uint256 timestamp
    );
    event ApplicationApproved(
        uint256 indexed appId,
        uint256 indexed policyId,
        uint256 timestamp
    );
    event ApplicationRejected(
        uint256 indexed appId,
        address indexed applicant,
        string  reason,
        uint256 timestamp
    );

    // ─── Policy Loan Events ────────────────────────────────────
    event PolicyLoanTaken(
        uint256 indexed policyId,
        address indexed patient,
        uint256 loanAmount,
        uint256 timestamp
    );
    event PolicyLoanRepaid(
        uint256 indexed policyId,
        address indexed patient,
        uint256 principal,
        uint256 interest,
        uint256 timestamp
    );
    event MaturityRefundPaid(
        uint256 indexed policyId,
        address indexed patient,
        uint256 refundAmount,
        uint256 timestamp
    );
    event PremiumAutoCollected(
        uint256 indexed policyId,
        address indexed patient,
        uint256 amount,
        uint256 totalPaid,
        uint256 timestamp
    );

    // ─── Oracle Events ─────────────────────────────────────────
    event OracleAddressSet(address indexed oracle);
    event OracleModeSet(bool enabled);
    event ClaimOracleVerified(
        uint256 indexed claimId,
        bool    approved,
        bytes32 dataHash,
        string  hospitalName,
        uint256 timestamp
    );

    // ─── 씬파일러 유연납입 Events ──────────────────────────────
    event FlexiblePaymentSet(uint256 indexed policyId, bool enabled);
    event ArrearsCoveredByLoan(uint256 indexed policyId, uint256 amount, uint256 timestamp);

    // ─── 웰니스 연동 동적 보험료 Events ──────────────────────────
    event WellnessPremiumAdjusted(
        uint256 indexed policyId,
        uint256 oldAmount,
        uint256 newAmount,
        string  reason,
        uint256 timestamp
    );

    // ─── 재보험풀(ceding) Events ────────────────────────────────
    event ReinsurancePoolSet(address indexed pool);
    event CedingBpsSet(uint256 bps);
    event PremiumCededToPool(uint256 indexed policyId, uint256 amount, uint256 timestamp);

    // ─────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────

    modifier onlyOracle() {
        require(oracleAddress != address(0), "Oracle not configured");
        require(msg.sender == oracleAddress, "Caller is not oracle");
        _;
    }

    constructor(address _stablecoin) Ownable(msg.sender) {
        require(_stablecoin != address(0), "Invalid stablecoin address");
        stablecoin = IERC20(_stablecoin);
    }

    // ─────────────────────────────────────────
    //  Oracle Management (Admin)
    // ─────────────────────────────────────────

    /**
     * @dev 오라클 주소 설정 (관리자 전용)
     * @param _oracle 오라클 서비스 지갑 주소
     */
    function setOracleAddress(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle address");
        oracleAddress = _oracle;
        emit OracleAddressSet(_oracle);
    }

    /**
     * @dev 오라클 모드 활성화/비활성화 (관리자 전용)
     *      활성화 시: 청구 제출 후 오라클이 자동 검증
     *      비활성화 시: 기존 수동 승인/거절 방식 유지
     */
    function setOracleMode(bool _enabled) external onlyOwner {
        oracleModeEnabled = _enabled;
        emit OracleModeSet(_enabled);
    }

    /**
     * @dev 오라클 진료내역 검증 후 청구 자동 처리 (오라클 전용)
     *      승인 시: Approved + 즉시 USDC 지급 (원자적 처리)
     *      거절 시: Rejected + 거절 사유 기록
     * @param claimId       처리할 청구 ID
     * @param approved      승인 여부
     * @param dataHash      진료내역 JSON의 keccak256 해시 (감사 추적용)
     * @param hospitalName  검증된 병원명
     * @param verificationCode 검증 결과 코드 (VERIFIED / AMOUNT_EXCEEDED / UNKNOWN_CODE 등)
     */
    function oracleVerifyAndProcess(
        uint256 claimId,
        bool    approved,
        bytes32 dataHash,
        string  calldata hospitalName,
        string  calldata verificationCode
    ) external onlyOracle nonReentrant {
        require(oracleModeEnabled, "Oracle mode disabled");
        Claim storage claim = claims[claimId];
        require(claim.id != 0,                       "Claim not found");
        require(claim.status == ClaimStatus.Pending, "Claim not pending");
        // 20% 초과 청구는 오라클 모드와 무관하게 항상 관리자 수동 심사 전용 — 오라클은 절대 처리 불가
        require(
            claim.amount <= (policies[claim.policyId].coverageLimit * AUTO_CLAIM_APPROVAL_PERCENT) / 100,
            "Exceeds oracle auto limit"
        );

        oracleVerifications[claimId] = OracleVerification({
            exists:           true,
            approved:         approved,
            dataHash:         dataHash,
            verifiedAt:       block.timestamp,
            hospitalName:     hospitalName,
            verificationCode: verificationCode
        });

        claim.processedAt = block.timestamp;

        if (approved) {
            _accrueClaim(policies[claim.policyId], claim.amount);
            _requireBalance(claim.amount);
            claim.status = ClaimStatus.Paid;
            totalClaimsPaid += claim.amount;
            require(
                stablecoin.transfer(claim.patient, claim.amount),
                "USDC transfer failed"
            );
            emit ClaimApproved(claimId, claim.policyId, claim.amount, block.timestamp);
            emit ClaimPaid(claimId, claim.policyId, claim.patient, claim.amount, block.timestamp);
        } else {
            claim.status      = ClaimStatus.Rejected;
            claim.rejectReason = string(abi.encodePacked("Oracle: ", verificationCode));
            emit ClaimRejected(claimId, claim.policyId, claim.rejectReason, block.timestamp);
        }

        emit ClaimOracleVerified(claimId, approved, dataHash, hospitalName, block.timestamp);
    }

    /**
     * @dev 오라클 검증 결과 조회
     */
    function getOracleVerification(uint256 claimId) external view returns (OracleVerification memory) {
        return oracleVerifications[claimId];
    }

    // ─────────────────────────────────────────
    //  Admin: Policy Management
    // ─────────────────────────────────────────

    /**
     * @dev 보험증권 생성 (관리자 전용 직접 생성)
     */
    function createPolicy(
        address patient,
        string  calldata patientName,
        uint256 monthlyPremium,
        uint256 coverageLimit,
        uint256 maturityDate,
        uint256 maturityRefundRate,
        bool    flexiblePayment
    ) external onlyOwner returns (uint256) {
        require(patient != address(0), "Invalid patient address");
        require(bytes(patientName).length > 0, "Patient name required");
        require(monthlyPremium > 0, "Premium must be > 0");
        require(coverageLimit > 0, "Coverage limit must be > 0");
        require(maturityDate > block.timestamp, "Maturity must be in future");
        require(maturityRefundRate <= 100, "Refund rate must be <= 100");
        return _createPolicyInternal(patient, patientName, monthlyPremium, coverageLimit, maturityDate, maturityRefundRate, flexiblePayment);
    }

    /**
     * @dev 내부 증권 생성 (createPolicy + approveApplication 공용)
     */
    function _createPolicyInternal(
        address patient,
        string  memory patientName,
        uint256 monthlyPremium,
        uint256 coverageLimit,
        uint256 maturityDate,
        uint256 maturityRefundRate,
        bool    flexiblePayment
    ) internal returns (uint256) {
        uint256 policyId = nextPolicyId++;

        Policy storage policy = policies[policyId];
        policy.id                = policyId;
        policy.patient            = patient;
        policy.patientName        = patientName;
        policy.monthlyPremium     = monthlyPremium;
        policy.coverageLimit      = coverageLimit;
        policy.nextDueTime        = block.timestamp + 30 days;
        policy.active             = true;
        policy.createdAt          = block.timestamp;
        policy.maturityDate       = maturityDate;
        policy.maturityRefundRate = maturityRefundRate;
        policy.premiumInterval    = 30 days;
        policy.flexiblePayment    = flexiblePayment;
        policy.baselinePremiumAmount = monthlyPremium;

        _patientPolicies[patient].push(policyId);
        _allPolicyIds.push(policyId);
        totalPoliciesCreated++;

        emit PolicyCreated(policyId, patient, patientName, monthlyPremium, coverageLimit, block.timestamp);
        return policyId;
    }

    // ─────────────────────────────────────────
    //  Underwriting: Application (청약 심사)
    // ─────────────────────────────────────────

    /**
     * @dev 보험 청약 신청 (누구나 호출 가능)
     *      스마트 컨트랙트가 자동으로 심사 룰을 체크한다. (선택 담보 개수 기준)
     *      - 담보 coverageCount == autoApproveCoverageCount(기본 2개): 즉시 자동승인 + 증권 생성
     *      - 담보 coverageCount >= maxCoverageCount(기본 7개, 전체 선택): 즉시 거절 (트랜잭션은 성공, 청약만 거절 처리)
     *      - 그 외(1개 또는 3~maxCoverageCount-1개): 대기(Pending) → 관리자가 approveApplication/rejectApplication으로 심사
     */
    function submitApplication(
        string  calldata applicantName,
        uint256 age,
        uint256 monthlyPremium,
        uint256 coverageLimit,
        uint256 maturityDays,
        uint256 maturityRefundRate,
        uint256 coverageCount,
        bool    flexiblePayment
    ) external returns (uint256) {
        require(bytes(applicantName).length > 0, "Name required");
        require(monthlyPremium > 0, "Premium must be > 0");
        require(coverageLimit > 0, "Coverage must be > 0");
        require(maturityDays > 0, "Maturity days must be > 0");
        require(maturityRefundRate <= 100, "Refund rate must be <= 100");
        require(coverageCount > 0, "At least 1 coverage required");

        (uint8 decision, string memory rejectReason, uint8 score) =
            _underwrite(msg.sender, age, monthlyPremium, coverageLimit, coverageCount);

        uint256 appId = nextApplicationId++;
        Application storage app = applications[appId];
        app.id                 = appId;
        app.applicant          = msg.sender;
        app.applicantName      = applicantName;
        app.age                = age;
        app.monthlyPremium     = monthlyPremium;
        app.coverageLimit      = coverageLimit;
        app.maturityDays       = maturityDays;
        app.maturityRefundRate = maturityRefundRate;
        app.submittedAt        = block.timestamp;
        app.riskScore          = score;
        app.coverageCount      = coverageCount;
        app.flexiblePayment    = flexiblePayment;

        if (decision == 1) {
            _grantApproval(app);
        } else if (decision == 2) {
            app.status = ApplicationStatus.Pending;
        } else {
            _rejectApplication(app, rejectReason);
        }

        _applicantApplications[msg.sender].push(appId);
        _allApplicationIds.push(appId);

        emit ApplicationSubmitted(appId, msg.sender, applicantName, score, block.timestamp);
        return appId;
    }

    /**
     * @dev 청약 승인 처리 공용 로직 (즉시 자동승인 / 관리자 수동승인 겸용) — 증권 생성 + 상태 갱신 + 이벤트
     */
    function _grantApproval(Application storage app) internal returns (uint256 policyId) {
        policyId = _createPolicyInternal(
            app.applicant, app.applicantName, app.monthlyPremium, app.coverageLimit,
            block.timestamp + app.maturityDays * 1 days, app.maturityRefundRate, app.flexiblePayment
        );
        app.status      = ApplicationStatus.Approved;
        app.processedAt = block.timestamp;
        app.policyId    = policyId;
        emit ApplicationApproved(app.id, policyId, block.timestamp);
    }

    /**
     * @dev 청약 거절 처리 공용 로직 (즉시 자동거절 / 관리자 수동거절 겸용)
     */
    function _rejectApplication(Application storage app, string memory reason) internal {
        app.status       = ApplicationStatus.Rejected;
        app.processedAt  = block.timestamp;
        app.rejectReason = reason;
        emit ApplicationRejected(app.id, app.applicant, reason, block.timestamp);
    }

    /**
     * @dev 내부 자동 심사 룰 엔진
     *      반환: (decision: 0=거절 1=자동승인 2=관리자심사대기, 거절사유, 위험점수 0~100)
     */
    function _underwrite(
        address applicant,
        uint256 age,
        uint256 monthlyPremium,
        uint256 coverageLimit,
        uint256 coverageCount
    ) internal view returns (uint8 decision, string memory reason, uint8 score) {
        // ① 연령 체크
        if (age < minAge)
            return (0, unicode"만 18세 미만 가입 불가", 100);
        if (age > maxAge)
            return (0, unicode"만 75세 초과 가입 불가", 100);

        // ② 최소 보험료 체크
        if (monthlyPremium < minMonthlyPremium)
            return (0, unicode"보험료 최소기준 미달", 90);

        // ③ 1인 최대 활성 증권 수 체크
        if (_activePolicyCount(applicant) >= maxActivePoliciesPerPerson)
            return (0, unicode"1인 가입한도 초과", 90);

        // ④ 위험 점수 계산 (참고용 — 더 이상 승인/거절 결정에는 사용하지 않음)
        uint256 ratio = monthlyPremium > 0 ? coverageLimit / monthlyPremium : 0;
        uint8 riskScore = 0;
        if      (age >= 65) riskScore += 40;
        else if (age >= 50) riskScore += 25;
        else if (age >= 40) riskScore += 15;

        if (ratio > 50) riskScore += 20;
        if (ratio > 80) riskScore += 10;

        if (riskScore > 100) riskScore = 100;

        // ⑤ 선택 담보 개수 기준 자동 심사
        //    - 전체 담보(maxCoverageCount)를 모두 선택 → 위험도 과다로 판단해 즉시 거절
        //    - 정확히 autoApproveCoverageCount개 선택 → 즉시 자동승인
        //    - 그 외(1개 또는 그 사이 구간) → 관리자 심사 대기
        if (coverageCount >= maxCoverageCount)
            return (0, unicode"전체 담보 선택은 위험도 과다로 자동 거절", riskScore);

        if (coverageCount == autoApproveCoverageCount) {
            return (1, "", riskScore);
        }
        return (2, "", riskScore);
    }

    /**
     * @dev 특정 신청자의 현재 활성 증권 수 계산 (심사·승인 공용)
     */
    function _activePolicyCount(address applicant) internal view returns (uint256) {
        uint256[] storage patPolicies = _patientPolicies[applicant];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < patPolicies.length; i++) {
            if (policies[patPolicies[i]].active) activeCount++;
        }
        return activeCount;
    }

    /**
     * @dev 본인 소유 + 활성 상태인 증권 조회 (payPremium/submitClaim 공용)
     */
    function _ownedActivePolicy(uint256 policyId) internal view returns (Policy storage policy) {
        policy = _activePolicy(policyId);
        require(policy.patient == msg.sender, "Not the policy holder");
    }

    /**
     * @dev 존재+활성 상태인 증권 조회 (소유자 무관, 관리자용 함수 공용)
     */
    function _activePolicy(uint256 policyId) internal view returns (Policy storage policy) {
        policy = policies[policyId];
        require(policy.id != 0, "Policy not found");
        require(policy.active,  "Policy not active");
    }

    /**
     * @dev 청약 최종 승인 (관리자) — 자동승인·자동거절 조건에 해당하지 않아 대기(Pending)된 청약 전용
     */
    function approveApplication(uint256 appId) external onlyOwner returns (uint256) {
        Application storage app = applications[appId];
        require(app.id != 0,                             "Application not found");
        require(app.status == ApplicationStatus.Pending, "Application not pending");
        require(
            _activePolicyCount(app.applicant) < maxActivePoliciesPerPerson,
            unicode"1인 가입한도 초과"
        );
        return _grantApproval(app);
    }

    /**
     * @dev 청약 거절 (관리자) — 대기(Pending) 청약 전용
     */
    function rejectApplication(uint256 appId, string calldata reason) external onlyOwner {
        Application storage app = applications[appId];
        require(app.id != 0,                             "Application not found");
        require(app.status == ApplicationStatus.Pending, "Application not pending");
        _rejectApplication(app, reason);
    }

    /**
     * @dev 심사 룰 파라미터 변경 (관리자)
     */
    function setUnderwritingRules(
        uint256 _minAge,
        uint256 _maxAge,
        uint256 _maxCoverageCount,
        uint256 _autoApproveCoverageCount,
        uint256 _minMonthlyPremium,
        uint256 _maxActivePolicies
    ) external onlyOwner {
        minAge                     = _minAge;
        maxAge                     = _maxAge;
        maxCoverageCount           = _maxCoverageCount;
        autoApproveCoverageCount   = _autoApproveCoverageCount;
        minMonthlyPremium          = _minMonthlyPremium;
        maxActivePoliciesPerPerson = _maxActivePolicies;
    }

    // ─────────────────────────────────────────
    //  Policy Loan (약관대출)
    // ─────────────────────────────────────────

    /**
     * @dev 최대 대출 가능 금액 조회
     *      해지환급금(totalPaid × refundRate%) × maxLoanRatio%
     */
    function getMaxLoanAmount(uint256 policyId) public view returns (uint256) {
        Policy storage policy = policies[policyId];
        if (policy.id == 0 || !policy.active || policy.totalPaid == 0) return 0;
        uint256 surrenderValue = (policy.totalPaid * policy.maturityRefundRate) / 100;
        return (surrenderValue * maxLoanRatio) / 100;
    }

    /**
     * @dev 현재 대출 이자 조회 (단순 이자)
     */
    function getCurrentInterest(uint256 policyId) public view returns (uint256) {
        PolicyLoan storage loan = policyLoans[policyId];
        if (!loan.active || loan.loanAmount == 0) return 0;
        uint256 elapsed = block.timestamp - loan.borrowedAt;
        // 단순 이자: 원금 × 연이율(bps) × 경과초 / (365일 × 10000)
        return (loan.loanAmount * loan.interestRate * elapsed) / (365 days * 10000);
    }

    /**
     * @dev 현재 상환해야 할 총 금액 (원금 + 이자)
     */
    function getLoanRepayAmount(uint256 policyId) external view returns (uint256 principal, uint256 interest, uint256 total) {
        PolicyLoan storage loan = policyLoans[policyId];
        if (!loan.active) return (0, 0, 0);
        principal = loan.loanAmount;
        interest  = getCurrentInterest(policyId);
        total     = principal + interest;
    }

    /**
     * @dev 약관대출 신청 (피보험자)
     *      대출 한도: 해지환급금(totalPaid × refundRate%)의 maxLoanRatio%
     */
    function requestPolicyLoan(uint256 policyId, uint256 amount) external nonReentrant {
        Policy storage policy = _ownedActivePolicy(policyId);
        require(policy.totalPaid > 0,          "No premiums paid yet");
        require(!policyLoans[policyId].active, "Existing loan not repaid");

        uint256 maxAmount = getMaxLoanAmount(policyId);
        require(maxAmount > 0,         "Surrender value is zero");
        require(amount > 0,            "Loan amount must be > 0");
        require(amount <= maxAmount,   "Exceeds max loan amount");
        _requireBalance(amount);

        policyLoans[policyId] = PolicyLoan({
            policyId:     policyId,
            loanAmount:   amount,
            borrowedAt:   block.timestamp,
            interestRate: loanInterestRate,
            active:       true
        });

        require(stablecoin.transfer(msg.sender, amount), "Transfer failed");
        emit PolicyLoanTaken(policyId, msg.sender, amount, block.timestamp);
    }

    /**
     * @dev 약관대출 상환 (피보험자) — 원금 + 이자 전액 일시 상환
     *      사전에 USDC approve 필요
     */
    function repayPolicyLoan(uint256 policyId) external nonReentrant {
        PolicyLoan storage loan = _loanForRepay(policyId);

        uint256 principal = loan.loanAmount;
        uint256 interest  = getCurrentInterest(policyId);
        uint256 total     = principal + interest;

        require(
            stablecoin.transferFrom(msg.sender, address(this), total),
            "Insufficient allowance"
        );

        loan.active      = false;
        loan.loanAmount  = 0;

        emit PolicyLoanRepaid(policyId, msg.sender, principal, interest, block.timestamp);
    }

    /**
     * @dev 약관대출 부분 상환 (피보험자) — 발생 이자는 항상 전액 먼저 충당하고,
     *      초과분은 원금 상환에 사용. 원금이 0이 되면 대출이 자동으로 종료됨.
     *      상환 후 이자 계산 시점(borrowedAt)이 지금으로 갱신되어 남은 원금 기준으로 새로 이자가 붙음.
     *      사전에 USDC approve 필요
     */
    function repayPolicyLoanPartial(uint256 policyId, uint256 amount) external nonReentrant {
        PolicyLoan storage loan = _loanForRepay(policyId);
        require(amount > 0, "Amount must be > 0");

        uint256 interest = getCurrentInterest(policyId);
        require(amount >= interest, "Must cover accrued interest");
        uint256 total = loan.loanAmount + interest;
        require(amount <= total, "Exceeds total owed");

        require(
            stablecoin.transferFrom(msg.sender, address(this), amount),
            "Insufficient allowance"
        );

        uint256 principalPaid = amount - interest;
        loan.loanAmount -= principalPaid;
        loan.borrowedAt  = block.timestamp;
        if (loan.loanAmount == 0) {
            loan.active = false;
        }

        emit PolicyLoanRepaid(policyId, msg.sender, principalPaid, interest, block.timestamp);
    }

    /**
     * @dev 상환 함수 공용 검증 (활성 대출 + 본인 확인)
     */
    function _loanForRepay(uint256 policyId) internal view returns (PolicyLoan storage loan) {
        loan = policyLoans[policyId];
        require(loan.active, "No active loan for this policy");
        require(policies[policyId].patient == msg.sender, "Not the policy holder");
    }

    /**
     * @dev 대출 이자율 변경 (관리자, basis points 단위)
     */
    function setLoanInterestRate(uint256 bps) external onlyOwner {
        require(bps <= 3000, "Rate cannot exceed 30%");
        loanInterestRate = bps;
    }

    /**
     * @dev 씬파일러 유연납입 대상 여부 소급 설정 (관리자 전용)
     */
    function setFlexiblePayment(uint256 policyId, bool enabled) external onlyOwner {
        require(policies[policyId].id != 0, "Policy not found");
        policies[policyId].flexiblePayment = enabled;
        emit FlexiblePaymentSet(policyId, enabled);
    }

    /**
     * @dev 유연납입 대상 증권의 연체 보험료를 약관대출로 자동 대환한다 (관리자/스케줄러 전용).
     *      실제 토큰 이체 없이 해지환급금 한도 내에서 대출을 일으켜 납입을 대신 처리한다.
     *      requestPolicyLoan과 동일하게 기존 활성 대출이 있으면(상환 전) 사용할 수 없다 —
     *      단순이자 계산이 borrowedAt 단일 시점 기준이라 대출 중첩을 지원하지 않기 때문.
     *      getMaxLoanAmount는 totalPaid>0을 요구하므로 최초 납입 전에는 적용되지 않는다.
     */
    function autoCoverArrearsWithLoan(uint256 policyId) external onlyOwner nonReentrant {
        Policy storage policy = _activePolicy(policyId);
        require(policy.flexiblePayment, "Flexible payment not enabled");
        require(block.timestamp >= policy.nextDueTime, "Premium not yet due");
        require(!policyLoans[policyId].active, "Existing loan not repaid");

        uint256 amount = policy.monthlyPremium;
        require(getMaxLoanAmount(policyId) >= amount, "Exceeds max loan amount");

        policyLoans[policyId] = PolicyLoan({
            policyId:     policyId,
            loanAmount:   amount,
            borrowedAt:   block.timestamp,
            interestRate: loanInterestRate,
            active:       true
        });

        policy.totalPaid       += amount;
        policy.lastPaymentTime  = block.timestamp;
        policy.nextDueTime      = block.timestamp + policy.premiumInterval;
        totalPremiumsCollected += amount;

        emit PremiumPaid(policyId, policy.patient, amount, policy.totalPaid, block.timestamp);
        emit ArrearsCoveredByLoan(policyId, amount, block.timestamp);
    }

    /**
     * @dev 웰니스(건강개선) 연동 보험료 조정 (오라클 전용) — 최초 보험료(baselinePremiumAmount)의
     *      ±20% 범위 내에서만 조정 가능하도록 제한해 드리프트를 방지한다.
     */
    function applyWellnessAdjustment(uint256 policyId, uint256 newPremiumAmount, string calldata reason) external onlyOracle {
        Policy storage policy = _activePolicy(policyId);
        require(policy.baselinePremiumAmount > 0, "No baseline premium");
        uint256 minAmount = (policy.baselinePremiumAmount * 80) / 100;
        uint256 maxAmount = (policy.baselinePremiumAmount * 120) / 100;
        require(newPremiumAmount >= minAmount && newPremiumAmount <= maxAmount, "Out of adjustment range");

        uint256 oldAmount = policy.monthlyPremium;
        policy.monthlyPremium = newPremiumAmount;
        emit WellnessPremiumAdjusted(policyId, oldAmount, newPremiumAmount, reason, block.timestamp);
    }

    /**
     * @dev 재보험풀 주소 설정 (관리자 전용). address(0)이면 ceding 비활성화.
     */
    function setReinsurancePool(address _pool) external onlyOwner {
        reinsurancePool = _pool;
        emit ReinsurancePoolSet(_pool);
    }

    /**
     * @dev 보험료 수취 시 재보험풀로 넘길 비율 설정 (관리자 전용, 최대 30%)
     */
    function setCedingBps(uint256 bps) external onlyOwner {
        require(bps <= 3000, "Ceding cannot exceed 30%");
        cedingBps = bps;
        emit CedingBpsSet(bps);
    }

    /**
     * @dev payPremium/collectPremium 공용 — 실제 토큰이 유입된 보험료에 한해서만 호출한다
     *      (autoCoverArrearsWithLoan처럼 토큰 이체가 없는 내부 대환 경로에서는 호출 금지 —
     *      유입되지 않은 자금을 재보험풀로 내보내면 컨트랙트 지급여력이 훼손된다).
     */
    function _cedeToPool(uint256 policyId, uint256 amount) internal {
        if (reinsurancePool == address(0) || cedingBps == 0) return;
        uint256 cut = (amount * cedingBps) / 10000;
        if (cut == 0) return;
        require(stablecoin.transfer(reinsurancePool, cut), "Ceding transfer failed");
        emit PremiumCededToPool(policyId, cut, block.timestamp);
    }

    /**
     * @dev 보험증권 비활성화 (관리자 전용)
     */
    function deactivatePolicy(uint256 policyId) external onlyOwner {
        require(policies[policyId].id != 0, "Policy not found");
        policies[policyId].active = false;
        emit PolicyDeactivated(policyId, block.timestamp);
    }

    /**
     * @dev 자동이체(납입) 주기 변경 (관리자 전용, 초 단위). 다음 납입 기한도 즉시 재계산됨.
     */
    function setPremiumInterval(uint256 policyId, uint256 intervalSeconds) external onlyOwner {
        Policy storage policy = policies[policyId];
        require(policy.id != 0, "Policy not found");
        require(intervalSeconds > 0, "Interval must be > 0");
        policy.premiumInterval = intervalSeconds;
        policy.nextDueTime     = block.timestamp + intervalSeconds;
    }

    uint256 public constant PREMIUM_INTERVAL_TEST      = 5 minutes; // 테스트 전용 — 추후 삭제 예정
    uint256 public constant PREMIUM_INTERVAL_MONTHLY   = 30 days;
    uint256 public constant PREMIUM_INTERVAL_QUARTERLY = 90 days;

    /**
     * @dev 피보험자 본인이 자동이체 주기를 선택 (5분/1개월/3개월 중 택1). 관리자 승인 불필요, 즉시 적용.
     */
    function setMyPremiumInterval(uint256 policyId, uint256 intervalSeconds) external {
        Policy storage policy = policies[policyId];
        require(policy.patient == msg.sender, "Not the policy holder");
        require(
            intervalSeconds == PREMIUM_INTERVAL_TEST ||
            intervalSeconds == PREMIUM_INTERVAL_MONTHLY ||
            intervalSeconds == PREMIUM_INTERVAL_QUARTERLY,
            "Invalid interval"
        );
        policy.premiumInterval = intervalSeconds;
        policy.nextDueTime     = block.timestamp + intervalSeconds;
    }

    /**
     * @dev 만기일 변경 (관리자 전용)
     */
    function setMaturityDate(uint256 policyId, uint256 newMaturityDate) external onlyOwner {
        Policy storage policy = policies[policyId];
        require(policy.id != 0, "Policy not found");
        require(!policy.maturityPaid, "Maturity already paid");
        require(newMaturityDate > block.timestamp, "Maturity must be in future");
        policy.maturityDate = newMaturityDate;
    }

    uint256 public constant MATURITY_OPTION_TEST     = 5 minutes; // 테스트 전용 — 추후 삭제 예정
    uint256 public constant MATURITY_OPTION_DAILY     = 1 days;
    uint256 public constant MATURITY_OPTION_MONTHLY   = 30 days;
    uint256 public constant MATURITY_OPTION_QUARTERLY = 90 days;
    uint256 public constant MATURITY_OPTION_YEARLY    = 365 days;

    /**
     * @dev 피보험자 본인이 만기 시점을 선택 (5분/1일/1개월/3개월/1년 중 택1). 관리자 승인 불필요, 즉시 적용.
     */
    function setMyMaturityInterval(uint256 policyId, uint256 intervalSeconds) external {
        Policy storage policy = policies[policyId];
        require(policy.patient == msg.sender, "Not the policy holder");
        require(!policy.maturityPaid, "Maturity already paid");
        require(
            intervalSeconds == MATURITY_OPTION_TEST ||
            intervalSeconds == MATURITY_OPTION_DAILY ||
            intervalSeconds == MATURITY_OPTION_MONTHLY ||
            intervalSeconds == MATURITY_OPTION_QUARTERLY ||
            intervalSeconds == MATURITY_OPTION_YEARLY,
            "Invalid interval"
        );
        policy.maturityDate = block.timestamp + intervalSeconds;
    }

    /**
     * @dev 컨트랙트에 준비금 입금 (관리자 전용)
     */
    function depositFunds(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit FundsDeposited(msg.sender, amount, block.timestamp);
    }

    // ─────────────────────────────────────────
    //  Patient: Premium Payment
    // ─────────────────────────────────────────

    /**
     * @dev 보험료 납입 (피보험자)
     *      사전에 USDC approve 필요
     */
    function payPremium(uint256 policyId) external nonReentrant {
        Policy storage policy = _ownedActivePolicy(policyId);

        uint256 amount = policy.monthlyPremium;
        require(
            stablecoin.transferFrom(msg.sender, address(this), amount),
            "Insufficient allowance"
        );

        policy.totalPaid       += amount;
        policy.lastPaymentTime  = block.timestamp;
        policy.nextDueTime      = block.timestamp + policy.premiumInterval;
        totalPremiumsCollected += amount;

        emit PremiumPaid(policyId, msg.sender, amount, policy.totalPaid, block.timestamp);
        _cedeToPool(policyId, amount);
    }

    // ─────────────────────────────────────────
    //  Patient: Claim Submission
    // ─────────────────────────────────────────

    /**
     * @dev 보장한도 내인지 확인 후 누적 지급액 갱신 (오라클 자동지급/payClaim 공용)
     */
    function _accrueClaim(Policy storage policy, uint256 amount) internal {
        require(policy.totalClaimed + amount <= policy.coverageLimit, "Exceeds coverage limit");
        policy.totalClaimed += amount;
    }

    /**
     * @dev 컨트랙트가 amount만큼 지급할 잔액이 있는지 확인 (공용)
     */
    function _requireBalance(uint256 amount) internal view {
        require(stablecoin.balanceOf(address(this)) >= amount, "Insufficient contract balance");
    }

    // 보장한도의 20% 이하 소액 청구는 오라클·관리자 승인 없이 즉시 자동 지급
    uint256 public constant AUTO_CLAIM_APPROVAL_PERCENT = 20;

    /**
     * @dev 소액 청구 자동 승인+지급 (submitClaim 공용)
     */
    function _autoPayClaim(Claim storage claim, Policy storage policy) internal {
        _accrueClaim(policy, claim.amount);
        _requireBalance(claim.amount);
        claim.status      = ClaimStatus.Paid;
        claim.processedAt = block.timestamp;
        totalClaimsPaid   += claim.amount;
        require(stablecoin.transfer(claim.patient, claim.amount), "USDC transfer failed");
        emit ClaimApproved(claim.id, claim.policyId, claim.amount, block.timestamp);
        emit ClaimPaid(claim.id, claim.policyId, claim.patient, claim.amount, block.timestamp);
    }

    /**
     * @dev 보험금 청구 제출 (피보험자)
     * @param policyId 보험증권 ID
     * @param amount 청구 금액 (USDC, 6 decimals)
     * @param treatmentCode 치료 코드 (예: D0120=정기검진, D2140=아말감충전)
     * @param description 치료 상세 설명
     */
    function submitClaim(
        uint256 policyId,
        uint256 amount,
        string  calldata treatmentCode,
        string  calldata description
    ) external returns (uint256) {
        Policy storage policy = _ownedActivePolicy(policyId);
        require(policy.totalPaid > 0,          "No premiums paid yet");
        require(amount > 0,                   "Claim amount must be > 0");
        require(policy.totalClaimed + amount <= policy.coverageLimit, "Exceeds coverage limit");
        require(bytes(treatmentCode).length > 0, "Treatment code required");

        uint256 claimId = nextClaimId++;

        claims[claimId] = Claim({
            id:            claimId,
            policyId:      policyId,
            patient:       msg.sender,
            amount:        amount,
            treatmentCode: treatmentCode,
            description:   description,
            status:        ClaimStatus.Pending,
            submittedAt:   block.timestamp,
            processedAt:   0,
            rejectReason:  ""
        });

        _patientClaims[msg.sender].push(claimId);
        _allClaimIds.push(claimId);
        totalClaimsSubmitted++;

        emit ClaimSubmitted(claimId, policyId, msg.sender, amount, treatmentCode, block.timestamp);

        // 오라클 모드 ON + 보장한도 20% 이하 소액 청구만 즉시 자동 승인+지급.
        // 오라클 모드 OFF면 20% 이하도 대기(Pending) → 관리자 수동 심사 필요.
        if (oracleModeEnabled && amount <= (policy.coverageLimit * AUTO_CLAIM_APPROVAL_PERCENT) / 100) {
            _autoPayClaim(claims[claimId], policy);
        }

        return claimId;
    }

    // ─────────────────────────────────────────
    //  Admin: Claim Processing
    // ─────────────────────────────────────────

    /**
     * @dev 보험금 청구 승인 (관리자 전용)
     */
    function approveClaim(uint256 claimId) external onlyOwner {
        Claim storage claim = _pendingClaim(claimId);

        claim.status      = ClaimStatus.Approved;
        claim.processedAt = block.timestamp;

        emit ClaimApproved(claimId, claim.policyId, claim.amount, block.timestamp);
    }

    /**
     * @dev 청구 ID로 대기중(Pending) 청구 조회 (approveClaim/rejectClaim 공용)
     */
    function _pendingClaim(uint256 claimId) internal view returns (Claim storage claim) {
        claim = claims[claimId];
        require(claim.id != 0,                       "Claim not found");
        require(claim.status == ClaimStatus.Pending, "Claim not in pending status");
    }

    /**
     * @dev 보험금 청구 거절 (관리자 전용)
     */
    function rejectClaim(uint256 claimId, string calldata reason) external onlyOwner {
        Claim storage claim = _pendingClaim(claimId);

        claim.status       = ClaimStatus.Rejected;
        claim.processedAt  = block.timestamp;
        claim.rejectReason = reason;

        emit ClaimRejected(claimId, claim.policyId, reason, block.timestamp);
    }

    /**
     * @dev 보험금 지급 실행 (관리자 전용)
     *      승인된 청구건에 대해 USDC 지급
     */
    function payClaim(uint256 claimId) external onlyOwner nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.id != 0,                         "Claim not found");
        require(claim.status == ClaimStatus.Approved,  "Claim not approved");

        _accrueClaim(policies[claim.policyId], claim.amount);
        _requireBalance(claim.amount);

        claim.status = ClaimStatus.Paid;
        totalClaimsPaid += claim.amount;

        require(
            stablecoin.transfer(claim.patient, claim.amount),
            "USDC transfer failed"
        );

        emit ClaimPaid(claimId, claim.policyId, claim.patient, claim.amount, block.timestamp);
    }

    // ─────────────────────────────────────────
    //  Maturity Refund
    // ─────────────────────────────────────────

    /**
     * @dev 만기환급금 지급 (관리자 전용, 자동 워처 전용 경로)
     *      만기일 도달 + 미지급 상태인 증권에 대해서만 지급 가능.
     *      maturity-watcher.js가 이 함수를 호출하므로 "자동 워처 = 진짜 만기
     *      도달"이라는 의미를 유지하기 위해 만기 조건을 그대로 둔다.
     */
    function processMaturityRefund(uint256 policyId) external onlyOwner nonReentrant {
        _payMaturityRefund(policyId, true);
    }

    /**
     * @dev 관리자 조기(수동) 만기환급 지급 (2026-09-19 추가)
     *      보험료가 한 번이라도 납입된 증권이라면, 만기 도래 여부와 무관하게
     *      관리자 재량으로 즉시 지급 가능 - 프론트엔드 "수동 만기환급 지급"
     *      전용 경로. 자동 워처(processMaturityRefund)는 영향받지 않음.
     */
    function adminPayMaturityRefund(uint256 policyId) external onlyOwner nonReentrant {
        _payMaturityRefund(policyId, false);
    }

    function _payMaturityRefund(uint256 policyId, bool requireMatured) internal {
        Policy storage policy = _activePolicy(policyId);
        require(!policy.maturityPaid,         "Maturity refund already paid");
        if (requireMatured) {
            require(block.timestamp >= policy.maturityDate, "Policy not yet matured");
        }
        require(policy.totalPaid > 0,         "No premiums paid");

        uint256 refundAmount = (policy.totalPaid * policy.maturityRefundRate) / 100;
        require(refundAmount > 0,             "Refund amount is 0");

        PolicyLoan storage loan = policyLoans[policyId];
        if (loan.active) {
            uint256 principal = loan.loanAmount;
            uint256 interest  = getCurrentInterest(policyId);
            uint256 loanTotal = principal + interest;

            refundAmount = loanTotal >= refundAmount ? 0 : refundAmount - loanTotal;

            loan.active     = false;
            loan.loanAmount = 0;
            emit PolicyLoanRepaid(policyId, policy.patient, principal, interest, block.timestamp);
        }

        _requireBalance(refundAmount);

        policy.maturityPaid = true;
        policy.active       = false;

        if (refundAmount > 0) {
            require(stablecoin.transfer(policy.patient, refundAmount), "Transfer failed");
        }

        emit MaturityRefundPaid(policyId, policy.patient, refundAmount, block.timestamp);
        emit PolicyDeactivated(policyId, block.timestamp);
    }

    // ─────────────────────────────────────────
    //  Auto Premium Collection
    // ─────────────────────────────────────────

    /**
     * @dev 자동 보험료 수납 (관리자 전용)
     *      피보험자가 이 컨트랙트에 충분한 USDC approve를 미리 해둔 경우에만 성공
     *      납입 기한(nextDueTime) 도달 후에만 실행 가능
     */
    function collectPremium(uint256 policyId) external onlyOwner nonReentrant {
        Policy storage policy = _activePolicy(policyId);
        require(block.timestamp >= policy.nextDueTime, "Premium not yet due");

        uint256 amount = policy.monthlyPremium;
        require(
            stablecoin.allowance(policy.patient, address(this)) >= amount,
            "Insufficient allowance"
        );
        require(
            stablecoin.balanceOf(policy.patient) >= amount,
            "Insufficient patient balance"
        );
        require(
            stablecoin.transferFrom(policy.patient, address(this), amount),
            "Auto-collection failed"
        );

        policy.totalPaid       += amount;
        policy.lastPaymentTime  = block.timestamp;
        policy.nextDueTime      = block.timestamp + policy.premiumInterval;
        totalPremiumsCollected += amount;

        emit PremiumPaid(policyId, policy.patient, amount, policy.totalPaid, block.timestamp);
        emit PremiumAutoCollected(policyId, policy.patient, amount, policy.totalPaid, block.timestamp);
        _cedeToPool(policyId, amount);
    }

    /**
     * @dev 납입 기한 도달 여부 조회
     */
    function isDue(uint256 policyId) external view returns (bool) {
        Policy storage policy = policies[policyId];
        return (
            policy.id != 0 &&
            policy.active &&
            block.timestamp >= policy.nextDueTime
        );
    }

    /**
     * @dev 만기 도달 여부 조회
     */
    function isMatured(uint256 policyId) external view returns (bool) {
        Policy storage policy = policies[policyId];
        return (
            policy.id != 0 &&
            policy.active &&
            !policy.maturityPaid &&
            policy.totalPaid > 0 &&
            block.timestamp >= policy.maturityDate
        );
    }

    // ─────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return claims[claimId];
    }

    function getPatientPolicies(address patient) external view returns (uint256[] memory) {
        return _patientPolicies[patient];
    }

    function getPatientClaims(address patient) external view returns (uint256[] memory) {
        return _patientClaims[patient];
    }

    function getAllPolicyIds() external view returns (uint256[] memory) {
        return _allPolicyIds;
    }

    function getAllClaimIds() external view returns (uint256[] memory) {
        return _allClaimIds;
    }

    function getContractBalance() external view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }

    // ─── Application View ──────────────────────────────────────

    function getApplication(uint256 appId) external view returns (Application memory) {
        return applications[appId];
    }

    function getAllApplicationIds() external view returns (uint256[] memory) {
        return _allApplicationIds;
    }

    function getApplicantApplications(address applicant) external view returns (uint256[] memory) {
        return _applicantApplications[applicant];
    }

    // ─── Policy Loan View ──────────────────────────────────────

    function getPolicyLoan(uint256 policyId) external view returns (PolicyLoan memory) {
        return policyLoans[policyId];
    }

    function getStats() external view returns (
        uint256 premiumsCollected,
        uint256 claimsPaid,
        uint256 contractBalance,
        uint256 policiesCount,
        uint256 claimsCount
    ) {
        return (
            totalPremiumsCollected,
            totalClaimsPaid,
            stablecoin.balanceOf(address(this)),
            totalPoliciesCreated,
            totalClaimsSubmitted
        );
    }
}
