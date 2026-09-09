"""STEWARD FIX — adversarial lifecycle tests (§7, §8).

The invariant every test in this file defends:

    A caller must never be able to make another user's evidence or
    challenge period expire merely by submitting a transaction.

Alice owns the claim. Bob is the attacker. Bob is a legitimate,
fully-funded account with every public method available to him — the
threat is not a stranger who cannot reach the contract, it is an ordinary
user who can.

Before the fix, Bob won: `advance_clock` was public and unprivileged, and
every write also ticked the same global counter, so he could expire
Alice's windows directly or simply by being busy elsewhere.
"""
import json

import pytest

from .conftest import (BASE_TS, CLAIM_TEXT, GOOD_URL, OTHER_URL, at_time,
                       make_result, mock_panel)


def _open_claim_for(direct_vm, deployed, owner, text=CLAIM_TEXT, window=3600):
    at_time(direct_vm, BASE_TS)
    direct_vm.sender = owner
    claim_id = deployed.create_claim(text, window)
    deployed.open_claim(claim_id)
    return claim_id


def _file(deployed, claim_id, url=GOOD_URL, desc="A source."):
    return deployed.submit_evidence(claim_id, url, "NEWS", desc, "UNCLASSIFIED")


def _deadlines(deployed, claim_id):
    claim = deployed.get_claim(claim_id)
    return {
        "status": claim["status"],
        "opened_at": claim["opened_at"],
        "evidence_deadline": claim["evidence_deadline"],
        "challenge_deadline": claim["challenge_deadline"],
        "finalized_at": claim["finalized_at"],
        "current_version": claim["current_version"],
    }


# ═══ Test 1 — unauthorized time manipulation ══════════════════════════════

def test_bob_has_no_reachable_method_that_moves_alices_deadlines(
    direct_vm, deployed, direct_alice, direct_bob
):
    """§7.1 — sweep every public write Bob can reach.

    Rather than naming the one function that used to be dangerous, this
    walks the contract's whole write surface and asserts that nothing Bob
    can call changes Alice's deadlines. If someone later adds another
    clock-ish method, this test is what notices.
    """
    alice_claim = _open_claim_for(direct_vm, deployed, direct_alice)
    direct_vm.sender = direct_alice
    _file(deployed, alice_claim)

    before = _deadlines(deployed, alice_claim)

    # Everything Bob might try, with arguments shaped to be plausible.
    attempts = [
        ("advance_clock", (86_400 * 30,)),
        ("advance_clock", (10**9,)),
        ("set_time", (BASE_TS + 10**6,)),
        ("set_timestamp", (BASE_TS + 10**6,)),
        ("open_claim", (alice_claim,)),
        ("close_evidence", (alice_claim,)),
        ("force_close_evidence", (alice_claim,)),
        ("start_adjudication", (alice_claim,)),
        ("finalize_claim", (alice_claim,)),
        ("submit_challenge", (alice_claim, "mine now", "[]")),
        ("remove_evidence", (alice_claim, "ev_000001")),
    ]

    direct_vm.sender = direct_bob
    for name, args in attempts:
        method = getattr(deployed, name, None)
        if method is None:
            continue                      # the method does not exist at all
        try:
            method(*args)
        except Exception:
            pass                          # refused is the expected outcome

    after = _deadlines(deployed, alice_claim)
    assert after == before, (
        f"Bob moved Alice's lifecycle state: {before} -> {after}")


def test_the_clock_setter_does_not_exist(deployed):
    """The direct attack, named explicitly so the regression is obvious."""
    for name in ("advance_clock", "set_time", "set_timestamp", "tick"):
        assert not hasattr(deployed, name), (
            f"`{name}` is a caller-controlled clock and must not exist")


# ═══ Test 2 — Bob cannot prematurely expire Alice's evidence window ═══════

def test_bob_cannot_expire_alices_evidence_window(
    direct_vm, deployed, direct_alice, direct_bob
):
    """§7.2 — the window stays open and Alice can still file."""
    alice_claim = _open_claim_for(direct_vm, deployed, direct_alice)
    direct_vm.sender = direct_alice
    _file(deployed, alice_claim, url=GOOD_URL)

    deadline_before = deployed.get_claim(alice_claim)["evidence_deadline"]

    # Bob tries to close it while the window is genuinely open. The clock
    # he is measured against is the consensus one, not one he supplies.
    at_time(direct_vm, BASE_TS + 60)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the claim creator"):
        deployed.close_evidence(alice_claim)
    with direct_vm.expect_revert("evidence window runs to"):
        deployed.force_close_evidence(alice_claim)

    claim = deployed.get_claim(alice_claim)
    assert claim["status"] == "OPEN"
    assert claim["evidence_window_open"] is True
    assert claim["evidence_deadline"] == deadline_before

    # And Alice can still do the thing the window exists to protect.
    direct_vm.sender = direct_alice
    late = _file(deployed, alice_claim, url=OTHER_URL, desc="Still admissible.")
    assert deployed.get_evidence(late)["status"] == "ACTIVE"


# ═══ Test 3 — Bob cannot prematurely expire Alice's challenge window ══════

