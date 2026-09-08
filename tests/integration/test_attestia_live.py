"""§49 — the live suite: real consensus, real retrieval, real LLM.

    gltest tests/integration -v -s --network studionet

What the direct suite cannot show, this can. `mock_llm` answers the
leader and every validator with one canned response, so no offline test
can demonstrate that independent nodes AGREE. Here the panel is real:
each node fetches the frozen sources itself, runs the prompt, and the
network compares their determinations. A round that lands is evidence
that the equivalence rule holds on inputs nobody staged.

Assertions stay on decision-critical fields — states, verdicts, buckets,
versions, hashes. Never on model prose: two honest panels reach the same
determination in different words, and a test that asserts on wording
fails for a reason unrelated to correctness.
"""
import json
import os

import pytest

from gltest import get_accounts, get_default_account
from .conftest import consensus_summary, must_fail, must_succeed, read as _read

# A live round is retrieval plus a model call per node, then consensus.
# Minutes, not seconds.
ROUND_WAIT = {"wait_interval": 5000, "wait_retries": 180}

SKIP_PANEL = os.environ.get("ATTESTIA_SKIP_PANEL", "0") == "1"
panel_test = pytest.mark.skipif(
    SKIP_PANEL, reason="set ATTESTIA_SKIP_PANEL=1 to skip the slow live rounds")

CLAIM_TEXT = ("The GenLayer project boilerplate repository documents a "
              "GenLayer intelligent contract project.")

# Commit-pinned raw content: every validator must retrieve the SAME bytes.
# A URL whose content moves between fetches is a consensus hazard, not a
# test.
GOOD_URL = (
    "https://raw.githubusercontent.com/genlayerlabs/genlayer-project-boilerplate/"
    "main/README.md"
)
# Deliberately unresolvable — proves unavailable != contradicting (§45).
DEAD_URL = "https://attestia-source-does-not-exist.invalid/post-mortem.json"


def _create_open_claim(contract, hint: str, window: int = 3600) -> str:
    must_succeed(
        contract.create_claim(args=[f"{CLAIM_TEXT} ({hint})", window]).transact(),
        "create_claim")
    page = _read(contract, "list_claims", [0, 100])
    rows = [r for r in page["rows"] if r["claim_text"].endswith(f"({hint})")]
    assert rows, "the created claim did not appear in list_claims"
    claim_id = rows[-1]["claim_id"]

    must_succeed(contract.open_claim(args=[claim_id]).transact(), "open_claim")
    assert _read(contract, "get_claim", [claim_id])["status"] == "OPEN"
    return claim_id


def _file(contract, claim_id: str, url: str, kind: str, desc: str,
          declared: str = "UNCLASSIFIED"):
    must_succeed(
        contract.submit_evidence(
            args=[claim_id, url, kind, desc, declared]).transact(),
        "submit_evidence")


def _run_panel(contract, claim_id: str):
    """Freeze, send to the panel, and insist the round actually committed.

    `tx_execution_succeeded` only reports the LEADER's execution, so a
    round that failed consensus can look successful while writing
    nothing. The state is what settles it.
    """
    must_succeed(contract.start_adjudication(args=[claim_id]).transact(),
                 "start_adjudication")
    receipt = contract.adjudicate(args=[claim_id]).transact(**ROUND_WAIT)
    must_succeed(receipt, "adjudicate")

    claim = _read(contract, "get_claim", [claim_id])
    assert claim["status"] == "ADJUDICATED", (
        f"adjudicate was accepted but stored no verdict — status "
        f"{claim['status']}. {consensus_summary(receipt)}")
    return _read(contract, "get_adjudication", [claim["current_adjudication_id"]])


# ═══ 1 · the protocol answers, and its vocabulary is closed ══════════════

def test_protocol_surface_is_live(contract):
    info = _read(contract, "get_protocol_info", [])

    assert info["version"] == "Attestia-1.0.0"
    assert sorted(info["verdicts"]) == [
        "CONTRADICTED", "INCONCLUSIVE", "OUTDATED",
        "PARTIALLY_SUPPORTED", "SUPPORTED"]
    assert "TRUE" not in info["verdicts"] and "FALSE" not in info["verdicts"], \
        "§20 — TRUE/FALSE must never be a semantic outcome"
    assert sorted(info["retrieval_outcomes"]) == [
        "SOURCE_INVALID", "SOURCE_OK", "SOURCE_UNAVAILABLE"]
    assert info["max_versions"] >= 2


