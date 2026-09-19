import "dotenv/config";
import { blockProver, chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { JsonRpcProvider } from "ethers";

const chainKey = Number(process.env.SOURCE_CHAIN_KEY ?? "1");
const txHash = process.env.ANCHOR_TX_HASH;
const sourceRpc = process.env.SEPOLIA_RPC_URL;
const creditcoinRpc = process.env.CREDITCOIN_RPC_URL;
const proofBuilderUrl = process.env.PROOF_BUILDER_URL;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  if (chainKey !== 1) throw new Error("SOURCE_CHAIN_KEY must be 1 for Ethereum Sepolia");
  const sourceProvider = new JsonRpcProvider(required(sourceRpc, "SEPOLIA_RPC_URL"));
  const creditcoinProvider = new JsonRpcProvider(required(creditcoinRpc, "CREDITCOIN_RPC_URL"));
  const transactionHash = required(txHash, "ANCHOR_TX_HASH");
  const builderUrl = required(proofBuilderUrl, "PROOF_BUILDER_URL");
  const receipt = await sourceProvider.waitForTransaction(transactionHash, 1, 120_000);
  if (!receipt?.blockNumber) throw new Error("Anchor transaction was not mined");

  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider as any);
  await chainInfoProvider.waitUntilHeightAttested(chainKey, receipt.blockNumber, 15_000, 1_200_000);
  const builder = new proofProvider.service.ProofBuilder(chainKey, builderUrl);
  const result = await builder.getProof(transactionHash);
  if (!result.success || !result.data) throw new Error(result.error ?? "Proof generation failed");

  const proof = result.data;
  const prover = new blockProver.PrecompileBlockProver(creditcoinProvider as any);
  const verified = await prover.verifySingle(
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof,
    proof.continuityProof,
  );
  if (!verified) throw new Error("PrecompileBlockProver.verifySingle failed");

  process.stdout.write(`${JSON.stringify(proof)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
