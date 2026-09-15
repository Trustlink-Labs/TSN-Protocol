import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  id,
  isAddress,
} from "ethers";

const ROUTE_ABI = [
  "function configureSettlementRoute(bytes32 routeId,uint64 sourceChainKey,address sourceEmitter,address payoutVault,address token,bytes32 destinationNetwork,uint256 destinationChainId,address destinationExecutor,address outbox,bool enabled) external",
  "function isSettlementRouteActive(bytes32 routeId) view returns (bool)",
  "function getRoute(bytes32 routeId) view returns (bool enabled,uint64 sourceChainKey,address sourceEmitter,address payoutVault,address token,bytes32 destinationNetwork,uint256 destinationChainId,address destinationExecutor,address outbox)",
];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /YOUR_REAL|PLACEHOLDER|REPLACE|<.*>/.test(value)) {
    throw new Error(`${name} is missing or still a placeholder`);
  }
  return value;
}

function address(name: string): string {
  const value = required(name);
  if (!isAddress(value)) throw new Error(`${name} must be a valid EVM address`);
  return getAddress(value);
}

function registryAddress(): string {
  const configured = process.env.CREDITCOIN_LIQUIDITY_REGISTRY?.trim();
  if (configured && !/YOUR_REAL|PLACEHOLDER|REPLACE|<.*>/.test(configured)) {
    if (!isAddress(configured)) throw new Error("CREDITCOIN_LIQUIDITY_REGISTRY must be a valid EVM address");
    return getAddress(configured);
  }

  const deploymentPath = resolve(process.cwd(), "deployments", "creditcoin-latest.json");
  if (!existsSync(deploymentPath)) {
    throw new Error("Creditcoin deployment evidence is missing; deploy the Creditcoin core first");
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
    contracts?: { destinationLiquidityRegistry?: string };
  };
  const deployed = deployment.contracts?.destinationLiquidityRegistry;
  if (!deployed || !isAddress(deployed)) {
    throw new Error("Creditcoin deployment evidence has no valid destinationLiquidityRegistry");
  }
  return getAddress(deployed);
}

function bytes32(name: string): string {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a bytes32 hex value`);
  return value;
}

function privateKey(): string {
  const direct = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (direct) return direct;
  const file = process.env.DEPLOYER_PRIVATE_KEY_FILE?.trim();
  if (!file) throw new Error("DEPLOYER_PRIVATE_KEY_FILE is required");
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) throw new Error(`Deployer key file not found: ${file}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { privateKey?: string };
  if (!parsed.privateKey) throw new Error("Deployer key file has no privateKey field");
  return parsed.privateKey;
}

async function main(): Promise<void> {
  const rpcUrl = required("CREDITCOIN_RPC_URL");
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(rpcUrl)) {
    throw new Error("CC3 route configuration is Devnet/Testnet-only; localnet is forbidden");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 102031n) {
    throw new Error(`Expected CC3 Testnet chain ID 102031, received ${network.chainId}`);
  }

  const wallet = new Wallet(privateKey(), provider);
  const registry = new Contract(registryAddress(), ROUTE_ABI, wallet);
  const routeId = bytes32("TSN_ROUTE_ID");
  const destinationNetwork = process.env.TSN_DESTINATION_NETWORK_HASH?.trim() || id(required("TSN_DESTINATION_NETWORK"));
  const sourceChainKey = BigInt(required("TSN_SOURCE_CHAIN_KEY"));
  const destinationChainId = BigInt(required("TSN_DESTINATION_CHAIN_ID"));

  console.log("=== TSN CC3 Route Configuration ===");
  console.log(`Signer: ${wallet.address}`);
  console.log(`Registry: ${await registry.getAddress()}`);
  console.log(`Route ID: ${routeId}`);
  console.log(`Destination network: ${destinationNetwork}`);

  const tx = await registry.configureSettlementRoute(
    routeId,
    sourceChainKey,
    address("TSN_SOURCE_EMITTER"),
    address("TSN_PAYOUT_VAULT"),
    address("TSN_DESTINATION_TOKEN"),
    destinationNetwork,
    destinationChainId,
    address("TSN_DESTINATION_EXECUTOR"),
    address("ATTESTCOIN_OUTBOX_ADDRESS"),
    true,
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Route configuration transaction failed");

  const active = await registry.isSettlementRouteActive(routeId);
  if (!active) throw new Error("Route configuration mined but is not executable on-chain");
  const route = await registry.getRoute(routeId);

  console.log(`Route configuration tx: ${receipt.hash}`);
  console.log(`On-chain executable: ${active}`);
  console.log(JSON.stringify({
    routeId,
    destinationNetwork,
    sourceChainKey: route.sourceChainKey.toString(),
    payoutVault: route.payoutVault,
    token: route.token,
    destinationChainId: route.destinationChainId.toString(),
    destinationExecutor: route.destinationExecutor,
    outbox: route.outbox,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
