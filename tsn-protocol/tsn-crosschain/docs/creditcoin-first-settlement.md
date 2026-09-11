# Creditcoin-first settlement

Creditcoin is the first live liquidity and settlement rail. The initial hub
holds configured stablecoin liquidity and pays Creditcoin addresses after the TSN Node has
validated the existing Solana exit flow. Solana programs, sealed TIP state,
two-phase exits, Path 1/2 wiring, liability PDAs, and the one-vault model are
unchanged.

## Value flow

```text
Solana debit commitment
        |
        | Node reads and validates the existing Solana debit commitment
        v
CreditcoinSettlementHub
        |
        | consumes commitment and pays from Creditcoin stablecoin liquidity
        v
Creditcoin recipient
```

Messages and attestations are not funds. The `CreditcoinSettlementHub` has a
real ERC-20 stablecoin balance and will execute a payout only when the Node's EIP-712
authorization matches the configured authorization signer. A Cranker submits
that exact authorization and cannot change the recipient, amount, hashes, or
network.

The contract stores only public settlement identifiers and hashes. It does not
receive raw TIN values, device keys, private balances, or Solana private state.

The Creditcoin fee is charged inside the same exit transaction. The Node signs
the exact `feeAmount`; the hub pays the recipient's net amount and sends the
fee to the configured fee recipient. Creditcoin can use a lower fee basis-point
configuration than a future destination network, so direct Creditcoin payouts
remain cheaper without adding a separate fee transaction.

## Other supported EVM networks

`base` and `ethereum` are represented as destination adapters and remain
disabled until each network has a registered payout contract and proof-backed
liquidity observation. Adding a network requires a destination vault and
liquidity provider that can pay actual stablecoin value on that network.
Attestcoin verifies supported source-chain data; the proof alone does not create
destination liquidity. See the [official Creditcoin
deployment overview](https://creditcoin.org/Deploy) and [Attestcoin
infrastructure documentation](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure).

The Base boundary is represented by
`contracts/future/BasePayoutVault.sol`. A provider or treasury prefunds that
vault on Base; the Attestcoin route supplies the authenticated destination
instruction and the vault pays the Base recipient. The direct Creditcoin path
remains a two-transaction user flow.

## Devnet deployment

Set `CREDITCOIN_RPC_URL` to the CC3 testnet RPC and provide
`DEPLOYER_PRIVATE_KEY`. The deployer is the default authorization signer; use
`CREDITCOIN_AUTHORIZATION_SIGNER` when the Node authorization key is separate.

```powershell
Set-Location tsn-protocol/tsn-crosschain
npm install
$env:CREDITCOIN_RPC_URL="https://rpc.cc3-testnet.creditcoin.network/"
$env:DEPLOYER_PRIVATE_KEY="<devnet-only-key>"
$env:CREDITCOIN_FEE_RECIPIENT="<creditcoin-fee-recipient>"
$env:CREDITCOIN_FEE_BPS="10"
npm run deploy
```

Fund the deployed hub with the configured testnet stablecoin before submitting
an exit. Keep native CTC available for gas. The
per-exit flow is one Solana debit-commitment transaction followed by one
Creditcoin exit transaction. No second Solana payout transaction is created by
this cross-chain route. No Sepolia anchor, proof worker, or localnet process is
part of this Creditcoin-first path.