# ═══ 2 · the deterministic case, on a real chain ═════════════════════════

def test_claim_lifecycle_and_guards(contract):
    claim_id = _create_open_claim(contract, "guards")

    # An empty record cannot be adjudicated.
    reason = must_fail(contract.close_evidence(args=[claim_id]).transact(),
                       "close_evidence on an empty record")
    assert "cannot close an empty record" in reason, reason

    _file(contract, claim_id, GOOD_URL, "DOCUMENTATION",
          "Project README, cited as the record.", "SUPPORTS")

    claim = _read(contract, "get_claim", [claim_id])
    assert claim["evidence_count"] == 1

    evidence = _read(contract, "list_evidence", [claim_id, 1])
    assert evidence[0]["declared_relationship"] == "SUPPORTS"
    assert evidence[0]["adjudicated_relationship"] == "", \
        "a submitter's assertion is never a finding"

    must_succeed(contract.close_evidence(args=[claim_id]).transact(),
                 "close_evidence")
    assert _read(contract, "get_claim", [claim_id])["status"] == "EVIDENCE_CLOSED"

    # Frozen means frozen.
    reason = must_fail(
        contract.submit_evidence(args=[
            claim_id, "https://example.org/late", "NEWS", "Late.", "UNCLASSIFIED",
        ]).transact(),
        "submit_evidence after freeze")
    assert "illegal transition from EVIDENCE_CLOSED" in reason, reason


# ═══ 3 · a real adjudication round ═══════════════════════════════════════

@panel_test
def test_live_panel_reaches_consensus(contract):
    """The load-bearing test: an unstaged round judged by a real panel."""
    claim_id = _create_open_claim(contract, "panel")
    _file(contract, claim_id, GOOD_URL, "DOCUMENTATION",
          "The repository README for the project named in the claim.", "SUPPORTS")
    must_succeed(contract.close_evidence(args=[claim_id]).transact(),
                 "close_evidence")

    adj = _run_panel(contract, claim_id)

    assert adj["verdict"] in {"SUPPORTED", "PARTIALLY_SUPPORTED",
                              "CONTRADICTED", "INCONCLUSIVE", "OUTDATED"}
    assert adj["claim_version"] == 1
    assert adj["round_number"] == 1
    assert adj["evidence_snapshot_hash"], "the record judged must be hashed"
    assert adj["reason"].strip(), "a verdict must carry its reasoning"

    # Every frozen source is accounted for in exactly one bucket.
    filed = [e["evidence_id"] for e in _read(contract, "list_evidence", [claim_id, 1])]
    bucketed = (adj["supporting_evidence"] + adj["contradicting_evidence"]
                + adj["partially_supporting_evidence"] + adj["irrelevant_evidence"]
                + adj["outdated_evidence"] + adj["unavailable_evidence"])
    assert sorted(bucketed) == sorted(filed)
    assert len(bucketed) == len(set(bucketed)), "no source may sit in two buckets"

    # A verdict is not final on arrival.
    claim = _read(contract, "get_claim", [claim_id])
    assert claim["status"] == "ADJUDICATED"
    assert claim["current_attestation_id"] == ""
    reason = must_fail(contract.finalize_claim(args=[claim_id]).transact(),
                       "finalize inside the challenge window")
    assert "challenge window is open" in reason, reason


@panel_test
def test_unreadable_source_is_not_evidence_against(contract):
    """§45 — a dead link must not argue against the claim."""
    claim_id = _create_open_claim(contract, "dead")
    _file(contract, claim_id, DEAD_URL, "AUDIT",
          "A post-mortem said to refute the claim.", "CONTRADICTS")
    must_succeed(contract.close_evidence(args=[claim_id]).transact(),
                 "close_evidence")

    adj = _run_panel(contract, claim_id)
    filed = [e["evidence_id"] for e in _read(contract, "list_evidence", [claim_id, 1])]
    dead = filed[0]

    assert dead not in adj["supporting_evidence"], \
        "an unreadable source can never support"
    assert dead not in adj["contradicting_evidence"], (
        "an unreadable source must not be read as contradicting — that is "
        "exactly the conflation §45 forbids")

    evidence = _read(contract, "get_evidence", [dead])
    assert evidence["declared_relationship"] == "CONTRADICTS", \
        "the submitter's assertion is preserved"
    assert evidence["adjudicated_relationship"] in ("", "IRRELEVANT")


