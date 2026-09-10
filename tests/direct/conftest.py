"""Shared fixtures for the Attestia direct suite (§48).

Direct mode runs the contract in a real GenVM runner. A contract call runs
the LEADER closure; the validator closure is captured, and
`test_validators.py` replays it with `direct_vm.run_validator()` after
swapping mocks, to stage validators that read different bytes, judge
differently, or see a different clock. What no direct test shows is a real
network's validators agreeing — that is the integration suite's job (§49)
and `scripts/prove_lifecycle.py`'s, and nothing here claims otherwise.

What direct mode does prove is everything deterministic: state machine
guards, permissions, bounds, identity minting, versioning, structured
output validation, and the rule that a malformed panel response never
becomes protocol state.
"""
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "attestia.py"

# §58's demo claim, used throughout so the tests read like the product.
CLAIM_TEXT = "Protocol X suffered a security exploit on June 12, 2026."

GOOD_URL = "https://example.org/protocol-x-incident-report"
OTHER_URL = "https://news.example.com/protocol-x-analysis"


def make_result(claim_id, version=1, verdict="SUPPORTED", supporting=None,
                contradicting=None, partially=None, irrelevant=None,
                outdated=None, reason="The retrieved sources address the claim.",
                **extra) -> str:
    """Build an adjudication payload.

    `extra` lets a test inject hostile or invented fields to prove they
    are dropped rather than trusted.
    """
    payload = {
        "claim_id": claim_id,
        "claim_version": version,
        "verdict": verdict,
        "supporting_evidence": supporting if supporting is not None else [],
        "contradicting_evidence": contradicting if contradicting is not None else [],
        "partially_supporting_evidence": partially if partially is not None else [],
        "irrelevant_evidence": irrelevant if irrelevant is not None else [],
        "outdated_evidence": outdated if outdated is not None else [],
        "reason": reason,
    }
    payload.update(extra)
    return json.dumps(payload)


# ─── the test clock ──────────────────────────────────────────────────────
#
# The contract has no clock of its own any more: it observes UTC seconds
# through a consensus round against CLOCK_URL. That is exactly the point
# of the steward fix — no caller can choose the time.
#
# Tests still need to move time, so they move THE SOURCE, not the
# contract. `at_time()` re-registers the mocked clock response; the
# contract keeps reading it the same way it reads a real one. This
# mechanism lives entirely in the harness and has no counterpart in
# production security logic, which is what §4.1 asks for.
CLOCK_URL_PATTERN = r".*cdn-cgi/trace.*"

# 2026-06-01T00:00:00Z — comfortably inside the contract's sanity bounds.
BASE_TS = 1_780_272_000


def _trace_body(ts: int) -> str:
    """A Cloudflare trace document, in the shape the contract parses."""
    return "\n".join([
        "fl=abc123",
        "h=cloudflare.com",
        "ip=203.0.113.7",
        f"ts={ts}.482",
        "visit_scheme=https",
    ])


def at_time(direct_vm, ts: int, body: str = "<html>report</html>",
            status: int = 200) -> None:
    """Point the mocked clock at `ts` and leave other web mocks in place.

    Order matters: direct-mode mocks are first-registered-wins, so the
    clock pattern has to be registered before the catch-all.
    """
    direct_vm.clear_mocks()
    direct_vm.mock_web(CLOCK_URL_PATTERN, {"status": 200, "body": _trace_body(ts)})
    direct_vm.mock_web(r".*", {"status": status, "body": body})


def mock_panel(direct_vm, result_json: str, body: str = "<html>report</html>",
               status: int = 200, ts: int = BASE_TS) -> None:
    """Register clock + web + LLM responses. Mocks are first-registered-wins
    in direct mode, so always clear first."""
    at_time(direct_vm, ts, body=body, status=status)
    direct_vm.mock_llm(r".*adjudicator on a GenLayer.*", result_json)


@pytest.fixture
def contract_path():
    return str(CONTRACT)


@pytest.fixture
def deployed(direct_deploy, contract_path):
    return direct_deploy(contract_path)


@pytest.fixture
def drafted(direct_vm, deployed, direct_alice):
    """A DRAFT claim created by Alice."""
    direct_vm.sender = direct_alice
    return deployed.create_claim(CLAIM_TEXT, 3600)


@pytest.fixture
def opened(direct_vm, deployed, direct_alice, drafted):
    """An OPEN claim, accepting evidence.

    Opening observes the clock through consensus, so the harness has to be
    answering as a clock before this runs.
    """
    at_time(direct_vm, BASE_TS)
    direct_vm.sender = direct_alice
    deployed.open_claim(drafted)
    return drafted
