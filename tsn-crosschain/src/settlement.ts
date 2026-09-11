import { id, type Wallet } from "ethers";

export const CREDITCOIN_NETWORK = "creditcoin-testnet" as const;
export const CREDITCOIN_NETWORK_HASH = id(CREDITCOIN_NETWORK);
export const SOLANA_NETWORK = "solana-devnet" as const;
export const SOLANA_NETWORK_HASH = id(SOLANA_NETWORK);

export type DestinationNetwork = typeof CREDITCOIN_NETWORK | "base" | "ethereum";

export interface CreditcoinPayoutAuthorization {
  settlementId: string;
  sealedTipHeadHash: string;
  tinHash: string;
  exitCommitment: string;
  destinationNetwork: string;
  token: string;
  recipient: string;
  amount: bigint;
  feeAmount: bigint;
  nonce: bigint;
  deadline: bigint;
  merchantOverride: boolean;
}

export const CREDITCOIN_PAYOUT_TYPES = {
  PayoutAuthorization: [
    { name: "settlementId", type: "bytes32" },
    { name: "sourceNetwork", type: "bytes32" },
    { name: "sealedTipHeadHash", type: "bytes32" },
    { name: "tinHash", type: "bytes32" },
    { name: "exitCommitment", type: "bytes32" },
    { name: "destinationNetwork", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "feeAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "merchantOverride", type: "bool" },
  ],
};

export function validateCreditcoinPayout(input: CreditcoinPayoutAuthorization): CreditcoinPayoutAuthorization {
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "string" && !value.trim()) throw new Error(`${name} is required`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.recipient)) throw new Error("recipient must be a 20-byte EVM address");
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.token)) throw new Error("token must be a 20-byte EVM address");
  for (const name of ["settlementId", "sealedTipHeadHash", "tinHash", "exitCommitment"] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input[name])) throw new Error(`${name} must be bytes32`);
  }
  if (input.destinationNetwork !== CREDITCOIN_NETWORK) throw new Error("only Creditcoin is enabled");
  if (input.amount <= 0n || input.feeAmount < 0n || input.nonce < 0n || input.deadline <= 0n) throw new Error("invalid payout numeric field");
  return input;
}

export async function signCreditcoinPayout(
  signer: Wallet,
  verifyingContract: string,
  chainId: bigint,
  authorization: CreditcoinPayoutAuthorization,
): Promise<string> {
  validateCreditcoinPayout(authorization);
  const domain = { name: "TSN Creditcoin Settlement Hub", version: "1", chainId, verifyingContract };
  const contractAuthorization = {
    ...authorization,
    sourceNetwork: SOLANA_NETWORK_HASH,
    destinationNetwork: CREDITCOIN_NETWORK_HASH,
  };
  return signer.signTypedData(domain, CREDITCOIN_PAYOUT_TYPES, contractAuthorization);
}

export interface DestinationSettlementAdapter {
  readonly network: DestinationNetwork;
  submit(authorization: CreditcoinPayoutAuthorization, signature: string): Promise<string>;
}

/** Future networks must provide their own funded settlement rail. */
export function assertDestinationAdapterEnabled(network: DestinationNetwork): void {
  if (network !== CREDITCOIN_NETWORK) {
    throw new Error(`${network} has no enabled TSN settlement rail yet`);
  }
}
