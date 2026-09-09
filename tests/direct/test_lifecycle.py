"""§47 — challenges, versioning, finalization, attestation.

The through-line of §63's golden path, and the property the whole
protocol exists to provide: a superseded verdict stays exactly as it was
recorded.
"""
import json

import pytest

from .conftest import (BASE_TS, GOOD_URL, OTHER_URL, at_time,
                       make_result, mock_panel)

THIRD_URL = "https://audit.example.org/protocol-x-post-mortem"


def _adjudicate(direct_vm, deployed, sender, claim_id, **kw):
    ids = [e["evidence_id"] for e in deployed.list_evidence(claim_id, 0)
           if e["status"] == "ACTIVE"
           and e["claim_version"] == deployed.get_claim(claim_id)["current_version"]]
    kw.setdefault("supporting", ids)
    mock_panel(direct_vm, make_result(
        claim_id, version=deployed.get_claim(claim_id)["current_version"], **kw))
    direct_vm.sender = sender
    deployed.start_adjudication(claim_id)
    return deployed.adjudicate(claim_id)


@pytest.fixture
def adjudicated(direct_vm, deployed, direct_alice, direct_bob, opened):
    """A claim with a SUPPORTED verdict on version 1."""
    direct_vm.sender = direct_bob
    deployed.submit_evidence(opened, GOOD_URL, "OFFICIAL_ANNOUNCEMENT",
                             "Incident report.", "SUPPORTS")
    direct_vm.sender = direct_alice
    deployed.close_evidence(opened)
    adj_id = _adjudicate(direct_vm, deployed, direct_alice, opened,
                         verdict="SUPPORTED")
    return opened, adj_id


# ═══ §26 challenges ═══════════════════════════════════════════════════════

def test_challenge_opens_a_new_version_without_touching_history(
    direct_vm, deployed, direct_charlie, adjudicated
):
    """§26, §27 — the whole point of the protocol."""
    claim_id, first_adj = adjudicated
    before = deployed.get_adjudication(first_adj)

    direct_vm.sender = direct_charlie
    chal_id = deployed.submit_challenge(
        claim_id,
        "A later post-mortem says the reported impact was wrong.",
        json.dumps([{"source_url": THIRD_URL, "source_type": "AUDIT",
                     "description": "Independent post-mortem."}]))

    claim = deployed.get_claim(claim_id)
    assert claim["status"] == "CHALLENGED"
    assert claim["current_version"] == 2
    assert claim["current_verdict"] == "", \
        "v1's verdict no longer describes the current version"

    # The historical adjudication is untouched, byte for byte.
    after = deployed.get_adjudication(first_adj)
    assert after == before, "a challenge must never mutate a past adjudication"

    ch = deployed.get_challenge(chal_id)
    assert ch["target_version"] == 1
    assert ch["resulting_version"] == 2
    assert ch["status"] == "ACCEPTED"
    assert len(ch["counter_evidence_ids"]) == 1


def test_challenge_carries_the_record_forward_as_copies(
    direct_vm, deployed, direct_charlie, adjudicated
):
    """Each version owns an immutable record of what its round saw."""
    claim_id, _ = adjudicated
    v1 = deployed.list_evidence(claim_id, 1)
    assert len(v1) == 1
    assert v1[0]["adjudicated_relationship"] == "SUPPORTS"

    direct_vm.sender = direct_charlie
    deployed.submit_challenge(claim_id, "Contesting the impact figure.", "[]")

    v2 = deployed.list_evidence(claim_id, 2)
    assert len(v2) == 1
    assert v2[0]["evidence_id"] != v1[0]["evidence_id"]
    assert v2[0]["source_url"] == v1[0]["source_url"]
    assert v2[0]["adjudicated_relationship"] == "", \
        "the new round decides afresh rather than inheriting a finding"

    # v1's record is still exactly as it was judged.
    assert deployed.list_evidence(claim_id, 1)[0]["adjudicated_relationship"] \
        == "SUPPORTS"


def test_challenge_requires_a_reason(direct_vm, deployed, direct_charlie,
                                     adjudicated):
    claim_id, _ = adjudicated
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("must state its reason"):
        deployed.submit_challenge(claim_id, "   ", "[]")


