# Attestations

## What one is

The finalized protocol state for one claim version, in a compact record
another program can fetch and check on its own.

```text
Attestation
├── attestation_id
├── claim_id
├── claim_text              carried, so the attestation stands alone
├── claim_version
├── verdict
├── adjudication_id         the round it rests on
├── evidence_count
├── challenge_count
├── created_at              when the claim was filed
├── adjudicated_at          when the panel ruled
├── finalized_at            when it became final
└── evidence_snapshot_hash  the record that was judged
```

The claim text is copied in deliberately. An attestation that only holds
ids forces every consumer back to the contract to learn what was even
claimed; carrying the text makes it a self-describing artifact, and the
verification call still checks it against live state.

## Finalization

`finalize_claim` is deterministic and permissionless, and requires all of:

1. the claim is `ADJUDICATED`;
2. the challenge window has elapsed against a CONSENSUS-OBSERVED clock
   — the panel is asked what time it is, and the caller cannot choose
   the answer;
3. no challenge on the claim is still `OPEN`;
4. `current_adjudication_id` exists and judged the **current** version;
5. someone sends the transaction.

The fifth is not a formality. A deadline passing is never itself a state
change (§12), so finalization happens when a transaction makes it happen.

Once `FINALIZED` the claim is terminal: no further challenge, no further
adjudication, no second attestation. `test_finalization_is_not_repeatable`
asserts all three refusals.

## Verification

`verify_attestation` re-derives every claim the attestation makes,
against live state:

| Check | What would fail it |
|---|---|
| the claim still exists | — |
| the claim is `FINALIZED` | a claim somehow reopened |
| the claim points at *this* attestation | a later attestation superseded it |
| claim version matches | the claim moved on |
| the adjudication exists | a missing round |
| its verdict matches | a mismatched pairing |
| it judged this version | a round bound to a different version |
| the evidence snapshot hash matches | a different record than the one judged |

```json
{
  "attestation_id": "att_000001",
  "claim_id": "claim_000005",
  "claim_version": 1,
  "verdict": "SUPPORTED",
  "finalized": true,
  "evidence_count": 1,
  "challenge_count": 0,
  "adjudication_id": "adj_000001",
  "evidence_snapshot_hash": "…",
  "valid": true,
  "reason": "verified against protocol state"
}
```

Two properties matter here.

**Verification re-derives; it does not echo.** Returning the attestation's
own fields and calling that verification would prove nothing.

**An unknown or broken attestation is reported, not thrown.** Asking for
one that does not exist returns `valid: false` with
`"no such attestation"`. §59 forbids rendering an unverifiable thing as
verified, and an error the UI might swallow is a worse answer than an
explicit negative.

## What an attestation does not promise

- **Not that the claim is true in the world.** It says a validator panel,
  reading a specific frozen record, reached this verdict — and names the
  record so you can look.
- **Not that the sources were authentic.** Validators retrieved them;
  nobody notarised them.
- **Not that it is the last word.** It is final for that version. A new
  claim can be filed about the same subject at any time.

## Superseded attestations

Only a finalized claim has an attestation, and finalization is terminal,
so a claim has at most one. A verdict that was superseded by a challenge
never reached finalization — it lives on in `get_claim_history` as a
superseded round, which is the honest place for it.
