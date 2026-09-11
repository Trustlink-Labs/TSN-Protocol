# TinExitAttested Protocol

`TinExitAttested` is an optional Creditcoin receipt for a TIN-paid exit. It is
not a bridge, a second balance, or a replacement for Solana settlement.

## Receipt flow

```text
1. Solana completes the existing authorized two-phase exit.
2. Node derives the sealed TIP head hash, amount, TIN hash, and exit commitment.
3. Node publishes the canonical digest to the configured EVM anchor.
4. Worker waits for the supported source block to be attested.
5. Worker obtains Merkle and continuity proofs using the Attestcoin SDK.
6. Creditcoin ASC verifies the proof through Block Prover 0x0FD2.
7. ASC rejects a replay and emits TinExitAttested.
```

The official Attestcoin entry points are the
[protocol overview](https://docs.attestcoin.org/attestcoin-protocol/),
[architecture](https://docs.attestcoin.org/attestcoin-protocol/architecture),
and [Deploy guide](https://creditcoin.org/Deploy). The worker must follow the
published SDK and example-repository ABI rather than guessing a raw precompile
signature.

## Event shape

```solidity
event TinExitAttested(
    bytes32 indexed sealedTipHeadHash,
    uint256 amount,
    bytes32 indexed tinHash,
    bytes32 indexed exitCommitment,
    bytes32 settlementId,
    uint256 sourceBlock,
    bytes32 sourceTransaction
);
```

The event contains hashes and settlement metadata only. It never contains a
raw TIN, sealed TIP plaintext, device key, seed, or private balance.

## Merchant override

A merchant may request a receipt when creating a payment intent:

```typescript
const intentPolicy = {
  destinationNetwork: "creditcoin-testnet",
  destinationAddress: "0x...",
  requestTinExitAttestation: true,
  merchantOverride: true,
};
```

The override is a policy flag for receipt creation. It does not authorize a
different amount, token, recipient, commitment, expiry, or destination than the
owner-authorized Solana intent. If the receipt path is unavailable, the node
must report attestation failure separately from the already-authorized Solana
settlement result.

## Back-reference

The TSN tracker links the Creditcoin receipt to the Solana settlement ID and
exit commitment. This is an off-chain correlation record; it does not modify the
Solana debit, payout, liability PDA, or private TIP state.
