import "dotenv/config";
import { blockProver, chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const ASC_ABI = [
  "function execute(bytes32 routeId,uint8 action,uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,tuple(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots) returns (bytes32 queryId)",
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertNoLocalnet(url: string, name: string): void {
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) {
    throw new Error(`${name} must use a devnet/testnet RPC`);
  }
}

async function main(): Promise<void> {
  const sourceRpc = required("DESTINATION_SOURCE_RPC_URL");
  const creditcoinRpc = required("CREDITCOIN_RPC_URL");
  assertNoLocalnet(sourceRpc, "DESTINATION_SOURCE_RPC_URL");
  assertNoLocalnet(creditcoinRpc, "CREDITCOIN_RPC_URL");

  const chainKey = Number(required("DESTINATION_SOURCE_CHAIN_KEY"));
  if (!Number.isSafeInteger(chainKey) || chainKey <= 0) throw new Error("DESTINATION_SOURCE_CHAIN_KEY must be positive");
  const routeId = required("DESTINATION_ROUTE_ID");
  if (!/^0x[0-9a-fA-F]{64}$/.test(routeId)) throw new Error("DESTINATION_ROUTE_ID must be bytes32");

  const sourceProvider = new JsonRpcProvider(sourceRpc);
  const creditcoinProvider = new JsonRpcProvider(creditcoinRpc);
  const sourceTxHash = required("DESTINATION_LIQUIDITY_TX_HASH");
  const receipt = await sourceProvider.waitForTransaction(sourceTxHash, 1, 120_000);
  if (!receipt?.blockNumber) throw new Error("destination liquidity event transaction was not mined");

  const info = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider as any);
  await info.waitUntilHeightAttested(chainKey, receipt.blockNumber, 15_000, 1_200_000);

  const builder = new proofProvider.service.ProofBuilder(chainKey, required("PROOF_BUILDER_URL"));
  const result = await builder.getProof(sourceTxHash);
  if (!result.success || !result.data) throw new Error(result.error ?? "destination liquidity proof generation failed");
  const proof = result.data;

  const prover = new blockProver.PrecompileBlockProver(creditcoinProvider as any);
  const locallyVerified = await prover.verifySingle(
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof,
    proof.continuityProof,
  );
  if (!locallyVerified) throw new Error("Creditcoin Block Prover rejected destination liquidity proof");

  const wallet = new Wallet(required("DEPLOYER_PRIVATE_KEY"), creditcoinProvider);
  const asc = new Contract(required("CREDITCOIN_LIQUIDITY_ASC_ADDRESS"), ASC_ABI, wallet);
  const tx = await asc.execute(
    routeId,
    0,
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings,
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  );
  const mined = await tx.wait();
  if (!mined) throw new Error("Creditcoin liquidity ASC transaction was not mined");

  console.log(JSON.stringify({
    sourceTransaction: sourceTxHash,
    routeId,
    sourceChainKey: chainKey,
    creditcoinLiquidityObservationTx: mined.hash,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
