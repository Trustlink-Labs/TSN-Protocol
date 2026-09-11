import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2";

// TSN-only exit façade.
//
// The exit is a strict two-phase value path, both phases coordinated by the
// TSN program against the shared Mother escrow:
//
//   Phase 1 (exit-intent): tsn_register_tcap_exit_debit_v1 records a sealed
//      debit against the TCap reserve/liability and opens a permit PDA.
//   Phase 2 (exit-settle): tsn_register_tcap_exit_payout_v1 consumes that
//      permit and pays the recipient's associated token account.
//
// The payout instruction fixes a `system_program` account in its account list
// so the associated-token-account creation CPI can be satisfied; the legacy
// private payout path (private-settlement) is quarantined, NOT this façade.

export const TSN_PROGRAM_ID = new PublicKey("TSN31jddtsmUg4D5aEdhY31nwB1e53VJJg9X8NoRP8V");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbbNbGKPFXCWuBvf9Ss623VQ5DA");

export function getTcapProgramId(): PublicKey {
  const value = process.env.TCAP_PROGRAM_ID?.trim();
  if (!value) throw new Error("TCAP_PROGRAM_ID is required for TSN exit instructions");
  try {
    return new PublicKey(value);
  } catch {
    throw new Error("TCAP_PROGRAM_ID must be a valid Solana public key");
  }
}

const textEncoder = new TextEncoder();

