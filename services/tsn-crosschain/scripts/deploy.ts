import "dotenv/config";
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import {
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  getAddress,
} from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const CC3_CHAIN_ID = 102031n;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing " + name);
  return value;
}

function requiredAddress(name: string): string {
  const value = required(name);
  try {
    return getAddress(value);
  } catch {
    throw new Error("Invalid EVM address in " + name);
  }
}

function optionalAddress(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error("Missing " + name);
  try {
    return getAddress(value);
  } catch {
    throw new Error("Invalid EVM address in " + name);
  }
}

function privateKeyFromFile(): string {
  const direct = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (direct) return direct;

  const configured = process.env.DEPLOYER_PRIVATE_KEY_FILE?.trim() ||
    ".creds/contract_auth_keypair.json";
  const filePath = resolve(root, configured);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Unable to read DEPLOYER_PRIVATE_KEY_FILE");
  }
  const privateKey = parsed && typeof parsed === "object"
    ? (parsed as { privateKey?: unknown }).privateKey
    : undefined;
  if (typeof privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("DEPLOYER_PRIVATE_KEY_FILE does not contain a valid privateKey");
  }
  return privateKey;
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
  return { error: "Import not found: " + importPath };
}

async function compile(
  fileName: string,
  contractName: string,
): Promise<{ abi: any[]; bytecode: string }> {
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
  const errors = (output.errors ?? []).filter(
    (item: { severity: string }) => item.severity === "error",
  );
  if (errors.length > 0) {
    throw new Error(errors.map((item: { formattedMessage: string }) => item.formattedMessage).join("\n"));
  }
  const artifact = output.contracts[fileName]?.[contractName];
  if (!artifact?.evm?.bytecode?.object) {
    throw new Error("No " + contractName + " bytecode generated");
  }
  return { abi: artifact.abi, bytecode: "0x" + artifact.evm.bytecode.object };
}