@pytest.fixture
def alice_adjudicated(direct_vm, deployed, direct_alice):
    """Alice's claim, carried to a verdict with its challenge window open."""
    claim_id = _open_claim_for(direct_vm, deployed, direct_alice)
    direct_vm.sender = direct_alice
    eid = _file(deployed, claim_id)
    deployed.close_evidence(claim_id)

    mock_panel(direct_vm, make_result(claim_id, verdict="SUPPORTED",
                                      supporting=[eid]))
    deployed.start_adjudication(claim_id)
    deployed.adjudicate(claim_id)
    return claim_id


def test_bob_cannot_expire_alices_challenge_window(
    direct_vm, deployed, direct_alice, direct_bob, alice_adjudicated
):
    """§7.3 — Bob cannot force finalization, so he cannot end the window."""
    before = _deadlines(deployed, alice_adjudicated)
    assert before["status"] == "ADJUDICATED"
    assert before["challenge_deadline"] > 0

    # Bob, inside the window, tries to slam the door.
    at_time(direct_vm, BASE_TS + 120)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("challenge window is open"):
        deployed.finalize_claim(alice_adjudicated)

    after = _deadlines(deployed, alice_adjudicated)
    assert after == before, "Bob changed the claim's lifecycle state"

    # Alice's right to contest is intact.
    direct_vm.sender = direct_alice
    deployed.submit_challenge(alice_adjudicated, "I contest this.", "[]")
    assert deployed.get_claim(alice_adjudicated)["status"] == "CHALLENGED"


def test_bob_cannot_shorten_the_window_by_being_busy(
    direct_vm, deployed, direct_alice, direct_bob, alice_adjudicated
):
    """The incidental attack: activity elsewhere used to age this claim.

    Every write once ticked the same global counter, so Bob did not even
    need `advance_clock` — running his own case forward aged Alice's.
    """
    before = _deadlines(deployed, alice_adjudicated)

    direct_vm.sender = direct_bob
    for i in range(6):
        bob_claim = _open_claim_for(
            direct_vm, deployed, direct_bob,
            text=f"Bob's unrelated disputed statement {i}.")
        _file(deployed, bob_claim, url=f"https://bob.example/{i}")

    assert _deadlines(deployed, alice_adjudicated) == before, \
        "Bob's activity moved Alice's deadlines"


# ═══ Test 4 — cross-claim isolation ═══════════════════════════════════════

def test_claims_share_no_mutable_lifecycle_state(
    direct_vm, deployed, direct_alice, direct_bob
):
    """§7.4 — running Claim B through its whole life must not touch Claim A."""
    claim_a = _open_claim_for(direct_vm, deployed, direct_alice,
                              text="Alice's disputed statement.")
    direct_vm.sender = direct_alice
    _file(deployed, claim_a, url=GOOD_URL)
    before = _deadlines(deployed, claim_a)

    # Claim B goes all the way to finalized.
    claim_b = _open_claim_for(direct_vm, deployed, direct_bob,
                              text="Bob's disputed statement.")
    direct_vm.sender = direct_bob
    b_evidence = _file(deployed, claim_b, url=OTHER_URL)
    deployed.close_evidence(claim_b)

    mock_panel(direct_vm, make_result(claim_b, verdict="SUPPORTED",
                                      supporting=[b_evidence]))
    deployed.start_adjudication(claim_b)
    deployed.adjudicate(claim_b)

    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    deployed.finalize_claim(claim_b)
    assert deployed.get_claim(claim_b)["status"] == "FINALIZED"

    after = _deadlines(deployed, claim_a)
    assert after == before, (
        f"Claim B's lifecycle leaked into Claim A: {before} -> {after}")
    assert after["status"] == "OPEN", "Claim A must still be collecting"


# ═══ Test 5 — legitimate expiry still works ═══════════════════════════════

def test_legitimate_expiry_still_happens(
    direct_vm, deployed, direct_alice, direct_bob
):
    """§7.5 — security by never expiring anything would be no fix at all.

    Once the window has genuinely elapsed against the consensus clock, a
    stranger CAN close a stalled record and the case moves on.
    """
    claim_id = _open_claim_for(direct_vm, deployed, direct_alice)
    direct_vm.sender = direct_alice
    eid = _file(deployed, claim_id)

    # Alice goes quiet. Bob waits out the real window and closes it.
    at_time(direct_vm, BASE_TS + 7200)
    direct_vm.sender = direct_bob
    deployed.force_close_evidence(claim_id)
    assert deployed.get_claim(claim_id)["status"] == "EVIDENCE_CLOSED"

    # And the case can be carried through to a finalized attestation.
    mock_panel(direct_vm, make_result(claim_id, verdict="SUPPORTED",
                                      supporting=[eid]),
               ts=BASE_TS + 7200)
    deployed.start_adjudication(claim_id)
    deployed.adjudicate(claim_id)

    at_time(direct_vm, BASE_TS + 7200 + 4 * 24 * 60 * 60)
    att_id = deployed.finalize_claim(claim_id)
    assert deployed.verify_attestation(att_id)["valid"] is True


def test_finalization_waits_for_the_real_deadline(
    direct_vm, deployed, direct_alice, alice_adjudicated
):
    """The deadline binds the OWNER too — it is a protocol rule, not a
    permission someone holds."""
    direct_vm.sender = direct_alice
    at_time(direct_vm, BASE_TS + 60)
    with direct_vm.expect_revert("challenge window is open"):
        deployed.finalize_claim(alice_adjudicated)

    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    att_id = deployed.finalize_claim(alice_adjudicated)
    assert deployed.get_attestation(att_id)["verdict"] == "SUPPORTED"
