# TSN Cross-Chain Starter

This folder is the single source of truth for TSN connections to Creditcoin and
future EVM or non-EVM settlement domains. It describes the adapter boundary; it
does not replace the Solana programs, TCAP accounting, TIN resolution, or the
existing two-phase exit flow.

## Scope

Creditcoin is the first destination domain. Creditcoin is an EVM-compatible
Layer 1 with native CTC and smart-contract support. Its official resources are
[Creditcoin](https://creditcoin.org/), [developer docs](https://docs.creditcoin.org/),
[Deploy / Attestcoin](https://creditcoin.org/Deploy), and the
[explorer](https://explorer.creditcoin.org/).

[Attestcoin](https://docs.attestcoin.org/attestcoin-protocol/) is Creditcoin's
cross-chain protocol. Its documented readability path verifies EVM transaction
inclusion using Merkle and continuity proofs through the Block Prover precompile
at `0x0000000000000000000000000000000000000FD2`. See the
[architecture](https://docs.attestcoin.org/attestcoin-protocol/architecture),
[readability](https://docs.attestcoin.org/attestcoin-protocol/readability),
[writability](https://docs.attestcoin.org/attestcoin-protocol/writability),
[environments](https://docs.attestcoin.org/attestcoin-protocol/environments),
and [dApp builder](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure).

## Integration story

The user chooses a destination network from a TIN picker: Solana, Creditcoin,
Base, Ethereum, or another network supported by a registered TSN adapter. The
Solana side still performs the existing authorized debit and payout flow. For a
Creditcoin destination, the node translates the finalized Solana evidence into
a destination-specific payload and routes the payout to the selected EVM
address.

Attestcoin does not currently prove a Solana transaction directly through its
EVM Block Prover path. The deployable proof-shaped route is therefore:

```text
Solana two-phase exit
  -> TSN node observes the finalized exit evidence
  -> Ethereum Sepolia anchor records the evidence digest
  -> Attestcoin proof worker obtains the EVM inclusion proof
  -> Creditcoin ASC verifies the proof through 0x0FD2
  -> optional TinExitAttested receipt is emitted on Creditcoin
```

The receipt is optional and informational. It does not mint raw TIN, create a
second liability, move Solana funds, or change the Solana debit/credit path.

## Preserved invariants

- Sealed TIP head remains an in-place 48-byte encrypted value plus its commit.
- Exit intent records the commitment; payout consumes the permit without a
  source TIP argument.
- Path 1 deposit-credit and Path 2 debit-credit liability wiring remains in the
  Solana program.
- The one-vault model and liability PDA remain authoritative.
- GPRU remains authorization and routing only; it never becomes a token account
  or balance container.
- Secondary chains receive an evidence digest and destination address, never a
  raw TIN or Solana private state.

## Environment policy

Testing is devnet/testnet-only. Do not use localnet and do not publish mainnet
addresses from this starter. Contract addresses, chain IDs, proof-builder URLs,
and transaction hashes belong in deployment records after a real test run.

See [architecture.md](./architecture.md),
[attestation-protocol.md](./attestation-protocol.md), and
[creditcoin-integration.md](./creditcoin-integration.md) for the operating
model. The TypeScript façade is in
[attestcoin-sdk-extension.ts](./attestcoin-sdk-extension.ts).

## Executable happy path

The executable pieces are under `contracts/`, `worker/`, and `scripts/`:

- `contracts/SepoliaAnchor.sol` records the canonical public evidence tuple and
  emits `TinExitAnchored`.
- `contracts/TinExitAttestedASC.sol` follows the official `ASCBase` and
  `EvmV1Decoder` pattern. Its inherited `execute` verifies the Sepolia proof
  through Creditcoin's native verifier at `0x0FD2`, then emits
  `TinExitAttested` with replay protection.
- `worker/tin-exit-attest-worker.ts` uses `@gluwa/usc-sdk` to wait for
  attestation, call `getProof`, locally run `PrecompileBlockProver.verifySingle`,
  and submit the proof to the ASC.

The implementation follows the [official Attestcoin SDK](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk)
and [custom-contract example](https://github.com/gluwa/attestcoin-protocol-examples/tree/main/bridge/custom-contracts-bridging).

### One-command testnet deployment

From this directory, copy `.env.example` to `.env`, provide a throwaway funded
testnet key and Sepolia RPC URL, then run:

```powershell
npm install
npm run deploy
```

The deployer rejects localnet URLs and requires Ethereum Sepolia chain ID
`11155111` plus CC3 Testnet chain ID `102031`. It writes addresses to
`deployments/latest.json`; no address or transaction hash is considered live
until this command succeeds.

After anchoring a real test exit, set `ANCHOR_TX_HASH` in `.env` and run:

```powershell
npm run worker
```

The worker prints the Sepolia anchor transaction and Creditcoin attestation
transaction. Do not replace those values with examples in public material.
