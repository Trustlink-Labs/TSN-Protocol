/** Public TSN-only primitives for optional Creditcoin attestations. */
export const ATTESTCOIN_BLOCK_PROVER_PRECOMPILE =
  "0x0000000000000000000000000000000000000FD2" as const;

export type CrossChainNetwork =
  | "solana-devnet"
  | "creditcoin-testnet"
  | "base-sepolia"
  | "ethereum-sepolia";

export type AttestationStatus =
  | "not_requested"
  | "queued"
  | "anchored"
  | "verified"
  | "failed";

export interface CreditcoinDestination {
  network: "creditcoin-testnet";
  address: `0x${string}`;
  token: string;
}

export interface TinExitAttestationInput {
  settlementId: string;
  sourceNetwork: "solana-devnet";
  destinationNetwork: "creditcoin-testnet";
  sealedTipHeadHash: string;
  amount: bigint;
  tinHash: string;
  exitCommitment: string;
}

export interface TinExitAttestationReceipt {
  status: AttestationStatus;
  settlementId: string;
  destinationNetwork: "creditcoin-testnet";
  creditcoinTransaction?: string;
  sourceAnchorTransaction?: string;
}

export function validateCreditcoinDestination(
  destination: CreditcoinDestination,
): CreditcoinDestination {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination.address)) {
    throw new Error("Creditcoin destination must be a 20-byte EVM address");
  }
  if (!destination.token.trim()) {
    throw new Error("Creditcoin destination token is required");
  }
  return destination;
}

export function createTinExitReplayKey(
  input: Pick<
    TinExitAttestationInput,
    "sealedTipHeadHash" | "amount" | "tinHash" | "exitCommitment"
  >,
): string {
  return [
    input.sealedTipHeadHash,
    input.amount.toString(10),
    input.tinHash,
    input.exitCommitment,
  ].join(":");
}
