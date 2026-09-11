// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title TinExitAttestedASC
/// @notice Creditcoin receipt ASC for a proved TSN exit anchor.
/// @dev The inherited ASCBase performs Block Prover verification through 0x0FD2,
///      deduplicates proof query IDs, and then invokes this contract's handler.
contract TinExitAttestedASC is ASCBase {
    uint8 public constant ATTEST_EXIT_ACTION = 0;
    uint64 public constant ETHEREUM_SEPOLIA_CHAIN_KEY = 1;

    bytes32 public constant TIN_EXIT_ANCHORED_EVENT = keccak256(
        "TinExitAnchored(bytes32,bytes32,uint256,bytes32,bytes32)"
    );

    address public immutable sourceAnchor;
    mapping(bytes32 => bool) public processedSettlements;

    event TinExitAttested(
        bytes32 indexed sealedTipHeadHash,
        uint256 amount,
        bytes32 indexed tinHash,
        bytes32 indexed exitCommitment,
        bytes32 settlementId,
        bytes32 queryId
    );

    error InvalidAction(uint8 action);
    error WrongSourceAnchor(address actual);
    error InvalidAnchorLog();
    error UnsupportedSourceChain(uint64 chainKey);
    error SettlementAlreadyProcessed(bytes32 settlementId);

    constructor(address sourceAnchor_) {
        require(sourceAnchor_ != address(0), "source anchor is zero");
        sourceAnchor = sourceAnchor_;
    }

    /// @dev ASCBase's execute call supplies the source chain key to the native
    /// verifier. The worker must submit chain key 1 for Ethereum Sepolia; the
    /// verified anchor log and registered source emitter provide the contract
    /// binding. Source-chain policy is also exposed for deployment tooling.
    function sourceChainKey() external pure returns (uint64) {
        return ETHEREUM_SEPOLIA_CHAIN_KEY;
    }

    function _processAndEmitEvent(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal override {
        if (action != ATTEST_EXIT_ACTION) revert InvalidAction(action);

        EvmV1Decoder.ReceiptFields memory receipt =
            EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "source transaction failed");

        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, TIN_EXIT_ANCHORED_EVENT);
        if (logs.length == 0) revert InvalidAnchorLog();

        EvmV1Decoder.LogEntry memory log = logs[0];
        if (log.address_ != sourceAnchor) revert WrongSourceAnchor(log.address_);
        if (log.topics.length != 2) revert InvalidAnchorLog();

        bytes32 settlementId = log.topics[1];
        if (processedSettlements[settlementId]) {
            revert SettlementAlreadyProcessed(settlementId);
        }

        (
            bytes32 sealedTipHeadHash,
            uint256 amount,
            bytes32 tinHash,
            bytes32 exitCommitment
        ) = abi.decode(log.data, (bytes32, uint256, bytes32, bytes32));

        require(sealedTipHeadHash != bytes32(0), "sealed TIP hash is zero");
        require(amount > 0, "amount is zero");
        require(tinHash != bytes32(0), "TIN hash is zero");
        require(exitCommitment != bytes32(0), "exit commitment is zero");

        processedSettlements[settlementId] = true;
        emit TinExitAttested(
            sealedTipHeadHash,
            amount,
            tinHash,
            exitCommitment,
            settlementId,
            queryId
        );
    }
}
