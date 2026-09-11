// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Driver payouts in USDC
/// @notice Pays the driver and writes plate, load ID, miles, rate, reserve on the same tx.
contract DriverPayout is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    mapping(address => bool) public payers;

    event DriverPaid(
        address indexed driver,
        uint256 usdcAmount,
        string plate,
        string loadId,
        uint256 miles,
        uint256 rate,
        uint256 reserve
    );

    constructor(address usdc_) Ownable(msg.sender) {
        require(usdc_ != address(0), "usdc");
        usdc = IERC20(usdc_);
        payers[msg.sender] = true;
    }

    function setPayer(address who, bool allowed) external onlyOwner {
        payers[who] = allowed;
    }

    function payOnDelivery(
        address driver,
        uint256 usdcAmount,
        string calldata plate,
        string calldata loadId,
        uint256 miles,
        uint256 rate,
        uint256 reserve
    ) external nonReentrant {
        require(payers[msg.sender], "not payer");
        require(driver != address(0), "driver");
        require(bytes(plate).length > 0, "plate");
        require(bytes(loadId).length > 0, "loadId");
        if (usdcAmount > 0) {
            usdc.safeTransfer(driver, usdcAmount);
        }
        emit DriverPaid(driver, usdcAmount, plate, loadId, miles, rate, reserve);
    }

    function recover(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
