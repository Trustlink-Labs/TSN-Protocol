import {
  buildCreateIntentRequest,
  type CreateIntentRequest,
  type TsnMempoolIntent,
} from "./contracts.js";
import {
  buildPaymentIntentMessage,
  buildCrossChainPaymentIntentMessage,
} from "./canonical-message.js";
import { TsnHttpClient } from "./client.js";

export function createSenderPaymentAuthorizationMessage(params: {
  senderWallet: string;
  senderIdentity: string;
  receiverIdentity: string;
  recipientRouteCommitment: string;
  recipientRouteVersion: number;
  tokenMintAddress: string;
  amount: number;
  senderFeeAmount: number;
  totalTokenRequiredUi: number;
  nonce?: string;
  issuedAt: string;
  expiresAt?: string;
  fundingMode?: "wallet_only_v2" | "epoch_treasury_v1";
}) {
  const recipientTin =
    params.receiverIdentity.match(/(?:^|\|)tin:(\d+)/)?.[1] ??
    params.receiverIdentity.match(/^tin:(\d+)/)?.[1];
  if (!recipientTin) {
    throw new Error(
      "recipient TIN is required for canonical TSN payment authorization",
    );
  }
  const amountBaseUnits = BigInt(Math.round(params.amount * 1_000_000));
  const feeBaseUnits = BigInt(Math.round(params.senderFeeAmount * 1_000_000));
  return buildPaymentIntentMessage({
    amountBaseUnits,
    recipientTin,
    recipientRouteCommitment: params.recipientRouteCommitment,
    recipientRouteVersion: params.recipientRouteVersion,
    feeBaseUnits,
    sender: "Main Wallet",
    nonce: params.nonce ?? "",
    expires:
      params.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}

export function createPaymentAuthorizationNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function createPaymentAuthorizationExpiry(ttlMs = 5 * 60_000) {
  return new Date(Date.now() + ttlMs).toISOString();
}

export function createPaymentAuthorization(params: {
  senderWallet: string;
  senderIdentity: string;
  receiverIdentity: string;
  recipientRouteCommitment: string;
  recipientRouteVersion: number;
  tokenMintAddress: string;
  amount: number;
  senderFeeAmount: number;
  totalTokenRequiredUi: number;
  nonce?: string;
  issuedAt?: string;
  expiresAt?: string;
  fundingMode?: "wallet_only_v2" | "epoch_treasury_v1";
}) {
  const nonce = params.nonce ?? createPaymentAuthorizationNonce();
  const issuedAt = params.issuedAt ?? new Date().toISOString();
  const expiresAt = params.expiresAt ?? createPaymentAuthorizationExpiry();
  const message = createSenderPaymentAuthorizationMessage({
    ...params,
    nonce,
    issuedAt,
    expiresAt,
  });

  return {
    message,
    nonce,
    issuedAt,
    expiresAt,
  };
}

export function createCrossChainPaymentAuthorization(params: {
  intentId: string;
  senderWallet: string;
  senderIdentity: string;
  receiverIdentity: string;
  recipientRouteCommitment: string;
  recipientRouteVersion: number;
  tokenMintAddress: string;
  amount: number;
  senderFeeAmount: number;
  nonce?: string;
  issuedAt?: string;
  expiresAt?: string;
  destinationNetwork: string;
  destinationExecutor: string;
  settlementRouteId: string;
}) {
  const nonce = params.nonce ?? createPaymentAuthorizationNonce();
  const issuedAt = params.issuedAt ?? new Date().toISOString();
  const expiresAt = params.expiresAt ?? createPaymentAuthorizationExpiry();
  const recipientTin =
    params.receiverIdentity.match(/(?:^|\|)tin:(\d+)/)?.[1] ??
    params.receiverIdentity.match(/^tin:(\d+)/)?.[1];
  if (!recipientTin) throw new Error("recipient TIN is required for canonical TSN payment authorization");
  const message = buildCrossChainPaymentIntentMessage({
    intentId: params.intentId,
    amountBaseUnits: BigInt(Math.round(params.amount * 1_000_000)),
    asset: params.tokenMintAddress,
    recipientTin,
    recipientRouteCommitment: params.recipientRouteCommitment,
    recipientRouteVersion: params.recipientRouteVersion,
    feeBaseUnits: BigInt(Math.round(params.senderFeeAmount * 1_000_000)),
    sender: "Main Wallet",
    nonce,
    expires: expiresAt,
    destinationNetwork: params.destinationNetwork,
    destinationExecutor: params.destinationExecutor,
    settlementRouteId: params.settlementRouteId,
  });
  return { message, nonce, issuedAt, expiresAt };
}

export function buildPaymentAuthorizationIntentRequest(params: {
  paymentId: string;
  recipientHash: string;
  recipientTin?: string | null;
  recipientRouteCommitment: string;
  recipientRouteVersion: number;
  tokenMintAddress: string;
  senderWallet: string;
  senderAuthorizationMessage: string;
  senderAuthorizationSignature: string;
  senderAuthorizationNonce: string;
  senderAuthorizationIssuedAt: string;
  senderAuthorizationExpiresAt: string;
  senderFeeAmount?: number | null;
  senderSignedFundingTransaction?: string | null;
  senderSignedFundingFeePayer?: string | null;
  senderFundingMode?: "epoch_treasury_v1" | "sponsored_sender_cosigned" | null;
  privacyVersion?: number | null;
  senderTokenAccount?: string | null;
  transferId?: string | null;
  commitmentHash?: string | null;
  settlementEpoch?: number | null;
  encryptedSettlementToken?: CreateIntentRequest["encryptedSettlementToken"];
  amount: number;
  destinationNetwork?: string | null;
  destinationExecutor?: string | null;
  settlementRouteId?: string | null;
  recipientAmount?: number;
  source?: string;
}): CreateIntentRequest {
  return {
    ...buildCreateIntentRequest({
      paymentId: params.paymentId,
      underlyingPayment: params.senderWallet,
      senderWallet: params.senderWallet,
      senderAuthorizationMessage: params.senderAuthorizationMessage,
      senderAuthorizationSignature: params.senderAuthorizationSignature,
      senderAuthorizationNonce: params.senderAuthorizationNonce,
      senderAuthorizationIssuedAt: params.senderAuthorizationIssuedAt,
      senderAuthorizationExpiresAt: params.senderAuthorizationExpiresAt,
      senderFeeAmount: params.senderFeeAmount,
      senderSignedFundingTransaction:
        params.senderSignedFundingTransaction,
      senderSignedFundingFeePayer: params.senderSignedFundingFeePayer,
      senderFundingMode: params.senderFundingMode,
      privacyVersion: params.privacyVersion,
      senderTokenAccount: params.senderTokenAccount,
      transferId: params.transferId,
      commitmentHash: params.commitmentHash,
      settlementEpoch: params.settlementEpoch,
      encryptedSettlementToken: params.encryptedSettlementToken,
      recipientHash: params.recipientHash,
      recipientTin: params.recipientTin,
      recipientRouteCommitment: params.recipientRouteCommitment,
      recipientRouteVersion: params.recipientRouteVersion,
      tokenMintAddress: params.tokenMintAddress,
      amount: params.amount,
      destinationNetwork: params.destinationNetwork,
      destinationExecutor: params.destinationExecutor,
      settlementRouteId: params.settlementRouteId,
      source: params.source,
    }),
    ...(params.recipientAmount == null
      ? {}
      : { recipientAmount: params.recipientAmount }),
  };
}

export async function submitPaymentAuthorizationToMempool(params: {
  mempoolUrl: string;
  fetchImpl?: typeof fetch;
  paymentId: string;
  recipientHash: string;
  recipientTin?: string | null;
  recipientRouteCommitment: string;
  recipientRouteVersion: number;
  tokenMintAddress: string;
  senderWallet: string;
  senderAuthorizationMessage: string;
  senderAuthorizationSignature: string;
  senderAuthorizationNonce: string;
  senderAuthorizationIssuedAt: string;
  senderAuthorizationExpiresAt: string;
  senderFeeAmount?: number | null;
  senderSignedFundingTransaction?: string | null;
  senderSignedFundingFeePayer?: string | null;
  senderFundingMode?: "epoch_treasury_v1" | "sponsored_sender_cosigned" | null;
  privacyVersion?: number | null;
  senderTokenAccount?: string | null;
  transferId?: string | null;
  commitmentHash?: string | null;
  settlementEpoch?: number | null;
  encryptedSettlementToken?: CreateIntentRequest["encryptedSettlementToken"];
  amount: number;
  destinationNetwork?: string | null;
  destinationExecutor?: string | null;
  settlementRouteId?: string | null;
  recipientAmount?: number;
  destinationWallet?: string | null;
  source?: string;
}) {
  const intentRequest = buildPaymentAuthorizationIntentRequest(params);
  const client = new TsnHttpClient({
    baseUrl: params.mempoolUrl,
    fetchImpl: params.fetchImpl,
  });
  const intent = await client.postIntent<CreateIntentRequest, TsnMempoolIntent>(
    intentRequest,
  );
  // Claim work is deliberately not created by the sender device.  A claim is
  // only valid after the TSN Node has verified this payment and a Cranker has
  // confirmed the immutable funding transaction.  The Receiver creates that
  // next work item atomically from the CONFIRMED payment transition.
  return {
    intentRequest,
    intent,
  };
}
