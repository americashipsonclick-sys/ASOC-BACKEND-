// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ASOC — America Ships On Click
/// @notice Polygon mint/stake token. Regular 1%/hr, premium 5%/hr (replaces 1%).
///         30-day sale/transfer lock after purchase. Hourly bonus budget is 7% of the
///         10% platform reserve (0.7% of volume). Claims above the budget are haircut.
contract ASOC is ERC20, Ownable, ReentrancyGuard {
    uint256 public constant LOCK_DURATION = 30 days;
    uint256 public constant HOUR = 1 hours;
    uint256 public constant REGULAR_RATE = 1;
    uint256 public constant PREMIUM_RATE = 5;
    uint256 private constant REWARD_INDEX_SCALE = 1e27;
    /// 70 / 10_000 = 0.7% of volume = 7% of a 10% reserve
    uint256 public constant SLICE_BPS = 70;
    uint256 public constant BPS_DENOM = 10_000;

    mapping(address => uint256) public lockedUntil;
    mapping(address => uint256) public staked;
    mapping(address => uint256) public rewardIndexPaid;
    mapping(address => uint256) public accrued;
    mapping(address => bool) public isPremium;
    mapping(bytes32 => bool) public processedPurchases;

    uint256 public totalStaked;
    uint256 public totalWeightedStake;
    uint256 public totalRewardLiability;
    uint256 public rewardBudget;
    uint256 public cumulativeVolume;
    uint256 public totalRewardsPaid;
    uint256 public rewardIndex;
    uint256 public lastGlobalAccrual;
    uint256 public messageFee = 0.01 ether;
    bool private _protocolMove;

    event Minted(
        address indexed to,
        uint256 amount,
        uint256 transactionVolume,
        bytes32 indexed purchaseId,
        uint256 lockedUntilTimestamp
    );
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event BonusClaimed(address indexed user, uint256 paid, uint256 haircut);
    event VolumeNotified(uint256 volume, uint256 sliceCredited);
    event PremiumSet(address indexed user, bool premium);
    event PaidMessage(address indexed from, address indexed to, bytes32 contentHash, uint256 fee);

    constructor() ERC20("America Ships On Click", "ASOC") Ownable(msg.sender) {
        lastGlobalAccrual = block.timestamp;
    }

    /// @notice Records a verified off-chain buy-in exactly once.
    /// @dev purchaseId must be the payment processor's immutable transaction id.
    function mintPurchase(
        address to,
        uint256 amount,
        uint256 transactionVolume,
        bytes32 purchaseId
    ) external onlyOwner {
        require(purchaseId != bytes32(0), "purchase id");
        require(!processedPurchases[purchaseId], "purchase processed");
        processedPurchases[purchaseId] = true;
        _purchaseMint(to, amount, transactionVolume, purchaseId);
    }

    function notifyVolume(uint256 volume) external onlyOwner {
        require(volume > 0, "volume");
        uint256 slice = _creditSlice(volume);
        emit VolumeNotified(volume, slice);
    }

    function setPremium(address user, bool premium) external onlyOwner {
        _accrue(user);
        uint256 oldWeight = _weight(user);
        isPremium[user] = premium;
        uint256 newWeight = _weight(user);
        totalWeightedStake = totalWeightedStake - oldWeight + newWeight;
        emit PremiumSet(user, premium);
    }

    function setMessageFee(uint256 fee) external onlyOwner {
        require(fee > 0, "fee");
        messageFee = fee;
    }

    /// @notice Small ASOC transfer to unlock a paid in-app message. Allowed during lock.
    function sendPaidMessage(address to, bytes32 contentHash) external nonReentrant {
        require(to != address(0) && to != msg.sender, "to");
        uint256 fee = messageFee;
        require(balanceOf(msg.sender) >= fee, "balance");
        _protocolMove = true;
        _transfer(msg.sender, to, fee);
        _protocolMove = false;
        emit PaidMessage(msg.sender, to, contentHash, fee);
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "zero");
        _accrue(msg.sender);
        _transfer(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        totalStaked += amount;
        totalWeightedStake += amount * _rate(msg.sender);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0 && amount <= staked[msg.sender], "bad amount");
        _accrue(msg.sender);
        totalWeightedStake -= amount * _rate(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        _transfer(address(this), msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claimBonus() external nonReentrant {
        _claim(msg.sender);
    }

    function previewAccrued(address user) external view returns (uint256) {
        uint256 currentIndex = rewardIndex;
        if (totalWeightedStake > 0 && block.timestamp > lastGlobalAccrual) {
            currentIndex +=
                ((block.timestamp - lastGlobalAccrual) * REWARD_INDEX_SCALE) /
                (100 * HOUR);
        }
        return accrued[user] + (_weight(user) * (currentIndex - rewardIndexPaid[user])) / REWARD_INDEX_SCALE;
    }

    function previewClaim(address user) external view returns (uint256 owed, uint256 paid, uint256 haircut) {
        owed = this.previewAccrued(user);
        uint256 liability = _previewLiability();
        paid = liability == 0 || rewardBudget >= liability
            ? owed
            : (owed * rewardBudget) / liability;
        haircut = owed - paid;
    }

    function _purchaseMint(
        address to,
        uint256 amount,
        uint256 transactionVolume,
        bytes32 purchaseId
    ) internal {
        require(to != address(0), "zero");
        require(amount > 0, "amount");
        require(transactionVolume > 0, "volume");
        uint256 until = block.timestamp + LOCK_DURATION;
        if (until > lockedUntil[to]) {
            lockedUntil[to] = until;
        }
        _mint(to, amount);
        uint256 slice = _creditSlice(transactionVolume);
        emit Minted(to, amount, transactionVolume, purchaseId, lockedUntil[to]);
        emit VolumeNotified(transactionVolume, slice);
    }

    function _creditSlice(uint256 volume) internal returns (uint256 slice) {
        slice = (volume * SLICE_BPS) / BPS_DENOM;
        cumulativeVolume += volume;
        rewardBudget += slice;
    }

    function _rate(address user) internal view returns (uint256) {
        return isPremium[user] ? PREMIUM_RATE : REGULAR_RATE;
    }

    function _weight(address user) internal view returns (uint256) {
        return staked[user] * _rate(user);
    }

    function _previewLiability() internal view returns (uint256) {
        if (totalWeightedStake == 0 || block.timestamp <= lastGlobalAccrual) {
            return totalRewardLiability;
        }
        return
            totalRewardLiability +
            (totalWeightedStake * (block.timestamp - lastGlobalAccrual)) /
            (100 * HOUR);
    }

    function _accrueGlobal() internal {
        uint256 elapsed = block.timestamp - lastGlobalAccrual;
        if (elapsed == 0) return;
        if (totalWeightedStake > 0) {
            rewardIndex += (elapsed * REWARD_INDEX_SCALE) / (100 * HOUR);
            totalRewardLiability += (totalWeightedStake * elapsed) / (100 * HOUR);
        }
        lastGlobalAccrual = block.timestamp;
    }

    function _accrue(address user) internal {
        _accrueGlobal();
        uint256 indexDelta = rewardIndex - rewardIndexPaid[user];
        if (indexDelta > 0) {
            accrued[user] += (_weight(user) * indexDelta) / REWARD_INDEX_SCALE;
            rewardIndexPaid[user] = rewardIndex;
        }
    }

    function _claim(address user) internal {
        _accrue(user);
        uint256 owed = accrued[user];
        if (owed == 0) return;
        uint256 liability = totalRewardLiability;
        uint256 paid = liability == 0 || rewardBudget >= liability
            ? owed
            : (owed * rewardBudget) / liability;
        uint256 haircut = owed - paid;
        accrued[user] = 0;
        totalRewardLiability -= owed;
        rewardBudget -= paid;
        if (paid > 0) {
            totalRewardsPaid += paid;
            require(
                totalRewardsPaid <= (cumulativeVolume * SLICE_BPS) / BPS_DENOM,
                "reward slice exceeded"
            );
            _mint(user, paid);
        }
        emit BonusClaimed(user, paid, haircut);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && !_protocolMove) {
            bool staking = to == address(this);
            bool unstaking = from == address(this);
            if (!staking && !unstaking) {
                require(block.timestamp >= lockedUntil[from], "locked 30 days");
            }
        }
        super._update(from, to, value);
    }
}
