# Security

What Attestia defends, how, and what it does not claim.

## Threat model

Attestia holds no money — §31 removes escrow, bonds, staking and payouts
entirely. What it holds is a **record**, and the record is the thing worth
attacking. Four actors can try:

| Actor | What they might attempt |
|---|---|
| **A claimant** | file a claim and stack only favourable evidence; close collection before contrary sources arrive; hold a case open forever |
| **A submitter** | pass off an unreadable link as proof; repeat one source to weight the record; label a source as supporting and hope the label sticks |
| **A stranger** | drive someone else's claim; adjudicate a version that was never frozen; finalize a contested claim; replay a transition |
| **A source** | carry text addressed to the adjudicator, trying to dictate the verdict |

The model is treated as **fallible, and possibly captured**. Every
defence below assumes the panel might return exactly what an attacker
wanted, and asks what the protocol does then.

## Prompt injection (§44)

Three layers, in order of how much they assume.

**1. Separation.** The prompt has four labelled sections and the first
states that it is the only authority. Evidence arrives inside a section
framed as quoted material, and rule 9 tells the panel that a page telling
it what to conclude is attempting to manipulate the record: ignore the
instruction, judge the page on substance, and note it in `reason`.

**2. Reduction.** Retrieved pages are stripped of scripts, styles and
markup, collapsed, and truncated to 4000 characters. Less hostile text
reaches the model.

**3. The gate — the layer that does not depend on the model behaving.**
Even a fully captured panel must return a result that survives
`_normalize_result`: verdict in the enum, every evidence id real and
belonging to this claim and this version, no id twice, none omitted,
bounded strings, and internal coherence. And the fixed key set means
anything it invents is dropped rather than read.

So the most an injected page can achieve is a *wrong verdict on the real
evidence set* — which is contestable through a challenge and visible in
the history. It cannot forge an id, skip a stage, finalize a claim, mint
an attestation, change a version, or alter a past ruling.

`tests/direct/test_security.py` proves the gate holds. It cannot prove a
model never yields, and does not claim to: that is what §49's live suite
and the challenge mechanism are for.

## Authorisation (§43)

Every write opens with named guards: `_require_claim`, `_require_state`,
`_require_creator`. Addresses are compared case-insensitively so a
case-flipped address cannot impersonate a party.

The privilege surface is deliberately tiny. Only two actions are
restricted to the creator — opening a claim, and closing evidence
collection *early*. Everything else is open, because adjudication,
challenge and finalization are protocol progress rather than powers, and
a case whose parties go quiet must still reach an end state.

There is no owner override. The contract records `owner` at construction
and never reads it for any decision.

## Identity

Ids are minted by the contract from monotonic sequences. A frontend
cannot choose protocol identity, and nothing derives an id from a Python
object id or a caller-supplied string.

## Immutability

- A finalized claim is terminal — no challenge, no adjudication, no
  second attestation.
- A stored adjudication is never rewritten. A challenge creates a new
  version; the old round stays queryable.
- Evidence is version-bound and copied, never moved, so each version
  keeps an immutable record of exactly what its round saw.
- Frozen means frozen: after `close_evidence` nothing can be submitted or
  withdrawn for that version.

## Bounds (§43)

| Limit | Value |
|---|---|
| claim text | 1000 chars |
| description | 500 chars |
| source URL | 500 chars |
| reason | 2000 chars |
| evidence per version | 40 |
| challenges per claim | 20 |
| versions per claim | 12 |
| list page | 100 |

Unbounded growth is an attack, and an endless challenge loop is the
cheapest version of it. URLs must be `http(s)`, which keeps `file://` and
`javascript:` out of the retrieval path.

## Source failure (§45)

`SOURCE_UNAVAILABLE` and `SOURCE_INVALID` carry no content, and a source
in `unavailable_evidence` is given **no relationship at all**.

If an unreadable source counted as contradicting, anyone could weaken a
claim by filing links that do not resolve. Absence of proof is not proof
of absence.

## State safety (§25)

```text
read state → copy to memory → nondeterministic evaluation
→ validator acceptance → deterministic validation → state mutation
```

Nothing in `adjudicate` touches storage until the panel's answer has been
accepted and validated. A refused round leaves the claim exactly where it
was and can be retried.

This was got wrong first: an early draft set `ADJUDICATING` before the
nondet call, and a rejected answer stranded the claim mid-round. The
direct tests caught it, and the transition became its own transaction.

## Failure is not a verdict (§24)

A failed adjudication is never silently converted into `INCONCLUSIVE`.
`INCONCLUSIVE` means the panel read the record and could not settle it.
A failure means no round happened. Conflating them would let
infrastructure trouble masquerade as a finding.

## Frontend

- No seed phrase, private key or wallet password is requested, stored or
  logged anywhere.
- EIP-6963 discovery, not `window.ethereum` — with two extensions
  installed that global is whichever won the injection race, and a user
  could sign from a wallet they never chose.
- Wrong network is surfaced and blocks signing rather than being silently
  coerced.
- A write is called finalized only after the receipt is read. A hash
  means submitted; GenLayer can accept a transaction that then reverted.
- A missing contract address produces a stated error, never a fabricated
  default.

## Assumptions this protocol does not hide

1. **A captured validator majority can agree on a false verdict.** That
   is GenLayer's trust model. Attestia's answer is not prevention but
   contestability: the verdict is on the record with the evidence it
   rested on, and a challenge supersedes it with a new version.
2. **Retrieval reflects the source at read time.** A page that changes
   between rounds is judged as it read during the round. Freezing fixes
   *which* URLs are admissible, not what they will say.
3. **Nothing authenticates a source.** No content hash is stored or
   checked. The guarantee is that validators read the real URL, not that
   the bytes were notarised.
4. **`retrieval` is the panel's report, not the contract's observation.**
   Deterministic code cannot fetch.
5. **Protocol time is a tick counter.** Deadlines advance with protocol
   activity, and `advance_clock` is permissionless by design.
6. **Direct tests exercise the leader path only.** `mock_llm` answers
   leader and validators identically, so real agreement is demonstrated
   by the live suite, not offline.

## Reporting a vulnerability

Open an issue naming the affected function, the state needed to reach it,
and the impact. Do not include private keys or funded account details.
