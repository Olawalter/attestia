"""Shared fixtures for the Attestia direct suite (§48).

Direct mode runs the contract in a real GenVM runner but exercises the
LEADER path only: `mock_llm` answers the leader and every validator with
the same canned response, so no direct test can demonstrate that
independent nodes AGREE. That is the integration suite's job (§49), and
nothing here claims otherwise.

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


def mock_panel(direct_vm, result_json: str, body: str = "<html>report</html>",
               status: int = 200) -> None:
    """Register web + LLM responses. Mocks are first-registered-wins in
    direct mode, so always clear first."""
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": status, "body": body})
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
    """An OPEN claim, accepting evidence."""
    direct_vm.sender = direct_alice
    deployed.open_claim(drafted)
    return drafted