# ═══ 4 · challenge, versioning, finalization, attestation ════════════════

@panel_test
def test_challenge_creates_a_version_and_history_survives(contract):
    """§26, §27 — the property the whole protocol exists to provide."""
    claim_id = _create_open_claim(contract, "challenge")
    _file(contract, claim_id, GOOD_URL, "DOCUMENTATION",
          "The repository README for the project named in the claim.", "SUPPORTS")
    must_succeed(contract.close_evidence(args=[claim_id]).transact(),
                 "close_evidence")

    first = _run_panel(contract, claim_id)
    first_id, first_verdict = first["adjudication_id"], first["verdict"]

    must_succeed(
        contract.submit_challenge(args=[
            claim_id,
            "The README does not establish the specific assertion made.",
            json.dumps([{"source_url": DEAD_URL, "source_type": "AUDIT",
                         "description": "Contested reading of the record."}]),
        ]).transact(),
        "submit_challenge")

    claim = _read(contract, "get_claim", [claim_id])
    assert claim["status"] == "CHALLENGED"
    assert claim["current_version"] == 2
    assert claim["challenge_count"] == 1

    # The historical adjudication is untouched, field for field.
    assert _read(contract, "get_adjudication", [first_id]) == first, \
        "a challenge must never mutate a past adjudication"

    # v2 carries the record forward as fresh copies plus the new source.
    v2 = _read(contract, "list_evidence", [claim_id, 2])
    assert len(v2) == 2
    assert all(e["adjudicated_relationship"] == "" for e in v2), \
        "the new round decides afresh rather than inheriting findings"

    second = _run_panel(contract, claim_id)
    assert second["adjudication_id"] != first_id
    assert second["claim_version"] == 2
    assert second["round_number"] == 2

    history = _read(contract, "get_claim_history", [claim_id])
    assert len(history["versions"]) == 2
    assert history["versions"][0]["verdict"] == first_verdict, \
        "the superseded verdict is still exactly what it was"
    assert history["versions"][0]["superseded"] is True
    assert history["versions"][1]["superseded"] is False


@panel_test
def test_finalization_mints_a_verifiable_attestation(contract):
    """§28, §29, §30 — the end of the golden path."""
    claim_id = _create_open_claim(contract, "final")
    _file(contract, claim_id, GOOD_URL, "DOCUMENTATION",
          "The repository README for the project named in the claim.", "SUPPORTS")
    must_succeed(contract.close_evidence(args=[claim_id]).transact(),
                 "close_evidence")

    adj = _run_panel(contract, claim_id)

    # Deadlines are protocol time; a transaction has to move it (§12).
    claim = _read(contract, "get_claim", [claim_id])
    step = max(60, claim["challenge_deadline"] - claim["protocol_clock"] + 60)
    must_succeed(contract.advance_clock(args=[step]).transact(), "advance_clock")

    must_succeed(contract.finalize_claim(args=[claim_id]).transact(),
                 "finalize_claim")

    claim = _read(contract, "get_claim", [claim_id])
    assert claim["status"] == "FINALIZED"
    attestation_id = claim["current_attestation_id"]
    assert attestation_id

    attestation = _read(contract, "get_attestation", [attestation_id])
    assert attestation["verdict"] == adj["verdict"]
    assert attestation["adjudication_id"] == adj["adjudication_id"]
    assert attestation["evidence_snapshot_hash"] == adj["evidence_snapshot_hash"]

    check = _read(contract, "verify_attestation", [attestation_id])
    assert check["valid"] is True, check["reason"]
    assert check["finalized"] is True
    assert check["reason"] == "verified against protocol state"

    # §57 — the compact answer an agent consumes.
    answer = _read(contract, "get_claim_verdict", [claim_id])
    assert answer["finalized"] is True
    assert answer["attestation_id"] == attestation_id
    assert answer["verdict"] == adj["verdict"]

    # Finalized is terminal.
    reason = must_fail(contract.finalize_claim(args=[claim_id]).transact(),
                       "double finalization")
    assert "illegal transition from FINALIZED" in reason, reason

    print(f"\n  finalized {claim_id} v{attestation['claim_version']} "
          f"-> {attestation['verdict']} -> {attestation_id}")


def test_unknown_attestation_reports_invalid(contract):
    """§59 — never render an unverifiable thing as verified."""
    check = _read(contract, "verify_attestation", ["att_999999"])
    assert check["valid"] is False
    assert check["reason"] == "no such attestation"
