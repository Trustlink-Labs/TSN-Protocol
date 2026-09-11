"""TSN Node orchestration for the optional Creditcoin TinExitAttested receipt.

The official Attestcoin SDK is Node.js-only, so this Python module owns the
durable workflow and invokes the isolated TypeScript USC helper. Creditcoin
transaction submission remains an injected EVM-cranker boundary; this module
never holds user funds or changes Solana settlement state.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from dataclasses import asdict, dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger("tsn.attestcoin")


class AttestationState(StrEnum):
    PENDING = "PENDING"
    ANCHOR_SUBMITTED = "ANCHOR_SUBMITTED"
    ANCHOR_CONFIRMED = "ANCHOR_CONFIRMED"
    PROOF_WAITING = "PROOF_WAITING"
    PROOF_VERIFIED = "PROOF_VERIFIED"
    ASC_SUBMITTED = "ASC_SUBMITTED"
    ATTESTED = "ATTESTED"


@dataclass(frozen=True)
class TinExitAttestationJob:
    settlement_id: str
    anchor_tx_hash: str
    sealed_tip_head_hash: str
    amount: str
    tin_hash: str
    exit_commitment: str
    merchant_override: bool = False


@dataclass(frozen=True)
class AttestationResult:
    settlement_id: str
    state: AttestationState
    anchor_tx_hash: str
    creditcoin_tx_hash: str | None = None


class AttestationTracker(Protocol):
    async def read(self, settlement_id: str) -> dict[str, Any] | None: ...

    async def write(self, settlement_id: str, state: AttestationState, patch: dict[str, Any]) -> None: ...


class EvmCranker(Protocol):
    async def submit_tin_exit_proof(self, payload: dict[str, Any]) -> str: ...


class HttpEvmCranker:
    """Adapter for the existing EVM cranker service.

    The cranker endpoint is configuration, not hardcoded protocol logic. It
    must submit TinExitAttestedASC.execute on Creditcoin and return the tx hash.
    """

    def __init__(self, endpoint: str, api_key: str | None = None) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key

    async def submit_tin_exit_proof(self, payload: dict[str, Any]) -> str:
        import httpx

        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(self.endpoint, json=payload, headers=headers)
            response.raise_for_status()
            body = response.json()
        tx_hash = str(body.get("creditcoinTxHash") or body.get("txHash") or "")
        if not tx_hash:
            raise RuntimeError("EVM cranker response did not include a Creditcoin transaction hash")
        return tx_hash


class InMemoryAttestationTracker:
    """Small tracker for unit tests; production Node wiring should use its store."""

    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def read(self, settlement_id: str) -> dict[str, Any] | None:
        async with self._lock:
            record = self.records.get(settlement_id)
            return dict(record) if record else None

    async def write(self, settlement_id: str, state: AttestationState, patch: dict[str, Any]) -> None:
        async with self._lock:
            current = self.records.setdefault(settlement_id, {})
            current.update(patch)
            current["state"] = state.value


class AttestcoinWorker:
    def __init__(
        self,
        tracker: AttestationTracker,
        cranker: EvmCranker,
        crosschain_root: Path,
        node_command: str = "npx",
        max_retries: int = 3,
    ) -> None:
        self.tracker = tracker
        self.cranker = cranker
        self.crosschain_root = crosschain_root
        self.node_command = node_command
        self.max_retries = max_retries

    async def run(self, job: TinExitAttestationJob) -> AttestationResult:
        self._validate(job)
        existing = await self.tracker.read(job.settlement_id)
        if existing and existing.get("state") in {
            AttestationState.ASC_SUBMITTED.value,
            AttestationState.ATTESTED.value,
        }:
            return AttestationResult(
                job.settlement_id,
                AttestationState(existing["state"]),
                job.anchor_tx_hash,
                existing.get("creditcoin_tx_hash"),
            )

        await self._write(job, AttestationState.PENDING, {"anchor_tx_hash": job.anchor_tx_hash})
        await self._write(job, AttestationState.ANCHOR_SUBMITTED, {})
        await self._write(job, AttestationState.ANCHOR_CONFIRMED, {})
        await self._write(job, AttestationState.PROOF_WAITING, {})
        proof = await self._get_verified_proof(job)
        await self._write(job, AttestationState.PROOF_VERIFIED, {"proof_ready": True})

        payload = {
            "idempotencyKey": self._idempotency_key(job),
            "settlementId": job.settlement_id,
            "sourceChainKey": 1,
            "anchorTxHash": job.anchor_tx_hash,
            "evidence": {
                "sealedTipHeadHash": job.sealed_tip_head_hash,
                "amount": job.amount,
                "tinHash": job.tin_hash,
                "exitCommitment": job.exit_commitment,
            },
            "proof": proof,
        }
        creditcoin_tx_hash = await self._submit_with_retries(payload)
        await self._write(
            job,
            AttestationState.ASC_SUBMITTED,
            {"creditcoin_tx_hash": creditcoin_tx_hash},
        )
        await self._write(
            job,
            AttestationState.ATTESTED,
            {"creditcoin_tx_hash": creditcoin_tx_hash},
        )
        logger.info("TinExitAttested settlement=%s tx=%s", job.settlement_id, creditcoin_tx_hash)
        return AttestationResult(job.settlement_id, AttestationState.ATTESTED, job.anchor_tx_hash, creditcoin_tx_hash)

    async def _get_verified_proof(self, job: TinExitAttestationJob) -> dict[str, Any]:
        env = os.environ.copy()
        env["ANCHOR_TX_HASH"] = job.anchor_tx_hash
        env["SOURCE_CHAIN_KEY"] = "1"
        command = [self.node_command, "tsx", "worker/usc-proof-helper.ts"]
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=self.crosschain_root,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise RuntimeError(f"USC proof helper failed: {stderr.decode().strip()}")
        try:
            return json.loads(stdout.decode().strip())
        except json.JSONDecodeError as exc:
            raise RuntimeError("USC proof helper returned invalid JSON") from exc

    async def _submit_with_retries(self, payload: dict[str, Any]) -> str:
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                return await self.cranker.submit_tin_exit_proof(payload)
            except Exception as exc:  # noqa: BLE001 - retry boundary
                last_error = exc
                delay = min(60, 2**attempt)
                logger.warning("Creditcoin submission failed attempt=%s retry_in=%ss error=%s", attempt + 1, delay, exc)
                if attempt + 1 < self.max_retries:
                    await asyncio.sleep(delay)
        raise RuntimeError("Creditcoin ASC submission failed after retries") from last_error

    async def _write(self, job: TinExitAttestationJob, state: AttestationState, patch: dict[str, Any]) -> None:
        await self.tracker.write(job.settlement_id, state, {**patch, "job": asdict(job)})

    @staticmethod
    def _idempotency_key(job: TinExitAttestationJob) -> str:
        return f"{job.settlement_id}:{job.exit_commitment}"

    @staticmethod
    def _validate(job: TinExitAttestationJob) -> None:
        if not job.merchant_override:
            raise ValueError("TinExitAttested must be explicitly requested by policy")
        if not job.settlement_id or not job.anchor_tx_hash:
            raise ValueError("settlement_id and anchor_tx_hash are required")
        for name, value in (
            ("sealed_tip_head_hash", job.sealed_tip_head_hash),
            ("tin_hash", job.tin_hash),
            ("exit_commitment", job.exit_commitment),
        ):
            if not value.startswith("0x") or len(value) != 66:
                raise ValueError(f"{name} must be a 32-byte 0x hash")
        if int(job.amount) <= 0:
            raise ValueError("amount must be positive")


def build_worker_from_environment(
    tracker: AttestationTracker,
    crosschain_root: Path,
) -> AttestcoinWorker:
    endpoint = os.environ.get("EVM_CRANKER_ATTEST_URL")
    if not endpoint:
        raise RuntimeError("EVM_CRANKER_ATTEST_URL is required for Creditcoin proof submission")
    return AttestcoinWorker(
        tracker=tracker,
        cranker=HttpEvmCranker(endpoint, os.environ.get("EVM_CRANKER_API_KEY")),
        crosschain_root=crosschain_root,
        node_command=os.environ.get(
            "TSN_CROSSCHAIN_RUNNER",
            "npx.cmd" if os.name == "nt" else "npx",
        ),
    )