def test_challenge_admissible_until_the_claim_finalizes(
    direct_vm, deployed, direct_alice, direct_charlie, adjudicated
):
    """STEWARD FIX — a challenger cannot be shut out by someone else's clock.

    The window used to be checked against the global counter, so Bob could
    advance it and close Alice's right to challenge. Now a challenge is
    admissible for as long as the claim has not finalized, and finalizing
    itself requires consensus to confirm the window elapsed. The guarantee
    moves from "the clock says you are late" to "nobody could have ended
    your window early".
    """
    claim_id, _ = adjudicated

    # Even well past the nominal window, the right to challenge survives
    # while the claim is still ADJUDICATED.
    at_time(direct_vm, BASE_TS + 9 * 24 * 60 * 60)
    direct_vm.sender = direct_charlie
    deployed.submit_challenge(claim_id, "A later audit disputes this.", "[]")
    assert deployed.get_claim(claim_id)["status"] == "CHALLENGED"


def test_challenge_refused_once_finalized(direct_vm, deployed, direct_alice,
                                          direct_charlie, adjudicated):
    """Finalization is the real boundary, and it is consensus-gated."""
    claim_id, _ = adjudicated
    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    direct_vm.sender = direct_alice
    deployed.finalize_claim(claim_id)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("illegal transition from FINALIZED"):
        deployed.submit_challenge(claim_id, "Too late.", "[]")


def test_challenge_rejected_before_adjudication(direct_vm, deployed,
                                                direct_charlie, opened):
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("illegal transition from OPEN"):
        deployed.submit_challenge(opened, "Nothing to contest yet.", "[]")


def test_counter_evidence_cannot_repeat_a_source(direct_vm, deployed,
                                                 direct_charlie, adjudicated):
    claim_id, _ = adjudicated
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("repeats an existing source"):
        deployed.submit_challenge(
            claim_id, "Same link again.",
            json.dumps([{"source_url": GOOD_URL, "source_type": "NEWS",
                         "description": "Duplicate."}]))


def test_re_adjudication_produces_a_second_verdict(
    direct_vm, deployed, direct_alice, direct_charlie, adjudicated
):
    """§27 — v1 SUPPORTED, v2 PARTIALLY_SUPPORTED, both readable."""
    claim_id, first_adj = adjudicated

    direct_vm.sender = direct_charlie
    deployed.submit_challenge(
        claim_id, "The impact figure is disputed by a later audit.",
        json.dumps([{"source_url": THIRD_URL, "source_type": "AUDIT",
                     "description": "Independent post-mortem."}]))

    v2_ids = [e["evidence_id"] for e in deployed.list_evidence(claim_id, 2)]
    second_adj = _adjudicate(
        direct_vm, deployed, direct_alice, claim_id,
        verdict="PARTIALLY_SUPPORTED",
        supporting=[v2_ids[0]], partially=[v2_ids[1]])

    claim = deployed.get_claim(claim_id)
    assert claim["current_verdict"] == "PARTIALLY_SUPPORTED"
    assert claim["adjudication_count"] == 2

    history = deployed.get_claim_history(claim_id)
    assert [v["verdict"] for v in history["versions"]] == [
        "SUPPORTED", "PARTIALLY_SUPPORTED"]
    assert history["versions"][0]["superseded"] is True
    assert history["versions"][1]["superseded"] is False
    assert deployed.get_adjudication(first_adj)["verdict"] == "SUPPORTED"
    assert second_adj != first_adj


# ═══ §28 finalization and §29 attestation ═════════════════════════════════

def test_finalization_blocked_inside_the_challenge_window(
    direct_vm, deployed, direct_alice, adjudicated
):
    claim_id, _ = adjudicated
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("challenge window is open"):
        deployed.finalize_claim(claim_id)


def test_finalization_mints_an_attestation(direct_vm, deployed, direct_alice,
                                           adjudicated):
    claim_id, adj_id = adjudicated
    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    direct_vm.sender = direct_alice
    att_id = deployed.finalize_claim(claim_id)

    claim = deployed.get_claim(claim_id)
    assert claim["status"] == "FINALIZED"
    assert claim["current_attestation_id"] == att_id

    att = deployed.get_attestation(att_id)
    assert att["verdict"] == "SUPPORTED"
    assert att["claim_version"] == 1
    assert att["adjudication_id"] == adj_id
    assert att["evidence_count"] == 1
    assert att["evidence_snapshot_hash"], "an attestation names the record it rests on"


