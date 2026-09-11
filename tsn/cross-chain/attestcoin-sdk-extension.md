# Attestcoin SDK Extension

This module defines TSN-owned primitives for optional Creditcoin receipts. It
does not import TCAP or TIN internals. Applications consume the TSN façade and
provide a destination network plus an EVM address.

The proof worker should use the official Attestcoin SDK and examples linked from
the [Attestcoin docs](https://docs.attestcoin.org/attestcoin-protocol/), then
submit the verified payload to the deployed ASC. Keep proof generation out of
the browser and never place deployer credentials in the client SDK.

## Public primitives

`tsn-protocol/tsn-sdk/src/cross-chain.ts` exports:

- supported destination network identifiers;
- a validated Creditcoin destination request;
- a canonical receipt input shape;
- a deterministic replay key input shape; and
- an optional receipt status type.

The primitives deliberately carry hashes and public routing metadata only.

## Integration rules

1. Resolve and authorize the Solana exit through the existing TSN façade.
2. Call the adapter with the exact sealed TIP head hash and exit commitment
   returned by the authorized flow.
3. Treat `TinExitAttested` as an optional receipt status, never as proof that
   Solana debit or payout still needs to occur.
4. Correlate receipts by settlement ID and exit commitment.
5. Reject duplicate receipt keys in the worker and ASC.

The façade export is intentionally additive. Existing TSN exports remain
unchanged, and no app should import TCAP/TIN implementation modules directly.