async function deployContract(
  label: string,
  fileName: string,
  contractName: string,
  deployer: Wallet,
  args: unknown[],
): Promise<{ address: string; txHash: string }> {
  console.log("Compiling " + label + "...");
  const artifact = await compile(fileName, contractName);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const receipt = tx ? await tx.wait() : null;
  const address = await contract.getAddress();
  console.log("Deployed " + label + ": " + address);
  return { address, txHash: receipt?.hash ?? tx?.hash ?? "" };
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  console.log("=== TSN Cross-Chain CC3 Testnet Core Deployment ===");
  console.log("Architecture: TSN Node decides; generic Cranker submits authorized work");
  console.log("Scope: Creditcoin registry + liquidity ASC + settlement hub");
  console.log("Destination vault/executor deploy separately on the selected EVM network");
  console.log("SepoliaAnchor and TinExitAttestedASC are excluded from normal value settlement");

  if (hasFlag("--test") || hasFlag("--receipt")) {
    throw new Error(
      "Deployment does not simulate or claim the Solana-to-EVM test path. " +
      "Run the real Node/Cranker integration harness only after route configuration and funding.",
    );
  }

  const rpcUrl = required("CREDITCOIN_RPC_URL");
  assertNoLocalnet(rpcUrl);
  const attestToken = requiredAddress("CREDITCOIN_ATTEST_TOKEN");
  const authorizationSigner = optionalAddress("CREDITCOIN_AUTHORIZATION_SIGNER");

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== CC3_CHAIN_ID) {
    throw new Error(
      "Expected Creditcoin CC3 Testnet (102031), got " + network.chainId.toString(),
    );
  }

  const deployer = new Wallet(privateKeyFromFile(), provider);
  console.log("Deployer address: " + deployer.address);
  console.log("Creditcoin chain ID: " + network.chainId.toString());
  console.log("Evidence guide: docs/team/cross-chain/creditcoin-navigation.md");

  if (hasFlag("--registry-only")) {
    const quorum = Number(process.env.DESTINATION_REGISTRY_QUORUM || "2");
    const votingPeriod = Number(process.env.DESTINATION_REGISTRY_VOTING_PERIOD || "604800");
    const activationDelay = Number(process.env.DESTINATION_REGISTRY_ACTIVATION_DELAY || "86400");
    if (!Number.isSafeInteger(quorum) || quorum < 2 || !Number.isSafeInteger(votingPeriod) || votingPeriod <= 0 || !Number.isSafeInteger(activationDelay) || activationDelay < 0) {
      throw new Error("Invalid DestinationRegistry quorum or timelock configuration");
    }
    const registry = await deployContract(
      "DestinationRegistry",
      "DestinationRegistry.sol",
      "DestinationRegistry",
      deployer,
      [authorizationSigner, deployer.address, quorum, votingPeriod, activationDelay],
    );
    const evidence = {
      chain: "creditcoin-cc3-testnet",
      chainId: Number(network.chainId),
      contracts: { destinationRegistry: registry.address },
      deploymentTxs: { destinationRegistry: registry.txHash },
      governance: { quorum, votingPeriod, activationDelay },
      nextAction: "Publish a signed route proposal, collect unique community votes, wait for the timelock, and verify route liquidity before activation.",
      deployedAt: new Date().toISOString(),
    };
    const deploymentDir = join(root, "deployments");
    await mkdir(deploymentDir, { recursive: true });
    await writeFile(join(deploymentDir, "destination-registry-latest.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  const registry = await deployContract(
    "DestinationLiquidityRegistry",
    "DestinationLiquidityRegistry.sol",
    "DestinationLiquidityRegistry",
    deployer,
    [deployer.address],
  );

  const liquidityAsc = await deployContract(
    "DestinationLiquidityASC",
    "DestinationLiquidityASC.sol",
    "DestinationLiquidityASC",
    deployer,
    [registry.address],
  );

  const registryContract = new (await import("ethers")).Contract(
    registry.address,
    [
      "function setLiquidityASC(address nextASC) external",
      "function setSettlementHub(address nextHub) external",
    ],
    deployer,
  );
  const registryAscTx = await registryContract.setLiquidityASC(liquidityAsc.address);
  const registryAscReceipt = await registryAscTx.wait();

  const hub = await deployContract(
    "CreditcoinSettlementHub",
    "CreditcoinSettlementHub.sol",
    "CreditcoinSettlementHub",
    deployer,
    [authorizationSigner, attestToken, registry.address],
  );

  const registryHubTx = await registryContract.setSettlementHub(hub.address);
  const registryHubReceipt = await registryHubTx.wait();

  const deployment = {
    chain: "creditcoin-cc3-testnet",
    chainId: Number(network.chainId),
    authorizationSigner,
    attestToken,
    contracts: {
      destinationLiquidityRegistry: registry.address,
      destinationLiquidityASC: liquidityAsc.address,
      creditcoinSettlementHub: hub.address,
    },
    deploymentTxs: {
      destinationLiquidityRegistry: registry.txHash,
      destinationLiquidityASC: liquidityAsc.txHash,
      registryLiquidityASC: registryAscReceipt?.hash ?? registryAscTx.hash,
      creditcoinSettlementHub: hub.txHash,
      registrySettlementHub: registryHubReceipt?.hash ?? registryHubTx.hash,
    },
    nextActions: [
      "Deploy TSNERCLiquidityVault and TSNSettlementExecutor with deploy:destination on the selected destination EVM network.",
      "Prefund the destination vault with the approved stablecoin.",
      "Configure and verify the Creditcoin route, Outbox, destination Inbox, executor, token, and capacity.",
      "Do not deploy SepoliaAnchor or claim TinExitAttested receipt evidence for a Solana source.",
    ],
    deployedAt: new Date().toISOString(),
  };

  const deploymentDir = join(root, "deployments");
  await mkdir(deploymentDir, { recursive: true });
  await writeFile(
    join(deploymentDir, "creditcoin-latest.json"),
    JSON.stringify(deployment, null, 2) + "\n",
    "utf8",
  );
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
