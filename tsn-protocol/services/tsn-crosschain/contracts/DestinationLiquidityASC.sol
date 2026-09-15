// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {DestinationLiquidityRegistry} from "./DestinationLiquidityRegistry.sol";

/// @title DestinationLiquidityASC
/// @notice Verifies a supported EVM liquidity event on Creditcoin and records
///         the result in DestinationLiquidityRegistry.
/// @dev The ASC verifies source-chain evidence. It does not custody tokens or
///      assume that an arbitrary network is supported.
contract DestinationLiquidityASC {
    uint8 public constant LIQUIDITY_ACTION = 0;
    bytes32 public constant LIQUIDITY_AVAILABLE_EVENT = keccak256(
        "LiquidityAvailable(bytes32,address,uint256,uint256,uint256)"
    );

    DestinationLiquidityRegistry public immutable registry;
    INativeQueryVerifier public immutable verifier;
    mapping(bytes32 => bool) public processedQueries;

    error UnsupportedAction(uint8 action);
    error QueryAlreadyProcessed(bytes32 queryId);
    error InvalidProof();
    error UnknownRoute();
    error WrongEmitter(address actual);
    error WrongChain(uint64 actual, uint64 expected);
    error WrongToken(address actual);
    error InvalidLiquidityEvent();

    constructor(address registry_) {
        if (registry_ == address(0)) revert UnknownRoute();
        registry = DestinationLiquidityRegistry(registry_);
        verifier = NativeQueryVerifierLib.getVerifier();
    }

    /// @notice Verify one source-chain LiquidityAvailable event and record it.
    /// @param routeId Registered route whose source chain/emitter/token are checked.
    /// @param action Only LIQUIDITY_ACTION is accepted.
    /// @param chainKey Attestcoin source chain key for the registered route.
    /// @param blockHeight Source block containing the event.
    /// @param encodedTransaction EVM receipt/transaction bytes from USC proof builder.
    /// @param merkleRoot Merkle proof root.
    /// @param siblings Merkle proof siblings.
    /// @param lowerEndpointDigest Continuity proof lower endpoint.
    /// @param continuityRoots Continuity proof roots.
    function execute(
        bytes32 routeId,
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bytes32 queryId) {
        if (action != LIQUIDITY_ACTION) revert UnsupportedAction(action);
        DestinationLiquidityRegistry.Route memory route = registry.getRoute(routeId);
        if (!route.enabled) revert UnknownRoute();
        if (chainKey != route.sourceChainKey) revert WrongChain(chainKey, route.sourceChainKey);

        INativeQueryVerifier.MerkleProof memory merkleProof = INativeQueryVerifier.MerkleProof({
            root: merkleRoot,
            siblings: siblings
        });
        INativeQueryVerifier.ContinuityProof memory continuityProof = INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: lowerEndpointDigest,
            roots: continuityRoots
        });

        queryId = _computeQueryId(chainKey, blockHeight, merkleProof);
        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);
        bool verified = verifier.verifyAndEmit(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleProof,
            continuityProof
        );
        if (!verified) revert InvalidProof();
        processedQueries[queryId] = true;

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert InvalidLiquidityEvent();
        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, LIQUIDITY_AVAILABLE_EVENT);
        if (logs.length == 0) revert InvalidLiquidityEvent();
        EvmV1Decoder.LogEntry memory log = logs[0];
        if (log.address_ != route.sourceEmitter) revert WrongEmitter(log.address_);
        if (log.topics.length != 3) revert InvalidLiquidityEvent();

        bytes32 eventRouteId = log.topics[1];
        address eventToken = address(uint160(uint256(log.topics[2])));
        if (eventRouteId != routeId || eventToken != route.token) revert WrongToken(eventToken);

        (uint256 availableAmount, uint256 nonce, uint256 validUntil) =
            abi.decode(log.data, (uint256, uint256, uint256));
        if (availableAmount == 0 || validUntil <= block.timestamp) revert InvalidLiquidityEvent();

        registry.recordVerifiedLiquidity(
            routeId,
            queryId,
            availableAmount,
            blockHeight,
            validUntil,
            nonce
        );
    }

    function _computeQueryId(
        uint64 chainKey,
        uint64 blockHeight,
        INativeQueryVerifier.MerkleProof memory proof
    ) internal view returns (bytes32 queryId) {
        uint256 txIndex = verifier.calculateTxIndex(proof);
        queryId = keccak256(abi.encode(chainKey, blockHeight, txIndex, address(this)));
    }
}
