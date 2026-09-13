# Creditcoin EVM Cranker Adapter

The Creditcoin adapter is the execution boundary for a generic TSN Cranker. It
does not choose a route, create an authorization, generate a proof, or hold
settlement liquidity. It receives a Node-issued EIP-712 authorization and
submits exactly one `executeSettlement` transaction to the registered
`CreditcoinSettlementHub`.

## Execution checks

Before submission, the adapter:

1. validates every authorization field and signature format;
2. reads the Creditcoin registry and current liquidity observation;
3. checks route ID, executor, token, amount, and expiry against on-chain state;
4. calls `CreditcoinSettlementHub.executeSettlement`;
5. requires a successful receipt and `SettlementMessagePublished` event; and
6. returns the real transaction hash and Attestcoin message ID.

The private key belongs to the Cranker operator and must remain outside the
repository. The Node authorization signer is separate from the Cranker key.
The Cranker cannot modify the amount, recipient, route, token, nonce, or
commitments without causing the Creditcoin contract to reject the transaction.

## Integration boundary

```ts
import { CreditcoinCranker } from "@trustlink/tsn-cross-chain/creditcoin-cranker";

const cranker = new CreditcoinCranker({
  rpcUrl: process.env.CREDITCOIN_RPC_URL!,
  hub: process.env.CREDITCOIN_SETTLEMENT_HUB!,
  signerPrivateKey: loadPrivateKeyFromIgnoredFile(process.env.CREDITCOIN_CRANKER_KEYPAIR_FILE!),
  route: {
    rpcUrl: process.env.CREDITCOIN_RPC_URL!,
    registry: process.env.CREDITCOIN_LIQUIDITY_REGISTRY!,
    routeId: process.env.CREDITCOIN_ROUTE_ID!,
  },
});

const result = await cranker.submit(nodeAuthorization, nodeSignature);
console.log(result.transactionHash, result.messageId);
```

The authorization and signature must come from the Node. The adapter is not a
replacement for Node orchestration and is not an Attestcoin proof generator.

## Current evidence boundary

The adapter is compile-verified but must not be reported as live until a Node
authorization and a real CC3 Testnet transaction produce a successful
`SettlementMessagePublished` event. Record the Solana debit signature,
Creditcoin transaction hash, message ID, destination payout hash, and final
recipient balance in the testnet evidence log.
