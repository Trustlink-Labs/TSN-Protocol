"""DBrix-compatible encrypted record envelope and Ledger Memo encoding."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import zlib
from typing import Any

from nacl.secret import SecretBox


def _ledger_memo_payload_v1(document: bytes) -> tuple[list[str], str]:
    encoded = base64.urlsafe_b64encode(document).decode("ascii").rstrip("=")
    slots = [encoded[index:index + 32].ljust(32, "=") for index in range(0, len(encoded), 32)]
    # Memo carries the uninterrupted Base64URL stream. Slot padding is a
    # Ledger presentation detail and is stripped before composing the stream.
    memo_payload = "".join(slot.rstrip("=") for slot in slots)
    return slots, memo_payload


def encrypt_transaction_record_v1(
    *,
    record: dict[str, Any],
    shared_point: bytes,
    record_ephemeral_public_key: bytes,
    dna: bytes,
) -> dict[str, Any]:
    """Build the same XSalsa20-Poly1305/Deflate envelope used by @dbrix/core."""
    if len(shared_point) != 32 or not any(shared_point):
        raise ValueError("GPRU record shared point must be a nonzero 32-byte point")
    if len(record_ephemeral_public_key) != 32 or not any(record_ephemeral_public_key):
        raise ValueError("GPRU record ephemeral public key must be a nonzero 32-byte point")
    if len(dna) != 32 or not any(dna):
        raise ValueError("GPRU DNA must be a nonzero 32-byte value")

    key = hashlib.sha256(
        b"DBRIX_GPRU_TRANSACTION_RECORD_KEY_V1\0"
        + shared_point
        + dna
        + record_ephemeral_public_key
    ).digest()
    typed_plaintext = b"\x02" + json.dumps(
        record, separators=(",", ":"), sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")
    compressed = zlib.compress(typed_plaintext, level=9)
    if len(compressed) < len(typed_plaintext):
        plaintext = compressed
        compression = "deflate"
    else:
        plaintext = typed_plaintext
        compression = None

    nonce = secrets.token_bytes(SecretBox.NONCE_SIZE)
    ciphertext = SecretBox(key).encrypt(plaintext, nonce).ciphertext
    envelope: dict[str, Any] = {
        "version": 1,
        "algorithm": "dbrix-core-secretbox-v1",
        "dna": dna.hex(),
        "recordEphemeralPublicKey": record_ephemeral_public_key.hex(),
        "data": base64.b64encode(ciphertext).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
    }
    if compression:
        envelope["compression"] = compression

    document = json.dumps(envelope, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    slots, memo_payload = _ledger_memo_payload_v1(document)
    return {
        "memoPayload": memo_payload,
        "memoLedgerSlots": slots,
        "memoCommitment": hashlib.sha256(memo_payload.encode("ascii")).hexdigest(),
        "recordEphemeralPublicKey": record_ephemeral_public_key.hex(),
    }