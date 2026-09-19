import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  id,
  type TransactionReceipt,
  type Log,
  type LogDescription,
} from "ethers";
import {
  CreditcoinRouteClient,
  type CreditcoinRouteClientConfig,
} from "../../../sdks/tsn-sdk/src/cross-chain.js";
import {
  validateCreditcoinPayout,
  type CreditcoinPayoutAuthorization,
} from "./settlement.js";

const HUB_ABI = [
  "function executeSettlement((bytes32 settlementId,bytes32 sourceNetwork,bytes32 sealedTipHeadHash,bytes32 tinHash,bytes32 exitCommitment,bytes32 routeId,bytes32 destinationNetwork,address destinationExecutor,address token,address recipient,uint256 amount,uint256 feeAmount,uint256 nonce,uint256 deadline,bool merchantOverride),bytes signature) returns (bytes32)",
  "event SettlementMessagePublished(bytes32 indexed settlementId,bytes32 indexed routeId,bytes32 indexed messageId,address destinationExecutor,address token,address recipient,uint256 amount,uint256 nonce)",
] as const;

export type CreditcoinCrankerConfig = {
  rpcUrl: string;
  hub: `0x${string}`;
  signerPrivateKey: string;
  route: CreditcoinRouteClientConfig;
};

export type CreditcoinSubmission = {
  transactionHash: string;
  messageId: string;
  receipt: TransactionReceipt;
};

/**
 * Generic EVM Cranker boundary for Creditcoin.
 *
 * The Cranker receives an already Node-authorized EIP-712 signature. It never
 * creates the authorization, chooses a route, or treats a UI-provided token
 * or executor as authoritative.
 */
export class CreditcoinCranker {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly hub: Contract;
  private readonly route: CreditcoinRouteClient;

  constructor(config: CreditcoinCrankerConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = new Wallet(config.signerPrivateKey, this.provider);
    this.hub = new Contract(getAddress(config.hub), HUB_ABI, this.signer);
    this.route = new CreditcoinRouteClient(config.route);
  }

  async submit(
    authorization: CreditcoinPayoutAuthorization,
    signature: string,
  ): Promise<CreditcoinSubmission> {
    validateCreditcoinPayout(authorization);
    if (!/^0x[0-9a-fA-F]+$/.test(signature) || signature.length < 132) {
      throw new Error("Creditcoin authorization signature is invalid");
    }

    const evidence = await this.route.readEvidence();
    if (evidence.status !== "ready") {
      throw new Error(evidence.failure ?? "Creditcoin route is not ready");
    }
    if (
      authorization.routeId.toLowerCase() !==
      evidence.route.routeId.toLowerCase()
    ) {
      throw new Error("authorized route does not match the on-chain registry");
    }
    if (
      getAddress(authorization.destinationExecutor) !==
      getAddress(evidence.route.destinationExecutor)
    ) {
      throw new Error(
        "authorized executor does not match the on-chain registry",
      );
    }
    if (
      getAddress(authorization.token) !==
      getAddress(evidence.route.settlementToken)
    ) {
      throw new Error("authorized token does not match the on-chain registry");
    }
    if (authorization.amount > evidence.liquidity.availableAmount) {
      throw new Error("authorized amount exceeds fresh registered liquidity");
    }
    if (authorization.deadline <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new Error("Creditcoin authorization is expired");
    }

    const tx = await this.hub.executeSettlement(
      {
        settlementId: authorization.settlementId,
        sourceNetwork: id("solana-devnet"),
        sealedTipHeadHash: authorization.sealedTipHeadHash,
        tinHash: authorization.tinHash,
        exitCommitment: authorization.exitCommitment,
        routeId: authorization.routeId,
        destinationNetwork: authorization.destinationNetwork,
        destinationExecutor: authorization.destinationExecutor,
        token: authorization.token,
        recipient: authorization.recipient,
        amount: authorization.amount,
        feeAmount: authorization.feeAmount,
        nonce: authorization.nonce,
        deadline: authorization.deadline,
        merchantOverride: authorization.merchantOverride,
      },
      signature,
    );
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1)
      throw new Error("Creditcoin settlement transaction failed");
    const parsed = receipt.logs
      .map((log: Log): LogDescription | null => {
        try {
          return this.hub.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(
        (event: LogDescription | null) =>
          event?.name === "SettlementMessagePublished",
      );
    if (!parsed)
      throw new Error("SettlementMessagePublished event was not emitted");

    return {
      transactionHash: receipt.hash,
      messageId: String(parsed.args[2]),
      receipt,
    };
  }
}
