"""STEWARD FIX — evidence-bound attestations (§13–§19).

The vulnerability: a verdict used to be bound to the evidence RECORD —
ids, urls, descriptions — and never to the content the panel actually
read. Nothing tied "SUPPORTED" to the bytes that justified it, so the
source could change afterwards and the verdict would still stand over it.

What binds them now is a digest of the canonical text each node
retrieved, carried in the decision fingerprint. Two consequences follow,
and this file tests both: the verdict names the content it rests on, and
validators that read different bytes cannot agree at all.

This file tests the binding as the leader records it — that the digest is
taken from what was fetched, that different content yields a different
digest, and that the contract refuses to bind anything it could not read.
The disagreement itself — a validator that read different bytes refusing
the leader's result — is staged in `test_validators.py`, which replays the
contract's validator closure with swapped mocks.
"""
import hashlib
import re

from .conftest import BASE_TS, GOOD_URL, OTHER_URL, at_time, make_result, mock_panel


# ─── an independent implementation of the contract's canonicalisation ────
#
# Deliberately written out again rather than imported: a test that reuses
# the implementation it is checking proves only that the code equals
# itself. This mirrors §15's rule — strip markup and collapse whitespace,
# but never normalise away meaning.
def canonical(text: str, limit: int = 4000) -> str:
    cleaned = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    cleaned = re.sub(r"(?s)<[^>]+>", " ", cleaned)
    cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:limit]


def digest_of(page: str) -> str:
    return hashlib.sha256(canonical(page).encode("utf-8")).hexdigest()


CONTENT_X = "<html><body><h1>Incident report</h1><p>The exploit occurred.</p></body></html>"
CONTENT_Y = "<html><body><h1>Incident report</h1><p>No exploit occurred.</p></body></html>"


def _adjudicate_with(direct_vm, deployed, sender, claim_id, page, **kw):
    """Run a round in which every source serves `page`.

    The version is read back from the contract rather than assumed: a
    challenge bumps it, and a result naming the wrong version is refused.
    """
    version = deployed.get_claim(claim_id)["current_version"]
    ids = [e["evidence_id"] for e in deployed.list_evidence(claim_id, version)
           if e["status"] == "ACTIVE"]
    kw.setdefault("supporting", ids)
    mock_panel(direct_vm, make_result(claim_id, version=version,
                                      verdict=kw.pop("verdict", "SUPPORTED"),
                                      **kw),
               body=page)
    direct_vm.sender = sender
    deployed.start_adjudication(claim_id)
    return deployed.adjudicate(claim_id)


def _one_source(direct_vm, deployed, alice, opened, url=GOOD_URL):
    direct_vm.sender = alice
    eid = deployed.submit_evidence(opened, url, "OFFICIAL_ANNOUNCEMENT",
                                   "Incident report.", "SUPPORTS")
    deployed.close_evidence(opened)
    return eid


# ═══ Test 1 — the verdict names the content it rests on ═══════════════════

def test_verdict_is_bound_to_the_content_actually_read(
    direct_vm, deployed, direct_alice, opened
):
    """§19.1 — content X → digest H1 → verdict V, and V records H1."""
    eid = _one_source(direct_vm, deployed, direct_alice, opened)
    adj_id = _adjudicate_with(direct_vm, deployed, direct_alice, opened, CONTENT_X)

    expected = digest_of(CONTENT_X)
    adj = deployed.get_adjudication(adj_id)

    bindings = {b["evidence_id"]: b["digest"] for b in adj["content_bindings"]}
    assert bindings[eid] == expected, \
        "the binding must be the digest of the canonical text that was read"
    assert adj["content_binding_hash"], "the round must carry a binding hash"

    # And it is written onto the evidence itself, so a reader of one
    # record can see what the panel saw.
    assert deployed.get_evidence(eid)["content_digest"] == expected


def test_binding_survives_cosmetic_differences(direct_vm, deployed, direct_alice,
                                               opened):
    """§15 — canonicalisation, so honest nodes are not split by whitespace.

    The same document served with different formatting is the same
    document, and must not produce a different binding.
    """
    eid = _one_source(direct_vm, deployed, direct_alice, opened)
    reformatted = ("<html>\n  <body>\n    <h1>Incident report</h1>\n"
                   "    <p>The exploit   occurred.</p>\n  </body>\n</html>")

    adj_id = _adjudicate_with(direct_vm, deployed, direct_alice, opened, reformatted)
    adj = deployed.get_adjudication(adj_id)
    bindings = {b["evidence_id"]: b["digest"] for b in adj["content_bindings"]}

    assert bindings[eid] == digest_of(CONTENT_X), \
        "markup and whitespace must not change the binding"


# ═══ Test 2 — modified content cannot inherit the old verdict ════════════

