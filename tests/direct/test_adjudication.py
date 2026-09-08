"""§47 — adjudication: structured output validation and state safety.

Direct mode answers leader and validators with one canned response, so
these tests cannot show that independent nodes agree — that is §49's job.
What they do prove is the half that must hold regardless of consensus:
a malformed, dishonest, or incoherent panel answer never becomes
protocol state.
"""
import pytest

from .conftest import GOOD_URL, OTHER_URL, make_result, mock_panel


def _two_sources(direct_vm, deployed, sender, claim_id):
    direct_vm.sender = sender
    a = deployed.submit_evidence(
        claim_id, GOOD_URL, "OFFICIAL_ANNOUNCEMENT",
        "Incident report published by the protocol team.", "SUPPORTS")
    b = deployed.submit_evidence(
        claim_id, OTHER_URL, "NEWS",
        "Independent analysis of the incident.", "UNCLASSIFIED")
    return a, b


@pytest.fixture
def closed(direct_vm, deployed, direct_alice, direct_bob, opened):
    """A claim with two sources and a frozen record, ready to adjudicate."""
    ids = _two_sources(direct_vm, deployed, direct_bob, opened)
    direct_vm.sender = direct_alice
    deployed.close_evidence(opened)
    deployed.start_adjudication(opened)
    return opened, ids


# ═══ the happy path ═══════════════════════════════════════════════════════

def test_adjudication_records_verdict_and_classifies_evidence(
    direct_vm, deployed, direct_alice, closed
):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="SUPPORTED", supporting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice

    adj_id = deployed.adjudicate(claim_id)

    claim = deployed.get_claim(claim_id)
    assert claim["status"] == "ADJUDICATED"
    assert claim["current_verdict"] == "SUPPORTED"
    assert claim["current_adjudication_id"] == adj_id
    assert claim["challenge_deadline"] > claim["adjudicated_at"], \
        "a verdict opens a challenge window; it is not final on arrival"

    adj = deployed.get_adjudication(adj_id)
    assert adj["supporting_evidence"] == [a]
    assert adj["irrelevant_evidence"] == [b]
    assert adj["round_number"] == 1
    assert adj["evidence_snapshot_hash"], "the record judged must be hashed"

    # The panel's finding is written onto the evidence itself.
    assert deployed.get_evidence(a)["adjudicated_relationship"] == "SUPPORTS"
    assert deployed.get_evidence(a)["adjudicated_in"] == adj_id
    assert deployed.get_evidence(b)["adjudicated_relationship"] == "IRRELEVANT"


def test_declared_relationship_is_not_the_finding(
    direct_vm, deployed, direct_alice, closed
):
    """§15 — the submitter said SUPPORTS; the panel decides otherwise."""
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="CONTRADICTED", contradicting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    deployed.adjudicate(claim_id)

    ev = deployed.get_evidence(a)
    assert ev["declared_relationship"] == "SUPPORTS"
    assert ev["adjudicated_relationship"] == "CONTRADICTS"


def test_unavailable_source_is_not_contradicting(
    direct_vm, deployed, direct_alice, closed
):
    """§45 — a source nobody could read argues in no direction."""
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="INCONCLUSIVE", irrelevant=[a],
        unavailable_evidence=[b]))
    direct_vm.sender = direct_alice
    adj_id = deployed.adjudicate(claim_id)

    assert deployed.get_adjudication(adj_id)["unavailable_evidence"] == [b]
    ev = deployed.get_evidence(b)
    assert ev["retrieval"] == "SOURCE_UNAVAILABLE"
    assert ev["adjudicated_relationship"] == "", \
        "an unread source gets no relationship at all"


# ═══ §21 structured output validation ═════════════════════════════════════

def test_invalid_verdict_rejected(direct_vm, deployed, direct_alice, closed):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="TRUE", supporting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid verdict"):
        deployed.adjudicate(claim_id)


def test_unknown_evidence_id_rejected(direct_vm, deployed, direct_alice, closed):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="SUPPORTED", supporting=[a, "ev_999999"],
        irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("unknown evidence id"):
        deployed.adjudicate(claim_id)


def test_duplicate_evidence_id_rejected(direct_vm, deployed, direct_alice, closed):
    """An id in two buckets is an impossible relationship."""
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="PARTIALLY_SUPPORTED", supporting=[a],
        contradicting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("appears in both"):
        deployed.adjudicate(claim_id)


