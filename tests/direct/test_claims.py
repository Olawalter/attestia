"""§47 — claims: creation, validation, permissions, reads."""
import pytest

from .conftest import BASE_TS, CLAIM_TEXT, at_time


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
    """The window is recorded as a DURATION at creation; it only becomes a
    deadline when the claim is opened and a real time is observed."""
    direct_vm.sender = direct_alice
    claim_id = deployed.create_claim(CLAIM_TEXT, 0)
    claim = deployed.get_claim(claim_id)
    assert claim["evidence_window_seconds"] == 7 * 24 * 60 * 60
    assert claim["evidence_deadline"] == 0, "a draft claim has no deadline running"


def test_only_creator_may_open(direct_vm, deployed, direct_bob, drafted):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the claim creator"):
        deployed.open_claim(drafted)


def test_open_moves_to_open_and_anchors_the_window(
    direct_vm, deployed, direct_alice, drafted
):
    """Opening is where the one timestamp a claim needs is anchored, and it
    comes from consensus rather than from the caller."""
    at_time(direct_vm, BASE_TS)
    direct_vm.sender = direct_alice
    opened_at = deployed.open_claim(drafted)

    claim = deployed.get_claim(drafted)
    assert claim["status"] == "OPEN"
    assert claim["evidence_window_open"] is True
    assert opened_at == BASE_TS, "the anchor is the observed time"
    assert claim["opened_at"] == BASE_TS
    assert claim["evidence_deadline"] == BASE_TS + 3600


def test_cannot_open_twice(direct_vm, deployed, direct_alice, opened):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from OPEN"):
        deployed.open_claim(opened)


def test_unknown_claim_reverts(direct_vm, deployed, direct_alice):
    with direct_vm.expect_revert("unknown claim"):
        deployed.get_claim("claim_999999")


def test_there_is_no_clock_to_manipulate(direct_vm, deployed, direct_alice):
    """STEWARD FIX — the caller-controlled clock is gone from the surface.

    `advance_clock` used to be public and unprivileged, which is what let
    one account expire everyone else's deadlines. The regression this
    guards is someone reintroducing it for convenience.
    """
    direct_vm.sender = direct_alice
    assert not hasattr(deployed, "advance_clock"),         "a caller-settable clock must not exist on the contract surface"

    info = deployed.get_protocol_info()
    assert "protocol_clock" not in info,         "no global clock may be exposed as protocol state"
    # What IS exposed is where time comes from, so it can be audited.
    assert info["clock_source"].startswith("https://")
    assert info["clock_tolerance_seconds"] > 0


def test_opening_requires_a_readable_clock(direct_vm, deployed, direct_alice,
                                           drafted):
    """§18 fail-closed: no trustworthy time, no anchored window."""
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 500, "body": "gateway error"})
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("TRANSIENT"):
        deployed.open_claim(drafted)
    assert deployed.get_claim(drafted)["status"] == "DRAFT",         "a failed clock read must leave the claim exactly where it was"


def test_absurd_clock_readings_are_refused(direct_vm, deployed, direct_alice,
                                           drafted):
    """A time source answering outside the sane range is not a clock."""
    at_time(direct_vm, 10_000)          # 1970
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("outside the sane range"):
        deployed.open_claim(drafted)


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
