import "dotenv/config";
import { readFileSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Wallet, id } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertNoLocalnet(url: string): void {
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) {
    throw new Error("Destination deployment is Devnet/Testnet-only; localnet is forbidden");
  }
}

function importResolver(importPath: string): { contents?: string; error?: string } {
  const candidates = [
    join(root, "contracts", importPath),
    join(root, "node_modules", importPath),
    join(root, "node_modules", "@gluwa", "asc-contracts", "node_modules", importPath),
  ];
  for (const candidate of candidates) {
    try {
      return { contents: readFileSync(candidate, "utf8") };
    } catch {
      // Try the next package-relative candidate.
    }
  }
  return { error: `Import not found: ${importPath}` };
}

async function compile(fileName: string, contractName: string): Promise<{ abi: any[]; bytecode: string }> {
  const source = await readFile(join(root, "contracts", fileName), "utf8");
  const input = {
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: importResolver }));
  const errors = (output.errors ?? []).filter((item: { severity: string }) => item.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((item: { formattedMessage: string }) => item.formattedMessage).join("\n"));
  const artifact = output.contracts[fileName][contractName];
  if (!artifact?.evm?.bytecode?.object) throw new Error(`No ${contractName} bytecode generated`);
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
}

async function main(): Promise<void> {
  const rpcUrl = required("DESTINATION_RPC_URL");
  const privateKey = required("DESTINATION_DEPLOYER_PRIVATE_KEY");
  assertNoLocalnet(rpcUrl);

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const deployer = new Wallet(privateKey, provider);
  const destinationNetwork = required("DESTINATION_NETWORK").trim().toLowerCase();
  const token = required("DESTINATION_TOKEN");
  const inbox = required("DESTINATION_ATTESTCOIN_INBOX");
  const creditcoinHub = required("CREDITCOIN_SETTLEMENT_HUB");
  const creditcoinChainId = BigInt(process.env.CREDITCOIN_CHAIN_ID ?? "102031");
  const networkHash = id(destinationNetwork);

  const vaultArtifact = await compile("TSNERCLiquidityVault.sol", "TSNERCLiquidityVault");
  // The deployer is temporary executor to break the vault/executor address cycle.
  const vault = await new ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, deployer)
    .deploy(deployer.address, token, deployer.address);
  const vaultDeploymentTx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  const executorArtifact = await compile("TSNSettlementExecutor.sol", "TSNSettlementExecutor");
  const executor = await new ContractFactory(executorArtifact.abi, executorArtifact.bytecode, deployer)
    .deploy(inbox, deployer.address, creditcoinChainId, creditcoinHub, networkHash, vaultAddress, token);
  const executorDeploymentTx = executor.deploymentTransaction();
  await executor.waitForDeployment();
  const executorAddress = await executor.getAddress();
  const executorUpdateTx = await (vault as any).setExecutor(executorAddress);
  await executorUpdateTx.wait();

  const deployment = {
    destinationNetwork,
    destinationChainId: Number(network.chainId),
    destinationToken: token,
    attestcoinInbox: inbox,
    creditcoinSettlementHub: creditcoinHub,
    creditcoinChainId: Number(creditcoinChainId),
    liquidityVault: vaultAddress,
    settlementExecutor: executorAddress,
    deploymentTxs: {
      liquidityVault: vaultDeploymentTx?.hash ?? null,
      settlementExecutor: executorDeploymentTx?.hash ?? null,
      executorUpdate: executorUpdateTx.hash,
    },
    nextStep: "Prefund liquidityVault, then configure the matching route on Creditcoin DestinationLiquidityRegistry.",
    deployedAt: new Date().toISOString(),
  };
  const deploymentDir = join(root, "deployments");
  await mkdir(deploymentDir, { recursive: true });
  await writeFile(join(deploymentDir, `${destinationNetwork}.json`), `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
