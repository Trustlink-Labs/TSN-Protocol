# Creditcoin Integration

## Destination model

Creditcoin is the leader destination for the first cross-chain adapter. The
user selects `creditcoin-testnet` and supplies an EVM `0x` address. The adapter
must reject a malformed address, unsupported token mapping, wrong network, or
missing destination capability before submitting work.

Creditcoin's official documentation describes its EVM compatibility and testnet
environment. Use [Creditcoin docs](https://docs.creditcoin.org/), the
[testnet environment](https://docs.creditcoin.org/environments/testnet), and
[Deploy](https://creditcoin.org/Deploy) for current RPC and deployment values.

## No direct Solana bridge

The TSN node translates Solana settlement evidence into an EVM-compatible
anchor payload. This is an adapter and evidence path, not a custody bridge. No
Solana program is asked to understand EVM calldata, and no Creditcoin contract
is given a raw TIN or Solana private state.

Because Attestcoin's documented Block Prover path is EVM-oriented, the first
receipt path uses an Ethereum Sepolia anchor before Creditcoin proof
verification. Future source-chain support can add another adapter without
changing the Solana exit contract.

## Account and vault model

The destination address is an external Creditcoin EVM account selected by the
user or merchant. It does not become a Solana vault authority, liability PDA,
GPRU identity, or TIN record. Solana remains the accounting source of truth.

The one-vault model is preserved. The cross-chain layer adds only destination
metadata, adapter state, and optional receipt correlation. It does not add an
escrow, a second vault, a raw-TIN account, or a substitute liability ledger.

## Exit sequence

```text
TIN picker
  -> owner-authorized Solana exit intent
  -> tsn_register_tcap_exit_debit_v1
  -> node validates permit and destination adapter
  -> register_tcap_exit_payout_v1
  -> Creditcoin payout/receipt adapter
  -> optional TinExitAttested tracker reference
```

The payout path must use the existing `register_tcap_exit_payout_v1` builder
and its current permit commitment semantics. This folder does not alter its
accounts, discriminator, sealed-head behavior, or liability wiring.

## Testing policy

Use Solana devnet and Creditcoin testnet/devnet only. Keep RPC URLs, deployer
keys, contract addresses, and proof-builder configuration in deployment-specific
secrets or `.env` files outside this documentation folder. Never commit private
keys or claim a live receipt without a transaction hash.

## Executable adapter files

The Sepolia anchor is deployed with `scripts/deploy.ts` alongside the ASC. The
ASC links the registered source anchor address at construction time and accepts
only the `TinExitAnchored` event signature from that address. The worker then
submits the proof using the official `@gluwa/usc-sdk` and the standard
`ASCBase.execute` argument layout. This completes the optional receipt path
without changing `register_tcap_exit_payout_v1` or any Solana account model.
