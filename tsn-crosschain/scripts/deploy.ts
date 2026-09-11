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

function assertNoLocalnet(url: string, name: string): void {
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) {
    throw new Error(`${name} must use devnet/testnet; localnet is forbidden`);
  }
}

function importResolver(importPath: string): { contents?: string; error?: string } {
  const candidates = [
    join(root, "node_modules", importPath),
    join(root, "node_modules", "@gluwa", "asc-contracts", "contracts", importPath),
  ];
  for (const candidate of candidates) {
    try {
      return { contents: readFileSync(candidate, "utf8") };
    } catch {
      // Try the next package-relative resolution candidate.
    }
  }
  return { error: `Import not found: ${importPath}` };
}

async function compile(fileName: string): Promise<{ abi: any[]; bytecode: string }> {
  const source = await readFile(join(root, "contracts", fileName), "utf8");
  const input = {
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: importResolver }));
  const errors = (output.errors ?? []).filter((item: { severity: string }) => item.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((item: { formattedMessage: string }) => item.formattedMessage).join("\n"));
  const contractName = fileName.replace(/\.sol$/, "");
  const artifact = output.contracts[fileName][contractName];
  if (!artifact?.evm?.bytecode?.object) throw new Error(`No bytecode generated for ${contractName}`);
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
}

async function main(): Promise<void> {
  const sepoliaRpc = required("SEPOLIA_RPC_URL");
  const creditcoinRpc = required("CREDITCOIN_RPC_URL");
  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  assertNoLocalnet(sepoliaRpc, "SEPOLIA_RPC_URL");
  assertNoLocalnet(creditcoinRpc, "CREDITCOIN_RPC_URL");

  const sepolia = new JsonRpcProvider(sepoliaRpc);
  const creditcoin = new JsonRpcProvider(creditcoinRpc);
  const [sepoliaNetwork, creditcoinNetwork] = await Promise.all([sepolia.getNetwork(), creditcoin.getNetwork()]);
  if (sepoliaNetwork.chainId !== 11155111n) throw new Error(`Expected Ethereum Sepolia (11155111), got ${sepoliaNetwork.chainId}`);
  if (creditcoinNetwork.chainId !== 102031n) throw new Error(`Expected CC3 Testnet (102031), got ${creditcoinNetwork.chainId}`);

  const sepoliaWallet = new Wallet(privateKey, sepolia);
  const creditcoinWallet = new Wallet(privateKey, creditcoin);
  const anchorArtifact = await compile("SepoliaAnchor.sol");
  const anchor = await new ContractFactory(anchorArtifact.abi, anchorArtifact.bytecode, sepoliaWallet).deploy();
  await anchor.waitForDeployment();
  const anchorAddress = await anchor.getAddress();

  const ascArtifact = await compile("TinExitAttestedASC.sol");
  const asc = await new ContractFactory(ascArtifact.abi, ascArtifact.bytecode, creditcoinWallet).deploy(anchorAddress);
  await asc.waitForDeployment();
  const ascAddress = await asc.getAddress();

  const deployment = {
    sourceNetwork: "ethereum-sepolia",
    destinationNetwork: "creditcoin-testnet",
    sourceChainKey: 1,
    sepoliaAnchor: anchorAddress,
    creditcoinAsc: ascAddress,
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
