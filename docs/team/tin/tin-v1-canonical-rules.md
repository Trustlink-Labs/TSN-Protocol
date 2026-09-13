# Canonical TIN V1 Rules

This document is the internal source of truth for the replacement TIN registry. The approved privacy-preserving design is **TIN V1**. The previous registry implementation is obsolete and is not a compatibility target.

## Scope

TIN V1 is a fresh registry and resolver for new users on Solana Devnet. Existing accounts created by the previous implementation are not migrated, upgraded, or accepted by the new SDK and Node route gate. A fresh program deployment and fresh TIN issuance are required before the next end-to-end settlement test.

## On-chain data boundary

The TIN value and display name are not stored in cleartext. A TIN V1 account stores an opaque lookup commitment, an owner commitment, encrypted identity material, encrypted metadata references, and the TSN route commitments required for settlement coordination. The account may expose status, timestamps, route version, and cryptographic commitments, but not the identity plaintext.

The lookup commitment must be keyed with resolver-held secret material. Hashing a short TIN without a secret would allow exhaustive guessing and is not an acceptable privacy boundary. The resolver computes the commitment from the supplied TIN and protected lookup secret, then returns only the authorized identity disclosure needed for payment confirmation.

## Issuance

TIN V1 issuance uses cryptographically random issuance material and an explicit uniqueness check. A check digit may be used for input-error detection, but it is not treated as a privacy mechanism or as the source of uniqueness. The old sequential counter and raw-TIN PDA lookup are not part of TIN V1.

## Resolver behavior

The SDK exposes one TIN V1 resolver. It does not scan for old account layouts, return `accountKind: "legacy"`, set `upgradeRequired`, or silently reinterpret an old account as current. If the commitment or account schema is not TIN V1, resolution fails.

## Settlement boundary

TIN V1 supplies the authorized route commitments to TSN. It does not change sealed TIP handling, two-phase exit commitments, Path 1 or Path 2 wiring, one-vault accounting, liability PDAs, GPRU authorization, Node orchestration, Cranker submission, or Creditcoin settlement routing.

TSN remains TrustLink Labs' Transfer Settlement Network within the broader Decentralized Settlement Protocol (DESP) architecture. DeFi decentralizes financial services; DESP decentralizes settlement infrastructure.

## Deployment gate

The TIN V1 program must be deployed on Solana Devnet before any public demo claim. The deployment record must include the program ID, deployment transaction, fresh TIN issuance transaction, resolver evidence, and the later Solana-to-Creditcoin settlement transactions. No placeholder address or fabricated transaction hash is valid evidence.

## Runtime configuration

The existing SDK façade accepts the protected lookup secret through its resolver options, and the TSN Node accepts the same secret through `TINS_LOOKUP_SECRET`. The value must be provisioned through the team secret store or an ignored local environment file; it must never be committed, printed, or sent to the Receiver. When the variable is absent, the Node continues using the existing route reader until the fresh private-registry deployment is activated.

## Implementation observation

The private account parser now validates the account version, active status, keyed lookup commitment, owner commitment, encrypted identity envelope, route commitments, and complete account length before returning route material. It does not read a cleartext TIN or display name from the account. The SDK resolver decrypts the identity disclosure only after the caller supplies the protected lookup secret.
