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

## Infrastructure diagnostics

The prototype may still use low-level Solana RPC and account inspection in
routes explicitly labelled as diagnostics, preflight, wallet loading, faucet,
or evidence verification. Those routes are test-lab instrumentation, not the
application integration example. They must not be presented as the way a
developer builds a TSN payment dApp.

## Current implementation observation

The wallet-transfer route now calls
`buildTsnSplTokenTransferTransaction` from `@trustlink/tsn-sdk`. The UI server
only validates the session and returns the SDK-produced unsigned transaction.
The user's wallet remains responsible for signing it.

The private TIN preparation route remains blocked until the Node-side TIN
allocator contract is available. It must not fall back to direct program
creation. This is an intentional safety boundary, not a fabricated success.

## Verification

From the repository root:

```powershell
npm --prefix tsn-protocol/sdks/tsn-sdk run build
node --check protocol-tests/ui/server.mjs
```

Record the command output in the team test log when the prototype changes.
