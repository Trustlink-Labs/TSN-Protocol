import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import solc from "solc";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, isAddress } from "ethers";

const root = resolve(process.cwd());

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /YOUR_REAL|PLACEHOLDER|REPLACE|<.*>/.test(value)) {
    throw new Error(`${name} is missing or a placeholder`);
  }
  return value;
}

function loadPrivateKey(): string {
  const direct = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (direct) return direct;
  const file = required("DEPLOYER_PRIVATE_KEY_FILE");
  const parsed = JSON.parse(readFileSync(resolve(root, file), "utf8")) as { privateKey?: string };
  if (!parsed.privateKey) throw new Error("DEPLOYER_PRIVATE_KEY_FILE does not contain privateKey");
  return parsed.privateKey;
}

function resolveImport(importPath: string): { contents?: string; error?: string } {
  const candidates = [
    join(root, "contracts", importPath),
    join(root, "node_modules", importPath),
    join(root, "node_modules", "@gluwa", "asc-contracts", "node_modules", importPath),
  ];
  for (const candidate of candidates) {
    try { return { contents: readFileSync(candidate, "utf8") }; } catch { /* continue */ }
  }
  return { error: `Import not found: ${importPath}` };
}

function compile(): { abi: any[]; bytecode: string } {
  const fileName = "tokens/USDSET.sol";
  const source = readFileSync(join(root, "contracts", fileName), "utf8");
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  }), { import: resolveImport }));
  const errors = (output.errors ?? []).filter((item: { severity: string }) => item.severity === "error");
  if (errors.length) throw new Error(errors.map((item: { formattedMessage: string }) => item.formattedMessage).join("\n"));
  const artifact = output.contracts[fileName]?.USDSET;
  if (!artifact?.evm?.bytecode?.object) throw new Error("No USDSET bytecode produced");
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
}

async function main(): Promise<void> {
  if (process.argv.includes("--compile-only")) {
    compile();
    console.log("USDSET compiles successfully with viaIR");
    return;
  }

  const rpcUrl = required("CREDITCOIN_RPC_URL");
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(rpcUrl)) throw new Error("CC3 deployment is Testnet-only; localnet is forbidden");
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 102031n) throw new Error(`Expected CC3 chain ID 102031, received ${network.chainId}`);

  const wallet = new Wallet(loadPrivateKey(), provider);
  const recipient = process.env.USDSET_MINT_RECIPIENT?.trim() || wallet.address;
  if (!isAddress(recipient)) throw new Error("USDSET_MINT_RECIPIENT must be a valid EVM address");
  const initialWholeUnits = required("USDSET_INITIAL_SUPPLY");
  if (!/^\d+(\.\d{1,6})?$/.test(initialWholeUnits)) throw new Error("USDSET_INITIAL_SUPPLY must be a decimal amount with up to 6 decimals");
  const initialSupply = BigInt(Math.round(Number(initialWholeUnits) * 1_000_000));
  if (initialSupply === 0n) throw new Error("USDSET_INITIAL_SUPPLY must be greater than zero");

  const artifact = compile();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, wallet).deploy(wallet.address);
  const deploymentTx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const deploymentReceipt = await deploymentTx?.wait();
  if (!deploymentReceipt || deploymentReceipt.status !== 1) throw new Error("USDSET deployment failed");

  const address = await contract.getAddress();
  const liveToken = new Contract(address, artifact.abi, wallet);
  const mintTx = await liveToken.mint(recipient, initialSupply);
  const mintReceipt = await mintTx.wait();
  if (!mintReceipt || mintReceipt.status !== 1) throw new Error("USDSET initial mint failed");

  console.log(JSON.stringify({
    chain: "creditcoin-cc3-testnet",
    chainId: 102031,
    token: { name: "TSN Dollar Settlement", symbol: "USDSET", decimals: 6, address, owner: wallet.address },
    initialMint: { recipient, amountBaseUnits: initialSupply.toString() },
    transactions: { deployment: deploymentReceipt.hash, initialMint: mintReceipt.hash },
    nextAction: "Register this exact token address in the Creditcoin route, fund the payout vault, then observe liquidity.",
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
