// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TSNERCLiquidityVault} from "../TSNERCLiquidityVault.sol";

/// @title CreditcoinDirectSettlementExecutor
/// @notice Releases stablecoins from the Creditcoin vault to a Creditcoin user.
contract CreditcoinDirectSettlementExecutor {
    address public immutable settlementHub;
    TSNERCLiquidityVault public immutable liquidityVault;
    address public immutable settlementToken;

    error Unauthorized();
    error InvalidSettlement();

    event SettlementExecuted(bytes32 indexed settlementId, address indexed recipient, uint256 amount, uint256 nonce);

    constructor(address hub_, address vault_, address token_) {
        if (hub_ == address(0) || vault_ == address(0) || token_ == address(0)) revert InvalidSettlement();
        settlementHub = hub_;
        liquidityVault = TSNERCLiquidityVault(vault_);
        settlementToken = token_;
    }

    function executePayout(
        bytes32 settlementId,
        address recipient,
        address token,
        uint256 amount,
        uint256 nonce
    ) external {
        if (msg.sender != settlementHub) revert Unauthorized();
        if (settlementId == bytes32(0) || recipient == address(0) || token != settlementToken || amount == 0) {
            revert InvalidSettlement();
        }
        liquidityVault.release(recipient, amount, settlementId);
        emit SettlementExecuted(settlementId, recipient, amount, nonce);
    }
}
