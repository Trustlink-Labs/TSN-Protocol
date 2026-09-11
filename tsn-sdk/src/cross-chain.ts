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

export const CREDITCOIN_SETTLEMENT_NETWORK = "creditcoin-testnet" as const;

export interface CreditcoinPayoutAuthorization {
  settlementId: string;
  sealedTipHeadHash: string;
  tinHash: string;
  exitCommitment: string;
  destinationNetwork: typeof CREDITCOIN_SETTLEMENT_NETWORK;
  recipient: `0x${string}`;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  merchantOverride: boolean;
}

export function validateCreditcoinPayoutAuthorization(
  authorization: CreditcoinPayoutAuthorization,
): CreditcoinPayoutAuthorization {
  if (!/^0x[0-9a-fA-F]{40}$/.test(authorization.recipient)) {
    throw new Error("Creditcoin payout recipient must be a 20-byte EVM address");
  }
  for (const field of ["settlementId", "sealedTipHeadHash", "tinHash", "exitCommitment"] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(authorization[field])) {
      throw new Error(`${field} must be a bytes32 value`);
    }
  }
  if (authorization.destinationNetwork !== CREDITCOIN_SETTLEMENT_NETWORK) {
    throw new Error("only the Creditcoin settlement rail is enabled");
  }
  if (authorization.amount <= 0n || authorization.deadline <= 0n) {
    throw new Error("payout amount and deadline must be positive");
  }
  return authorization;
}

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

export type VerifiedDestinationEvm = "base" | "ethereum";

export interface DestinationLiquidityRoute {
  routeId: `0x${string}`;
  network: VerifiedDestinationEvm;
  sourceChainKey: bigint;
  sourceLiquidityEmitter: `0x${string}`;
  payoutVault: `0x${string}`;
  settlementToken: `0x${string}`;
  enabled: boolean;
}

export interface VerifiedDestinationLiquidity {
  routeId: `0x${string}`;
  queryId: `0x${string}`;
  availableAmount: bigint;
  sourceBlock: bigint;
  validUntil: bigint;
  nonce: bigint;
}

export function assertVerifiedDestinationLiquidity(
  route: DestinationLiquidityRoute,
  observation: VerifiedDestinationLiquidity,
  requestedAmount: bigint,
  nowSeconds: bigint = BigInt(Math.floor(Date.now() / 1000)),
): void {
  if (!route.enabled) throw new Error("destination route is disabled");
  if (route.routeId !== observation.routeId) throw new Error("liquidity observation route mismatch");
  if (!/^0x[0-9a-fA-F]{40}$/.test(route.payoutVault)) throw new Error("invalid destination payout vault");
  if (!/^0x[0-9a-fA-F]{40}$/.test(route.settlementToken)) throw new Error("invalid destination settlement token");
  if (requestedAmount <= 0n || observation.availableAmount < requestedAmount) {
    throw new Error("verified destination liquidity is insufficient");
  }
  if (observation.validUntil <= nowSeconds) throw new Error("verified destination liquidity has expired");
}
