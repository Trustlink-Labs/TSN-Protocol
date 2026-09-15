// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CreditcoinDirectLiquidityRegistry
/// @notice On-chain route and local stablecoin-capacity registry for the first
///         direct Creditcoin destination lane.
/// @dev The Node may mirror this data, but the direct Hub reads this contract
///      again during settlement. This registry never custodies tokens.
contract CreditcoinDirectLiquidityRegistry {
    uint256 public constant CREDITCOIN_CHAIN_ID = 102031;

    struct Route {
        bool enabled;
        uint64 sourceChainKey;
        address sourceEmitter;
        address payoutVault;
        address token;
        bytes32 destinationNetwork;
        uint256 destinationChainId;
        address destinationExecutor;
        address outbox;
    }

    struct LiquidityObservation {
        uint256 availableAmount;
        uint256 sourceBlock;
        uint256 observedAt;
        uint256 validUntil;
        uint256 nonce;
        bytes32 queryId;
    }

    address public owner;
    address public settlementHub;
    mapping(bytes32 => Route) public routes;
    mapping(bytes32 => LiquidityObservation) public latestObservation;
    mapping(bytes32 => uint256) public reservedAmount;
    mapping(bytes32 => mapping(bytes32 => uint256)) public reservations;

    error Unauthorized();
    error InvalidRoute();
    error InvalidObservation();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error ReplayReservation();

    event RouteConfigured(bytes32 indexed routeId, address payoutVault, address token, address executor, bool enabled);
    event LiquidityObserved(bytes32 indexed routeId, uint256 availableAmount, uint256 validUntil, uint256 nonce);
    event LiquidityReserved(bytes32 indexed routeId, bytes32 indexed settlementId, uint256 amount);
    event LiquidityReleased(bytes32 indexed routeId, bytes32 indexed settlementId, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function configureRoute(
        bytes32 routeId,
        address payoutVault,
        address token,
        bytes32 destinationNetwork,
        address destinationExecutor,
        bool enabled
    ) external onlyOwner {
        if (
            routeId == bytes32(0) || payoutVault == address(0) || token == address(0) ||
            destinationNetwork == bytes32(0) || destinationExecutor == address(0)
        ) revert InvalidRoute();
        routes[routeId] = Route(
            enabled, 0, address(0), payoutVault, token, destinationNetwork,
            CREDITCOIN_CHAIN_ID, destinationExecutor, address(0)
        );
        emit RouteConfigured(routeId, payoutVault, token, destinationExecutor, enabled);
    }

    /// @notice Record the current local vault balance as a time-bounded capacity.
    /// @dev This is local Creditcoin liquidity, so no external proof is needed.
    function observeLocalLiquidity(bytes32 routeId, uint256 validUntil, uint256 nonce) external onlyOwner {
        Route memory route = routes[routeId];
        if (!route.enabled || validUntil <= block.timestamp || nonce <= latestObservation[routeId].nonce) {
            revert InvalidObservation();
        }
        uint256 amount = IERC20(route.token).balanceOf(route.payoutVault);
        latestObservation[routeId] = LiquidityObservation(
            amount, block.number, block.timestamp, validUntil, nonce, keccak256(abi.encode(routeId, nonce, amount))
        );
        emit LiquidityObserved(routeId, amount, validUntil, nonce);
    }

    function setSettlementHub(address nextHub) external onlyOwner {
        if (nextHub == address(0)) revert InvalidRoute();
        settlementHub = nextHub;
    }

    function getRoute(bytes32 routeId) external view returns (Route memory) { return routes[routeId]; }

    function isSettlementRouteActive(bytes32 routeId) external view returns (bool) {
        Route memory route = routes[routeId];
        return route.enabled && route.destinationChainId == CREDITCOIN_CHAIN_ID && route.destinationExecutor != address(0);
    }

    function isLiquidityAvailable(bytes32 routeId, uint256 amount) public view returns (bool) {
        LiquidityObservation memory observation = latestObservation[routeId];
        return routes[routeId].enabled && observation.validUntil >= block.timestamp &&
            observation.availableAmount >= reservedAmount[routeId] + amount;
    }

    function reserveLiquidity(bytes32 routeId, bytes32 settlementId, uint256 amount) external onlyHub {
        if (settlementId == bytes32(0) || reservations[routeId][settlementId] != 0) revert ReplayReservation();
        LiquidityObservation memory observation = latestObservation[routeId];
        if (amount == 0 || !isLiquidityAvailable(routeId, amount)) {
            revert InsufficientLiquidity(amount, observation.availableAmount);
        }
        reservations[routeId][settlementId] = amount;
        reservedAmount[routeId] += amount;
        emit LiquidityReserved(routeId, settlementId, amount);
    }

    function releaseLiquidity(bytes32 routeId, bytes32 settlementId, uint256 amount) external onlyHub {
        if (reservations[routeId][settlementId] != amount || amount == 0) revert InvalidObservation();
        reservations[routeId][settlementId] = 0;
        reservedAmount[routeId] -= amount;
        emit LiquidityReleased(routeId, settlementId, amount);
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyHub() { if (msg.sender != settlementHub) revert Unauthorized(); _; }
}
