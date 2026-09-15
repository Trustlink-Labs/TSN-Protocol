# Prototype SDK Boundary

This runbook defines what the local prototype/test UI may expose as an example
payment dApp and what must remain infrastructure-only.

## Application code

The prototype must use the canonical `@trustlink/tsn-sdk` façade for:

- private TIN identity-envelope preparation;
- TIN route resolution;
- payment authorization and intent serialization;
- wallet-to-wallet SPL transfer transaction construction;
- sponsored settlement transaction preparation;
- cross-chain route and destination validation.

The prototype must not import TCAP/TIN program clients, derive settlement PDAs,
or assemble raw settlement instructions in a payment route. Those operations
belong inside the SDK, Node, Receiver, Cranker, or program packages.

## Protocol UI scope

The Protocol UI is not an infrastructure diagnostic console. It does not load
local keypair files, run a faucet, inspect TCAP accounts, derive PDAs, or build
raw program instructions. Those tools belong in separate operator and test
scripts, not in the dApp example.

## Current implementation observation

The UI server has no Solana, SPL-token, TCAP, or TIN client imports. It invokes
the SDK for TIN route lookup, payment authorization, intent submission,
wallet-transfer construction, and sponsored funding construction. The browser
wallet owns signing and no private key enters the UI server.

The UI also calls `getTsnNetworkStatus` before transaction preparation. It
tries the local Node, Receiver, and RPC endpoints first, falls back to the
configured live Receiver/RPC and future live Node, and reads Cranker liveness
from the Node's heartbeat-backed route response. The selected RPC source is
also passed to SDK route and transaction helpers, so the UI does not report a
healthy live gateway while quietly preparing transactions against a different
RPC. A missing route or unavailable Cranker blocks signing in the prototype.

Private TIN issuance remains a service-authorized flow. The UI explains that
boundary and does not fabricate a TIN or fall back to direct program creation.

## Verification

From the repository root:

```powershell
npm --prefix tsn-protocol/sdks/tsn-sdk run build
node --check protocol-tests/ui/server.mjs
```

Record the command output in the team test log when the prototype changes.
