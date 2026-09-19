# Creditcoin-first settlement

Creditcoin is the first settlement and authenticated-message rail. The hub
does not pay every destination itself; each destination has its own prefunded
stablecoin vault and executor. Solana programs, sealed TIP state,
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
        | consumes commitment and publishes an authenticated payout message
        v
Selected EVM Inbox -> destination executor -> local stablecoin vault -> recipient
```

Messages and attestations are not funds. The destination vault has the real
ERC-20 stablecoin balance and releases it only through its registered executor.
The `CreditcoinSettlementHub` publishes a payout message only when the Node's EIP-712
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

The destination boundary is implemented by `TSNERCLiquidityVault.sol` and
`TSNSettlementExecutor.sol`. A provider or treasury prefunds the vault on the
selected EVM network; Attestcoin delivers the authenticated instruction and
the executor pays the recipient. The direct Creditcoin and onward-EVM paths
remain one Solana debit transaction plus the required EVM submission(s), not a
second Solana payout.

## Devnet deployment

Set `CREDITCOIN_RPC_URL` to the CC3 testnet RPC and provide
`DEPLOYER_PRIVATE_KEY`. The deployer is the default authorization signer; use
`CREDITCOIN_AUTHORIZATION_SIGNER` when the Node authorization key is separate.

```powershell
Set-Location tsn-protocol/services/tsn-crosschain
npm install
$env:CREDITCOIN_RPC_URL="https://rpc.cc3-testnet.creditcoin.network/"
$env:DEPLOYER_PRIVATE_KEY="<devnet-only-key>"
$env:CREDITCOIN_FEE_RECIPIENT="<creditcoin-fee-recipient>"
$env:CREDITCOIN_FEE_BPS="10"
npm run deploy
```

Prefund each deployed destination vault with the configured testnet stablecoin
before submitting an exit. Keep native CTC or the destination chain's native
token available for gas. The
per-exit flow is one Solana debit-commitment transaction followed by one
Creditcoin exit transaction. No second Solana payout transaction is created by
this cross-chain route. No Sepolia anchor, proof worker, or localnet process is
part of this Creditcoin-first path.
