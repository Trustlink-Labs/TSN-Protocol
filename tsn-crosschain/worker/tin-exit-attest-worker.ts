import "dotenv/config";
import { blockProver, chainInfo, proofProvider } from "@gluwa/usc-sdk";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  type TransactionReceipt,
} from "ethers";

const ANCHOR_ABI = [
  "event TinExitAnchored(bytes32 indexed settlementId,bytes32 sealedTipHeadHash,uint256 amount,bytes32 tinHash,bytes32 exitCommitment)",
];

const ASC_ABI = [
  "function execute(uint8 action,uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,tuple(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots) returns (bool success)",
  "event TinExitAttested(bytes32 indexed sealedTipHeadHash,uint256 amount,bytes32 indexed tinHash,bytes32 indexed exitCommitment,bytes32 settlementId,bytes32 queryId)",
];

const REQUIRED = [
  "SEPOLIA_RPC_URL",
  "CREDITCOIN_RPC_URL",
  "DEPLOYER_PRIVATE_KEY",
  "PROOF_BUILDER_URL",
  "SEPOLIA_ANCHOR_ADDRESS",
  "CREDITCOIN_ASC_ADDRESS",
] as const;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertNoLocalnet(url: string, name: string): void {
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) {
    throw new Error(`${name} must use devnet/testnet; localnet is not supported`);
  }
}

async function waitForReceipt(
  provider: JsonRpcProvider,
  hash: string,
): Promise<TransactionReceipt> {
  const receipt = await provider.waitForTransaction(hash, 1, 120_000);
  if (!receipt || receipt.blockNumber == null) {
    throw new Error(`Anchor transaction ${hash} was not mined`);
  }
  return receipt;
}

async function proveAndSubmit(
  txHash: string,
  sourceProvider: JsonRpcProvider,
  creditcoinProvider: any,
  asc: Contract,
  chainKey: number,
  proofBuilderUrl: string,
): Promise<string> {
  const receipt = await waitForReceipt(sourceProvider, txHash);
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);

  console.log(`Waiting for Sepolia block ${receipt.blockNumber} attestation...`);
  await chainInfoProvider.waitUntilHeightAttested(
    chainKey,
    receipt.blockNumber,
    15_000,
    1_200_000,
  );

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
  const proofResult = await proofBuilder.getProof(txHash);
  if (!proofResult.success || !proofResult.data) {
    throw new Error(`Proof generation failed: ${proofResult.error ?? "unknown error"}`);
  }

  const proof = proofResult.data;
  const prover = new blockProver.PrecompileBlockProver(creditcoinProvider);
  const verified = await prover.verifySingle(
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof,
    proof.continuityProof,
  );
  if (!verified) throw new Error("local Block Prover verification failed");

  const tx = await asc.execute(
    0,
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings,
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  );
  const result = await tx.wait();
  if (!result) throw new Error("Creditcoin ASC transaction was not mined");
  return result.hash;
}

async function main(): Promise<void> {
  for (const name of REQUIRED) env(name);

  const sourceRpc = env("SEPOLIA_RPC_URL");
  const creditcoinRpc = env("CREDITCOIN_RPC_URL");
  assertNoLocalnet(sourceRpc, "SEPOLIA_RPC_URL");
  assertNoLocalnet(creditcoinRpc, "CREDITCOIN_RPC_URL");

  const chainKey = Number(process.env.SOURCE_CHAIN_KEY ?? "1");
  if (chainKey !== 1) throw new Error("SOURCE_CHAIN_KEY must be 1 for Ethereum Sepolia on CC3 Testnet");

  const sourceProvider = new JsonRpcProvider(sourceRpc);
  const creditcoinProvider = new JsonRpcProvider(creditcoinRpc);
  const wallet = new Wallet(env("DEPLOYER_PRIVATE_KEY"), creditcoinProvider);
  const anchor = new Contract(env("SEPOLIA_ANCHOR_ADDRESS"), ANCHOR_ABI, sourceProvider);
  const asc = new Contract(env("CREDITCOIN_ASC_ADDRESS"), ASC_ABI, wallet);

  const requestedHash = process.env.ANCHOR_TX_HASH;
  if (requestedHash) {
    const ascHash = await proveAndSubmit(
      requestedHash,
      sourceProvider,
      creditcoinProvider,
      asc,
      chainKey,
      env("PROOF_BUILDER_URL"),
    );
    console.log(JSON.stringify({ sourceAnchorTx: requestedHash, creditcoinAttestationTx: ascHash }, null, 2));
    return;
  }

  const latest = await sourceProvider.getBlockNumber();
  const events = await anchor.queryFilter(anchor.filters.TinExitAnchored(), Math.max(0, latest - 50), latest);
  if (events.length === 0) {
    throw new Error("No TinExitAnchored event found in the last 50 Sepolia blocks; set ANCHOR_TX_HASH for a one-shot run");
  }

  const event = events[events.length - 1];
  const txHash = event.transactionHash;
  const ascHash = await proveAndSubmit(
    txHash,
    sourceProvider,
    creditcoinProvider,
    asc,
    chainKey,
    env("PROOF_BUILDER_URL"),
  );
  console.log(JSON.stringify({ sourceAnchorTx: txHash, creditcoinAttestationTx: ascHash }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
