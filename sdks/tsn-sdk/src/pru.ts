import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import nacl from "tweetnacl";

// This module now carries ONLY the TIN identity + routing surface.  The PRU
// spend/balance/sweep surface and the scoped-intent cranker path were retired
// (two-phase value paths hold funds in the shared Mother escrow).  Keep this
// internal: it is not re-exported from the SDK root.

export type PruLifecycleState = "PLANNED" | "ACTIVE" | "USED" | "SWEPT";

export const DEFAULT_PRU_COUNT = 30 as const;

export type PruEndpoint = {
  tinId: string;
  index: number;
  derivedPublicKey: string;
  encryptedMetadata?: string;
  state: PruLifecycleState;
};

const textEncoder = new TextEncoder();
const PRU_CONFIGURATION_TAG = "TSN_V1_TOKEN_AGNOSTIC_PRU_CONFIGURATION";
const TIN_MASTER_SEED_BYTES = 32;

function hashHex(parts: Array<string | number | bigint | Uint8Array>) {
  const chunks = parts.map((part) => {
    if (part instanceof Uint8Array) return Buffer.from(part).toString("hex");
    return String(part);
  });
  return bytesToHex(sha256(textEncoder.encode(chunks.join("|"))));
}

export function getDefaultPruCount() {
  return DEFAULT_PRU_COUNT;
}

export function derivePruPublicKey(input: {
  masterSeed: string | Uint8Array;
  tinId: string;
  index: number;
}) {
  if (!Number.isInteger(input.index) || input.index < 0) {
    throw new Error("PRU index must be a non-negative integer");
  }
  const masterSeedHex = typeof input.masterSeed === "string"
    ? input.masterSeed
    : bytesToHex(input.masterSeed);
  const seed = sha256(textEncoder.encode(`TRUSTLINK_PRU_KEY_V1|${masterSeedHex}|${input.tinId}|${input.index}`));
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  wipeBytes(seed);
  return bytesToHex(keypair.publicKey);
}

export function derivePruSet(input: {
  masterSeed: string | Uint8Array;
  tinId: string;
  encryptedMetadataForIndex?: (index: number) => string | undefined;
  initialState?: PruLifecycleState;
}) {
  const count = getDefaultPruCount();
  return Array.from({ length: count }, (_, index): PruEndpoint => ({
    tinId: input.tinId,
    index,
    derivedPublicKey: derivePruPublicKey({ masterSeed: input.masterSeed, tinId: input.tinId, index }),
    encryptedMetadata: input.encryptedMetadataForIndex?.(index),
    state: input.initialState ?? "PLANNED",
  }));
}

export function computePruConfigurationHash(prus: PruEndpoint[]) {
  const canonical = [...prus]
    .sort((left, right) => left.index - right.index)
    .map((pru) => `${pru.tinId}:${pru.index}:${pru.derivedPublicKey}:${pru.encryptedMetadata ?? ""}`)
    .join("\n");
  return hashHex([PRU_CONFIGURATION_TAG, canonical]);
}

function randomBytesCsprng(size: number) {
  const bytes = new Uint8Array(size);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  throw new Error("Web Crypto API (crypto.getRandomValues) is required for TrustLink SDK");
}

function wipeBytes(bytes?: Uint8Array | null) {
  if (bytes) bytes.fill(0);
}

export function generateTinMasterSeed(randomBytesFn: (size: number) => Uint8Array = randomBytesCsprng) {
  const seed = randomBytesFn(TIN_MASTER_SEED_BYTES);
  if (seed.length !== TIN_MASTER_SEED_BYTES) throw new Error("TIN Master Seed must be exactly 32 bytes");
  return seed;
}
