import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const protocolRoot = path.resolve(process.cwd(), "..");
const rpcUrl =
  process.env.CREDITCOIN_RPC_URL?.trim() ||
  "https://rpc.cc3-testnet.creditcoin.network";
const deployerFile = path.resolve(
  process.env.CREDITCOIN_DEPLOYER_KEYPAIR_FILE?.trim() ||
    path.join(
      protocolRoot,
      "services",
      "tsn-crosschain",
      ".creds",
      "contract_auth_keypair.json",
    ),
);
const crankerFile = path.resolve(
  process.env.CREDITCOIN_CRANKER_KEYPAIR_FILE?.trim() ||
    path.join(
      protocolRoot,
      "services",
      "tsn-crosschain",
      ".creds",
      "creditcoin_cranker_keypair.json",
    ),
);
const fundingAmount = process.env.CREDITCOIN_CRANKER_FUND_CTC?.trim() || "10";

type KeyFile = { privateKey?: string; address?: string };

function readKeyFile(file: string): string {
  if (!fs.existsSync(file)) throw new Error(`Key file not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as KeyFile;
  if (!parsed.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(parsed.privateKey)) {
    throw new Error("Key file does not contain a valid EVM privateKey");
  }
  return parsed.privateKey;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 102031n)
    throw new Error(
      `Expected CC3 Testnet chain ID 102031, got ${network.chainId}`,
    );

  if (fs.existsSync(crankerFile)) {
    const existing = JSON.parse(
      fs.readFileSync(crankerFile, "utf8"),
    ) as KeyFile;
    const wallet = new ethers.Wallet(readKeyFile(crankerFile), provider);
    console.log(`Creditcoin Cranker key already exists: ${wallet.address}`);
    console.log(
      `Creditcoin Cranker balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} CTC`,
    );
    console.log(
      `Key file preserved: ${path.relative(protocolRoot, crankerFile)}`,
    );
    if (
      existing.address &&
      ethers.getAddress(existing.address) !== wallet.address
    ) {
      throw new Error(
        "Existing key file address does not match its private key",
      );
    }
    return;
  }

  const cranker = ethers.Wallet.createRandom();
  fs.mkdirSync(path.dirname(crankerFile), { recursive: true });
  fs.writeFileSync(
    crankerFile,
    JSON.stringify(
      { address: cranker.address, privateKey: cranker.privateKey },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );

  const deployer = new ethers.Wallet(readKeyFile(deployerFile), provider);
  const deployerBalance = await provider.getBalance(deployer.address);
  const value = ethers.parseEther(fundingAmount);
  if (deployerBalance < value)
    throw new Error(
      `Deployer balance is below ${fundingAmount} CTC; no funding transaction sent`,
    );

  console.log(`Created Creditcoin Cranker wallet: ${cranker.address}`);
  console.log(`Funding ${fundingAmount} CTC from deployer ${deployer.address}`);
  const tx = await deployer.sendTransaction({ to: cranker.address, value });
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error(
      `Funding transaction was not confirmed successfully: ${tx.hash}`,
    );

  const balance = await provider.getBalance(cranker.address);
  console.log(`Creditcoin Cranker funded: ${ethers.formatEther(balance)} CTC`);
  console.log(`Funding transaction: ${tx.hash}`);
  console.log(
    `Explorer: https://creditcoin-testnet.blockscout.com/tx/${tx.hash}`,
  );
  console.log(
    `Key file preserved: ${path.relative(protocolRoot, crankerFile)}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
