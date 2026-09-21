// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @dev MockUSDC/MockKRW의 테스트 전용 파우셋 — ReserveFund.sol과 동일하게, 이자만큼
 *      실제 토큰을 발행해 포지션 잔액이 항상 실제 토큰 보유량으로 뒷받침되도록 한다.
 */
interface IFaucetToken {
    function faucet(uint256 amount) external;
}

/**
 * @dev ReinsurancePool.sol의 최소 인터페이스 — "리스크연동형" 펀드가 내부적으로
 *      이 풀에 예치/인출을 대행해주기 위해서만 필요한 4개 함수만 가져온다.
 */
interface IReinsurancePool {
    function deposit(uint256 amount) external;
    function withdraw(uint256 shareAmount) external;
    function totalAssets() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function shares(address investor) external view returns (uint256);
}

/**
 * @title AltInvestmentFund
 * @dev ReserveFund(연 5% 고정 준비금 계좌) 옆에 두는 "대체투자형" 상품. 관리자가 등록한
 *      여러 펀드(부동산 리츠·인프라·PE 등) 중 하나를 골라 투자한다. ReserveFund보다 APR이
 *      높은 대신 락업 기간이 있고, 락업 이전 인출은 페널티가 붙는다 — 대체투자 고유의
 *      "고수익-저유동성" 트레이드오프를 시뮬레이션한다.
 *
 *      설계 단순화: 한 (투자자, 펀드) 쌍에 포지션을 하나만 두고, 추가 투자 시 락업을
 *      block.timestamp 기준으로 다시 시작한다(트랜치별 개별 락업 관리는 하지 않음).
 */
