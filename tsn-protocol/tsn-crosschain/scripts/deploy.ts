import "dotenv/config";
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertNoLocalnet(url: string): void {
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) {
    throw new Error("Creditcoin deployment must use devnet/testnet; localnet is forbidden");
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
      // Continue through package-relative candidates.
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
  const rpcUrl = required("CREDITCOIN_RPC_URL");
  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  assertNoLocalnet(rpcUrl);

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 102031n) {
    throw new Error(`Expected Creditcoin CC3 Testnet (102031), got ${network.chainId}`);
  }

  const deployer = new Wallet(privateKey, provider);
  const signer = process.env.CREDITCOIN_AUTHORIZATION_SIGNER ?? deployer.address;
  const attestToken = required("CREDITCOIN_ATTEST_TOKEN");
  const registryArtifact = await compile("DestinationLiquidityRegistry.sol", "DestinationLiquidityRegistry");
  const registry = await new ContractFactory(registryArtifact.abi, registryArtifact.bytecode, deployer).deploy(deployer.address);
  const registryDeploymentTx = registry.deploymentTransaction();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  const ascArtifact = await compile("DestinationLiquidityASC.sol", "DestinationLiquidityASC");
  const asc = await new ContractFactory(ascArtifact.abi, ascArtifact.bytecode, deployer).deploy(registryAddress);
  const ascDeploymentTx = asc.deploymentTransaction();
  await asc.waitForDeployment();
  const ascAddress = await asc.getAddress();
  await (await (registry as any).setLiquidityASC(ascAddress)).wait();

  const hubArtifact = await compile("CreditcoinSettlementHub.sol", "CreditcoinSettlementHub");
  const hub = await new ContractFactory(hubArtifact.abi, hubArtifact.bytecode, deployer).deploy(signer, attestToken, registryAddress);
  const hubDeploymentTx = hub.deploymentTransaction();
  await hub.waitForDeployment();
  const hubAddress = await hub.getAddress();
  await (await (registry as any).setSettlementHub(hubAddress)).wait();

  const deployment = {
    chain: "creditcoin-cc3-testnet",
    chainId: Number(network.chainId),
    settlementHub: hubAddress,
    destinationLiquidityRegistry: registryAddress,
    destinationLiquidityASC: ascAddress,
    attestcoinSmartContract: ascAddress,
    authorizationSigner: signer,
    attestToken,
    deploymentTxs: {
      settlementHub: hubDeploymentTx?.hash ?? null,
      destinationLiquidityRegistry: registryDeploymentTx?.hash ?? null,
      destinationLiquidityASC: ascDeploymentTx?.hash ?? null,
    },
    enabledDestinationNetworks: [],
    supportedDestinationNetworks: ["creditcoin-testnet", "base", "ethereum"],
    routeStatus: "no destination is active until its executor, Inbox/Outbox route, token, and verified liquidity are registered",
    deployedAt: new Date().toISOString(),
  };
  const deploymentDir = join(root, "deployments");
  await mkdir(deploymentDir, { recursive: true });
  await writeFile(join(deploymentDir, "latest.json"), `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
