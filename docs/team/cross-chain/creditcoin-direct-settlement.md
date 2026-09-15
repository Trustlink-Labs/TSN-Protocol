# Direct Creditcoin destination runbook

This is TSN's first EVM destination prototype. Solana remains the settlement
source: the Solana debit creates the commitment, the Node validates it, and a
Creditcoin transaction consumes the signed authorization and pays a Creditcoin
recipient from a prefunded stablecoin vault.

## Contract boundary

```text
Solana debit commitment
  -> TSN Node preflight and authorization
  -> CreditcoinDirectSettlementHub
  -> CreditcoinDirectLiquidityRegistry on-chain route check
  -> CreditcoinDirectSettlementExecutor
  -> TSNERCLiquidityVault
  -> Creditcoin recipient
```

The Node route list contains only the network, route ID, registry address, RPC,
and expected chain ID. It is a mirror for preflight, not a token or executor
authority. The Node reads the executor and token from the live Creditcoin
registry and checks the signed intent against those values. The direct Hub
reads the Creditcoin registry again during the transaction, checks the EIP-712
authorization, rejects replayed settlement IDs and nonces, reserves capacity,
and calls the executor. The executor can release only from the configured
vault.

## Build

```text
cd tsn-protocol/services/tsn-crosschain
npm run build
npx tsx scripts/deploy-creditcoin-direct.ts --compile-only
```

Expected result:

```text
Direct Creditcoin contracts compile successfully with viaIR
```

## CC3 deployment

Provide only real values in the ignored `.env`:

```text
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
DEPLOYER_PRIVATE_KEY_FILE=.creds/contract_auth_keypair.json
CREDITCOIN_AUTHORIZATION_SIGNER=0x...
USDSET_INITIAL_SUPPLY=1000000
TSN_ROUTE_ID=0x...
TSN_DESTINATION_NETWORK=creditcoin-testnet
```

Run:

```text
npm run deploy:creditcoin-direct
```

The command deploys USDSET, mints the explicit initial supply to the deployer,
then deploys the direct registry, vault, hub, and executor. It binds the vault
to the executor, configures the Creditcoin route with the USDSET address, and
binds the registry to the Hub. It prints mined transaction hashes. The token
address is passed directly between contract deployment transactions; runtime
settlement reads it from the live registry and vault. The command does not fund
the vault or pretend that liquidity exists.

## Liquidity admission

After the vault is funded with the approved stablecoin, the owner calls
`observeLocalLiquidity(routeId, validUntil, nonce)` on
`CreditcoinDirectLiquidityRegistry`. The registry records the actual vault
balance and expiry. The Node can then mirror the route and verify the live
registry state before accepting a Solana debit.

## Observed status

The direct contracts compile successfully. Deployment has not been claimed:
the direct Creditcoin contracts are now deployed and the route is active. The
test token is `Bridge Test Token` (`BTKT`), but the deployer balance is zero.
The route therefore has zero available liquidity, and no Solana debit or
Creditcoin payout transaction is recorded by this run. Evidence is stored in
`tsn-crosschain/deployments/creditcoin-direct-latest.json`.

The direct route is intentionally separate from the onward-EVM Attestcoin
Outbox/Inbox path. The same vault, executor authorization, replay protection,
and route-registry boundary can be reused by a future destination adapter.

## Latest USDSET route evidence

The USDSET-bound route is now deployed on CC3 Testnet. The registry is active,
the vault contains `1,000,000` USDSET, and `observeLocalLiquidity` has recorded
that capacity. The deployment and verification transactions are maintained in
the [verified address register](./verified-addresses.md). This proves route
admission and available liquidity; it does not yet prove a Solana-origin
settlement payout.

## Exact-token policy

The registry is the authority for the payout token. Each route stores one exact
ERC-20 contract address, and the Hub checks that address before the executor
releases funds. A USDC route pays USDC; a USDT route pays USDT. The direct lane
contains no swap or symbol substitution. The currently deployed CC3 prototype
points at the test token `BTKT` and has zero vault balance, so it is not evidence
of a funded `USDC-T` or `USDT-T` route. CC3 currently exposes those two test
assets as `USDC-Test` and `USDT-Test`; they are not presented as Circle USDC or
Tether USDT. See the
[verified address register](./verified-addresses.md) for the observed status.
