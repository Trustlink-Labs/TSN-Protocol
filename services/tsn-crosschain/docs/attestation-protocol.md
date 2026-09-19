# Destination Liquidity Attestation and Payout

## Purpose

TSN uses Attestcoin to restrict onward EVM payouts to supported routes with
proof-backed destination liquidity. The attestation is evidence and message
authorization; it is not the stablecoin value.

## Readability path

1. A destination liquidity contract emits `LiquidityAvailable`.
2. The proof worker waits for source-chain block attestation.
3. The worker obtains Merkle and continuity proofs through the official USC
   SDK/Proof Builder flow.
4. `DestinationLiquidityASC` verifies the proof through Creditcoin's native
   verifier at `0x0FD2`.
5. The ASC checks the registered route, source emitter, token, event, nonce,
   and expiry.
6. `DestinationLiquidityRegistry` records the verified observation.

## Writability/payout path

After Creditcoin consumes the authorized Solana commitment:

```text
Creditcoin Hub
  -> authenticated destination message
  -> Attestcoin relayer
  -> destination Inbox
  -> destination payout contract
  -> destination stablecoin vault
```

The destination payout contract performs the final balance and replay checks
and transfers stablecoins to the recipient. No raw TIN or private Solana state
is included in the destination message.

## Replay and freshness

`DestinationLiquidityRegistry` rejects duplicate/non-monotonic liquidity
nonces, expires observations, and tracks route reservations by settlement ID.
The destination payout contract must independently reject duplicate message IDs
and expired instructions. Creditcoin settlement IDs and exit commitments remain
the correlation keys back to Solana.

## Scope boundary

The direct Creditcoin payout still uses the existing signed
`CreditcoinSettlementHub` authorization and does not require a destination
message. The Attestcoin route is used when Creditcoin is coordinating a payout
to another supported EVM network.

Official references: [Attestcoin dApp infrastructure](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure),
[ASC contracts](https://www.npmjs.com/package/%40gluwa/asc-contracts), and the
[official examples](https://github.com/gluwa/attestcoin-protocol-examples).
