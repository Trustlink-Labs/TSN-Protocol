# Cross-chain guides

Use this category for Creditcoin settlement, Attestcoin messaging, destination
liquidity, EVM executors, and cross-network route activation.

- [Cross-network build plan](../../CROSS-NETWORK-PAYMENTS-BUILD-PLAN.md)
- [Cross-network research](../../CROSS-NETWORK-PAYMENTS-RESEARCH.md)
- [TSN cross-chain source docs](../../../tsn-protocol/tsn-crosschain/docs/README.md)
- [Creditcoin-first settlement](../../../tsn-protocol/tsn-crosschain/docs/creditcoin-first-settlement.md)
- [Cross-chain architecture](../../../tsn-protocol/tsn-crosschain/docs/architecture.md)
- [Creditcoin navigation and deployment experience](./creditcoin-navigation.md)
- [Direct Creditcoin settlement](./creditcoin-direct-settlement.md) — the
  first destination prototype: registry, stablecoin vault, executor, and
  direct Solana-commitment settlement.
- [Direct Creditcoin settlement](./creditcoin-direct-settlement.md)
  â€” the first destination prototype: registry, stablecoin vault, executor,
  and direct Solana-commitment settlement.

Every route guide must identify the source accounting chain, Creditcoin
settlement boundary, destination executor, local stablecoin vault, Attestcoin
message boundary, Cranker submission, and real transaction evidence required
for activation.

The [verified-addresses.md](./verified-addresses.md) register contains the
observed Solana Devnet and Creditcoin CC3 Testnet contract and token addresses.
It intentionally leaves unsupported chains and unverified USDC/USDT addresses
out of the active route inventory.

- [USDSET deployment guide](./usdset-deployment.md) â€” deploy and fund TSN's
  own CC3 settlement test asset with explicit evidence.
- [SDK test UI guide](./sdk-ui-test.md) â€” run the same Node and Creditcoin
  evidence checks from the test UI.

## CC3 Testnet deployment gate

The Creditcoin testnet deployer key must be loaded from a local, private
operator-controlled key store. Never publish the filesystem path, wallet
address, private key, or seed material in repository documentation. The key
is testnet-only and must remain outside the repository.

Before creating tsn-crosschain/.env or submitting a deployment transaction,
the operator must have all of the following locally:

1. CREDITCOIN_RPC_URL set to the CC3 Testnet RPC.
2. DEPLOYER_PRIVATE_KEY loaded from the local Creditcoin key file.
3. A real CREDITCOIN_ATTEST_TOKEN address supplied by the CC3 testnet
   deployment, not a placeholder.
4. The authorization signer address, if it is different from the deployer.
5. A destination route, executor, Inbox/Outbox configuration, and prefunded
   stablecoin vault for payout testing.

The faucet transaction proves native CTC gas funding only. It does not prove
that the Attestcoin token, destination stablecoin, route registry, or payout
vault is configured.

The current deploy script must be checked before running it. A successful
source compilation is not evidence that every required contract was deployed.
Record each deployed address and transaction hash, then verify the address on
the Creditcoin testnet explorer. Do not claim the cross-chain happy path is
live until a real Solana debit transaction, real Creditcoin settlement
transaction, and expected on-chain event have been observed.

Use the [Creditcoin navigation and deployment experience](./creditcoin-navigation.md)
for the team procedure. It records the difference between Blockscout's EVM
view and Subscan's runtime view, the current CC3 requirements, the
Attestcoin boundary, and the observed deployment milestone.

### Latest deployment attempt

The deployment script now validates the CC3 RPC, authorization signer, and
Attestcoin fee-token address before any transaction. Destination vault and
executor deployment is a separate operation on the selected EVM destination.

The deploy:devnet alias was executed against the CC3 Testnet configuration. The
local key-file loader and authorization signer validation passed. The attempt
stopped before any transaction because the Attestcoin token value was still a
placeholder:

    Invalid EVM address in CREDITCOIN_ATTEST_TOKEN

No deployment transaction was submitted. The next implementation step is to
confirm the real CC3 Attestcoin fee-token role, then deploy the destination
vault/executor and configure the route separately. Do not add a Sepolia anchor
to the normal Solana-origin settlement path.
