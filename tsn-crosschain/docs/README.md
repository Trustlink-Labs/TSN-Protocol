# TSN Cross-Chain

This folder is the EVM and Attestcoin boundary for TSN. Solana remains the
source accounting chain for TIN debit commitments, sealed TIP state, two-phase
exit permits, Path 1/2 liability movement, one-vault custody, and GPRU-only
authorization. None of those Solana programs are changed here.

## The settlement model

Creditcoin is the first EVM settlement domain and the source chain for onward
EVM instructions. The user selects a destination network, but TSN accepts the
route only when the network, payout contract, token, and destination liquidity
are registered and proof-backed.

```text
SVM debit intent
  -> Node validates route and destination-liquidity readiness
  -> Creditcoin consumes the authorized Solana commitment
  -> Creditcoin publishes an authenticated destination instruction
  -> Attestcoin route delivers it to the selected EVM payout contract
  -> destination vault pays the recipient in stablecoin
```

The direct Creditcoin route uses the funded `CreditcoinSettlementHub`. An
other-EVM route uses a destination payout vault. Native CTC or the destination
chain's native token pays gas; stablecoins are the settlement value.

## What Attestcoin verifies

The official Attestcoin readability pattern uses a source-chain contract that
emits a structured event, an off-chain proof worker, a Creditcoin ASC, and the
native Block Prover precompile at `0x0FD2`. The ASC verifies the Merkle and
continuity proofs and then executes Creditcoin business logic. See the
[official dApp infrastructure](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure).

For TSN, a destination liquidity contract emits a structured
`LiquidityAvailable` observation. `DestinationLiquidityASC.sol` verifies that
source event and records it in `DestinationLiquidityRegistry.sol`. The registry
does not custody funds; it records which routes are supported and which
liquidity observations are currently valid.

The SDK/proof worker does not create liquidity. The destination vault supplies
the stablecoins. The destination route must be supported by Attestcoin and have
an approved payout contract before TSN accepts it.

## Contracts

- `CreditcoinSettlementHub.sol`: direct Creditcoin stablecoin reserve, signed
  Solana commitment consumption, replay protection, and payout.
- `DestinationLiquidityRegistry.sol`: supported EVM route registry, proof-backed
  liquidity observations, and reservation accounting for onward settlements.
- `DestinationLiquidityASC.sol`: the TSN Attestcoin Smart Contract deployed on
  Creditcoin. It verifies a registered EVM liquidity event via the Creditcoin
  native verifier and records the observation in the registry.
- `../worker/destination-liquidity-attest-worker.ts`: uses `@gluwa/usc-sdk` to
  wait for source attestation, obtain the proof, locally verify it, and submit
  it to the liquidity ASC.
- `future/BasePayoutVault.sol`: destination-vault template; it is not a claim
  that Base liquidity already exists.

## Deployment policy

Testing is Creditcoin CC3 Testnet/devnet and supported EVM testnets only. Localnet
is forbidden. `scripts/deploy.ts` deploys the Hub, destination-liquidity
registry, and the TSN Attestcoin Smart Contract, then writes deployment addresses to
`deployments/latest.json`. A destination route still requires explicit
`configureRoute` configuration and a verified liquidity observation before it
is eligible.

```powershell
cd tsn-protocol/tsn-crosschain
Copy-Item .env.example .env
npm install
npm run build
npm run deploy
```

Do not publish addresses or transaction hashes until the command succeeds on
the intended testnet.

## Official resources

- [Creditcoin](https://creditcoin.org/)
- [Creditcoin Deploy / Attestcoin](https://creditcoin.org/Deploy)
- [Creditcoin docs](https://docs.creditcoin.org/)
- [Attestcoin Protocol](https://docs.attestcoin.org/attestcoin-protocol)
- [Attestcoin dApp infrastructure](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure)
- [Attestcoin ASC contracts](https://www.npmjs.com/package/%40gluwa/asc-contracts)
- [Attestcoin examples](https://github.com/gluwa/attestcoin-protocol-examples)

The TSN facade remains in
[`tsn-protocol/tsn-sdk/src/cross-chain.ts`](../../tsn-sdk/src/cross-chain.ts)
and does not expose direct TCAP or TIN implementation imports.
