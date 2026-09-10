"""Drive one complete Attestia lifecycle on the production contract and
record exactly what the chain returns.

    python scripts/prove_lifecycle.py                 # run it, write the report
    python scripts/prove_lifecycle.py --verify FILE   # re-check a report from chain

Nothing in the report is typed in by hand. Every transaction hash, status,
consensus result and state snapshot is read back from the network, and
`--verify` re-reads each one so anyone can confirm the report against the
chain rather than trusting it.

The signer is the key in `.env` (ATTESTIA_KEY). It is loaded, used, and
never printed.

WHAT "FINAL" MEANS HERE. Two different clocks are involved and the report
keeps them apart:

  * GenLayer transaction finality — every write is followed from ACCEPTED
    (the validators' decision) to FINALIZED (the appeal window closed and
    the result is irreversible). Accepted is not final.
  * Attestia's own challenge window — a protocol rule inside the contract,
    enforced against a consensus-observed clock. A claim is FINALIZED in the
    protocol only when `finalize_claim` succeeds after that window.

The steward's prompt listed fund / accept / supplier evidence / fulfill /
settle and a deductible. Those belong to an escrow protocol. Attestia has
no escrow by design (its build spec forbids bonds, staking and payouts), so
the lifecycle below is Attestia's real one. Nothing is invented to fill
the missing names.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import time

from eth_account import Account
from genlayer_py import create_client
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionStatus

REPO = pathlib.Path(__file__).resolve().parents[1]


def _production_address() -> str:
    """The frontend's committed production config is the one source of the
    address — this script does not keep a second copy that could drift."""
    for line in (REPO / "frontend" / ".env.example").read_text(encoding="utf-8").splitlines():
        if line.startswith("NEXT_PUBLIC_CONTRACT_ADDRESS="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("frontend/.env.example has no NEXT_PUBLIC_CONTRACT_ADDRESS")


PRODUCTION_CONTRACT = _production_address()
RPC_URL = studionet.rpc_urls["default"]["http"][0]

# Commit-pinned, so every validator retrieves byte-identical content. That
# matters: retrieved-content digests are part of the consensus fingerprint,
# so a source that moved between two validators' fetches would split the
# round.
PIN = "e685f1f12c4c357787d48390692a654baf576f03"
RAW = f"https://raw.githubusercontent.com/genlayerlabs/genlayer-project-boilerplate/{PIN}"
EVIDENCE_URL = f"{RAW}/README.md"
COUNTER_URL = f"{RAW}/LICENSE"

CLAIM_TEXT = ("The GenLayer project boilerplate repository documents a "
              "GenLayer intelligent contract project.")
EVIDENCE_WINDOW = 60      # contract minimum
CHALLENGE_WINDOW = 120    # short enough to wait out honestly

# ─── transport resilience ───────────────────────────────────────────────────
# The public RPC drops connections mid-flight. Retry at the transport
# boundary only: a JSON-RPC error is a real answer and is raised at once.
# Re-broadcasting eth_sendRawTransaction is safe — the payload is already
# signed, so its nonce and hash are fixed.
_TRANSIENT = ("SSL", "Max retries", "Connection aborted", "Connection reset",
              "Read timed out", "Remote end closed", "RemoteDisconnected",
              "timed out", "returned invalid JSON", "<!DOCTYPE html>",
              "Bad gateway", "502", "503", "504")


def _install_retry() -> None:
    import importlib
    provider = importlib.import_module("genlayer_py.provider.provider")
    cls = provider.GenLayerProvider
    if getattr(cls, "_attestia_retry", False):
        return
    original = cls.make_request

    def make_request(self, method, params):
        last = None
        for attempt in range(6):
            try:
                return original(self, method, params)
            except Exception as err:  # noqa: BLE001 — the provider wraps everything
                if not any(m in str(err) for m in _TRANSIENT):
                    raise
                last = err
                time.sleep(3 * (attempt + 1))
        raise last

    cls.make_request = make_request
    cls._attestia_retry = True


def _key() -> str:
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("ATTESTIA_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("ATTESTIA_KEY not found in .env")


def _plain(value):
    """GenLayer SDK objects → JSON-safe values."""
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, bytes):
        return "0x" + value.hex()
    if hasattr(value, "value") and not isinstance(value, (int, str, float, bool)):
        return value.value
    return value


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Driver:
    def __init__(self) -> None:
        _install_retry()
        self.account = Account.from_key(_key())
        self.client = create_client(chain=studionet, account=self.account)
        self.steps: list[dict] = []

    # ── reads ───────────────────────────────────────────────────────────────
    def read(self, fn: str, args: list):
        return _plain(self.client.read_contract(
            address=PRODUCTION_CONTRACT, function_name=fn, args=args))

    def claim(self, claim_id: str) -> dict:
        c = self.read("get_claim", [claim_id])
        keep = ("status", "current_version", "current_verdict", "evidence_count",
                "challenge_count", "adjudication_count", "opened_at",
                "evidence_deadline", "adjudicated_at", "challenge_deadline",
                "finalized_at", "current_adjudication_id", "current_attestation_id")
        return {k: c.get(k) for k in keep}

    # ── writes ──────────────────────────────────────────────────────────────
    def write(self, step: str, fn: str, args: list, claim_id: str | None,
              expect_success: bool = True, rounds_wait: int = 240) -> dict:
        """Submit, follow to ACCEPTED, then to FINALIZED, then re-read state."""
        record = {"step": step, "contract": PRODUCTION_CONTRACT, "function": fn,
                  "caller": self.account.address, "args": args,
                  "submitted_at": _now()}
        print(f"\n[{step}] {fn}({', '.join(repr(a)[:40] for a in args)})")

        tx_hash = self.client.write_contract(
            address=PRODUCTION_CONTRACT, function_name=fn, args=args,
            consensus_max_rotations=3)
        tx_hash = _plain(tx_hash)
        record["tx_hash"] = tx_hash
        print(f"  submitted  {tx_hash}")

        # 1. the validators' decision
        accepted = _plain(self.client.wait_for_transaction_receipt(
            transaction_hash=tx_hash, status=TransactionStatus.ACCEPTED,
            interval=5000, retries=rounds_wait, full_transaction=True))
        leader = (accepted.get("consensus_data") or {}).get("leader_receipt") or [{}]
        leader = leader[0] if isinstance(leader, list) and leader else {}
        result = leader.get("result") or {}
        last_round = accepted.get("last_round") or {}
        record["accepted"] = {
            "at": _now(),
            "status_name": accepted.get("status_name"),
            "consensus_result": accepted.get("result_name"),
            "execution_result": leader.get("execution_result"),
            "result_status": result.get("status"),
            "payload": result.get("payload"),
            "validator_votes": last_round.get("validator_votes_name"),
            "gl_tx_id": accepted.get("tx_id") or tx_hash,
        }
        print(f"  accepted   {record['accepted']['consensus_result']}  "
              f"execution={record['accepted']['execution_result']}  "
              f"votes={record['accepted']['validator_votes']}")

        # 2. finality: the appeal window closed and the result is permanent
        final = _plain(self.client.wait_for_transaction_receipt(
            transaction_hash=tx_hash, status=TransactionStatus.FINALIZED,
            interval=5000, retries=rounds_wait, full_transaction=False))
        record["finalized"] = {"at": _now(), "status_name": final.get("status_name")}
        print(f"  finalized  {record['finalized']['status_name']}")

        ok = record["accepted"]["execution_result"] == "SUCCESS"
        record["execution_succeeded"] = ok
        if ok != expect_success:
            record["unexpected"] = True
            self.steps.append(record)
            raise SystemExit(
                f"[{step}] expected success={expect_success}, got "
                f"{record['accepted']['execution_result']}: {record['accepted']['payload']}")

        # 3. the state the UI would refresh to, read from the contract
        if claim_id:
            record["refreshed_state"] = self.claim(claim_id)
            print(f"  state      {record['refreshed_state']['status']}  "
                  f"v{record['refreshed_state']['current_version']}  "
                  f"verdict={record['refreshed_state']['current_verdict'] or '-'}")
        self.steps.append(record)
        return record


def run(out_json: pathlib.Path) -> None:
    d = Driver()
    info = d.read("get_protocol_info", [])
    started = _now()
    print(f"contract {PRODUCTION_CONTRACT}  version {info.get('version')}")
    print(f"signer   {d.account.address}")

    before = d.read("list_claims", [0, 100])["total"]

    d.write("CREATE", "create_claim",
            [CLAIM_TEXT, EVIDENCE_WINDOW, CHALLENGE_WINDOW], None)
    page = d.read("list_claims", [0, 100])
    claim_id = page["rows"][-1]["claim_id"]
    assert page["total"] == before + 1, "the claim did not appear"
    d.steps[-1]["refreshed_state"] = d.claim(claim_id)
    print(f"  claim      {claim_id}")

    d.write("OPEN", "open_claim", [claim_id], claim_id)
    d.write("EVIDENCE", "submit_evidence",
            [claim_id, EVIDENCE_URL, "DOCUMENTATION",
             "The repository README, pinned to a commit.", "SUPPORTS"], claim_id)
    d.write("CLOSE_EVIDENCE", "close_evidence", [claim_id], claim_id)
    d.write("START_ADJUDICATION", "start_adjudication", [claim_id], claim_id)
    first = d.write("ADJUDICATE", "adjudicate", [claim_id], claim_id)

    d.write("CHALLENGE", "submit_challenge",
            [claim_id, "The README alone does not settle the claim; a second "
             "file from the same commit should be weighed.",
             json.dumps([{"source_url": COUNTER_URL, "source_type": "REPOSITORY_FILE",
                          "description": "The repository LICENSE at the same commit."}])],
            claim_id)
    d.write("START_RE_ADJUDICATION", "start_adjudication", [claim_id], claim_id)
    d.write("RE_ADJUDICATE", "adjudicate", [claim_id], claim_id)

    # The challenge window is enforced against a consensus-observed clock.
    # Asking too early must be REFUSED by that clock — recorded as evidence.
    state = d.claim(claim_id)
    d.write("FINALIZE_EARLY_REFUSED", "finalize_claim", [claim_id], claim_id,
            expect_success=False)
    wait = max(0, state["challenge_deadline"] - int(time.time())) + 20
    print(f"\n  waiting {wait}s for the challenge window to actually close")
    time.sleep(wait)
    d.write("FINALIZE", "finalize_claim", [claim_id], claim_id)

    final_state = d.claim(claim_id)
    att_id = final_state["current_attestation_id"]
    attestation = d.read("get_attestation", [att_id])
    verification = d.read("verify_attestation", [att_id])
    history = d.read("get_claim_history", [claim_id])
    adj = d.read("get_adjudication", [final_state["current_adjudication_id"]])

    report = {
        "generated_at": _now(),
        "started_at": started,
        "production_contract": PRODUCTION_CONTRACT,
        "network": "GenLayer StudioNet",
        "chain_id": studionet.id,
        "rpc": RPC_URL,
        "contract_version": info.get("version"),
        "signer": d.account.address,
        "claim_id": claim_id,
        "evidence_sources": {"evidence": EVIDENCE_URL, "counter": COUNTER_URL},
        "steps": d.steps,
        "attestation": attestation,
        "verification": verification,
        "content_bindings": adj.get("content_bindings"),
        "content_binding_hash": adj.get("content_binding_hash"),
        "history": [{k: v.get(k) for k in ("claim_version", "verdict",
                                            "adjudication_id", "superseded")}
                    for v in history.get("versions", [])],
    }
    out_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nreport written: {out_json}")
    print(f"attestation {att_id}  valid={verification.get('valid')}  "
          f"verdict={verification.get('verdict')}")


def verify(path: pathlib.Path) -> int:
    """Re-read every recorded transaction and the final state from chain."""
    _install_retry()
    # genlayer_py's read_contract refuses to run without an account, even
    # though a read signs nothing. A throwaway random account satisfies it
    # and means verification needs no key at all — anyone can run this.
    client = create_client(chain=studionet, account=Account.create())
    report = json.loads(path.read_text(encoding="utf-8"))
    bad = 0
    for s in report["steps"]:
        tx = _plain(client.get_transaction(transaction_hash=s["tx_hash"]))
        leader = ((tx.get("consensus_data") or {}).get("leader_receipt") or [{}])[0]
        chain_exec = leader.get("execution_result")
        to = str(tx.get("to_address") or tx.get("recipient") or "").lower()
        ok = (chain_exec == s["accepted"]["execution_result"]
              and to == report["production_contract"].lower()
              and tx.get("status_name") == "FINALIZED")
        bad += not ok
        print(f"{'OK ' if ok else 'BAD'} {s['step']:<24} {s['tx_hash'][:18]}…  "
              f"exec={chain_exec}  status={tx.get('status_name')}  to={to[:12]}…")
    check = _plain(client.read_contract(
        address=report["production_contract"], function_name="verify_attestation",
        args=[report["attestation"]["attestation_id"]]))
    print(f"attestation re-verified from chain: valid={check.get('valid')}")
    bad += not check.get("valid")
    print("REPORT MATCHES CHAIN" if not bad else f"{bad} MISMATCH(ES)")
    return 1 if bad else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", type=pathlib.Path)
    ap.add_argument("--out", type=pathlib.Path,
                    default=REPO / "docs" / "production-evidence.json")
    a = ap.parse_args()
    sys.exit(verify(a.verify) if a.verify else run(a.out) or 0)
