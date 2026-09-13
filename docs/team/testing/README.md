# Testing and release guides

Use this category for Devnet evidence, test sequences, deployment review, and
release gates.

- [Devnet build and deploy](../../DEVNET-BUILD-DEPLOY.md)
- [Operations and testing](../../operations-and-testing.md)
- [TCAP Devnet credit smoke](../../tcap-devnet-credit-smoke.md)
- [TCAP v2 Devnet](../../TCAP-V2-DEVNET.md)
- [Protocol TCAP credit smoke](../../protocol-tests-tcap-credit-smoke.md)

Tests are evidence-producing procedures. A build proves compilation; a
simulation proves local behavior; only confirmed Devnet/Testnet transactions
prove an on-chain path. Guides must print real signatures and explorer links,
never placeholders.

## Windows and WSL signer context

When the repository is operated from Windows with the Solana CLI installed in
WSL, run Solana commands inside WSL so the configured signer is preserved:

```bash
wsl.exe bash -lc 'solana config get; solana address; solana balance'
```

The WSL signer is normally stored at `/home/<user>/.config/solana/id.json`.
Do not replace it with a Windows-side keypair merely because the Windows CLI
cannot see the WSL configuration. Confirm the RPC is Solana Devnet and record
only the public address and balance in team evidence; never copy the private
key or seed phrase into logs or documentation.