contract AltInvestmentFund is Ownable, ReentrancyGuard {
    IERC20 public immutable stablecoin;

    uint256 public constant BPS_DENOM     = 10000;
    uint256 public constant DAYS_PER_YEAR = 365;

    // ReserveFund.sol과 동일한 이유로 이자 발행(faucet)을 청크 단위로 나눔 —
    // MockUSDC의 1회 파우셋 상한(10,000 USDC)을 넘지 않도록 함.
    uint256 public immutable faucetChunkSize;

    struct FundInfo {
        string  name;                  // 예: "프라임오피스 리츠 펀드"
        string  assetClass;            // 예: "상업용 부동산 리츠"
        uint256 aprBps;                 // 연 수익률 (bps, 100 = 1%) — riskLinked=true면 미사용(0)
        uint256 lockupDays;             // 락업 기간(일)
        uint256 earlyExitPenaltyBps;    // 조기 해지 시 인출액에 적용되는 페널티 (bps)
        bool    active;                 // false면 신규 투자 불가(기존 포지션엔 영향 없음)
        bool    riskLinked;             // true면 고정APR이 아니라 linkedPool의 실제 지분가치를 따라감
        address linkedPool;             // riskLinked=true일 때만 사용 — ReinsurancePool 주소
    }

    struct Position {
        uint256 principal;
        uint256 lastAccrualTime;
        uint256 depositTime;            // 락업 판정 기준 — 투자 시마다 리셋됨
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 totalInterestEarned;
        bool    exists;
    }

    FundInfo[] private _funds;
    mapping(address => mapping(uint256 => Position)) private _positions;
    address[] private _holders;
    mapping(address => bool) private _isHolder;

    // riskLinked 펀드 전용 — 이 컨트랙트가 ReinsurancePool에서 보유한 지분 중
    // 투자자별 몫을 추적한다 (Position.principal은 riskLinked 펀드에선 사용하지 않음).
    mapping(address => mapping(uint256 => uint256)) private _riskLinkedShares;

    event FundCreated(uint256 indexed fundId, string name, string assetClass, uint256 aprBps, uint256 lockupDays, uint256 earlyExitPenaltyBps);
    event FundActiveSet(uint256 indexed fundId, bool active);
    event Invested(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 newPrincipal, uint256 unlockTime, uint256 timestamp);
    event Withdrawn(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 newPrincipal, uint256 timestamp);
    event EarlyWithdrawn(address indexed investor, uint256 indexed fundId, uint256 amount, uint256 penalty, uint256 payout, uint256 newPrincipal, uint256 timestamp);
    event InterestAccrued(address indexed investor, uint256 indexed fundId, uint256 interestAmount, uint256 newPrincipal, uint256 timestamp);

    constructor(address _stablecoin) Ownable(msg.sender) {
        require(_stablecoin != address(0), "Invalid stablecoin address");
        stablecoin = IERC20(_stablecoin);
        uint8 dec = IERC20Metadata(_stablecoin).decimals();
        faucetChunkSize = dec == 0 ? type(uint256).max : 5000 * (10 ** uint256(dec));
    }

    /**
     * @dev 이자만큼 실제 토큰을 발행 — 파우셋 1회 상한을 넘지 않도록 필요한 만큼
     *      나눠서 호출한다 (_accrue 전용).
     */
    function _fundInterest(uint256 amount) internal {
        IFaucetToken token = IFaucetToken(address(stablecoin));
        uint256 remaining = amount;
        while (remaining > 0) {
            uint256 take = remaining > faucetChunkSize ? faucetChunkSize : remaining;
            token.faucet(take);
            remaining -= take;
        }
    }

    /**
     * @dev 펀드별 APR을 매일 복리로 적용한 원금을 계산한다 (일 단위 반복 계산).
     */
    function _compound(uint256 principal, uint256 aprBps, uint256 daysElapsed) internal pure returns (uint256) {
        for (uint256 i = 0; i < daysElapsed; i++) {
            principal += (principal * aprBps) / (BPS_DENOM * DAYS_PER_YEAR);
        }
        return principal;
    }

    /**
     * @dev 경과일만큼 이자를 실제로 원금에 반영(확정)한다.
     */
    function _accrue(address investor, uint256 fundId) internal {
        Position storage pos = _positions[investor][fundId];
        if (!pos.exists || pos.principal == 0) return;
        uint256 daysElapsed = (block.timestamp - pos.lastAccrualTime) / 1 days;
        if (daysElapsed == 0) return;

        uint256 newPrincipal = _compound(pos.principal, _funds[fundId].aprBps, daysElapsed);
        uint256 interest     = newPrincipal - pos.principal;
        if (interest > 0) {
            pos.principal            = newPrincipal;
            pos.totalInterestEarned += interest;
            _fundInterest(interest);
            emit InterestAccrued(investor, fundId, interest, newPrincipal, block.timestamp);
        }
        pos.lastAccrualTime += daysElapsed * 1 days;
    }

    // ─────────────────────────────────────────────────────────────
    // 관리자: 펀드 관리
    // ─────────────────────────────────────────────────────────────

    function addFund(
        string calldata name,
        string calldata assetClass,
        uint256 aprBps,
        uint256 lockupDays,
        uint256 earlyExitPenaltyBps
    ) external onlyOwner returns (uint256 fundId) {
        require(earlyExitPenaltyBps <= BPS_DENOM, "Penalty too high");
        _funds.push(FundInfo(name, assetClass, aprBps, lockupDays, earlyExitPenaltyBps, true, false, address(0)));
        fundId = _funds.length - 1;
        emit FundCreated(fundId, name, assetClass, aprBps, lockupDays, earlyExitPenaltyBps);
    }

    /**
     * @dev "리스크연동형" 펀드 등록 — 고정 APR 대신 ReinsurancePool(pool)의 실제
     *      지분가치를 그대로 물려받는다. 기존 고정APR 펀드는 전혀 건드리지 않고
     *      나란히 추가되는 두 번째 상품 유형이다.
     */
    function addRiskLinkedFund(
        string calldata name,
        string calldata assetClass,
        address pool,
        uint256 lockupDays,
        uint256 earlyExitPenaltyBps
    ) external onlyOwner returns (uint256 fundId) {
        require(pool != address(0), "Invalid pool");
        require(earlyExitPenaltyBps <= BPS_DENOM, "Penalty too high");
        _funds.push(FundInfo(name, assetClass, 0, lockupDays, earlyExitPenaltyBps, true, true, pool));
        fundId = _funds.length - 1;
        emit FundCreated(fundId, name, assetClass, 0, lockupDays, earlyExitPenaltyBps);
    }

    function setFundActive(uint256 fundId, bool active) external onlyOwner {
        require(fundId < _funds.length, "Invalid fund");
        _funds[fundId].active = active;
        emit FundActiveSet(fundId, active);
    }

    // ─────────────────────────────────────────────────────────────
    // 투자 / 인출
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev 펀드에 투자. 신규 포지션이면 락업이 이제 시작되고, 기존 포지션에 추가
     *      투자하면 이자를 먼저 확정한 뒤 원금을 더하고 락업을 처음부터 다시 시작한다.
     */
    function invest(uint256 fundId, uint256 amount) external nonReentrant {
        require(fundId < _funds.length, "Invalid fund");
        FundInfo storage fund = _funds[fundId];
        require(fund.active, "Fund not active");
        require(amount > 0, "Amount must be > 0");

        if (!_isHolder[msg.sender]) {
            _isHolder[msg.sender] = true;
            _holders.push(msg.sender);
        }

        if (fund.riskLinked) {
            _investRiskLinked(msg.sender, fundId, amount);
            return;
        }

        Position storage pos = _positions[msg.sender][fundId];
        if (!pos.exists) {
            pos.exists          = true;
            pos.lastAccrualTime = block.timestamp;
        } else {
            _accrue(msg.sender, fundId);
        }

        require(stablecoin.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        pos.principal      += amount;
        pos.totalDeposited += amount;
        pos.depositTime      = block.timestamp;

        emit Invested(msg.sender, fundId, amount, pos.principal, pos.depositTime + fund.lockupDays * 1 days, block.timestamp);
    }

    /**
     * @dev riskLinked 펀드 투자 — 받은 스테이블코인을 그대로 ReinsurancePool에
     *      예치(deposit)하고, 그 대가로 이 컨트랙트가 받은 지분 중 이번에 새로
     *      늘어난 몫을 투자자에게 내부적으로 배정한다.
     */
    function _investRiskLinked(address investor, uint256 fundId, uint256 amount) internal {
        FundInfo storage fund = _funds[fundId];
        IReinsurancePool pool = IReinsurancePool(fund.linkedPool);

        require(stablecoin.transferFrom(investor, address(this), amount), "Transfer failed");

        uint256 sharesBefore = pool.shares(address(this));
        require(stablecoin.approve(address(pool), amount), "Approve failed");
        pool.deposit(amount);
        uint256 minted = pool.shares(address(this)) - sharesBefore;
        require(minted > 0, "No shares minted");

        Position storage pos = _positions[investor][fundId];
        if (!pos.exists) pos.exists = true;
        _riskLinkedShares[investor][fundId] += minted;
        pos.totalDeposited += amount;
        pos.depositTime      = block.timestamp;

        emit Invested(investor, fundId, amount, _riskLinkedShares[investor][fundId], pos.depositTime + fund.lockupDays * 1 days, block.timestamp);
    }

    /**
     * @dev 락업이 경과한 뒤 정상 인출 (페널티 없음).
     */
    function withdraw(uint256 fundId, uint256 amount) external nonReentrant {
        require(fundId < _funds.length, "Invalid fund");
        require(!_funds[fundId].riskLinked, "Use withdrawRiskLinked for this fund");
        Position storage pos = _positions[msg.sender][fundId];
        require(pos.exists, "No position");
        require(block.timestamp >= pos.depositTime + _funds[fundId].lockupDays * 1 days, "Still locked up");

        _accrue(msg.sender, fundId);
        require(amount > 0 && amount <= pos.principal, "Invalid amount");

        pos.principal      -= amount;
        pos.totalWithdrawn += amount;
        require(stablecoin.transfer(msg.sender, amount), "Transfer failed");
        emit Withdrawn(msg.sender, fundId, amount, pos.principal, block.timestamp);
    }

    /**
     * @dev 락업 여부와 무관하게 즉시 해지. 이자는 정상 확정하되, 인출액에
     *      earlyExitPenaltyBps만큼 페널티를 적용해 그만큼 적은 금액만 지급한다
     *      (페널티분은 컨트랙트에 남아 손실을 시뮬레이션).
     */
    function earlyWithdraw(uint256 fundId, uint256 amount) external nonReentrant {
        require(fundId < _funds.length, "Invalid fund");
        require(!_funds[fundId].riskLinked, "Use earlyWithdrawRiskLinked for this fund");
        Position storage pos = _positions[msg.sender][fundId];
        require(pos.exists, "No position");

        _accrue(msg.sender, fundId);
        require(amount > 0 && amount <= pos.principal, "Invalid amount");

        uint256 penalty = (amount * _funds[fundId].earlyExitPenaltyBps) / BPS_DENOM;
        uint256 payout  = amount - penalty;

        pos.principal      -= amount;
        pos.totalWithdrawn += amount;
        require(stablecoin.transfer(msg.sender, payout), "Transfer failed");
        emit EarlyWithdrawn(msg.sender, fundId, amount, penalty, payout, pos.principal, block.timestamp);
    }

    /**
     * @dev riskLinked 펀드의 락업 경과 후 정상 인출 — 인자는 스테이블코인 금액이
     *      아니라 이 컨트랙트가 ReinsurancePool에서 대신 들고 있는 "지분 수량"이다
     *      (previewRiskLinkedPosition으로 현재 가치를 먼저 조회해 필요한 지분을 계산).
     */
    function withdrawRiskLinked(uint256 fundId, uint256 poolShareAmount) external nonReentrant {
        require(fundId < _funds.length, "Invalid fund");
        FundInfo storage fund = _funds[fundId];
        require(fund.riskLinked, "Not a risk-linked fund");
        Position storage pos = _positions[msg.sender][fundId];
        require(pos.exists, "No position");
        require(block.timestamp >= pos.depositTime + fund.lockupDays * 1 days, "Still locked up");
        require(poolShareAmount > 0 && poolShareAmount <= _riskLinkedShares[msg.sender][fundId], "Invalid share amount");

        uint256 payout = _redeemFromPool(fund.linkedPool, poolShareAmount);
        _riskLinkedShares[msg.sender][fundId] -= poolShareAmount;
        pos.totalWithdrawn += payout;

        require(stablecoin.transfer(msg.sender, payout), "Transfer failed");
        emit Withdrawn(msg.sender, fundId, payout, _riskLinkedShares[msg.sender][fundId], block.timestamp);
    }

    /**
     * @dev riskLinked 펀드의 락업 무관 즉시 해지 — 실제로 돌려받은 금액에서
     *      fund.earlyExitPenaltyBps만큼 추가 페널티를 뗀다(이미 실제 리스크로
     *      가치가 줄어든 상태일 수 있는 것과는 별개로, 조기해지 억제 목적).
     */
    function earlyWithdrawRiskLinked(uint256 fundId, uint256 poolShareAmount) external nonReentrant {
        require(fundId < _funds.length, "Invalid fund");
        FundInfo storage fund = _funds[fundId];
        require(fund.riskLinked, "Not a risk-linked fund");
        Position storage pos = _positions[msg.sender][fundId];
        require(pos.exists, "No position");
        require(poolShareAmount > 0 && poolShareAmount <= _riskLinkedShares[msg.sender][fundId], "Invalid share amount");

        uint256 redeemed = _redeemFromPool(fund.linkedPool, poolShareAmount);
        uint256 penalty  = (redeemed * fund.earlyExitPenaltyBps) / BPS_DENOM;
        uint256 payout   = redeemed - penalty;

        _riskLinkedShares[msg.sender][fundId] -= poolShareAmount;
        pos.totalWithdrawn += redeemed;

        require(stablecoin.transfer(msg.sender, payout), "Transfer failed");
        emit EarlyWithdrawn(msg.sender, fundId, redeemed, penalty, payout, _riskLinkedShares[msg.sender][fundId], block.timestamp);
    }

    function _redeemFromPool(address poolAddr, uint256 poolShareAmount) internal returns (uint256 received) {
        IReinsurancePool pool = IReinsurancePool(poolAddr);
        uint256 balBefore = stablecoin.balanceOf(address(this));
        pool.withdraw(poolShareAmount);
        received = stablecoin.balanceOf(address(this)) - balBefore;
    }

    // ─────────────────────────────────────────────────────────────
    // 조회
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev 미확정 이자까지 포함한 현재 예상 잔액 + 락업 해제 시각 조회 (상태 변경 없음)
     */
    function previewPosition(address investor, uint256 fundId)
        external view returns (uint256 projectedPrincipal, uint256 pendingInterest, uint256 unlockTime)
    {
        require(!_funds[fundId].riskLinked, "Use previewRiskLinkedPosition for this fund");
        Position memory pos = _positions[investor][fundId];
        if (!pos.exists) return (0, 0, 0);
        uint256 daysElapsed = (block.timestamp - pos.lastAccrualTime) / 1 days;
        projectedPrincipal = _compound(pos.principal, _funds[fundId].aprBps, daysElapsed);
        pendingInterest     = projectedPrincipal - pos.principal;
        unlockTime          = pos.depositTime + _funds[fundId].lockupDays * 1 days;
    }

    /**
     * @dev riskLinked 펀드 전용 조회 — 이 투자자가 내부적으로 배정받은 풀 지분 수량과,
     *      그 지분의 "지금 이 순간" 스테이블코인 환산가치(청구로 줄었을 수도 있음)를 반환.
     */
    function previewRiskLinkedPosition(address investor, uint256 fundId)
        external view returns (uint256 poolShareBalance, uint256 currentValue, uint256 unlockTime)
    {
        FundInfo memory fund = _funds[fundId];
        require(fund.riskLinked, "Not a risk-linked fund");
        poolShareBalance = _riskLinkedShares[investor][fundId];
        if (poolShareBalance > 0) {
            IReinsurancePool pool = IReinsurancePool(fund.linkedPool);
            uint256 poolTotalShares = pool.totalShares();
            currentValue = poolTotalShares == 0 ? 0 : (poolShareBalance * pool.totalAssets()) / poolTotalShares;
        }
        Position memory pos = _positions[investor][fundId];
        unlockTime = pos.depositTime + fund.lockupDays * 1 days;
    }

    function getRiskLinkedShares(address investor, uint256 fundId) external view returns (uint256) {
        return _riskLinkedShares[investor][fundId];
    }

    function getFunds() external view returns (FundInfo[] memory) {
        return _funds;
    }

    function getFund(uint256 fundId) external view returns (FundInfo memory) {
        require(fundId < _funds.length, "Invalid fund");
        return _funds[fundId];
    }

    function getFundCount() external view returns (uint256) {
        return _funds.length;
    }

    function getPosition(address investor, uint256 fundId) external view returns (Position memory) {
        return _positions[investor][fundId];
    }

    function getAllHolders() external view returns (address[] memory) {
        return _holders;
    }

    function getContractBalance() external view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }
}
