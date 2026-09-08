# Challenges and versioning

## What a challenge does

It does not edit a verdict. It opens a new version of the claim.

```text
claim_000042
  v1  SUPPORTED             adj_000001   ← still readable, unchanged
        │
        │  chal_000001  "the impact figure is disputed"
        ▼
  v2  PARTIALLY_SUPPORTED   adj_000002   ← current
```

`v1.verdict` is never rewritten. That is the whole point: a protocol
whose history can be edited is a protocol whose history proves nothing.

## The record

```text
Challenge
├── challenge_id
├── claim_id
├── target_version        the version being contested
├── resulting_version     the version it opened
├── submitted_by
├── reason                required, bounded
├── counter_evidence_ids  filed against the new version
├── submitted_at
└── status                OPEN | ACCEPTED | REJECTED | SUPERSEDED
```

A challenge is recorded `ACCEPTED` on submission. Attestia does not have
a gatekeeper deciding which challenges deserve a hearing — the protocol
accepts any well-formed challenge inside the window, and the panel
decides whether the contested reading survives. Earlier challenges on the
same claim become `SUPERSEDED` when a later one opens a further version,
because the version they were arguing about is no longer current.

## Who may challenge, and when

Anyone, while the claim is `ADJUDICATED` and the challenge window is
open. Not just the creator — a case that only its author can contest is
not adjudication.

Requirements: a non-empty reason, the window still open, the claim below
the version ceiling, and counter-evidence that is well-formed
(`http(s)` URLs, descriptions present, no source already on the record).

## What happens to the evidence

The previous version's active evidence is **copied** into the new version
as fresh records: new ids, same source and description, findings cleared.
The counter-evidence is then filed alongside.

Copying rather than moving is what makes the history real. v1 keeps an
immutable record of exactly what its round was shown, and the new round
decides afresh rather than inheriting the last panel's classifications.

## Re-adjudication

`CHALLENGED → start_adjudication → RE_ADJUDICATING → adjudicate →
ADJUDICATED`.

The new round sees the new version's evidence set — the carried-forward
record plus whatever the challenge added — and produces a new
adjudication with its own id, round number and snapshot hash.

`get_claim_history` returns every round in order, each marked
`superseded` or not:

```json
{
  "current_version": 2,
  "versions": [
    { "claim_version": 1, "verdict": "SUPPORTED",
      "adjudication_id": "adj_000001", "superseded": true },
    { "claim_version": 2, "verdict": "PARTIALLY_SUPPORTED",
      "adjudication_id": "adj_000002", "superseded": false }
  ]
}
```

## Bounds

12 versions and 20 challenges per claim. Both exist so a claim cannot be
made to grow without limit — §43 lists unbounded storage growth as an
attack, and an endless challenge loop is exactly that. The ceilings are
tested (`test_challenge_count_is_capped` walks a claim to the version
limit and asserts the refusal).

## While a challenge is open

Finalization is blocked. `finalize_claim` refuses if any challenge on the
claim is still `OPEN`, and refuses outright unless the claim is
`ADJUDICATED` with an elapsed window — so a contested claim cannot be
quietly finalized out from under the challenger.
