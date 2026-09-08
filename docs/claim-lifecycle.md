# Claim lifecycle

```text
DRAFT
  │  open_claim              creator only
  ▼
OPEN ─────────────────────────────────── evidence may be submitted
  │  close_evidence          creator any time; anyone after the deadline
  ▼
EVIDENCE_CLOSED ──────────────────────── the set is frozen for this version
  │  start_adjudication
  ▼
ADJUDICATING
  │  adjudicate              GenLayer panel round
  ▼
ADJUDICATED ──────────────────────────── challenge window open
  ├── submit_challenge ─► CHALLENGED
  │                          │  start_adjudication
  │                          ▼
  │                     RE_ADJUDICATING
  │                          │  adjudicate
  │                          └─► ADJUDICATED   (new version)
  │
  └── finalize_claim ────► FINALIZED           terminal
```

## Transition rules

Every transition validates, in this order: the claim exists, the state
permits it, the caller is allowed, deadlines are satisfied, and the
version is current. Failures raise `EXPECTED:` errors naming the rule
that refused.

| From | Call | To | Who |
|---|---|---|---|
| `DRAFT` | `open_claim` | `OPEN` | creator |
| `OPEN` | `submit_evidence` | `OPEN` | anyone, before the deadline |
| `OPEN` | `remove_evidence` | `OPEN` | the submitter of that record |
| `OPEN` | `close_evidence` | `EVIDENCE_CLOSED` | creator, or anyone once the deadline passed |
| `EVIDENCE_CLOSED` | `start_adjudication` | `ADJUDICATING` | anyone |
| `CHALLENGED` | `start_adjudication` | `RE_ADJUDICATING` | anyone |
| `ADJUDICATING` / `RE_ADJUDICATING` | `adjudicate` | `ADJUDICATED` | anyone |
| `ADJUDICATED` | `submit_challenge` | `CHALLENGED`, version + 1 | anyone, in the window |
| `ADJUDICATED` | `finalize_claim` | `FINALIZED` | anyone, after the window |

Two asymmetries are deliberate:

- **Only the creator may open a claim or close collection early.** The
  claim is theirs to bring. But once the evidence deadline passes anyone
  may close it, so a creator who dislikes the incoming evidence cannot
  hold the case open forever.
- **Anyone may adjudicate, challenge and finalize.** These are protocol
  progress, not privileges. A case whose parties go quiet must still be
  able to reach an end state.

## Why `start_adjudication` is separate

It looks like ceremony and is not. §25 requires that no protocol state
change until the panel's answer has been accepted.

An early draft set `ADJUDICATING` inside `adjudicate`, immediately before
the non-deterministic call. When a malformed answer was rejected, the
claim was left stranded mid-round and could not retry — the direct tests
caught it. Splitting the transition into its own transaction means
`adjudicate` mutates nothing until consensus lands, while the in-flight
state stays a real, observable thing rather than a UI fiction.

## Protocol time

Deadlines are absolute values on a monotonic clock measured in seconds.
`advance_clock(seconds)` moves it forward, and is public, unprivileged
and one-way.

This is not what §12 asks for first. §12 wants UTC seconds from a
deterministic transaction timestamp — but the pinned runner has none:
`gl.vm.get_timestamp()` is documented for v0.3.0 and absent from the std
lib this runner bundles, and `gl.message` carries only
`contract_address`, `sender_address`, `origin_address`, `value` and
`chain_id`. Both facts were checked against the extracted runner rather
than assumed.

The remaining options were wall-clock inside deterministic code (not
available, and non-deterministic across validators if it were), a
caller-supplied timestamp (§12 forbids treating client time as
authoritative), or a clock the chain advances. Attestia took the third,
kept the unit §12 asked for, and is explicit about it everywhere: the UI
renders protocol time as `t+…`, never as a calendar date.

A deadline passing is never itself a state change. Some transaction has
to make the transition — which is §12's other requirement.

## Timestamps recorded

`created_at` · `updated_at` · `evidence_deadline` ·
`adjudication_started_at` · `adjudicated_at` · `challenge_deadline` ·
`finalized_at`

All in protocol seconds, all consistent with one another.

## Windows

| Window | Default | Bounds |
|---|---|---|
| Evidence collection | 7 days | 60s – 90 days, chosen at creation |
| Challenge | 3 days | fixed |

The evidence window is measured from the moment collection actually
opens, not from creation — a claim can sit in `DRAFT` indefinitely.
