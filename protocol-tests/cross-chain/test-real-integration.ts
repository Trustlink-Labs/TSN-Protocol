import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Interface,
  JsonRpcProvider,
  getAddress,
} from "../../tsn-protocol/services/tsn-crosschain/node_modules/ethers";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const crossChainEnvPath = join(
  packageRoot,
  "../../tsn-protocol/services/tsn-crosschain/.env",
);
try {
  process.loadEnvFile?.(crossChainEnvPath);
} catch {
  // Environment variables may be supplied by the shell or CI instead.
}
const creditcoinRpc =
  process.env.CREDITCOIN_RPC_URL?.trim() ||
  "https://rpc.cc3-testnet.creditcoin.network";
const solanaRpc =
  process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";
const nodeUrl = (
  process.env.TSN_NODE_URL?.trim() || "http://127.0.0.1:8000"
).replace(/\/$/, "");
const cc3ChainId = 102031n;
const hubInterface = new Interface([
  "event SettlementMessagePublished(bytes32 indexed settlementId,bytes32 indexed routeId,bytes32 indexed messageId,address destinationExecutor,address token,address recipient,uint256 amount,uint256 nonce)",
]);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(
      `Missing ${name}; no real integration evidence can be verified`,
    );
  return value;
}

function assertHash(value: string, name: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} must be a 32-byte transaction hash`);
  return value;
}

async function solanaSignatureStatus(
  signature: string,
): Promise<Record<string, unknown>> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(signature)) {
    throw new Error(
      "SOLANA_INTENT_TX_SIGNATURE is not a valid Solana signature format",
    );
  }
  const response = await fetch(solanaRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignatureStatuses",
      params: [[signature], { searchTransactionHistory: true }],
    }),
  });
  if (!response.ok)
    throw new Error(`Solana RPC returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    error?: unknown;
    result?: { value?: Array<Record<string, unknown> | null> };
  };
  if (body.error)
    throw new Error(`Solana RPC error: ${JSON.stringify(body.error)}`);
  const status = body.result?.value?.[0];
  if (!status) throw new Error("Solana intent signature was not found");
  if (status.err !== null)
    throw new Error(`Solana intent failed: ${JSON.stringify(status.err)}`);
  return status;
}

async function main(): Promise<void> {
  console.log("=== TSN Real Cross-Chain Evidence Verification ===");
  console.log(
    "Node decides; Cranker submits; this harness only verifies completed transactions",
  );

  const deploymentPath =
    process.env.TSN_CREDITCOIN_DEPLOYMENT_FILE?.trim() ||
    join(
      packageRoot,
      "../../tsn-protocol/services/tsn-crosschain/deployments/creditcoin-latest.json",
    );
  const deployment = JSON.parse(await readFile(deploymentPath, "utf8")) as {
    chainId: number;
    contracts?: { creditcoinSettlementHub?: string };
  };
  if (deployment.chainId !== Number(cc3ChainId))
    throw new Error(
      `Deployment evidence is not CC3 Testnet: ${deployment.chainId}`,
    );
  const hubAddress = getAddress(
    deployment.contracts?.creditcoinSettlementHub || "",
  );

  const provider = new JsonRpcProvider(creditcoinRpc);
  const network = await provider.getNetwork();
  if (network.chainId !== cc3ChainId)
    throw new Error(
      `Expected CC3 chain ID ${cc3ChainId}, got ${network.chainId}`,
    );
  for (const [label, address] of Object.entries(deployment.contracts || {})) {
    const code = await provider.getCode(getAddress(address));
    if (code === "0x")
      throw new Error(`${label} has no deployed bytecode at ${address}`);
    console.log(`Verified bytecode: ${label} ${address}`);
  }

  console.log(`Checking Node route gate at ${nodeUrl}/settlement-networks ...`);
  const nodeResponse = await fetch(`${nodeUrl}/settlement-networks`);
  if (!nodeResponse.ok)
    throw new Error(`Node route gate returned HTTP ${nodeResponse.status}`);
  const routes = await nodeResponse.json();
  if (!Array.isArray(routes) || routes.length === 0)
    throw new Error(
      "Node route gate returned no configured destination routes",
    );
  console.log(`Node route gate: ${routes.length} configured route(s)`);

  const solanaSignature = required("SOLANA_INTENT_TX_SIGNATURE");
  console.log("Checking Solana intent transaction ...");
  const solanaStatus = await solanaSignatureStatus(solanaSignature);
  console.log(`Solana intent confirmed: ${solanaSignature}`);
  console.log(`Solana confirmation: ${JSON.stringify(solanaStatus)}`);

  const creditcoinHash = assertHash(
    required("CREDITCOIN_SETTLEMENT_TX_HASH"),
    "CREDITCOIN_SETTLEMENT_TX_HASH",
  );
  console.log("Checking Creditcoin settlement transaction ...");
  const receipt = await provider.getTransactionReceipt(creditcoinHash);
  if (!receipt)
    throw new Error("Creditcoin settlement transaction is not mined");
  if (receipt.status !== 1)
    throw new Error("Creditcoin settlement transaction failed");
  if (!receipt.to || getAddress(receipt.to) !== hubAddress)
    throw new Error(
      `Creditcoin transaction target is not the deployed Settlement Hub: ${receipt.to}`,
    );
  const published = receipt.logs
    .map((log) => {
      try {
        return hubInterface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "SettlementMessagePublished");
  if (!published)
    throw new Error("SettlementMessagePublished event was not found");

  console.log(`Creditcoin settlement confirmed: ${receipt.hash}`);
  console.log(
    `SettlementMessagePublished event: ${JSON.stringify(published.args)}`,
  );
  console.log(
    "Real cross-chain evidence verified. No transaction was submitted by this verifier.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
