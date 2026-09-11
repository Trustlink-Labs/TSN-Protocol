# Attestcoin SDK Extension

This extension keeps applications on the TSN facade while adding destination
route and verified-liquidity primitives. Applications do not import TCAP or TIN
implementation modules directly.

## Two distinct SDK/protocol paths

### Readability: verify destination liquidity

The destination EVM liquidity contract emits a structured event. The Node-side
proof worker uses the official USC SDK pattern to wait for source-block
attestation, obtain the proof, and locally verify it with
`PrecompileBlockProver.verifySingle`. The proof is then submitted to
`DestinationLiquidityASC` on Creditcoin.

The ASC verifies the proof on-chain and records the result in
`DestinationLiquidityRegistry`. This is the cryptographic route-eligibility
record that the Node consumes before allowing a payout route.

### Writability: trigger destination payout

After Creditcoin consumes the Solana commitment, the Creditcoin-side message
route publishes an authenticated instruction for the selected EVM network. A
relayer delivers it to the destination Inbox, which verifies the message and
invokes the destination payout contract. The payout contract transfers the
stablecoin from its own prefunded vault.

The SDK/proof worker and message relayer do not create liquidity and do not
replace the destination payout contract.

## TSN facade primitives

`src/destination-liquidity.ts` provides:

- supported destination EVM route types;
- deterministic route IDs;
- the canonical `LiquidityAvailable` event signature and topic;
- proof-backed observation validation with amount and expiry checks; and
- a preflight guard that rejects unverified or expired destination liquidity.

The primitives carry route addresses, token identifiers, amounts, nonces,
expiry values, and hashes. They do not carry raw TIN values, device keys, or
private balances.

## Operational rules

1. Run the fast destination RPC preflight before the SVM debit intent is
   submitted.
2. Require a current Creditcoin registry observation before authorizing an
   onward destination route.
3. Bind the destination route, token, recipient, amount, nonce, and expiry to
   the authenticated settlement instruction.
4. Let the destination payout contract perform the final balance check and
   stablecoin transfer atomically.
5. Keep proof generation and relaying off the browser and out of Solana
   program logic.

Official references: [Attestcoin dApp infrastructure](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure),
[ASC contracts](https://www.npmjs.com/package/%40gluwa/asc-contracts), and the
[official examples](https://github.com/gluwa/attestcoin-protocol-examples).
