// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {DestinationLiquidityRegistry} from "./DestinationLiquidityRegistry.sol";

interface IAttestcoinOutbox {
    function publishMessage(bool canAck, bytes calldata payload) external returns (bytes32 messageId);
}

/// @title CreditcoinSettlementHub
/// @notice Creditcoin settlement layer for TSN's authenticated Attestcoin
///         destination payout messages.
/// @dev This contract does not custody or directly pay destination stablecoins.
///      It verifies the Node authorization, binds the registered route and
///      destination executor, then publishes the exact payload through the
///      official Attestcoin Outbox. The destination Inbox delivers the message
///      to that network's TSNSettlementExecutor and local liquidity vault.
contract CreditcoinSettlementHub {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    bytes32 public constant SOLANA_NETWORK = keccak256("solana-devnet");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "PayoutAuthorization(bytes32 settlementId,bytes32 sourceNetwork,bytes32 sealedTipHeadHash,bytes32 tinHash,bytes32 exitCommitment,bytes32 routeId,bytes32 destinationNetwork,address destinationExecutor,address token,address recipient,uint256 amount,uint256 feeAmount,uint256 nonce,uint256 deadline,bool merchantOverride)"
    );
    bytes32 private constant NAME_HASH = keccak256("TSN Creditcoin Settlement Hub");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public owner;
    address public authorizationSigner;
    IERC20 public immutable attestToken;
    DestinationLiquidityRegistry public immutable routeRegistry;
    bool public paused;

    mapping(bytes32 => bool) public processedSettlements;
    mapping(uint256 => bool) public usedNonces;

    error Unauthorized();
    error Paused();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error Replay(bytes32 settlementId, uint256 nonce);
    error RouteNotExecutable(bytes32 routeId);
    error InvalidAttestToken();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AuthorizationSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event AttestcoinFeesFunded(address indexed funder, uint256 amount, uint256 newBalance);
    event AttestcoinApprovalUpdated(address indexed outbox, uint256 amount);
    event SettlementMessagePublished(
        bytes32 indexed settlementId,
        bytes32 indexed routeId,
        bytes32 indexed messageId,
        address destinationExecutor,
        address token,
        address recipient,
        uint256 amount,
        uint256 nonce
    );

    struct PayoutAuthorization {
        bytes32 settlementId;
        bytes32 sourceNetwork;
        bytes32 sealedTipHeadHash;
        bytes32 tinHash;
        bytes32 exitCommitment;
        bytes32 routeId;
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
        address signer,
        address attestToken_,
        address registry_
    ) {
        if (signer == address(0) || attestToken_ == address(0) || registry_ == address(0)) {
            revert InvalidAuthorization();
        }
        owner = msg.sender;
        authorizationSigner = signer;
        attestToken = IERC20(attestToken_);
        routeRegistry = DestinationLiquidityRegistry(registry_);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function fundAttestcoinFees(uint256 amount) external {
        if (amount == 0) revert InvalidAttestToken();
        attestToken.safeTransferFrom(msg.sender, address(this), amount);
        emit AttestcoinFeesFunded(msg.sender, amount, attestToken.balanceOf(address(this)));
    }

    function approveOutbox(address outbox, uint256 amount) external onlyOwner {
        if (outbox == address(0)) revert InvalidAttestToken();
        attestToken.forceApprove(outbox, amount);
        emit AttestcoinApprovalUpdated(outbox, amount);
    }

    function executeSettlement(
        PayoutAuthorization calldata authorization,
        bytes calldata signature
    ) external returns (bytes32 messageId) {
        if (paused) revert Paused();
        if (block.timestamp > authorization.deadline) revert AuthorizationExpired();
        if (authorization.sourceNetwork != SOLANA_NETWORK) revert InvalidAuthorization();
        if (authorization.settlementId == bytes32(0) || authorization.routeId == bytes32(0)) {
            revert InvalidAuthorization();
        }
        if (
            authorization.sealedTipHeadHash == bytes32(0) ||
            authorization.tinHash == bytes32(0) ||
            authorization.exitCommitment == bytes32(0) ||
            authorization.destinationNetwork == bytes32(0) ||
            authorization.destinationExecutor == address(0) ||
            authorization.token == address(0) ||
            authorization.recipient == address(0) ||
            authorization.amount == 0
        ) revert InvalidAuthorization();
        if (processedSettlements[authorization.settlementId] || usedNonces[authorization.nonce]) {
            revert Replay(authorization.settlementId, authorization.nonce);
        }
        if (_hashTypedData(authorization).recover(signature) != authorizationSigner) revert Unauthorized();

        DestinationLiquidityRegistry.Route memory route = routeRegistry.getRoute(authorization.routeId);
        if (
            !route.enabled ||
            route.destinationChainId == 0 ||
            route.destinationExecutor == address(0) ||
            route.outbox == address(0) ||
            route.destinationExecutor != authorization.destinationExecutor ||
            route.token != authorization.token
        ) revert RouteNotExecutable(authorization.routeId);

        processedSettlements[authorization.settlementId] = true;
        usedNonces[authorization.nonce] = true;

        bytes memory payload = abi.encode(
            authorization.settlementId,
            authorization.sourceNetwork,
            authorization.sealedTipHeadHash,
            authorization.tinHash,
            authorization.exitCommitment,
            authorization.destinationNetwork,
            authorization.destinationExecutor,
            authorization.token,
            authorization.recipient,
            authorization.amount,
            authorization.feeAmount,
            authorization.nonce,
            authorization.deadline,
            authorization.merchantOverride
        );
        messageId = IAttestcoinOutbox(route.outbox).publishMessage(false, payload);
        emit SettlementMessagePublished(
            authorization.settlementId,
            authorization.routeId,
            messageId,
            authorization.destinationExecutor,
            authorization.token,
            authorization.recipient,
            authorization.amount,
            authorization.nonce
        );
    }

    function authorizationDigest(PayoutAuthorization calldata authorization) external view returns (bytes32) {
        return _hashTypedData(authorization);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function setAuthorizationSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert InvalidAuthorization();
        emit AuthorizationSignerUpdated(authorizationSigner, signer);
        authorizationSigner = signer;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
    }

    function withdrawAttestcoinFees(address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0) || amount > attestToken.balanceOf(address(this))) revert InvalidAttestToken();
        attestToken.safeTransfer(recipient, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert Unauthorized();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function _hashTypedData(PayoutAuthorization calldata authorization) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                AUTHORIZATION_TYPEHASH,
                authorization.settlementId,
                authorization.sourceNetwork,
                authorization.sealedTipHeadHash,
                authorization.tinHash,
                authorization.exitCommitment,
                authorization.routeId,
                authorization.destinationNetwork,
                authorization.destinationExecutor,
                authorization.token,
                authorization.recipient,
                authorization.amount,
                authorization.feeAmount,
                authorization.nonce,
                authorization.deadline,
                authorization.merchantOverride
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }
}
