"""Validator-side verification (steward §13, §14, §25).

The other direct tests drive the LEADER: a contract call runs the leader
closure and commits its result. That shows what the leader does, and says
nothing about whether a validator would have agreed.

These tests run the VALIDATOR. Every `gl.vm.run_nondet_unsafe` call in
direct mode captures its `(leader_result, leader_fn, validator_fn)`, and
`direct_vm.run_validator()` replays the contract's own validator closure
against a leader result — the real one, or a forged one. Swapping the web
and LLM mocks between the call and the replay stages a validator that
read different bytes, judged differently, or saw a different clock.

So the claims below are about the code that decides consensus, not about
a restatement of it: a validator that reads the same bytes and reaches
the same determinations agrees; one that read different bytes, reached a
different determination, read a different time, or was handed a forged
result does not.

What this still does not show is a real network's validators — their
models, their fetches, their latency. That is `prove_lifecycle.py`'s job,
against the production contract (docs/production-evidence.md).
"""
import copy

from .conftest import BASE_TS, CLOCK_URL_PATTERN, at_time, make_result, mock_panel
from .test_evidence_binding import CONTENT_X, CONTENT_Y, digest_of, _adjudicate_with, _one_source


def _round(direct_vm, key: str) -> int:
    """Index of the most recent captured round whose leader result has `key`.

    `_observe_time` rounds return {"ts": …}; adjudication rounds return
    {"normalized": …}. One contract call can run both, so rounds are found
    by what they returned rather than by position.
    """
    captured = direct_vm._captured_validators
    for i in range(len(captured) - 1, -1, -1):
        result = captured[i][0]
        if isinstance(result, dict) and key in result:
            return i
    raise AssertionError(f"no captured round returned {key!r}")


def _leader_result(direct_vm, index: int) -> dict:
    return copy.deepcopy(direct_vm._captured_validators[index][0])


# ═══ The clock: a leader cannot tell the network what time it is ═══════════

def _opened_at(direct_vm, deployed, alice, drafted, ts=BASE_TS) -> int:
    direct_vm.clear_validators()
    at_time(direct_vm, ts)
    direct_vm.sender = alice
    deployed.open_claim(drafted)
    return _round(direct_vm, "ts")


def test_validator_confirms_an_honest_clock_reading(
    direct_vm, deployed, direct_alice, drafted
):
    i = _opened_at(direct_vm, deployed, direct_alice, drafted)
    assert direct_vm.run_validator(index=i) is True


def test_validator_rejects_a_leader_that_moves_time(
    direct_vm, deployed, direct_alice, drafted
):
    """The attack the clock fix exists for, attempted by the one party that
    could still try it — the leader — and refused by every validator."""
    tol = deployed.get_protocol_info()["clock_tolerance_seconds"]
    i = _opened_at(direct_vm, deployed, direct_alice, drafted)

    assert direct_vm.run_validator(index=i, leader_result={"ts": BASE_TS + 3 * 86400}) is False, \
        "a leader jumping three days ahead (to expire a window) must be refused"
    assert direct_vm.run_validator(index=i, leader_result={"ts": BASE_TS - 86400}) is False, \
        "a leader backdating (to hold a window open) must be refused"
    assert direct_vm.run_validator(index=i, leader_result={"ts": BASE_TS + tol + 1}) is False
    # Tolerance, not equality: two honest nodes never read the same instant.
    assert direct_vm.run_validator(index=i, leader_result={"ts": BASE_TS + tol - 1}) is True


def test_validator_reads_the_clock_itself(direct_vm, deployed, direct_alice, drafted):
    """The leader's honest reading is still refused by a validator whose own
    reading disagrees — agreement is reached, never inherited."""
    i = _opened_at(direct_vm, deployed, direct_alice, drafted)
    at_time(direct_vm, BASE_TS + 3600)
    assert direct_vm.run_validator(index=i) is False


def test_validator_fails_closed_when_it_cannot_read_the_clock(
    direct_vm, deployed, direct_alice, drafted
):
    i = _opened_at(direct_vm, deployed, direct_alice, drafted)
    direct_vm.clear_mocks()
    direct_vm.mock_web(CLOCK_URL_PATTERN, {"status": 503, "body": "unavailable"})
    assert direct_vm.run_validator(index=i) is False


# ═══ Adjudication: agreement means same bytes AND same determinations ═══════

