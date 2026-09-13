import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import solc from "solc";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, id, isAddress, parseUnits } from "ethers";

const root = resolve(process.cwd());

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /YOUR_REAL|PLACEHOLDER|REPLACE|<.*>/.test(value)) throw new Error(`${name} is missing or a placeholder`);
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
    join(root, "node_modules", "@gluwa", "asc-contracts", "node_modules", importPath),
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

function cliValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length).trim() || undefined;
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
  if (process.argv.includes("--compile-only")) {
    compile("creditcoin/CreditcoinDirectLiquidityRegistry.sol", "CreditcoinDirectLiquidityRegistry");
    compile("tokens/USDSET.sol", "USDSET");
    compile("TSNERCLiquidityVault.sol", "TSNERCLiquidityVault");
    compile("creditcoin/CreditcoinDirectSettlementHub.sol", "CreditcoinDirectSettlementHub");
    compile("creditcoin/CreditcoinDirectSettlementExecutor.sol", "CreditcoinDirectSettlementExecutor");
    console.log("Direct Creditcoin contracts compile successfully with viaIR");
    return;
  }
  const rpcUrl = required("CREDITCOIN_RPC_URL");
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(rpcUrl)) throw new Error("CC3 deployment is Testnet-only; localnet is forbidden");
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 102031n) throw new Error(`Expected CC3 chain ID 102031, received ${network.chainId}`);
  const wallet = new Wallet(key(), provider);
  const signer = process.env.CREDITCOIN_AUTHORIZATION_SIGNER?.trim() || wallet.address;
  if (!isAddress(signer)) throw new Error("CREDITCOIN_AUTHORIZATION_SIGNER must be a valid EVM address");
  const routeId = process.env.TSN_ROUTE_ID?.trim() || id("creditcoin-testnet-direct");
  const destinationNetwork = id(process.env.TSN_DESTINATION_NETWORK?.trim() || "creditcoin-testnet");

  console.log("=== Direct Creditcoin Destination Deployment ===");
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Route ID: ${routeId}`);

  // The token address is supplied only at one-time route bootstrap. The
  // registry and vault become the runtime authorities after configuration.
  const usdsetArtifact = compile("tokens/USDSET.sol", "USDSET");
  const existingUsdset = cliValue("usdset-address");
  let token: string;
  let usdsetDeploymentHash: string | null = null;
  let usdsetMintHash: string | null = null;
  const usdsetLive: any = existingUsdset
    ? new Contract(existingUsdset, usdsetArtifact.abi, wallet)
    : null;
  if (existingUsdset) {
    if (!isAddress(existingUsdset)) throw new Error("--usdset-address must be a valid EVM address");
    token = existingUsdset;
    const symbol = await usdsetLive.symbol();
    const decimals = await usdsetLive.decimals();
    if (symbol !== "USDSET" || Number(decimals) !== 6) throw new Error("Provided asset is not the USDSET contract");
    console.log(`Using existing USDSET contract: ${token}`);
  } else {
    const usdsetContract = await new ContractFactory(usdsetArtifact.abi, usdsetArtifact.bytecode, wallet).deploy(wallet.address);
    const usdsetDeployTx = usdsetContract.deploymentTransaction();
    await usdsetContract.waitForDeployment();
    token = await usdsetContract.getAddress();
    const usdsetDeployReceipt = await usdsetDeployTx?.wait();
    if (!usdsetDeployReceipt || usdsetDeployReceipt.status !== 1) throw new Error("USDSET deployment failed");
    usdsetDeploymentHash = usdsetDeployReceipt.hash;
    const initialSupply = parseUnits(required("USDSET_INITIAL_SUPPLY"), 6);
    if (initialSupply <= 0n) throw new Error("USDSET_INITIAL_SUPPLY must be greater than zero");
    const deployedUsdset = new Contract(token, usdsetArtifact.abi, wallet);
    const mintReceipt = await (await deployedUsdset.mint(wallet.address, initialSupply)).wait();
    if (!mintReceipt || mintReceipt.status !== 1) throw new Error("USDSET initial mint failed");
    usdsetMintHash = mintReceipt.hash;
    console.log(`USDSET: ${token} (${usdsetDeployReceipt.hash})`);
  }

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

  const liquidityAmountText = cliValue("liquidity");
  let liquidityTxHash: string | null = null;
  let observationTxHash: string | null = null;
  if (liquidityAmountText) {
    const liquidityAmount = parseUnits(liquidityAmountText, 6);
    if (liquidityAmount <= 0n) throw new Error("--liquidity must be greater than zero");
    const tokenContract = usdsetLive ?? new Contract(token, usdsetArtifact.abi, wallet);
    const approvalReceipt = await (await tokenContract.approve(vault.address, liquidityAmount)).wait();
    if (!approvalReceipt || approvalReceipt.status !== 1) throw new Error("USDSET vault approval failed");
    const fundReceipt = await (await vaultContractLive.fund(liquidityAmount)).wait();
    if (!fundReceipt || fundReceipt.status !== 1) throw new Error("USDSET vault funding failed");
    liquidityTxHash = fundReceipt.hash;
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 86400);
    const observationReceipt = await (await registryContract.observeLocalLiquidity(routeId, validUntil, 1)).wait();
    if (!observationReceipt || observationReceipt.status !== 1) throw new Error("USDSET liquidity observation failed");
    observationTxHash = observationReceipt.hash;
  }

  const deployment = {
    chain: "creditcoin-cc3-testnet",
    chainId: 102031,
    routeId,
    destinationNetwork,
    contracts: { usdset: token, registry: registry.address, vault: vault.address, hub: hub.address, executor: executor.address },
    transactions: {
      usdsetDeployment: usdsetDeploymentHash, usdsetInitialMint: usdsetMintHash,
      registry: registry.txHash, vault: vault.txHash, hub: hub.txHash, executor: executor.txHash,
      setExecutor: setExecutorReceipt.hash, configureRoute: configureReceipt.hash, setSettlementHub: setHubReceipt.hash,
      vaultFunding: liquidityTxHash, liquidityObservation: observationTxHash,
    },
    nextAction: liquidityTxHash && observationTxHash
      ? "Vault funded and liquidity observed; update the Node route mirror, then run the route gate."
      : "Fund the vault, then call observeLocalLiquidity(routeId, validUntil, nonce) before running the Node route gate.",
  };
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
