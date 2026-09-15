# Creditcoin Integration

## Creditcoin's role

Creditcoin is the first funded EVM settlement domain and the source chain for
onward supported-EVM payout instructions. It does not replace Solana as the
source accounting chain and does not receive raw TIN values or private device
state.

Official references are [Creditcoin](https://creditcoin.org/),
[Creditcoin docs](https://docs.creditcoin.org/), and the
[Deploy / Attestcoin overview](https://creditcoin.org/Deploy).

## Route admission

A TIN picker option is not enabled merely because it has an EVM address. The
route must have:

- a supported source chain key and decoder;
- an approved source liquidity emitter;
- an approved destination payout vault/contract;
- a configured settlement token; and
- a current proof-backed liquidity observation.

`DestinationLiquidityRegistry` stores this route configuration. A registered
ASC can call `recordVerifiedLiquidity` only after the source-chain event has
been verified by the native Creditcoin proof verifier. The observation expires
and carries a monotonic nonce so stale liquidity cannot silently remain valid.

## Liquidity verification

The destination liquidity contract emits:

```solidity
LiquidityAvailable(
    bytes32 indexed routeId,
    address indexed token,
    uint256 availableAmount,
    uint256 nonce,
    uint256 validUntil
)
```

The official Attestcoin worker pattern waits for source-block attestation,
requests a proof from the Proof Builder, and submits the proof to the
Creditcoin ASC. `DestinationLiquidityASC` verifies the source emitter, route,
token, event, and proof before recording the observation. See the
[official dApp infrastructure](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure).

The Node may also perform a fast destination RPC preflight before submitting
the Solana intent. That is a UX and risk-reduction check; the Creditcoin ASC
and destination payout contract remain the cryptographic/on-chain boundaries.

## Settlement sequence

```text
TIN picker selects supported EVM route
  -> Node checks route + current verified liquidity
  -> existing owner-authorized SVM debit intent
  -> Cranker Job 1 submits Solana transaction
  -> Node validates the Solana debit commitment
  -> Cranker Job 2 submits the authorized Creditcoin transaction
  -> CreditcoinSettlementHub consumes the commitment
  -> Creditcoin pays directly, or publishes an onward EVM instruction
  -> destination Inbox/payout contract pays from its stablecoin vault
```

The direct Creditcoin route uses `CreditcoinSettlementHub` and its configured
ERC-20 settlement token. Native CTC pays gas only. An onward route never treats
an Attestcoin message as value; its destination vault supplies the stablecoin.

The existing Solana payout builder and
`register_tcap_exit_payout_v1` remain unchanged. This EVM layer adds route
metadata, verified liquidity observations, reservations, and destination
message state only.

## Deployment and test policy

Use Creditcoin CC3 Testnet/devnet and supported EVM testnets only. Do not use
localnet. `scripts/deploy.ts` deploys the Creditcoin Hub, the destination
liquidity registry, and the liquidity ASC. Each destination route must then be
configured explicitly; deployment alone does not enable Base or Ethereum.

The proof and message infrastructure must follow the official
[ASC contracts](https://www.npmjs.com/package/%40gluwa/asc-contracts) and
[Attestcoin examples](https://github.com/gluwa/attestcoin-protocol-examples).
