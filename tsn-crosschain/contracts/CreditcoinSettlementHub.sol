// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CreditcoinSettlementHub
/// @notice Creditcoin-first stablecoin reserve and payout receipt for TSN exits.
/// @dev Native CTC is used by the Cranker for gas. Settlement value is the
///      configured ERC-20 stablecoin held by this contract.
contract CreditcoinSettlementHub {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    bytes32 public constant CREDITCOIN_NETWORK = keccak256("creditcoin-testnet");
    bytes32 public constant SOLANA_NETWORK = keccak256("solana-devnet");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "PayoutAuthorization(bytes32 settlementId,bytes32 sourceNetwork,bytes32 sealedTipHeadHash,bytes32 tinHash,bytes32 exitCommitment,bytes32 destinationNetwork,address token,address recipient,uint256 amount,uint256 feeAmount,uint256 nonce,uint256 deadline,bool merchantOverride)"
    );
    bytes32 private constant NAME_HASH = keccak256("TSN Creditcoin Settlement Hub");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 public constant BPS_DENOMINATOR = 10_000;

    address public owner;
    address public authorizationSigner;
    address payable public feeRecipient;
    IERC20 public immutable settlementToken;
    uint256 public feeBps;
    bool public paused;

    mapping(bytes32 => bool) public processedSettlements;
    mapping(uint256 => bool) public usedNonces;

    error Unauthorized();
    error Paused();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error Replay(bytes32 settlementId, uint256 nonce);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error InvalidFeeConfiguration();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AuthorizationSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event LiquidityFunded(address indexed funder, address indexed token, uint256 amount, uint256 newBalance);
    event LiquidityWithdrawn(address indexed recipient, address indexed token, uint256 amount, uint256 newBalance);
    event FeeConfigurationUpdated(address indexed feeRecipient, uint256 feeBps);
    event SolanaDebitCommitmentConsumed(bytes32 indexed settlementId, bytes32 indexed exitCommitment);
    event PayoutExecuted(
        bytes32 indexed settlementId,
        bytes32 indexed sealedTipHeadHash,
        bytes32 indexed exitCommitment,
        bytes32 tinHash,
        bytes32 destinationNetwork,
        address token,
        address recipient,
        uint256 amount,
        uint256 feeAmount,
        uint256 nonce,
        bool merchantOverride
    );

    struct PayoutAuthorization {
        bytes32 settlementId;
        bytes32 sourceNetwork;
        bytes32 sealedTipHeadHash;
        bytes32 tinHash;
        bytes32 exitCommitment;
        bytes32 destinationNetwork;
        address token;
        address recipient;
        uint256 amount;
        uint256 feeAmount;
        uint256 nonce;
        uint256 deadline;
        bool merchantOverride;
    }

    constructor(address signer, address payable feeRecipient_, uint256 feeBps_, address token_) {
        if (signer == address(0) || token_ == address(0)) revert InvalidAuthorization();
        if (feeRecipient_ == address(0) || feeBps_ > BPS_DENOMINATOR) revert InvalidFeeConfiguration();
        owner = msg.sender;
        authorizationSigner = signer;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        settlementToken = IERC20(token_);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function fundLiquidity(uint256 amount) external {
        if (amount == 0) revert InvalidAuthorization();
        settlementToken.safeTransferFrom(msg.sender, address(this), amount);
        emit LiquidityFunded(msg.sender, address(settlementToken), amount, settlementToken.balanceOf(address(this)));
    }

    function executeCreditcoinExit(
        PayoutAuthorization calldata authorization,
        bytes calldata signature
    ) public returns (bytes32 settlementId) {
        if (paused) revert Paused();
        if (block.timestamp > authorization.deadline) revert AuthorizationExpired();
        if (authorization.sourceNetwork != SOLANA_NETWORK) revert InvalidAuthorization();
        if (authorization.destinationNetwork != CREDITCOIN_NETWORK) revert InvalidAuthorization();
        if (authorization.token != address(settlementToken)) revert InvalidAuthorization();
        if (authorization.settlementId == bytes32(0)) revert InvalidAuthorization();
        if (authorization.sealedTipHeadHash == bytes32(0)) revert InvalidAuthorization();
        if (authorization.tinHash == bytes32(0)) revert InvalidAuthorization();
        if (authorization.exitCommitment == bytes32(0)) revert InvalidAuthorization();
        if (authorization.recipient == address(0) || authorization.amount == 0) revert InvalidAuthorization();
        if (processedSettlements[authorization.settlementId] || usedNonces[authorization.nonce]) {
            revert Replay(authorization.settlementId, authorization.nonce);
        }

        uint256 expectedFee = quoteFee(authorization.amount);
        if (authorization.feeAmount != expectedFee) revert InvalidFeeConfiguration();
        uint256 totalRequired = authorization.amount + authorization.feeAmount;
        uint256 available = settlementToken.balanceOf(address(this));
        if (available < totalRequired) revert InsufficientLiquidity(totalRequired, available);
        if (_hashTypedData(authorization).recover(signature) != authorizationSigner) revert Unauthorized();

        processedSettlements[authorization.settlementId] = true;
        usedNonces[authorization.nonce] = true;
        emit SolanaDebitCommitmentConsumed(authorization.settlementId, authorization.exitCommitment);

        settlementToken.safeTransfer(authorization.recipient, authorization.amount);
        if (authorization.feeAmount > 0) {
            settlementToken.safeTransfer(feeRecipient, authorization.feeAmount);
        }

        emit PayoutExecuted(
            authorization.settlementId,
            authorization.sealedTipHeadHash,
            authorization.exitCommitment,
            authorization.tinHash,
            authorization.destinationNetwork,
            authorization.token,
            authorization.recipient,
            authorization.amount,
            authorization.feeAmount,
            authorization.nonce,
            authorization.merchantOverride
        );
        return authorization.settlementId;
    }

    /// @dev Compatibility alias for callers that still use the earlier name.
    function executeCreditcoinPayout(
        PayoutAuthorization calldata authorization,
        bytes calldata signature
    ) external returns (bytes32) {
        return executeCreditcoinExit(authorization, signature);
    }

    function authorizationDigest(PayoutAuthorization calldata authorization) external view returns (bytes32) {
        return _hashTypedData(authorization);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function quoteFee(uint256 amount) public view returns (uint256) {
        return (amount * feeBps) / BPS_DENOMINATOR;
    }

    function setAuthorizationSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert InvalidAuthorization();
        emit AuthorizationSignerUpdated(authorizationSigner, signer);
        authorizationSigner = signer;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
    }

    function setFeeConfiguration(address payable recipient, uint256 bps) external onlyOwner {
        if (recipient == address(0) || bps > BPS_DENOMINATOR) revert InvalidFeeConfiguration();
        feeRecipient = recipient;
        feeBps = bps;
        emit FeeConfigurationUpdated(recipient, bps);
    }

    function withdrawLiquidity(address recipient, uint256 amount) external onlyOwner {
        uint256 available = settlementToken.balanceOf(address(this));
        if (recipient == address(0) || amount > available) revert InsufficientLiquidity(amount, available);
        settlementToken.safeTransfer(recipient, amount);
        emit LiquidityWithdrawn(recipient, address(settlementToken), amount, settlementToken.balanceOf(address(this)));
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
                authorization.destinationNetwork,
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