function seed(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function digest(value: Uint8Array): Uint8Array {
  return sha256(value);
}

function discriminator(name: string): Uint8Array {
  return sha256(textEncoder.encode(`global:${name}`)).subarray(0, 8);
}

function bytes32(value: Uint8Array | string | Buffer, label: string): Uint8Array {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(String(value), "hex");
  if (bytes.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return bytes;
}

function bytes48(value: Uint8Array | string | Buffer, label: string): Uint8Array {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(value ?? "", "hex");
  if (bytes.length !== 48) throw new Error(`${label} must be exactly 48 bytes`);
  return bytes;
}

function bytes64(value: Uint8Array | string | Buffer, label: string): Uint8Array {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(value ?? "", "hex");
  if (bytes.length !== 64) throw new Error(`${label} must be exactly 64 bytes`);
  return bytes;
}

function pubkey(value: string | PublicKey): PublicKey {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function u64(value: bigint | number | string): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(value), true);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export type ExitDebitParams = {
  authority: string | PublicKey;
  motherEscrow: string | PublicKey;
  tcapConfig: string | PublicKey;
  tip: string | PublicKey;
  reserve: string | PublicKey;
  liability: string | PublicKey;
  mint: string | PublicKey;
  permitNonce: Uint8Array | string;
  destinationCommitment: Uint8Array | string;
  amount: bigint | number | string;
  sequence: bigint | number | string;
  sealed: Uint8Array | string;
  sealCommitment: Uint8Array | string;
  sourceDebitSignature: Uint8Array | string;
};

export function buildExitDebitInstruction(params: ExitDebitParams): TransactionInstruction {
  const nonce = bytes32(params.permitNonce, "permitNonce");
  const permit = deriveExitPermitPda({ permitNonce: nonce });
  const data = concat(
    discriminator("tsn_register_tcap_exit_debit_v1"),
    nonce,
    bytes32(params.destinationCommitment, "destinationCommitment"),
    pubkey(params.mint).toBytes(),
    u64(params.amount),
    u64(params.sequence),
    bytes48(params.sealed, "sealed"),
    bytes32(params.sealCommitment, "sealCommitment"),
    bytes64(params.sourceDebitSignature, "sourceDebitSignature"),
  );
  return new TransactionInstruction({
    programId: TSN_PROGRAM_ID,
    keys: [
      { pubkey: pubkey(params.authority), isSigner: true, isWritable: true },
      { pubkey: pubkey(params.motherEscrow), isSigner: false, isWritable: false },
      { pubkey: getTcapProgramId(), isSigner: false, isWritable: false },
      { pubkey: pubkey(params.tcapConfig), isSigner: false, isWritable: false },
      { pubkey: pubkey(params.tip), isSigner: false, isWritable: true },
      { pubkey: pubkey(params.reserve), isSigner: false, isWritable: true },
      { pubkey: pubkey(params.liability), isSigner: false, isWritable: true },
      { pubkey: permit, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function buildExitDebitTransaction(params: ExitDebitParams): Transaction {
  return new Transaction().add(buildExitDebitInstruction(params));
}

export type ExitPayoutParams = {
  authority: string | PublicKey;
  motherEscrow: string | PublicKey;
  tcapConfig: string | PublicKey;
  reserve: string | PublicKey;
  assetEntry: string | PublicKey;
  permit: string | PublicKey;
  reserveAuthority: string | PublicKey;
  vault: string | PublicKey;
  destination: string | PublicKey;
  destinationOwner: string | PublicKey;
  mint: string | PublicKey;
  tokenProgram?: string | PublicKey;
};

export function buildExitPayoutInstruction(params: ExitPayoutParams): TransactionInstruction {
  const destinationOwner = pubkey(params.destinationOwner);
  const data = concat(
    discriminator("tsn_register_tcap_exit_payout_v1"),
    destinationOwner.toBytes(),
  );
  return new TransactionInstruction({
    programId: TSN_PROGRAM_ID,
    keys: [
      { pubkey: pubkey(params.authority), isSigner: true, isWritable: true },
      { pubkey: pubkey(params.motherEscrow), isSigner: false, isWritable: false },
      { pubkey: getTcapProgramId(), isSigner: false, isWritable: false },
      { pubkey: pubkey(params.tcapConfig), isSigner: false, isWritable: false },
      { pubkey: pubkey(params.reserve), isSigner: false, isWritable: true },
      { pubkey: pubkey(params.assetEntry), isSigner: false, isWritable: false },
      { pubkey: pubkey(params.permit), isSigner: false, isWritable: true },
      { pubkey: pubkey(params.reserveAuthority), isSigner: false, isWritable: false },
      { pubkey: pubkey(params.vault), isSigner: false, isWritable: true },
      { pubkey: pubkey(params.destination), isSigner: false, isWritable: true },
      { pubkey: pubkey(params.mint), isSigner: false, isWritable: false },
      { pubkey: pubkey(params.tokenProgram ?? TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      // Fixed system_program so the recipient ATA-creation CPI can resolve.
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function buildExitPayoutTransaction(params: ExitPayoutParams): Transaction {
  return new Transaction().add(buildExitPayoutInstruction(params));
}

export function deriveExitPermitPda(input: { permitNonce: Uint8Array | string }): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed("tcap:exit-permit:v1"), bytes32(input.permitNonce, "permitNonce")],
    getTcapProgramId(),
  )[0];
}

export function deriveExitDestinationAta(input: {
  destinationOwner: string | PublicKey;
  mint: string | PublicKey;
  tokenProgram?: string | PublicKey;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      pubkey(input.destinationOwner).toBytes(),
      pubkey(input.tokenProgram ?? TOKEN_PROGRAM_ID).toBytes(),
      pubkey(input.mint).toBytes(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export type ExitCommitmentFields = {
  destinationOwner: string | PublicKey;
  destination: string | PublicKey;
  amount: bigint | number | string;
  mint: string | PublicKey;
  permitNonce: Uint8Array | string;
  sourceTip: string | PublicKey;
  sequence: bigint | number | string;
};

export function deriveExitCommitment(fields: ExitCommitmentFields): Uint8Array {
  return digest(concat(
    seed("TCAP_EXIT_COMMIT_V1"),
    pubkey(fields.destinationOwner).toBytes(),
    pubkey(fields.destination).toBytes(),
    u64(fields.amount),
    pubkey(fields.mint).toBytes(),
    bytes32(fields.permitNonce, "permitNonce"),
    pubkey(fields.sourceTip).toBytes(),
    u64(fields.sequence),
  ));
}
