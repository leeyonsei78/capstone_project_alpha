// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReinsurancePool
 * @dev 외부 투자자(LP)가 스테이블코인을 예치해 DentalInsurance의 보험료 수입 중
 *      일부(cedingBps, DentalInsurance.sol의 _cedeToPool)를 나눠 받는 지분형
 *      유동성 풀 — 실제 재보험(reinsurance) 구조를 단순화해 시뮬레이션한다.
 *
 *      AltInvestmentFund.sol("고정 APR을 관리자가 정해서 지급하는 가짜 투자")와는
 *      근본적으로 다르다: 여기서는 지분가치가 DentalInsurance의 실제 보험료 유입
 *      (PremiumCededToPool)에 의해서만 오르고, 청구가 몰려 drawForClaim으로
 *      풀 자산이 빠져나가면 지분가치가 실제로 줄어든다 — LP가 진짜 보험 리스크를
 *      나눠지는 구조다.
 *
 *      drawForClaim은 컨트랙트 간 자동 신뢰 연결 없이 관리자가 두 단계로 수동
 *      중개한다: ① 이 풀에서 관리자 지갑으로 인출 → ② 관리자가 그 자금을
 *      DentalInsurance.depositFunds()로 재입금. 자동화하지 않은 이유는 임의
 *      컨트랙트가 이 풀에서 자금을 끌어갈 수 있는 새로운 신뢰 경로를 만들지
 *      않기 위함이다.
 */
contract ReinsurancePool is Ownable, ReentrancyGuard {
    IERC20 public immutable stablecoin;

    mapping(address => uint256) public shares;
    uint256 public totalShares;

    address[] private _holders;
    mapping(address => bool) private _isHolder;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalDrawnForClaims;

    event Deposited(address indexed investor, uint256 amount, uint256 sharesMinted, uint256 newShares, uint256 timestamp);
    event Withdrawn(address indexed investor, uint256 shareAmount, uint256 amountPaid, uint256 newShares, uint256 timestamp);
    event ClaimDrawUsed(address indexed to, uint256 amount, uint256 timestamp);

    constructor(address _stablecoin) Ownable(msg.sender) {
        require(_stablecoin != address(0), "Invalid stablecoin address");
        stablecoin = IERC20(_stablecoin);
    }

    function totalAssets() public view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }

    /**
     * @dev 스테이블코인 예치 → 현재 지분가치(totalAssets/totalShares) 기준으로 지분 발행.
     *      최초 예치자는 1:1로 지분을 받는다.
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        uint256 assetsBefore = totalAssets();
        uint256 minted = totalShares == 0 ? amount : (amount * totalShares) / assetsBefore;
        require(minted > 0, "Amount too small for current share price");

        require(stablecoin.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (!_isHolder[msg.sender]) {
            _isHolder[msg.sender] = true;
            _holders.push(msg.sender);
        }

        shares[msg.sender] += minted;
        totalShares         += minted;
        totalDeposited      += amount;

        emit Deposited(msg.sender, amount, minted, shares[msg.sender], block.timestamp);
    }

    /**
     * @dev 지분 소각 → 현재 풀 자산 대비 비율만큼 스테이블코인 반환.
     *      청구 지급으로 풀 자산이 줄어든 상태라면 예치 원금보다 적게 돌려받을 수 있다
     *      (실제 재보험 리스크 부담을 그대로 반영).
     */
    function withdraw(uint256 shareAmount) external nonReentrant {
        require(shareAmount > 0 && shareAmount <= shares[msg.sender], "Invalid share amount");

        uint256 amount = (shareAmount * totalAssets()) / totalShares;
        require(amount > 0 && amount <= totalAssets(), "Insufficient pool liquidity");

        shares[msg.sender] -= shareAmount;
        totalShares         -= shareAmount;
        totalWithdrawn      += amount;

        require(stablecoin.transfer(msg.sender, amount), "Transfer failed");
        emit Withdrawn(msg.sender, shareAmount, amount, shares[msg.sender], block.timestamp);
    }

    /**
     * @dev 청구 지급 재원이 부족할 때 관리자가 풀에서 인출해 DentalInsurance에
     *      재입금하기 위한 수동 백스톱 (관리자 전용, 2단계 수동 플로우의 1단계).
     */
    function drawForClaim(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0 && amount <= totalAssets(), "Insufficient pool balance");
        totalDrawnForClaims += amount;
        require(stablecoin.transfer(msg.sender, amount), "Transfer failed");
        emit ClaimDrawUsed(msg.sender, amount, block.timestamp);
    }

    // ─────────────────────────────────────────
    //  조회
    // ─────────────────────────────────────────

    function previewShareValue(address investor) external view returns (uint256 shareBalance, uint256 assetValue) {
        shareBalance = shares[investor];
        if (totalShares == 0 || shareBalance == 0) return (shareBalance, 0);
        assetValue = (shareBalance * totalAssets()) / totalShares;
    }

    function getHolders() external view returns (address[] memory) {
        return _holders;
    }

    function getContractBalance() external view returns (uint256) {
        return totalAssets();
    }

    function getPoolStats() external view returns (uint256 assets, uint256 shareSupply, uint256 holderCount) {
        return (totalAssets(), totalShares, _holders.length);
    }
}
