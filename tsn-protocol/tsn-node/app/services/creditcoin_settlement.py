"""Creditcoin-first settlement boundary.

This module is deliberately independent from the Solana program. The Node
supplies already-validated public hashes and a destination address; the
Creditcoin Cranker transports the authorized request. It does not generate
proofs, anchor transactions, or hold private TIN data.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

CreditcoinNetwork = Literal["creditcoin-testnet"]


def _bytes32(value: str, field: str) -> str:
    if not isinstance(value, str) or len(value) != 66 or not value.startswith("0x"):
        raise ValueError(f"{field} must be a 32-byte hex value")
    try:
        int(value[2:], 16)
    except ValueError as exc:
        raise ValueError(f"{field} must be a 32-byte hex value") from exc
    return value.lower()


def _evm_address(value: str) -> str:
    if not isinstance(value, str) or len(value) != 42 or not value.startswith("0x"):
        raise ValueError("recipient must be a 20-byte EVM address")
    try:
        int(value[2:], 16)
    except ValueError as exc:
        raise ValueError("recipient must be a 20-byte EVM address") from exc
    return value


@dataclass(frozen=True)
class CreditcoinPayoutAuthorization:
    settlement_id: str
    sealed_tip_head_hash: str
    tin_hash: str
    exit_commitment: str
    token: str
    recipient: str
    amount_base_units: int
    fee_amount_base_units: int
    nonce: int
    deadline: int
    merchant_override: bool = False
    destination_network: CreditcoinNetwork = "creditcoin-testnet"

    def __post_init__(self) -> None:
        object.__setattr__(self, "settlement_id", _bytes32(self.settlement_id, "settlement_id"))
        object.__setattr__(self, "sealed_tip_head_hash", _bytes32(self.sealed_tip_head_hash, "sealed_tip_head_hash"))
        object.__setattr__(self, "tin_hash", _bytes32(self.tin_hash, "tin_hash"))
        object.__setattr__(self, "exit_commitment", _bytes32(self.exit_commitment, "exit_commitment"))
        object.__setattr__(self, "recipient", _evm_address(self.recipient))
        object.__setattr__(self, "token", _evm_address(self.token))
        if self.destination_network != "creditcoin-testnet":
            raise ValueError("only the Creditcoin settlement rail is enabled")
        if self.amount_base_units <= 0 or self.fee_amount_base_units < 0 or self.nonce < 0 or self.deadline <= 0:
            raise ValueError("invalid Creditcoin payout numeric field")

    def to_cranker_payload(self, signature: str) -> dict[str, Any]:
        if not isinstance(signature, str) or not signature.startswith("0x"):
            raise ValueError("authorization signature is required")
        return {
            "destinationNetwork": self.destination_network,
            "authorization": {
                "settlementId": self.settlement_id,
                "sourceNetwork": "solana-devnet",
                "sealedTipHeadHash": self.sealed_tip_head_hash,
                "tinHash": self.tin_hash,
                "exitCommitment": self.exit_commitment,
                "destinationNetwork": self.destination_network,
                "token": self.token,
                "recipient": self.recipient,
                "amount": str(self.amount_base_units),
                "feeAmount": str(self.fee_amount_base_units),
                "nonce": str(self.nonce),
                "deadline": str(self.deadline),
                "merchantOverride": self.merchant_override,
            },
            "signature": signature,
        }
