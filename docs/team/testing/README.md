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

## TSN Devnet deployment gate

The TSN program ID is
`TSN31jddtsmUg4D5aEdhY31nwB1e53VJJg9X8NoRP8V`. A program account on Devnet
proves that some version of the program is deployed; it does not prove that
the current local Rust source and `.so` binary are the version on-chain.

Verify the existing Devnet deployment before attempting a new deployment:

```powershell
solana program show TSN31jddtsmUg4D5aEdhY31nwB1e53VJJg9X8NoRP8V --url devnet
```

The current observed account is owned by the upgradeable BPF loader and has a
program-data account, so the TSN program exists on Devnet. The local Windows
deployment gate currently stops before building when `cargo build-sbf` is not
installed. Do not claim that the latest source is deployed until the pinned
Devnet toolchain is available and the following sequence completes:

```powershell
npm run deploy:doctor
npm run tsn:program:build:devnet
npm run tsn:program:deploy:devnet
solana program show TSN31jddtsmUg4D5aEdhY31nwB1e53VJJg9X8NoRP8V --url devnet
```

If the Windows toolchain is incomplete, run the same guarded sequence in the
WSL environment that owns the funded Devnet signer. Record the resulting
deployment signature and program-data state before creating a debit intent.
The next cross-chain gate remains separate: Creditcoin's
`latestObservation(routeId)` must also be current before the Node exposes the
destination route.

## TIN program deployment gate

The private TIN registry is a separate Solana program from TSN escrow:

```text
Program ID: TinseNnU588NkmRZBe4ADJbxqrqQma92678UFP6VuwT
```

Verify it independently:

```powershell
solana program show TinseNnU588NkmRZBe4ADJbxqrqQma92678UFP6VuwT --url devnet
```

The observed Devnet account is owned by the upgradeable BPF loader and has
program data, so the TIN program is deployed. That does not mean a particular
private TIN exists: the TIN registry state and the private TIN PDA must still
be initialized/created through the TIN SDK and program instruction before a
TIN debit intent can reference it.

### Observed TIN upgrade status

The live TIN program was last deployed at Devnet slot `481383589`, whose block
time was `2026-08-05T12:09:41Z`. The local `tins_program.so` was also last
written on August 5. The TIN source has a newer repository commit from
September 13, so the upgraded source has not yet been deployed to Devnet.
Treat the live TIN program as the previous deployment until the guarded build
and deploy sequence produces a new deployment receipt or slot.