def _adjudicated(direct_vm, deployed, alice, opened):
    eid = _one_source(direct_vm, deployed, alice, opened)
    direct_vm.clear_validators()
    _adjudicate_with(direct_vm, deployed, alice, opened, CONTENT_X)
    return eid, _round(direct_vm, "normalized")


def test_panel_validator_agrees_when_it_reads_and_judges_the_same(
    direct_vm, deployed, direct_alice, opened
):
    eid, i = _adjudicated(direct_vm, deployed, direct_alice, opened)
    # A fresh, independent fetch of the same bytes and the same judgement.
    mock_panel(direct_vm, make_result(opened, supporting=[eid]), body=CONTENT_X)
    assert direct_vm.run_validator(index=i) is True


def test_panel_validator_rejects_a_leader_that_read_different_bytes(
    direct_vm, deployed, direct_alice, opened
):
    """§13 — the case a URL-only binding could not catch: the SAME verdict
    reached over DIFFERENT content. The validator's own digest differs, so
    its fingerprint differs, so it disagrees."""
    eid, i = _adjudicated(direct_vm, deployed, direct_alice, opened)
    mock_panel(direct_vm, make_result(opened, supporting=[eid]), body=CONTENT_Y)
    assert direct_vm.run_validator(index=i) is False


def test_panel_validator_rejects_a_different_determination(
    direct_vm, deployed, direct_alice, opened
):
    """Same bytes, different judgement: the validator's own model reads the
    source as contradicting, and that is a disagreement."""
    eid, i = _adjudicated(direct_vm, deployed, direct_alice, opened)
    mock_panel(direct_vm,
               make_result(opened, verdict="CONTRADICTED", supporting=[], contradicting=[eid]),
               body=CONTENT_X)
    assert direct_vm.run_validator(index=i) is False


def test_panel_validator_rejects_a_forged_verdict(
    direct_vm, deployed, direct_alice, opened
):
    """A leader that returns a coherent but different ruling than the one
    it computed is refused — validators recompute, they do not inspect."""
    eid, i = _adjudicated(direct_vm, deployed, direct_alice, opened)
    mock_panel(direct_vm, make_result(opened, supporting=[eid]), body=CONTENT_X)

    forged = _leader_result(direct_vm, i)
    forged["normalized"]["verdict"] = "CONTRADICTED"
    forged["normalized"]["supporting_evidence"] = []
    forged["normalized"]["contradicting_evidence"] = [eid]
    assert direct_vm.run_validator(index=i, leader_result=forged) is False


def test_panel_validator_rejects_a_forged_content_binding(
    direct_vm, deployed, direct_alice, opened
):
    """A leader that claims to have read other bytes than it did — here, the
    digest of CONTENT_Y while every node read CONTENT_X — is refused."""
    eid, i = _adjudicated(direct_vm, deployed, direct_alice, opened)
    mock_panel(direct_vm, make_result(opened, supporting=[eid]), body=CONTENT_X)

    forged = _leader_result(direct_vm, i)
    forged["normalized"]["content_bindings"][0]["digest"] = digest_of(CONTENT_Y)
    assert direct_vm.run_validator(index=i, leader_result=forged) is False


def test_panel_validator_does_not_fail_on_prose(
    direct_vm, deployed, direct_alice, opened
):
    """§14 — the narrowest equivalence that works. Two honest nodes do not
    write the same paragraph; the fingerprint compares determinations, so
    different wording over the same determinations is still agreement."""
    eid, i = _adjudicated(direct_vm, deployed, direct_alice, opened)
    mock_panel(direct_vm, make_result(opened, supporting=[eid]), body=CONTENT_X)

    reworded = _leader_result(direct_vm, i)
    reworded["normalized"]["reason"] = "Worded entirely differently, same finding."
    assert direct_vm.run_validator(index=i, leader_result=reworded) is True


def test_panel_validator_rejects_a_leader_that_falsely_reports_failure(
    direct_vm, deployed, direct_alice, opened
):
    """A leader that claims the panel failed, when the validator can read
    the source and reach a ruling, does not get its failure agreed to."""
    eid, i = _adjudicated(direct_vm, deployed, direct_alice, opened)
    mock_panel(direct_vm, make_result(opened, supporting=[eid]), body=CONTENT_X)
    assert direct_vm.run_validator(
        index=i, leader_error=Exception("LLM_ERROR: panel returned a non-object")) is False
