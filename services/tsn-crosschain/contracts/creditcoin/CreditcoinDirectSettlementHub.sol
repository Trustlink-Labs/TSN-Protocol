// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {CreditcoinDirectLiquidityRegistry} from "./CreditcoinDirectLiquidityRegistry.sol";
import {CreditcoinDirectSettlementExecutor} from "./CreditcoinDirectSettlementExecutor.sol";

/// @title CreditcoinDirectSettlementHub
/// @notice Direct Creditcoin destination lane for a Solana-origin debit.
/// @dev It consumes a signed Solana commitment and pays only from a registered
///      prefunded Creditcoin stablecoin vault.
contract CreditcoinDirectSettlementHub {
    using ECDSA for bytes32;

    bytes32 public constant SOLANA_NETWORK = keccak256("solana-devnet");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256("PayoutAuthorization(bytes32 settlementId,bytes32 sourceNetwork,bytes32 sealedTipHeadHash,bytes32 tinHash,bytes32 exitCommitment,bytes32 routeId,bytes32 destinationNetwork,address destinationExecutor,address token,address recipient,uint256 amount,uint256 feeAmount,uint256 nonce,uint256 deadline,bool merchantOverride)");
    bytes32 private constant NAME_HASH = keccak256("TSN Creditcoin Direct Settlement Hub");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable authorizationSigner;
    CreditcoinDirectLiquidityRegistry public immutable routeRegistry;
    mapping(bytes32 => bool) public processedSettlements;
    mapping(uint256 => bool) public usedNonces;

    struct PayoutAuthorization {
        bytes32 settlementId; bytes32 sourceNetwork; bytes32 sealedTipHeadHash; bytes32 tinHash;
        bytes32 exitCommitment; bytes32 routeId; bytes32 destinationNetwork; address destinationExecutor;
        address token; address recipient; uint256 amount; uint256 feeAmount; uint256 nonce;
        uint256 deadline; bool merchantOverride;
    }

    error Unauthorized();
    error InvalidAuthorization();
    error Expired();
    error Replay();
    error RouteNotExecutable();

    event DirectSettlementExecuted(bytes32 indexed settlementId, bytes32 indexed routeId, address indexed recipient, address token, uint256 amount, uint256 nonce);

    constructor(address signer_, address registry_) {
        if (signer_ == address(0) || registry_ == address(0)) revert InvalidAuthorization();
        authorizationSigner = signer_;
        routeRegistry = CreditcoinDirectLiquidityRegistry(registry_);
    }

    function executeSettlement(PayoutAuthorization calldata authorization, bytes calldata signature) external {
        if (block.timestamp > authorization.deadline) revert Expired();
        if (authorization.sourceNetwork != SOLANA_NETWORK || authorization.settlementId == bytes32(0) || authorization.routeId == bytes32(0)) revert InvalidAuthorization();
        if (authorization.sealedTipHeadHash == bytes32(0) || authorization.tinHash == bytes32(0) || authorization.exitCommitment == bytes32(0) || authorization.destinationNetwork == bytes32(0) || authorization.destinationExecutor == address(0) || authorization.token == address(0) || authorization.recipient == address(0) || authorization.amount == 0) revert InvalidAuthorization();
        if (processedSettlements[authorization.settlementId] || usedNonces[authorization.nonce]) revert Replay();
        if (_hashTypedData(authorization).recover(signature) != authorizationSigner) revert Unauthorized();

        CreditcoinDirectLiquidityRegistry.Route memory route = routeRegistry.getRoute(authorization.routeId);
        if (!route.enabled || route.destinationNetwork != authorization.destinationNetwork || route.destinationExecutor != authorization.destinationExecutor || route.token != authorization.token || route.destinationChainId != 102031) revert RouteNotExecutable();
        routeRegistry.reserveLiquidity(authorization.routeId, authorization.settlementId, authorization.amount);
        processedSettlements[authorization.settlementId] = true;
        usedNonces[authorization.nonce] = true;
        CreditcoinDirectSettlementExecutor(authorization.destinationExecutor).executePayout(authorization.settlementId, authorization.recipient, authorization.token, authorization.amount, authorization.nonce);
        emit DirectSettlementExecuted(authorization.settlementId, authorization.routeId, authorization.recipient, authorization.token, authorization.amount, authorization.nonce);
    }

    function domainSeparator() public view returns (bytes32) { return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))); }

    function _hashTypedData(PayoutAuthorization calldata authorization) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(AUTHORIZATION_TYPEHASH, authorization.settlementId, authorization.sourceNetwork, authorization.sealedTipHeadHash, authorization.tinHash, authorization.exitCommitment, authorization.routeId, authorization.destinationNetwork, authorization.destinationExecutor, authorization.token, authorization.recipient, authorization.amount, authorization.feeAmount, authorization.nonce, authorization.deadline, authorization.merchantOverride));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }
}
