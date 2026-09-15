import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export type TsnSplTokenTransferTransactionParams = {
  senderWallet: string;
  recipientWallet: string;
  tokenMintAddress: string;
  amountUi: string;
  tokenDecimals: number;
  rpcUrl: string;
};

function parseUiAmount(amountUi: string, decimals: number): bigint {
  const [whole, fraction = ""] = amountUi.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) throw new Error("Invalid token amount");
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (amount <= 0n) throw new Error("Amount must be positive");
  return amount;
}

/** Builds an unsigned SPL transfer transaction for a TSN dApp. */
export async function buildTsnSplTokenTransferTransaction(params: TsnSplTokenTransferTransactionParams) {
  const sender = new PublicKey(params.senderWallet);
  const recipient = new PublicKey(params.recipientWallet);
  const mint = new PublicKey(params.tokenMintAddress);
  const decimals = Number(params.tokenDecimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Token decimals must be an integer from 0 through 18");
  const amount = parseUiAmount(params.amountUi, decimals);
  const connection = new Connection(params.rpcUrl, "confirmed");
  const senderAta = getAssociatedTokenAddressSync(mint, sender);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient);
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: sender, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(sender, recipientAta, recipient, mint),
    createTransferCheckedInstruction(senderAta, mint, recipientAta, sender, amount, decimals, [], TOKEN_PROGRAM_ID),
  );
  return {
    transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    senderWallet: sender.toBase58(), recipientWallet: recipient.toBase58(), tokenMintAddress: mint.toBase58(),
    senderTokenAccount: senderAta.toBase58(), recipientTokenAccount: recipientAta.toBase58(), amountUi: params.amountUi,
    amountBaseUnits: amount.toString(), tokenDecimals: decimals, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}