def test_modified_content_does_not_match_the_binding(
    direct_vm, deployed, direct_alice, opened
):
    """§19.2 — H1 != H2, and the contract says so on request."""
    eid = _one_source(direct_vm, deployed, direct_alice, opened)
    _adjudicate_with(direct_vm, deployed, direct_alice, opened, CONTENT_X)

    h1, h2 = digest_of(CONTENT_X), digest_of(CONTENT_Y)
    assert h1 != h2, "the two documents must not hash alike"

    # The document that was actually judged: matches.
    good = deployed.check_evidence_binding(eid, h1)
    assert good["matches"] is True
    assert good["bound_digest"] == h1

    # The altered document: refused, in the open, with a reason.
    bad = deployed.check_evidence_binding(eid, h2)
    assert bad["matches"] is False
    assert "does NOT match" in bad["reason"]


def test_a_changed_source_changes_the_binding(direct_vm, deployed, direct_alice,
                                              direct_bob, opened):
    """Two rounds over the same URL serving different content produce
    different bindings — which is what stops a verdict outliving the page
    that justified it."""
    _one_source(direct_vm, deployed, direct_alice, opened)
    first = _adjudicate_with(direct_vm, deployed, direct_alice, opened, CONTENT_X)

    # The source changes underneath, and the claim is re-heard.
    direct_vm.sender = direct_bob
    deployed.submit_challenge(opened, "The page now says the opposite.", "[]")
    second = _adjudicate_with(direct_vm, deployed, direct_alice, opened, CONTENT_Y)

    a = deployed.get_adjudication(first)
    b = deployed.get_adjudication(second)
    assert a["content_binding_hash"] != b["content_binding_hash"], \
        "different content must not produce the same binding"
    # The first ruling still records what IT read — history is intact.
    assert a["content_bindings"][0]["digest"] == digest_of(CONTENT_X)
    assert b["content_bindings"][0]["digest"] == digest_of(CONTENT_Y)


# ═══ Tests 3 & 4 — the mechanism a validator rejects on ══════════════════

def test_the_binding_is_what_validators_compare(
    direct_vm, deployed, direct_alice, direct_bob, opened
):
    """§19.3, §19.4 — leader/source mismatch is caught by the fingerprint.

    This proves the input to that comparison: an identical VERDICT over
    different CONTENT yields a different binding hash. The comparison
    itself is exercised in `test_validators.py`
    (`test_panel_validator_rejects_a_leader_that_read_different_bytes`). Since the binding is part of the decision fingerprint,
    a leader that reached the right-looking answer over the wrong document
    cannot match a validator that read the right one.
    """
    _one_source(direct_vm, deployed, direct_alice, opened)
    first = _adjudicate_with(direct_vm, deployed, direct_alice, opened,
                             CONTENT_X, verdict="SUPPORTED")

    direct_vm.sender = direct_bob
    deployed.submit_challenge(opened, "Re-hearing on a different source.", "[]")
    second = _adjudicate_with(direct_vm, deployed, direct_alice, opened,
                              CONTENT_Y, verdict="SUPPORTED")

    a, b = deployed.get_adjudication(first), deployed.get_adjudication(second)
    assert a["verdict"] == b["verdict"] == "SUPPORTED", \
        "same conclusion, deliberately"
    assert a["content_binding_hash"] != b["content_binding_hash"], (
        "identical verdicts over different evidence must be distinguishable — "
        "otherwise a leader could substitute the source unnoticed")


# ═══ Test 5 — missing source fails closed ════════════════════════════════

def test_unreadable_source_is_bound_to_nothing(
    direct_vm, deployed, direct_alice, opened
):
    """§19.5, §18 — no content, no binding, and no pretence of one."""
    eid = _one_source(direct_vm, deployed, direct_alice, opened)

    mock_panel(direct_vm, make_result(opened, verdict="INCONCLUSIVE",
                                      irrelevant=[], supporting=[],
                                      unavailable_evidence=[eid]),
               body="", status=503)
    direct_vm.sender = direct_alice
    deployed.start_adjudication(opened)
    adj_id = deployed.adjudicate(opened)

    ev = deployed.get_evidence(eid)
    assert ev["retrieval"] == "SOURCE_UNAVAILABLE"
    assert ev["content_digest"] == "", \
        "a source nobody could read must not be bound to a digest"

    binding = deployed.check_evidence_binding(eid, digest_of(CONTENT_X))
    assert binding["bound"] is False
    assert binding["matches"] is False
    assert "no adjudication has read this source" in binding["reason"]

    adj = deployed.get_adjudication(adj_id)
    assert adj["content_bindings"][0]["digest"] == ""
    assert adj["content_bindings"][0]["retrieval"] == "SOURCE_UNAVAILABLE"


def test_attestation_carries_the_binding_and_verification_checks_it(
    direct_vm, deployed, direct_alice, opened
):
    """The binding has to survive all the way to the artefact an agent
    consumes, or it protects nothing at the point of use."""
    _one_source(direct_vm, deployed, direct_alice, opened)
    adj_id = _adjudicate_with(direct_vm, deployed, direct_alice, opened, CONTENT_X)

    at_time(direct_vm, BASE_TS + 4 * 24 * 60 * 60)
    att_id = deployed.finalize_claim(opened)

    att = deployed.get_attestation(att_id)
    adj = deployed.get_adjudication(adj_id)
    assert att["content_binding_hash"] == adj["content_binding_hash"]

    check = deployed.verify_attestation(att_id)
    assert check["valid"] is True
    assert check["content_binding_hash"] == adj["content_binding_hash"]
