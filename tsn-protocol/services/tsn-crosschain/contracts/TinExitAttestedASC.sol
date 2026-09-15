// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title TinExitAttestedASC
/// @notice Creditcoin receipt ASC for a proved TSN exit anchor.
/// @dev This follows the official ASCBase readability flow, with a local thin
///      wrapper so Ethereum Sepolia chainKey=1 is enforced on-chain.
contract TinExitAttestedASC {
    uint8 public constant ATTEST_EXIT_ACTION = 0;
    uint64 public constant ETHEREUM_SEPOLIA_CHAIN_KEY = 1;

    bytes32 public constant TIN_EXIT_ANCHORED_EVENT = keccak256(
        "TinExitAnchored(bytes32,bytes32,uint256,bytes32,bytes32)"
    );

    address public immutable sourceAnchor;
    INativeQueryVerifier public immutable VERIFIER;
    mapping(bytes32 => bool) public processedQueries;
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
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    /// @notice The only accepted source chain is Ethereum Sepolia on CC3 Testnet.
    function sourceChainKey() external pure returns (uint64) {
        return ETHEREUM_SEPOLIA_CHAIN_KEY;
    }

    /// @notice Verify a Sepolia transaction proof, deduplicate the query, and
    /// emit the optional TSN receipt. This mirrors the official ASCBase
    /// execute signature while enforcing chainKey=1 before verification.
    function execute(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        if (chainKey != ETHEREUM_SEPOLIA_CHAIN_KEY) {
            revert UnsupportedSourceChain(chainKey);
        }

        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);
        if (processedQueries[queryId]) revert("Query already processed");

        INativeQueryVerifier.MerkleProof memory merkleProof = INativeQueryVerifier.MerkleProof({
            root: merkleRoot,
            siblings: siblings
        });
        INativeQueryVerifier.ContinuityProof memory continuityProof = INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: lowerEndpointDigest,
            roots: continuityRoots
        });

        bool verified = VERIFIER.verifyAndEmit(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleProof,
            continuityProof
        );
        require(verified, "Proof of inclusion verification failed");
        processedQueries[queryId] = true;
        _processAndEmitEvent(action, queryId, encodedTransaction);
        return true;
    }

    function _computeQueryId(
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings
    ) internal view returns (bytes32 queryId) {
        INativeQueryVerifier.MerkleProof memory merkleProof = INativeQueryVerifier.MerkleProof({
            root: merkleRoot,
            siblings: siblings
        });
        uint256 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
    }

    function _processAndEmitEvent(
        uint8 action,
        bytes32 queryId,
        bytes memory encodedTransaction
    ) internal {
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
