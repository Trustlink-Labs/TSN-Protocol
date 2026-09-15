// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MessageReceiverBase} from "@gluwa/asc-contracts/contracts/write-ability/abstract/MessageReceiverBase.sol";
import {TSNERCLiquidityVault} from "./TSNERCLiquidityVault.sol";

/// @title TSNSettlementExecutor
/// @notice Destination-chain executor for authenticated Creditcoin settlement
///         messages delivered by the official Attestcoin Inbox.
/// @dev This contract has no arbitrary pay(recipient, amount) entry point.
///      Only a trusted Inbox can call receiveMessage, and the message must be
///      emitted by the configured Creditcoin settlement contract and target this
///      exact executor, network, token, nonce, and recipient.
contract TSNSettlementExecutor is MessageReceiverBase {
    bytes32 public immutable destinationNetwork;
    uint256 public immutable creditcoinChainId;
    address public settlementEmitter;
    TSNERCLiquidityVault public immutable liquidityVault;
    address public immutable settlementToken;

    mapping(uint256 => bool) public usedNonces;

    error InvalidConfiguration();
    error InvalidSource(uint256 sourceChainId, address emitter);
    error InvalidSettlement();
    error Expired();
    error NonceReplay(uint256 nonce);

    event SettlementExecuted(
        bytes32 indexed messageId,
        bytes32 indexed settlementId,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 nonce
    );
    event SettlementEmitterUpdated(address indexed previousEmitter, address indexed newEmitter);

    struct SettlementMessage {
        bytes32 settlementId;
        bytes32 sourceNetwork;
        bytes32 sealedTipHeadHash;
        bytes32 tinHash;
        bytes32 exitCommitment;
        bytes32 destinationNetwork;
        address destinationExecutor;
        address token;
        address recipient;
        uint256 amount;
        uint256 feeAmount;
        uint256 nonce;
        uint256 deadline;
        bool merchantOverride;
    }

    constructor(
        address initialInbox,
        address initialOwner,
        uint256 creditcoinChainId_,
        address settlementEmitter_,
        bytes32 destinationNetwork_,
        address vault_,
        address token_
    ) MessageReceiverBase(initialInbox, initialOwner) {
        if (
            creditcoinChainId_ == 0 ||
            settlementEmitter_ == address(0) ||
            destinationNetwork_ == bytes32(0) ||
            vault_ == address(0) ||
            token_ == address(0)
        ) revert InvalidConfiguration();
        creditcoinChainId = creditcoinChainId_;
        settlementEmitter = settlementEmitter_;
        destinationNetwork = destinationNetwork_;
        liquidityVault = TSNERCLiquidityVault(vault_);
        settlementToken = token_;
    }

    function _processMessage(
        bytes32 messageId,
        uint256 sourceChainId,
        address emitterAddress,
        bytes calldata payload
    ) internal override {
        if (sourceChainId != creditcoinChainId || emitterAddress != settlementEmitter) {
            revert InvalidSource(sourceChainId, emitterAddress);
        }

        SettlementMessage memory settlement = abi.decode(payload, (SettlementMessage));
        if (
            settlement.settlementId == bytes32(0) ||
            settlement.sourceNetwork == bytes32(0) ||
            settlement.sealedTipHeadHash == bytes32(0) ||
            settlement.tinHash == bytes32(0) ||
            settlement.exitCommitment == bytes32(0) ||
            settlement.destinationNetwork != destinationNetwork ||
            settlement.destinationExecutor != address(this) ||
            settlement.token != settlementToken ||
            settlement.recipient == address(0) ||
            settlement.amount == 0
        ) revert InvalidSettlement();
        if (block.timestamp > settlement.deadline) revert Expired();
        if (usedNonces[settlement.nonce]) revert NonceReplay(settlement.nonce);

        usedNonces[settlement.nonce] = true;
        liquidityVault.release(settlement.recipient, settlement.amount, settlement.settlementId);
        emit SettlementExecuted(
            messageId,
            settlement.settlementId,
            settlement.recipient,
            settlement.token,
            settlement.amount,
            settlement.nonce
        );
    }

    function setSettlementEmitter(address nextEmitter) external onlyOwner {
        if (nextEmitter == address(0)) revert InvalidConfiguration();
        emit SettlementEmitterUpdated(settlementEmitter, nextEmitter);
        settlementEmitter = nextEmitter;
    }
}
