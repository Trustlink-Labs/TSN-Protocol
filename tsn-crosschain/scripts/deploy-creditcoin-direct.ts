import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Wallet, id, isAddress } from "ethers";

const root = resolve(process.cwd());

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /YOUR_REAL|PLACEHOLDER|REPLACE|<.*>/.test(value)) throw new Error(`${name} is missing or a placeholder`);
  return value;
}

function address(name: string): string {
  const value = required(name);
  if (!isAddress(value)) throw new Error(`${name} must be a valid EVM address`);
  return value;
}

function key(): string {
  const direct = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (direct) return direct;
  const file = required("DEPLOYER_PRIVATE_KEY_FILE");
  return JSON.parse(readFileSync(resolve(root, file), "utf8")).privateKey;
}

function importResolver(importPath: string): { contents?: string; error?: string } {
  const candidates = [
    join(root, "contracts", "creditcoin", importPath),
    join(root, "contracts", importPath),
    join(root, "node_modules", importPath),
  ];
  for (const candidate of candidates) {
    try { return { contents: readFileSync(candidate, "utf8") }; } catch { /* continue */ }
  }
  return { error: `Import not found: ${importPath}` };
}

function compile(fileName: string, contractName: string): { abi: any[]; bytecode: string } {
  const source = readFileSync(join(root, "contracts", fileName), "utf8");
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  }), { import: importResolver }));
  const errors = (output.errors ?? []).filter((item: { severity: string }) => item.severity === "error");
  if (errors.length) throw new Error(errors.map((item: { formattedMessage: string }) => item.formattedMessage).join("\n"));
  const artifact = output.contracts[fileName]?.[contractName];
  if (!artifact?.evm?.bytecode?.object) throw new Error(`No bytecode for ${contractName}`);
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
}

async function deploy(factory: ContractFactory, label: string, ...args: any[]): Promise<{ address: string; txHash: string }> {
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const receipt = tx ? await tx.wait() : null;
  if (!receipt || receipt.status !== 1) throw new Error(`${label} deployment failed`);
  const deployed = await contract.getAddress();
  console.log(`${label}: ${deployed} (${receipt.hash})`);
  return { address: deployed, txHash: receipt.hash };
}

async function main(): Promise<void> {
  const rpcUrl = required("CREDITCOIN_RPC_URL");
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(rpcUrl)) throw new Error("CC3 deployment is Testnet-only; localnet is forbidden");
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 102031n) throw new Error(`Expected CC3 chain ID 102031, received ${network.chainId}`);
  const wallet = new Wallet(key(), provider);
  const token = address("CREDITCOIN_SETTLEMENT_TOKEN");
  const signer = process.env.CREDITCOIN_AUTHORIZATION_SIGNER?.trim() || wallet.address;
  if (!isAddress(signer)) throw new Error("CREDITCOIN_AUTHORIZATION_SIGNER must be a valid EVM address");
  const routeId = process.env.TSN_ROUTE_ID?.trim() || id("creditcoin-testnet-direct");
  const destinationNetwork = id(process.env.TSN_DESTINATION_NETWORK?.trim() || "creditcoin-testnet");

  console.log("=== Direct Creditcoin Destination Deployment ===");
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Settlement token: ${token}`);
  console.log(`Route ID: ${routeId}`);

  const registryArtifact = compile("creditcoin/CreditcoinDirectLiquidityRegistry.sol", "CreditcoinDirectLiquidityRegistry");
  const registry = await deploy(new ContractFactory(registryArtifact.abi, registryArtifact.bytecode, wallet), "Registry");

  const vaultArtifact = compile("TSNERCLiquidityVault.sol", "TSNERCLiquidityVault");
  const vaultFactory = new ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, wallet);
  const vaultContract = await vaultFactory.deploy(wallet.address, token, wallet.address);
  const vaultTx = vaultContract.deploymentTransaction();
  await vaultContract.waitForDeployment();
  const vault = { address: await vaultContract.getAddress(), txHash: (await vaultTx?.wait())?.hash ?? "" };
  console.log(`Vault: ${vault.address} (${vault.txHash})`);

  const hubArtifact = compile("creditcoin/CreditcoinDirectSettlementHub.sol", "CreditcoinDirectSettlementHub");
  const hubFactory = new ContractFactory(hubArtifact.abi, hubArtifact.bytecode, wallet);
  const hubContract = await hubFactory.deploy(signer, registry.address);
  const hubTx = hubContract.deploymentTransaction();
  await hubContract.waitForDeployment();
  const hub = { address: await hubContract.getAddress(), txHash: (await hubTx?.wait())?.hash ?? "" };
  console.log(`Hub: ${hub.address} (${hub.txHash})`);

  const executorArtifact = compile("creditcoin/CreditcoinDirectSettlementExecutor.sol", "CreditcoinDirectSettlementExecutor");
  const executor = await deploy(new ContractFactory(executorArtifact.abi, executorArtifact.bytecode, wallet), "Executor", hub.address, vault.address, token);
  const executorContract = new (await import("ethers")).Contract(executor.address, executorArtifact.abi, wallet);
  const executorDeployTx = await executorContract.getAddress();
  void executorDeployTx;

  const vaultContractLive = new (await import("ethers")).Contract(vault.address, vaultArtifact.abi, wallet);
  const setExecutorTx = await vaultContractLive.setExecutor(executor.address);
  const setExecutorReceipt = await setExecutorTx.wait();

  const registryContract = new (await import("ethers")).Contract(registry.address, registryArtifact.abi, wallet);
  const configureTx = await registryContract.configureRoute(routeId, vault.address, token, destinationNetwork, executor.address, true);
  const configureReceipt = await configureTx.wait();
  const setHubTx = await registryContract.setSettlementHub(hub.address);
  const setHubReceipt = await setHubTx.wait();

  const deployment = {
    chain: "creditcoin-cc3-testnet",
    chainId: 102031,
    routeId,
    destinationNetwork,
    contracts: { registry: registry.address, vault: vault.address, hub: hub.address, executor: executor.address, token },
    transactions: {
      registry: registry.txHash, vault: vault.txHash, hub: hub.txHash, executor: executor.txHash,
      setExecutor: setExecutorReceipt.hash, configureRoute: configureReceipt.hash, setSettlementHub: setHubReceipt.hash,
    },
    nextAction: "Fund the vault, then call observeLocalLiquidity(routeId, validUntil, nonce) before running the Node route gate.",
  };
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
