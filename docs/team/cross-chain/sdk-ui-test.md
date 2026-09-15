# Cross-chain SDK test UI guide

## Purpose

The test UI must use the TSN SDK for the same evidence path as the terminal
runner. It must not maintain a second token, executor, route, or liquidity
configuration. The Creditcoin registry remains the runtime authority.

## SDK preflight

Build the SDK:

```powershell
cd tsn-protocol/sdks/tsn-sdk
npm run build
```

Use the exported `loadCrossChainUiSnapshot` helper:

```typescript
import { loadCrossChainUiSnapshot } from "@trustlink/tsn-sdk/cross-chain";

const snapshot = await loadCrossChainUiSnapshot({
  nodeUrl: "http://127.0.0.1:8000",
  route: {
    rpcUrl: "https://rpc.cc3-testnet.creditcoin.network",
    registry: "0x764Ac587b1fC0feBEE86012cF7A2489b575EE5D1",
    routeId:
      "0xd1c8fb4fdaa90f4b4cf7f385e0f426c0cc6130ecff6ac078f0c95b91125e3943",
  },
});

for (const line of snapshot.logs) console.log(line);
```

The UI should render `snapshot.logs`, `snapshot.status`,
`snapshot.creditcoin.route`, and `snapshot.creditcoin.liquidity` directly. The
route token and executor are read from the live registry; they are not supplied
by UI state.

## Expected log sequence

```text
Checking TSN Node route gate...
Node route gate: 1 configured route(s)
Checking Creditcoin chain ID...
Reading route from on-chain registry...
Route: active
Settlement asset: USDSET 0x...
Vault liquidity: 1000000000000 base units
Liquidity observation: fresh
Route gate: ready for Node authorization
Cross-chain UI preflight: ready
```

`1000000000000` is `1,000,000 USDSET` because USDSET has 6 decimals. The UI
must show the formatted amount using `tokenDecimals`; it must not treat the raw
base-unit value as whole USDSET.

## Node restart gate

The Node loads its route mirror at process startup. After changing the local
ignored Node environment, restart the Node before testing the UI:

```powershell
python tsn-protocol/services/tsn-node/server.py --test-crosschain --receipt --network creditcoin-testnet --verbose
```

Confirm that `GET /settlement-networks` returns the USDSET route before
expecting the SDK snapshot to become `ready`. A UI result of `blocked` with
live Creditcoin liquidity usually means the Node process has stale environment
state or the route mirror does not point to the deployed registry.

## Observed SDK test

The SDK build passed. A live SDK preflight read the deployed CC3 route and
returned:

```text
Route: active
Settlement asset: USDSET 0xa6a0e01dbaf91ae8fa46ff7b832c23e735a269a9
Vault liquidity: 1000000000000 base units
Liquidity observation: fresh
Route gate: ready for Node authorization
```

The same run returned `Node route gate: 0 configured route(s)` because the
already-running Node process had not reloaded the updated route mirror. No
settlement transaction was submitted by the SDK preflight.