def test_finalization_is_not_repeatable(direct_vm, deployed, direct_alice,
                                        adjudicated):
    """§43 — no double finalization, no post-finalization mutation."""
    claim_id, _ = adjudicated
    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    direct_vm.sender = direct_alice
    deployed.finalize_claim(claim_id)

    with direct_vm.expect_revert("illegal transition from FINALIZED"):
        deployed.finalize_claim(claim_id)
    with direct_vm.expect_revert("illegal transition from FINALIZED"):
        deployed.submit_challenge(claim_id, "Reopening after the fact.", "[]")
    with direct_vm.expect_revert("illegal transition from FINALIZED"):
        deployed.start_adjudication(claim_id)


def test_attestation_verifies_against_live_state(direct_vm, deployed,
                                                 direct_alice, adjudicated):
    claim_id, _ = adjudicated
    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    direct_vm.sender = direct_alice
    att_id = deployed.finalize_claim(claim_id)

    check = deployed.verify_attestation(att_id)
    assert check["valid"] is True
    assert check["finalized"] is True
    assert check["verdict"] == "SUPPORTED"
    assert check["reason"] == "verified against protocol state"


def test_unknown_attestation_is_invalid_not_an_error(deployed):
    """§59 — never render an unverifiable thing as verified."""
    check = deployed.verify_attestation("att_999999")
    assert check["valid"] is False
    assert check["reason"] == "no such attestation"


def test_agent_read_surface(direct_vm, deployed, direct_alice, adjudicated):
    """§30, §57 — what another agent consumes."""
    claim_id, _ = adjudicated
    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    direct_vm.sender = direct_alice
    att_id = deployed.finalize_claim(claim_id)

    answer = deployed.get_claim_verdict(claim_id)
    assert answer["verdict"] == "SUPPORTED"
    assert answer["finalized"] is True
    assert answer["attestation_id"] == att_id
    assert answer["version"] == 1
    assert set(answer) == {
        "claim_id", "version", "verdict", "status", "finalized",
        "evidence_count", "challenge_count", "attestation_id",
    }


def test_full_golden_path(direct_vm, deployed, direct_alice, direct_bob,
                          direct_charlie, opened):
    """§63 — claim → evidence → adjudication → challenge → new version →
    re-adjudication → finalization → attestation, end to end."""
    direct_vm.sender = direct_bob
    deployed.submit_evidence(opened, GOOD_URL, "OFFICIAL_ANNOUNCEMENT",
                             "Incident report.", "SUPPORTS")
    deployed.submit_evidence(opened, OTHER_URL, "NEWS",
                             "Contemporary coverage.", "UNCLASSIFIED")

    direct_vm.sender = direct_alice
    deployed.close_evidence(opened)
    _adjudicate(direct_vm, deployed, direct_alice, opened, verdict="SUPPORTED")
    assert deployed.get_claim(opened)["current_verdict"] == "SUPPORTED"

    direct_vm.sender = direct_charlie
    deployed.submit_challenge(
        opened, "A later audit disputes the impact.",
        json.dumps([{"source_url": THIRD_URL, "source_type": "AUDIT",
                     "description": "Post-mortem."}]))

    v2 = [e["evidence_id"] for e in deployed.list_evidence(opened, 2)]
    _adjudicate(direct_vm, deployed, direct_alice, opened,
                verdict="PARTIALLY_SUPPORTED", supporting=v2[:2],
                partially=v2[2:])

    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    att_id = deployed.finalize_claim(opened)

    final = deployed.verify_attestation(att_id)
    assert final["valid"] is True
    assert final["verdict"] == "PARTIALLY_SUPPORTED"
    assert final["claim_version"] == 2
    assert final["challenge_count"] == 1

    history = deployed.get_claim_history(opened)
    assert len(history["versions"]) == 2
    assert history["versions"][0]["verdict"] == "SUPPORTED", \
        "the superseded verdict is still exactly what it was"
