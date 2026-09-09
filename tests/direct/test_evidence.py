"""§47 — evidence: submission, binding, duplicates, removal, freezing."""
from .conftest import BASE_TS, CLAIM_TEXT, GOOD_URL, OTHER_URL, at_time


def _submit(deployed, claim_id, url=GOOD_URL, kind="OFFICIAL_ANNOUNCEMENT",
            desc="Incident report published by the protocol team.",
            declared="UNCLASSIFIED"):
    return deployed.submit_evidence(claim_id, url, kind, desc, declared)


def test_submit_records_a_declaration_not_a_finding(
    direct_vm, deployed, direct_bob, opened
):
    """§15 — the submitter's opinion is stored as a claim about the source."""
    direct_vm.sender = direct_bob
    eid = _submit(deployed, opened, declared="SUPPORTS")

    ev = deployed.get_evidence(eid)
    assert ev["declared_relationship"] == "SUPPORTS"
    assert ev["adjudicated_relationship"] == "", \
        "nothing is classified until a panel has ruled"
    assert ev["adjudicated_in"] == ""
    assert ev["retrieval"] == ""
    assert ev["status"] == "ACTIVE"
    assert ev["claim_version"] == 1
    assert ev["submitted_by"].lower() == str(direct_bob).lower()


def test_anyone_may_submit_evidence(direct_vm, deployed, direct_bob, direct_charlie,
                                    opened):
    direct_vm.sender = direct_bob
    _submit(deployed, opened, url=GOOD_URL)
    direct_vm.sender = direct_charlie
    _submit(deployed, opened, url=OTHER_URL)

    assert deployed.get_claim(opened)["evidence_count"] == 2


def test_evidence_requires_a_url_and_description(direct_vm, deployed, direct_bob,
                                                 opened):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("source_url is required"):
        _submit(deployed, opened, url="  ")
    with direct_vm.expect_revert("must be an http(s) URL"):
        _submit(deployed, opened, url="javascript:alert(1)")
    with direct_vm.expect_revert("description is required"):
        _submit(deployed, opened, desc="")


def test_declared_relationship_must_be_in_the_vocabulary(
    direct_vm, deployed, direct_bob, opened
):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("declared_relationship must be one of"):
        _submit(deployed, opened, declared="TOTALLY_PROVES_IT")


def test_duplicate_source_rejected_within_a_version(
    direct_vm, deployed, direct_bob, direct_charlie, opened
):
    """Repetition must not be able to weight the record."""
    direct_vm.sender = direct_bob
    _submit(deployed, opened, url=GOOD_URL)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("source already submitted for version 1"):
        _submit(deployed, opened, url=GOOD_URL)


def test_evidence_rejected_on_a_draft_claim(direct_vm, deployed, direct_bob,
                                            drafted):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("illegal transition from DRAFT"):
        _submit(deployed, drafted)


def test_evidence_is_accepted_while_the_claim_is_open(
    direct_vm, deployed, direct_bob, opened
):
    """The window bounds how long the record STAYS open, not each filing.

    Enforcing a deadline per submission would put a consensus round in
    front of every filing and buy nothing: a source filed a second before
    closing is as legitimate as one filed an hour earlier. What the
    deadline governs is who may close — see the force-close tests.
    """
    at_time(direct_vm, BASE_TS + 7200)    # past the 3600s window
    direct_vm.sender = direct_bob
    eid = _submit(deployed, opened)
    assert deployed.get_evidence(eid)["status"] == "ACTIVE"
    assert deployed.get_claim(opened)["status"] == "OPEN"


def test_only_the_submitter_may_remove(direct_vm, deployed, direct_bob,
                                       direct_charlie, opened):
    direct_vm.sender = direct_bob
    eid = _submit(deployed, opened)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only the submitter may remove"):
        deployed.remove_evidence(opened, eid)


def test_removed_evidence_leaves_the_active_set(direct_vm, deployed, direct_bob,
                                                opened):
    direct_vm.sender = direct_bob
    eid = _submit(deployed, opened)
    assert deployed.get_claim(opened)["evidence_count"] == 1

    deployed.remove_evidence(opened, eid)
    assert deployed.get_claim(opened)["evidence_count"] == 0
    assert deployed.get_evidence(eid)["status"] == "REMOVED", \
        "the record stays readable; only its standing changes"


def test_cross_claim_evidence_rejected(direct_vm, deployed, direct_alice,
                                       direct_bob, opened):
    """§43 — an evidence id is only valid for the claim it was filed on."""
    direct_vm.sender = direct_alice
    other = deployed.create_claim("An unrelated disputed statement.", 3600)
    deployed.open_claim(other)

    direct_vm.sender = direct_bob
    eid = _submit(deployed, opened)

    with direct_vm.expect_revert(f"belongs to {opened}"):
        deployed.remove_evidence(other, eid)


def test_close_evidence_freezes_the_set(direct_vm, deployed, direct_alice,
                                        direct_bob, opened):
    direct_vm.sender = direct_bob
    first = _submit(deployed, opened, url=GOOD_URL)
    _submit(deployed, opened, url=OTHER_URL)

    direct_vm.sender = direct_alice
    frozen = deployed.close_evidence(opened)
    assert first in frozen

    claim = deployed.get_claim(opened)
    assert claim["status"] == "EVIDENCE_CLOSED"
    assert claim["evidence_count"] == 2

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("illegal transition from EVIDENCE_CLOSED"):
        _submit(deployed, opened, url="https://example.net/late-arrival")


def test_empty_record_cannot_be_closed(direct_vm, deployed, direct_alice, opened):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("cannot close an empty record"):
        deployed.close_evidence(opened)


def test_non_creator_cannot_close_a_claim_they_do_not_own(
    direct_vm, deployed, direct_bob, opened
):
    """STEWARD FIX — `close_evidence` is now creator-only."""
    direct_vm.sender = direct_bob
    _submit(deployed, opened)

    with direct_vm.expect_revert("only the claim creator"):
        deployed.close_evidence(opened)
    assert deployed.get_claim(opened)["status"] == "OPEN"


def test_force_close_needs_consensus_to_confirm_the_window_elapsed(
    direct_vm, deployed, direct_bob, opened
):
    """Liveness without a manipulable clock.

    Anyone may force a stalled claim closed — and precisely BECAUSE anyone
    may call it, the deadline it checks is read from consensus rather than
    supplied by the caller.
    """
    direct_vm.sender = direct_bob
    _submit(deployed, opened)

    # Inside the window: refused, no matter who asks.
    at_time(direct_vm, BASE_TS + 60)
    with direct_vm.expect_revert("evidence window runs to"):
        deployed.force_close_evidence(opened)
    assert deployed.get_claim(opened)["status"] == "OPEN"

    # Once the window has genuinely elapsed, it works.
    at_time(direct_vm, BASE_TS + 7200)
    deployed.force_close_evidence(opened)
    assert deployed.get_claim(opened)["status"] == "EVIDENCE_CLOSED"


def test_list_evidence_filters_by_version(direct_vm, deployed, direct_bob, opened):
    direct_vm.sender = direct_bob
    _submit(deployed, opened, url=GOOD_URL)

    assert len(deployed.list_evidence(opened, 1)) == 1
    assert len(deployed.list_evidence(opened, 2)) == 0
    assert len(deployed.list_evidence(opened, 0)) == 1
