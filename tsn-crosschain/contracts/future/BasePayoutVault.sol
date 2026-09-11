// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title BasePayoutVault
/// @notice Future destination-side liquidity vault for Base payouts.
/// @dev This contract is not deployed by the Creditcoin-first script. It is a
///      destination adapter boundary: Base liquidity is prefunded here, and a
///      Creditcoin settlement adapter supplies an authorized payout message.
contract BasePayoutVault {
    using ECDSA for bytes32;

    bytes32 public constant CREDITCOIN_NETWORK = keccak256("creditcoin-testnet");
    bytes32 public constant BASE_NETWORK = keccak256("base");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant PAYOUT_TYPEHASH = keccak256(
        "DestinationPayout(bytes32 creditcoinSettlementId,bytes32 sourceNetwork,bytes32 destinationNetwork,address recipient,uint256 amount,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant NAME_HASH = keccak256("TSN Base Payout Vault");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public owner;
    address public settlementAdapter;
    mapping(bytes32 => bool) public processedSettlements;
    mapping(uint256 => bool) public usedNonces;

    error Unauthorized();
    error InvalidPayout();
    error Expired();
    error Replay();
    error InsufficientLiquidity();
    error TransferFailed();

    event LiquidityFunded(address indexed funder, uint256 amount, uint256 newBalance);
    event BasePayoutExecuted(bytes32 indexed creditcoinSettlementId, address indexed recipient, uint256 amount);

    struct DestinationPayout {
        bytes32 creditcoinSettlementId;
        bytes32 sourceNetwork;
        bytes32 destinationNetwork;
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    constructor(address adapter) {
        if (adapter == address(0)) revert InvalidPayout();
        owner = msg.sender;
        settlementAdapter = adapter;
    }

    receive() external payable {
        emit LiquidityFunded(msg.sender, msg.value, address(this).balance);
    }

    function fundLiquidity() external payable {
        if (msg.value == 0) revert InvalidPayout();
        emit LiquidityFunded(msg.sender, msg.value, address(this).balance);
    }

    function executePayout(DestinationPayout calldata payout, bytes calldata signature) external {
        if (block.timestamp > payout.deadline) revert Expired();
        if (payout.sourceNetwork != CREDITCOIN_NETWORK || payout.destinationNetwork != BASE_NETWORK) revert InvalidPayout();
        if (payout.creditcoinSettlementId == bytes32(0) || payout.recipient == address(0) || payout.amount == 0) revert InvalidPayout();
        if (processedSettlements[payout.creditcoinSettlementId] || usedNonces[payout.nonce]) revert Replay();
        if (address(this).balance < payout.amount) revert InsufficientLiquidity();
        if (_hashPayout(payout).recover(signature) != settlementAdapter) revert Unauthorized();

        processedSettlements[payout.creditcoinSettlementId] = true;
        usedNonces[payout.nonce] = true;
        (bool sent, ) = payout.recipient.call{value: payout.amount}("");
        if (!sent) revert TransferFailed();
        emit BasePayoutExecuted(payout.creditcoinSettlementId, payout.recipient, payout.amount);
    }

    function setSettlementAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert InvalidPayout();
        settlementAdapter = adapter;
    }

    function withdrawLiquidity(address payable recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0) || amount > address(this).balance) revert InsufficientLiquidity();
        (bool sent, ) = recipient.call{value: amount}("");
        if (!sent) revert TransferFailed();
    }

    function _hashPayout(DestinationPayout calldata payout) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYOUT_TYPEHASH,
                payout.creditcoinSettlementId,
                payout.sourceNetwork,
                payout.destinationNetwork,
                payout.recipient,
                payout.amount,
                payout.nonce,
                payout.deadline
            )
        );
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
}
