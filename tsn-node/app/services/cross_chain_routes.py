"""Creditcoin-backed destination route registry for cross-chain intents.

The Node never treats a chain name or chain ID as sufficient support. A route
must be configured with its exact Creditcoin registry, executor, token, and
route ID, and the registry must report an active route with an unexpired
proof-backed liquidity observation.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx


GET_ROUTE_SELECTOR = "0xe9207600"
LATEST_OBSERVATION_SELECTOR = "0xa2fb18c1"
ACTIVE_ROUTE_SELECTOR = "0x655d0aa8"


def _address(value: str, field: str) -> str:
    normalized = str(value or "").strip().lower()
    if len(normalized) != 42 or not normalized.startswith("0x"):
        raise ValueError(f"{field} must be a 20-byte EVM address")
    try:
        int(normalized[2:], 16)
    except ValueError as exc:
        raise ValueError(f"{field} must be a 20-byte EVM address") from exc
    return normalized


def _bytes32(value: str, field: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized.startswith("0x"):
        normalized = normalized[2:]
    if len(normalized) != 64:
        raise ValueError(f"{field} must be bytes32")
    try:
        int(normalized, 16)
    except ValueError as exc:
        raise ValueError(f"{field} must be bytes32") from exc
    return f"0x{normalized}"


def _word(data: str, index: int) -> int:
    raw = data[2:] if data.startswith("0x") else data
    start = index * 64
    return int(raw[start:start + 64], 16)


def _word_address(data: str, index: int) -> str:
    raw = data[2:] if data.startswith("0x") else data
    return "0x" + raw[index * 64 + 24:index * 64 + 64].lower()


@dataclass(frozen=True)
class DestinationRoute:
    network: str
    route_id: str
    registry: str
    executor: str
    token: str
    destination_chain_id: int
    rpc_url: str


def load_destination_routes() -> dict[str, DestinationRoute]:
    raw = os.environ.get("TSN_DESTINATION_ROUTES_JSON", "").strip()
    if not raw:
        return {}
    try:
        entries = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("TSN_DESTINATION_ROUTES_JSON is invalid JSON") from exc
    if not isinstance(entries, list):
        raise RuntimeError("TSN_DESTINATION_ROUTES_JSON must be a list")

    default_rpc = os.environ.get("TSN_CREDITCOIN_RPC_URL", "").strip()
    routes: dict[str, DestinationRoute] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise RuntimeError("each destination route must be an object")
        network = str(entry.get("network") or "").strip().lower()
        if not network or network in routes:
            raise RuntimeError("destination route network is missing or duplicated")
        route = DestinationRoute(
            network=network,
            route_id=_bytes32(str(entry.get("routeId") or ""), "routeId"),
            registry=_address(str(entry.get("registry") or os.environ.get("TSN_CREDITCOIN_REGISTRY_ADDRESS", "")), "registry"),
            executor=_address(str(entry.get("executor") or ""), "executor"),
            token=_address(str(entry.get("token") or ""), "token"),
            destination_chain_id=int(entry.get("destinationChainId") or 0),
            rpc_url=str(entry.get("rpcUrl") or default_rpc).strip(),
        )
        if route.destination_chain_id <= 0 or not route.rpc_url:
            raise RuntimeError(f"destination route {network} is incomplete")
        routes[network] = route
    return routes


async def _eth_call(client: httpx.AsyncClient, rpc_url: str, to: str, data: str) -> str:
    response = await client.post(
        rpc_url,
        json={"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]},
    )
    response.raise_for_status()
    body = response.json()
    if body.get("error") or not isinstance(body.get("result"), str):
        raise RuntimeError(f"Creditcoin registry eth_call failed: {body.get('error') or 'missing result'}")
    return body["result"]


async def verify_destination_route(
    *,
    network: str,
    route_id: str,
    executor: str,
    token: str,
    requested_amount: int,
    now_seconds: int,
) -> DestinationRoute:
    routes = load_destination_routes()
    route = routes.get(network.strip().lower())
    if route is None:
        raise ValueError("destination network is not active in the TSN registry")
    if _bytes32(route_id, "routeId") != route.route_id:
        raise ValueError("settlement route ID is not registered for the destination network")
    if _address(executor, "destinationExecutor") != route.executor:
        raise ValueError("destination executor is not the registered executor")
    if _address(token, "destinationToken") != route.token:
        raise ValueError("destination token is not the registered route asset")
    if requested_amount <= 0:
        raise ValueError("destination amount must be positive")

    route_arg = route.route_id[2:]
    async with httpx.AsyncClient(timeout=15) as client:
        active_raw = await _eth_call(client, route.rpc_url, route.registry, ACTIVE_ROUTE_SELECTOR + route_arg)
        if _word(active_raw, 0) != 1:
            raise ValueError("destination route is not active on Creditcoin")
        route_raw = await _eth_call(client, route.rpc_url, route.registry, GET_ROUTE_SELECTOR + route_arg)
        if _word(route_raw, 0) != 1:
            raise ValueError("destination route is disabled on Creditcoin")
        if _word_address(route_raw, 7) != route.executor or _word_address(route_raw, 4) != route.token:
            raise ValueError("Creditcoin route configuration does not match the signed intent")
        observation_raw = await _eth_call(client, route.rpc_url, route.registry, LATEST_OBSERVATION_SELECTOR + route_arg)
        available = _word(observation_raw, 0)
        valid_until = _word(observation_raw, 3)
        if valid_until <= now_seconds:
            raise ValueError("destination liquidity observation is expired")
        if available < requested_amount:
            raise ValueError("verified destination liquidity is insufficient")
    return route


def configured_destination_networks() -> list[dict[str, Any]]:
    return [
        {
            "name": route.network,
            "routeId": route.route_id,
            "chainId": route.destination_chain_id,
            "executor": route.executor,
            "supportedAssets": [route.token],
            "status": "configured; live liquidity checked per intent",
        }
        for route in load_destination_routes().values()
    ]


async def ready_destination_networks(now_seconds: int) -> list[dict[str, Any]]:
    """Return routes that pass the same live checks used by intent admission.

    The amount-one probe is only a readiness probe. The signed intent is still
    checked with its exact amount immediately before authorization.
    """
    ready: list[dict[str, Any]] = []
    for route in load_destination_routes().values():
        try:
            await verify_destination_route(
                network=route.network,
                route_id=route.route_id,
                executor=route.executor,
                token=route.token,
                requested_amount=1,
                now_seconds=now_seconds,
            )
        except (RuntimeError, ValueError, httpx.HTTPError):
            continue
        ready.append(
            {
                "name": route.network,
                "routeId": route.route_id,
                "chainId": route.destination_chain_id,
                "executor": route.executor,
                "supportedAssets": [route.token],
                "status": "ready; live liquidity verified",
            }
        )
    return ready
