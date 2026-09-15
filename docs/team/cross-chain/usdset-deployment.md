# USDSET deployment guide

## Intent

Deploy TSN's own CC3 settlement test asset, `TSN Dollar Settlement` (`USDSET`),
for the first Creditcoin liquidity route. This asset is a testnet token today;
it is not Circle USDC, Tether USDT, or a claim that future USD backing already
exists.

## Environment

Use the existing ignored Creditcoin deployer configuration and CC3 Testnet:

```text
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
DEPLOYER_PRIVATE_KEY_FILE=<local ignored key-file reference>
USDSET_MINT_RECIPIENT=<recipient EVM address, optional; defaults to deployer>
USDSET_INITIAL_SUPPLY=<explicit whole USDSET amount, up to 6 decimals>
```

`USDSET_INITIAL_SUPPLY` is required. The deployment helper does not guess the
amount of liquidity to create. The token uses 6 decimals and the owner receives
the `mint` authority.

## Commands

From `tsn-protocol/services/tsn-crosschain`:

```powershell
npx tsx scripts/deploy-usdset.ts --compile-only
npm run deploy:usdset
```

The first command is compile-only. The second submits two CC3 transactions:
contract deployment and the initial mint. The script checks CC3 chain ID
`102031`, rejects localnet RPCs, waits for mined receipts, and prints the token
address plus both transaction hashes without printing private key material.

## Expected result

Record the following from the deployment output:

- USDSET contract address;
- deployment transaction hash;
- initial mint transaction hash;
- mint recipient and base-unit amount;
- CC3 explorer links for both receipts.

## Observed implementation state

The Solidity contract and TypeScript deployment helper compiled successfully
with the repository's `viaIR` compiler settings. The first CC3 deployment used
an explicit supply of `1,000,000` USDSET and minted it to the deployer.

Observed deployment evidence:

- Contract: [`0xA6a0e01Dbaf91aE8fa46Ff7B832c23E735A269a9`](https://creditcoin-testnet.blockscout.com/address/0xA6a0e01Dbaf91aE8fa46Ff7B832c23E735A269a9)
- Deployment transaction: [`0x6b7fd3338a1ac80bf3f884ab084132265d1f6199704e7f81846a1cfb45b665b3`](https://creditcoin-testnet.blockscout.com/tx/0x6b7fd3338a1ac80bf3f884ab084132265d1f6199704e7f81846a1cfb45b665b3)
- Initial mint transaction: [`0x04acf72a7dc56f913839fc09c6bc60201412c5bec612efd49c4a27d38721c63c`](https://creditcoin-testnet.blockscout.com/tx/0x04acf72a7dc56f913839fc09c6bc60201412c5bec612efd49c4a27d38721c63c)

This proves token deployment and minting only. It does not yet prove route
registration, vault funding, liquidity observation, or payout.

## After deployment

1. Configure the Creditcoin direct route with the exact USDSET address.
2. Ensure the route vault uses USDSET, not BTKT or an unverified token.
3. Transfer USDSET to the route vault.
4. Call `observeLocalLiquidity(routeId, validUntil, nonce)` on the direct
   registry.
5. Verify the observed balance and route state through CC3 RPC and Blockscout.
6. Only then run the Node route gate and settlement test.

The current direct route is still configured for BTKT with zero liquidity. A
new USDSET route or controlled route reconfiguration must be recorded before
claiming a USDSET payout.
