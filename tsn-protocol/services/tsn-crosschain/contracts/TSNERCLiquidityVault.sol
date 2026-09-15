// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title TSNERCLiquidityVault
/// @notice Prefunded destination-chain stablecoin liquidity for one executor.
/// @dev The executor is the only account allowed to release funds. Ownership
///      can fund or withdraw unused liquidity, but cannot bypass executor checks
///      through the payout path.
contract TSNERCLiquidityVault is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public executor;

    error InvalidConfiguration();
    error UnauthorizedExecutor();
    error InsufficientLiquidity(uint256 requested, uint256 available);

    event LiquidityFunded(address indexed funder, uint256 amount, uint256 newBalance);
    event LiquidityReleased(address indexed recipient, uint256 amount, bytes32 indexed settlementId);
    event LiquidityWithdrawn(address indexed recipient, uint256 amount);
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);

    constructor(address initialOwner, address token_, address executor_)
        Ownable(initialOwner)
    {
        if (token_ == address(0) || executor_ == address(0)) revert InvalidConfiguration();
        token = IERC20(token_);
        executor = executor_;
    }

    function fund(uint256 amount) external {
        if (amount == 0) revert InvalidConfiguration();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit LiquidityFunded(msg.sender, amount, token.balanceOf(address(this)));
    }

    function release(address recipient, uint256 amount, bytes32 settlementId) external onlyExecutor {
        if (recipient == address(0) || amount == 0) revert InvalidConfiguration();
        uint256 available = token.balanceOf(address(this));
        if (available < amount) revert InsufficientLiquidity(amount, available);
        token.safeTransfer(recipient, amount);
        emit LiquidityReleased(recipient, amount, settlementId);
    }

    function setExecutor(address nextExecutor) external onlyOwner {
        if (nextExecutor == address(0)) revert InvalidConfiguration();
        emit ExecutorUpdated(executor, nextExecutor);
        executor = nextExecutor;
    }

    function withdraw(address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0) || amount > token.balanceOf(address(this))) {
            revert InsufficientLiquidity(amount, token.balanceOf(address(this)));
        }
        token.safeTransfer(recipient, amount);
        emit LiquidityWithdrawn(recipient, amount);
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert UnauthorizedExecutor();
        _;
    }
}
