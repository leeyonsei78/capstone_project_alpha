// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ParametricInsurance
 * @dev 파라메트릭(자동집행형) 보험 — 관찰값이 조건을 충족하면 청구 절차 없이
 *      오라클이 즉시 지급한다. DentalInsurance.sol의 Ownable+ReentrancyGuard+
 *      onlyOracle 패턴과 AltInvestmentFund.sol의 상품 레지스트리(addFund류) 패턴을
 *      그대로 재사용한다.
 *
 *      관찰값을 넣는 오라클(scripts/parametric-oracle-service.js)은 실제 항공사/
 *      기상청 API가 아니라 데모용 시뮬레이션이다 — 실 서비스 전환 시 그 스크립트만
 *      교체하면 되고 컨트랙트 인터페이스는 그대로 유지된다.
 */
contract ParametricInsurance is Ownable, ReentrancyGuard {
    IERC20 public immutable stablecoin;

    enum CoverageStatus { Active, Triggered, Expired }

    struct ProductInfo {
        string  name;                 // 예: "항공편 지연 보장"
        string  metricLabel;          // 예: "지연시간(분)"
        uint256 triggerThreshold;     // 이 값 이상 관측되면 트리거
        uint256 payoutAmount;         // 고정 지급액
        uint256 premium;              // 1회성 보험료
        uint256 coverageDurationSecs; // 구매 시점부터 관측 마감까지 유효기간
        bool    active;               // false면 신규 구매 불가(기존 커버리지엔 영향 없음)
    }

    struct Coverage {
        uint256 id;
        address holder;
        uint256 productId;
        uint256 purchaseTime;
        uint256 expiryTime;
        CoverageStatus status;
        uint256 observedValue;
        uint256 resolvedAt;
    }

    ProductInfo[] private _products;
    mapping(uint256 => Coverage) public coverages;
    uint256 public nextCoverageId = 1;
    uint256[] private _allCoverageIds;
    mapping(address => uint256[]) private _holderCoverages;

    uint256 public totalPremiumsCollected;
    uint256 public totalPayoutsPaid;

    address public oracleAddress;

    event ProductAdded(uint256 indexed productId, string name, string metricLabel, uint256 triggerThreshold, uint256 payoutAmount, uint256 premium, uint256 coverageDurationSecs);
    event ProductActiveSet(uint256 indexed productId, bool active);
    event OracleAddressSet(address indexed oracle);
    event FundsDeposited(address indexed depositor, uint256 amount, uint256 timestamp);
    event CoveragePurchased(uint256 indexed coverageId, address indexed holder, uint256 indexed productId, uint256 premium, uint256 expiryTime, uint256 timestamp);
    event CoverageResolved(uint256 indexed coverageId, CoverageStatus status, uint256 observedValue, uint256 payoutAmount, uint256 timestamp);

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
    //  관리자: 상품/오라클 관리
    // ─────────────────────────────────────────

    function addProduct(
        string calldata name,
        string calldata metricLabel,
        uint256 triggerThreshold,
        uint256 payoutAmount,
        uint256 premium,
        uint256 coverageDurationSecs
    ) external onlyOwner returns (uint256 productId) {
        require(payoutAmount > 0, "Payout must be > 0");
        require(premium > 0, "Premium must be > 0");
        require(coverageDurationSecs > 0, "Duration must be > 0");
        _products.push(ProductInfo(name, metricLabel, triggerThreshold, payoutAmount, premium, coverageDurationSecs, true));
        productId = _products.length - 1;
        emit ProductAdded(productId, name, metricLabel, triggerThreshold, payoutAmount, premium, coverageDurationSecs);
    }

    function setProductActive(uint256 productId, bool active) external onlyOwner {
        require(productId < _products.length, "Invalid product");
        _products[productId].active = active;
        emit ProductActiveSet(productId, active);
    }

    function setOracleAddress(address _oracle) external onlyOwner {
        oracleAddress = _oracle;
        emit OracleAddressSet(_oracle);
    }

    /**
     * @dev 지급 재원 시딩 (DentalInsurance.depositFunds와 동일 패턴)
     */
    function depositFunds(uint256 amount) external onlyOwner {
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit FundsDeposited(msg.sender, amount, block.timestamp);
    }

    // ─────────────────────────────────────────
    //  구매
    // ─────────────────────────────────────────

    function purchaseCoverage(uint256 productId) external nonReentrant returns (uint256 coverageId) {
        require(productId < _products.length, "Invalid product");
        ProductInfo storage product = _products[productId];
        require(product.active, "Product not active");

        require(stablecoin.transferFrom(msg.sender, address(this), product.premium), "Premium transfer failed");
        totalPremiumsCollected += product.premium;

        coverageId = nextCoverageId++;
        uint256 expiryTime = block.timestamp + product.coverageDurationSecs;
        coverages[coverageId] = Coverage({
            id:            coverageId,
            holder:        msg.sender,
            productId:     productId,
            purchaseTime:  block.timestamp,
            expiryTime:    expiryTime,
            status:        CoverageStatus.Active,
            observedValue: 0,
            resolvedAt:    0
        });
        _allCoverageIds.push(coverageId);
        _holderCoverages[msg.sender].push(coverageId);

        emit CoveragePurchased(coverageId, msg.sender, productId, product.premium, expiryTime, block.timestamp);
    }

    // ─────────────────────────────────────────
    //  오라클: 관측값 반영 → 트리거 판정
    // ─────────────────────────────────────────

    /**
     * @dev 오라클이 관측값을 제출한다. 만료 시각이 지났으면 Expired로 종료(지급 없음).
     *      관측값이 조건 충족이면 Triggered로 전환하고 즉시 지급. 조건 미충족이면
     *      Active 상태를 유지해(다음 관측을 기다림) 재호출 가능하게 한다.
     */
    function resolveCoverage(uint256 coverageId, uint256 observedValue) external onlyOracle nonReentrant {
        Coverage storage cov = coverages[coverageId];
        require(cov.id != 0, "Coverage not found");
        require(cov.status == CoverageStatus.Active, "Coverage already resolved");

        if (block.timestamp > cov.expiryTime) {
            cov.status        = CoverageStatus.Expired;
            cov.observedValue = observedValue;
            cov.resolvedAt    = block.timestamp;
            emit CoverageResolved(coverageId, CoverageStatus.Expired, observedValue, 0, block.timestamp);
            return;
        }

        ProductInfo storage product = _products[cov.productId];
        if (observedValue >= product.triggerThreshold) {
            require(stablecoin.balanceOf(address(this)) >= product.payoutAmount, "Insufficient contract balance");
            cov.status        = CoverageStatus.Triggered;
            cov.observedValue = observedValue;
            cov.resolvedAt    = block.timestamp;
            totalPayoutsPaid += product.payoutAmount;
            require(stablecoin.transfer(cov.holder, product.payoutAmount), "Payout transfer failed");
            emit CoverageResolved(coverageId, CoverageStatus.Triggered, observedValue, product.payoutAmount, block.timestamp);
        }
        // 조건 미충족 + 아직 만료 전: 상태 유지, 이벤트 없음(다음 관측을 기다림)
    }

    // ─────────────────────────────────────────
    //  조회
    // ─────────────────────────────────────────

    function getProducts() external view returns (ProductInfo[] memory) {
        return _products;
    }

    function getProduct(uint256 productId) external view returns (ProductInfo memory) {
        require(productId < _products.length, "Invalid product");
        return _products[productId];
    }

    function getProductCount() external view returns (uint256) {
        return _products.length;
    }

    function getCoverage(uint256 coverageId) external view returns (Coverage memory) {
        return coverages[coverageId];
    }

    function getHolderCoverages(address holder) external view returns (uint256[] memory) {
        return _holderCoverages[holder];
    }

    function getAllCoverageIds() external view returns (uint256[] memory) {
        return _allCoverageIds;
    }

    function getContractBalance() external view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }

    function getStats() external view returns (uint256 productCount, uint256 coverageCount, uint256 premiumsCollected, uint256 payoutsPaid) {
        return (_products.length, _allCoverageIds.length, totalPremiumsCollected, totalPayoutsPaid);
    }
}
