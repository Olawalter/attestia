"""§47 — claims: creation, validation, permissions, reads."""
import pytest

from .conftest import CLAIM_TEXT


def test_create_claim_records_the_case(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    claim_id = deployed.create_claim(CLAIM_TEXT, 3600)

    claim = deployed.get_claim(claim_id)
    assert claim["claim_text"] == CLAIM_TEXT
    assert claim["status"] == "DRAFT"
    assert claim["current_version"] == 1
    assert claim["creator"].lower() == str(direct_alice).lower()
    assert claim["current_verdict"] == "", "a new claim has no verdict, not a default one"
    assert claim["evidence_count"] == 0
    assert claim["current_attestation_id"] == ""


def test_claim_id_is_minted_by_the_contract(direct_vm, deployed, direct_alice):
    """§14 — a caller must never be able to choose protocol identity."""
    direct_vm.sender = direct_alice
    first = deployed.create_claim(CLAIM_TEXT, 3600)
    second = deployed.create_claim("A different disputed statement.", 3600)

    assert first != second
    assert first.startswith("claim_") and second.startswith("claim_")
    assert deployed.get_claim(first)["claim_text"] == CLAIM_TEXT


def test_empty_claim_rejected(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("claim text is required"):
        deployed.create_claim("   ", 3600)


def test_oversized_claim_rejected(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("exceeds 1000 characters"):
        deployed.create_claim("x" * 1001, 3600)


def test_invalid_evidence_window_rejected(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("evidence window must be between"):
        deployed.create_claim(CLAIM_TEXT, 5)
    with direct_vm.expect_revert("evidence window must be between"):
        deployed.create_claim(CLAIM_TEXT, 999_999_999)


def test_default_evidence_window_applied(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    claim_id = deployed.create_claim(CLAIM_TEXT, 0)
    claim = deployed.get_claim(claim_id)
    assert claim["evidence_deadline"] - claim["created_at"] == 7 * 24 * 60 * 60


def test_only_creator_may_open(direct_vm, deployed, direct_bob, drafted):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the claim creator"):
        deployed.open_claim(drafted)


def test_open_moves_to_open_and_starts_the_window(
    direct_vm, deployed, direct_alice, drafted
):
    direct_vm.sender = direct_alice
    deployed.open_claim(drafted)

    claim = deployed.get_claim(drafted)
    assert claim["status"] == "OPEN"
    assert claim["evidence_window_open"] is True
    assert claim["evidence_deadline"] > claim["protocol_clock"]


def test_cannot_open_twice(direct_vm, deployed, direct_alice, opened):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from OPEN"):
        deployed.open_claim(opened)


def test_unknown_claim_reverts(direct_vm, deployed, direct_alice):
    with direct_vm.expect_revert("unknown claim"):
        deployed.get_claim("claim_999999")


def test_clock_only_moves_forward(direct_vm, deployed, direct_alice):
    """§12 — the protocol clock is monotonic and permissionless."""
    direct_vm.sender = direct_alice
    before = deployed.get_protocol_info()["protocol_clock"]
    after = deployed.advance_clock(600)
    assert after >= before + 600

    with direct_vm.expect_revert("clock may only move forward"):
        deployed.advance_clock(0)
    with direct_vm.expect_revert("clock may only move forward"):
        deployed.advance_clock(-5)


def test_anyone_may_advance_the_clock(direct_vm, deployed, direct_bob, opened):
    """A deadline nobody can reach is not a deadline."""
    direct_vm.sender = direct_bob
    assert deployed.advance_clock(120) > 0


def test_list_claims_paginates(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    for i in range(3):
        deployed.create_claim(f"Disputed statement number {i}.", 3600)

    page = deployed.list_claims(0, 2)
    assert page["total"] == 3
    assert page["count"] == 2
    assert page["rows"][0]["claim_text"].endswith("number 0.")

    rest = deployed.list_claims(2, 50)
    assert rest["count"] == 1


def test_protocol_info_publishes_the_vocabulary(deployed):
    info = deployed.get_protocol_info()
    assert info["version"] == "Attestia-1.0.0"
    assert sorted(info["verdicts"]) == [
        "CONTRADICTED", "INCONCLUSIVE", "OUTDATED",
        "PARTIALLY_SUPPORTED", "SUPPORTED",
    ]
    assert "TRUE" not in info["verdicts"] and "FALSE" not in info["verdicts"], \
        "§20 — TRUE/FALSE must never be a semantic outcome"
    assert sorted(info["retrieval_outcomes"]) == [
        "SOURCE_INVALID", "SOURCE_OK", "SOURCE_UNAVAILABLE",
    ]
