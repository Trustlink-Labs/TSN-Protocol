# Cranker TIN-operation job

## Scope

Every online Cranker remains a generic TSN operator. The daemon leases `AUTHORIZED_FUNDING`, `SETTLEMENT`, and `TIN_OPERATION` work through the Receiver and selects the network-specific adapter only after the Node has authorized the work.

## What changed

The daemon now accepts `TIN_OPERATION` work. For a verified `tin_creation`, it submits the existing `CreateTinV1` instruction to the Solana TIN program with the owner Ed25519 proof, the global-state PDA, and the commitment-derived `tin-v1` registry PDA. The SDK owns the byte layout through `serializeTinV1CreationParams`; the daemon does not hand-build the protocol payload.

## Privacy boundary

The lookup secret, plaintext TIN identity, and display name do not enter the Cranker view. The Node passes only the lookup commitment, owner authorization, and encrypted envelopes required by the on-chain instruction. Public operation reads expose a TIN hash and omit encrypted identity material.

## Required sequence

1. The owner creates and signs a TIN creation intent through the TSN SDK.
2. The Node validates the encrypted route, owner signature, expiry, and `TSN_TIN_V1_CREATE` commitment.
3. The Receiver leases the verified work to any admitted Cranker.
4. The Cranker submits the owner Ed25519 instruction followed by `CreateTinV1`.
5. The Cranker reports the Solana signature; the Node/Receiver retain the evidence and status transition.

## Verification checklist

- `python -m py_compile tsn-protocol/tsn-node/server.py`
- `npm run build` from `tsn-protocol/tsn-sdk`
- `npx tsc --noEmit -p tsconfig.json` from `tsn-protocol/tsn-cranker-op-daemon`
- Receiver production build and deployment must be run from the Receiver repository before claiming the hosted path is live.

This runbook describes the implemented local boundary. It does not claim a real TIN transaction until a Devnet signature is recorded in the evidence log.
