# Single Generic Cranker Runtime

TSN uses one Cranker process with multiple network adapters. It is not split
into a Solana Cranker and a Creditcoin Cranker. The same operator leases work
from the Receiver, submits the exact Solana transaction when the work requires
Solana, and switches to the configured EVM signer when the work requires a
Creditcoin settlement.

## Required runtime services

| Service            | Runtime                    | Purpose                                               |
| ------------------ | -------------------------- | ----------------------------------------------------- |
| Solana Devnet RPC  | remote                     | Source-chain reads and transactions                   |
| Creditcoin CC3 RPC | remote                     | EVM settlement reads and transactions                 |
| TSN Receiver       | deployed service           | Durable work queue and Cranker leases                 |
| TSN Node           | local or deployed          | Intent validation, route admission, and authorization |
| Generic Cranker    | one local/deployed process | Solana and EVM transaction submission                 |
| Test UI            | local or deployed          | Calls the TSN SDK and displays evidence               |

No localnet validator is required.

## Cranker environment

The existing Solana fields remain unchanged:

```text
KEYPAIR_PATH=./keys/cranker-keypair.json
TSN_CRANKER_KEYPAIR_PATH=./keys/cranker-keypair.json
TSN_RPC_GATEWAY_URL=https://tsn-rpc-gateway.vercel.app
```

The same process now accepts the Creditcoin adapter fields:

```text
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
CREDITCOIN_CRANKER_KEYPAIR_FILE=../tsn-crosschain/.creds/creditcoin_cranker_keypair.json
CREDITCOIN_SETTLEMENT_HUB=0x29151Ff9266b8Fb15D86D22d73f084F59293438c
CREDITCOIN_LIQUIDITY_REGISTRY=0x764Ac587b1fC0feBEE86012cF7A2489b575EE5D1
CREDITCOIN_ROUTE_ID=0xd1c8fb4fdaa90f4b4cf7f385e0f426c0cc6130ecff6ac078f0c95b91125e3943
```

Never commit the EVM private key. It must be a Cranker operator key funded
with CTC for gas. It is separate from the Node authorization signer and does
not authorize payouts.

### Team key-generation procedure

Generate the dedicated CC3 Testnet EVM Cranker wallet from the daemon package:

```powershell
cd tsn-protocol/services/tsn-cranker-op-daemon
npm run creditcoin:key:fund
```

The command creates `tsn-crosschain/.creds/creditcoin_cranker_keypair.json`
only when it does not already exist, funds the public address from the funded
deployment account, and prints the public address, balance, and funding
transaction. It never prints the private key. The generated file is ignored by
Git and must be loaded through `CREDITCOIN_CRANKER_KEYPAIR_FILE` in the local
daemon environment. The observed CC3 funding result for the current test
wallet is 10 CTC at `0x0f42c93F992AdA97d4a8aF3348D7141741de242d`, confirmed by
transaction `0x042bac062e15be7be44dcf7198eab6956ef8aa4cad74e1ab54a63eafe79198af`.

## Start order

Start the Node, then the one Cranker process, then the test UI:

```powershell
# Window 1
python tsn-protocol/services/tsn-node/server.py --test-crosschain --receipt --network creditcoin-testnet --verbose

# Window 2
cd tsn-protocol/services/tsn-cranker-op-daemon
npm run crank:start

# Window 3
cd tsn-protocol/services/tsn-mempool-ui
npm run dev
```

The UI must use `@trustlink/tsn-sdk` for route discovery, preflight, intent
submission, and evidence display. It must not call Creditcoin directly.

## Funding gate

The Solana Cranker needs its existing Devnet SOL and TSN vault setup. The EVM
Cranker address needs CC3 Testnet CTC for gas. A CTC balance proves gas
availability only; USDSET liquidity remains in the registered Creditcoin vault.

The first demo evidence is complete only when one Solana transaction and one
Creditcoin transaction are confirmed, and the Creditcoin receipt contains the
expected settlement event. Starting the processes or passing route preflight is
not transaction evidence.

## Observed deployment gate

On 2026-09-13 the Cranker process started successfully with the Solana
operator identity, but repeated polling returned HTTP 404 from
`https://tsn-receiver-kappa.vercel.app/api/cranker/auth/challenge`. The local
Receiver source contains that POST route, so the observed failure indicates
that the deployed Receiver is stale or points at the wrong project root. The
required action is to deploy the current `tsn-receiver` service and confirm
that the challenge endpoint returns a JSON nonce before restarting the
Cranker. No Creditcoin transaction is attempted until this Receiver gate
passes.

After the Receiver repository reached `origin/main`, the same endpoint changed
from HTTP 404 to HTTP 403 with `CRANKER_OPERATOR_REVOKED_OR_UNKNOWN`. That
observed response exposed the old per-operator allowlist boundary. The
canonical replacement is the on-chain Mother DNA gate: the Receiver derives
the Mother Escrow and operator Cranker PDAs from the public Solana operator key,
reads the registered Cranker account from Solana Devnet, and verifies its
Mother Escrow, operator, and `dna_hash`. Any operator can join by registering
its own Cranker PDA through TSN; the Receiver does not need a new configuration
entry for each operator.

The public Solana key is the Receiver challenge identity, while the EVM key is
only the gas and settlement signer used after Node authorization. No Cranker
API key or per-Cranker Receiver allowlist is part of the canonical path. A
successful challenge returns HTTP 200 with a nonce; only then should the
Cranker be restarted for work leasing.

The Mother-DNA Receiver implementation was pushed to
`bigdreamsweb3/tsn-receiver` commit `550208d`. A live probe immediately after
the push still returned the legacy `CRANKER_OPERATOR_REVOKED_OR_UNKNOWN`
response, so Vercel deployment completion or project/branch linkage must be
verified before interpreting the next response. Once commit `550208d` is live,
an unregistered Solana operator should return `CRANKER_MOTHER_DNA_NOT_FOUND`,
while a registered on-chain Cranker PDA should receive the challenge nonce.