def test_omitted_evidence_rejected(direct_vm, deployed, direct_alice, closed):
    """Every frozen source must be accounted for."""
    claim_id, (a, _b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="SUPPORTED", supporting=[a]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("result omits evidence"):
        deployed.adjudicate(claim_id)


def test_wrong_claim_id_rejected(direct_vm, deployed, direct_alice, closed):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        "claim_000999", verdict="SUPPORTED", supporting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("claim_id mismatch"):
        deployed.adjudicate(claim_id)


def test_wrong_claim_version_rejected(direct_vm, deployed, direct_alice, closed):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, version=7, verdict="SUPPORTED", supporting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("claim_version mismatch"):
        deployed.adjudicate(claim_id)


def test_missing_reason_rejected(direct_vm, deployed, direct_alice, closed):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="SUPPORTED", supporting=[a], irrelevant=[b], reason="  "))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("`reason` is required"):
        deployed.adjudicate(claim_id)


def test_non_object_result_rejected(direct_vm, deployed, direct_alice, closed):
    claim_id, _ids = closed
    mock_panel(direct_vm, '"just a string"')
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("LLM_ERROR"):
        deployed.adjudicate(claim_id)


def test_incoherent_supported_with_contradiction_rejected(
    direct_vm, deployed, direct_alice, closed
):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="SUPPORTED", supporting=[a], contradicting=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("SUPPORTED cannot carry contradicting"):
        deployed.adjudicate(claim_id)


def test_incoherent_contradicted_without_contradiction_rejected(
    direct_vm, deployed, direct_alice, closed
):
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="CONTRADICTED", supporting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("CONTRADICTED requires at least one"):
        deployed.adjudicate(claim_id)


def test_invented_fields_are_dropped(direct_vm, deployed, direct_alice, closed):
    """§21 — a fixed key set beats guessing what a model might invent."""
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(
        claim_id, verdict="SUPPORTED", supporting=[a], irrelevant=[b],
        finalize=True, attestation_id="att_000001", confidence="0.99",
        claim_status="FINALIZED"))
    direct_vm.sender = direct_alice
    deployed.adjudicate(claim_id)

    claim = deployed.get_claim(claim_id)
    assert claim["status"] == "ADJUDICATED", \
        "the panel cannot finalize a claim by saying so"
    assert claim["current_attestation_id"] == ""


# ═══ §25 state safety ═════════════════════════════════════════════════════

def test_failed_adjudication_leaves_no_partial_state(
    direct_vm, deployed, direct_alice, closed
):
    """A refused answer must cost the claim nothing."""
    claim_id, (a, b) = closed
    before = deployed.get_claim(claim_id)

    mock_panel(direct_vm, make_result(claim_id, verdict="NONSENSE",
                                      supporting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid verdict"):
        deployed.adjudicate(claim_id)

    after = deployed.get_claim(claim_id)
    assert after["status"] == before["status"] == "ADJUDICATING",         "a refused round leaves the claim exactly where it was"
    assert after["current_verdict"] == ""
    assert after["adjudication_count"] == 0
    assert deployed.list_adjudications(claim_id) == []
    assert deployed.get_evidence(a)["adjudicated_relationship"] == ""


def test_retry_after_failure_succeeds(direct_vm, deployed, direct_alice, closed):
    """Nothing was consumed, so the call can simply be made again."""
    claim_id, (a, b) = closed
    mock_panel(direct_vm, make_result(claim_id, verdict="NOPE",
                                      supporting=[a], irrelevant=[b]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid verdict"):
        deployed.adjudicate(claim_id)

    mock_panel(direct_vm, make_result(claim_id, verdict="SUPPORTED",
                                      supporting=[a], irrelevant=[b]))
    adj_id = deployed.adjudicate(claim_id)
    assert deployed.get_adjudication(adj_id)["verdict"] == "SUPPORTED"


def test_adjudication_illegal_before_the_record_is_frozen(
    direct_vm, deployed, direct_alice, direct_bob, opened
):
    _two_sources(direct_vm, deployed, direct_bob, opened)
    mock_panel(direct_vm, make_result(opened, verdict="SUPPORTED"))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from OPEN"):
        deployed.start_adjudication(opened)
    with direct_vm.expect_revert("illegal transition from OPEN"):
        deployed.adjudicate(opened)
