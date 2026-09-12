# EVM network adapter template

Solana is TSN's settlement source and remains outside this EVM adapter tree.
Each supported EVM destination gets one adapter folder with:

1. A destination liquidity vault and settlement executor deployment record.
2. A network-specific deployment script or configuration file.
3. An Attestcoin liquidity-observation contract only when that destination
   exposes a proof-readable EVM liquidity event.
4. A runbook containing RPC, chain ID, chain key, token, finality, fee asset,
   explorer, Attestcoin role, and observed testnet evidence.

The adapter receives an authorized message derived from the Solana debit
commitment through Creditcoin. It must not change Solana programs, TIN privacy boundaries, GPRU
authorization, liability PDAs, or the shared settlement contracts.
