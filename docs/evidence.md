# Evidence

## The model

```text
Evidence
├── evidence_id             minted by the contract
├── claim_id                the case it belongs to
├── claim_version           the version it was filed against
├── submitted_by            address
├── source_url              http(s), bounded
├── source_type             free label, bounded
├── description             what the submitter says it is
├── submitted_at            protocol seconds
├── status                  ACTIVE | OUTDATED | REMOVED
├── declared_relationship   an ASSERTION by the submitter
├── adjudicated_relationship  a FINDING by the panel
├── adjudicated_in          which adjudication classified it
└── retrieval               what the panel reported about reading it
```

## Assertion versus finding

The two relationship fields are the heart of the model, and they are
never merged.

`declared_relationship` is what the person filing the source says it
proves. It is recorded because provenance matters — who claimed what —
and it is never treated as evidence of anything. It is optional, and the
honest default is `UNCLASSIFIED`.

`adjudicated_relationship` is empty until a panel rules. Only
`adjudicate` writes it.

The frontend renders the two differently on purpose: the finding is the
line that carries weight, the assertion sits below it in small type
labelled "submitter asserts", and before a ruling the finding position
reads "not yet adjudicated" rather than showing something blank that
could be mistaken for a neutral verdict.

| Relationship | Meaning when adjudicated |
|---|---|
| `SUPPORTS` | establishes the claim as written |
| `CONTRADICTS` | establishes that the claim is wrong |
| `PARTIALLY_SUPPORTS` | supports the substance but not every asserted detail |
| `IRRELEVANT` | about the topic, but does not bear on the assertion |
| `OUTDATED` | was true of an earlier state of the world |
| `RELATED` | connected to the case without bearing on the claim |

## What is deliberately not stored

**No page contents.** §16 asks for references and compact metadata. A
retrieved page is normalised, truncated and used inside the round, then
discarded.

**No submitter-supplied content hash.** This is an honesty decision. A
hash the submitter provides and nobody checks is worse than no hash,
because it looks like verification. What establishes anything here is
validators retrieving the source themselves during adjudication, so
that is the only mechanism the protocol offers.

## Retrieval

Nothing is fetched at submission time. Fetching happens inside the
non-deterministic block, on every node, and `_classify_fetch` labels each
attempt:

| Outcome | Carries content? | When |
|---|---|---|
| `SOURCE_OK` | **yes** | 2xx with a non-empty body |
| `SOURCE_UNAVAILABLE` | no | transport failure, or a non-2xx answer |
| `SOURCE_INVALID` | no | reachable, body empty or unusable |

Only `SOURCE_OK` ever carries text into the prompt. An error page is not
the document it failed to serve, and a panel reasoning over a 404 body is
reasoning over an error message.

Retrieved text is normalised before use: scripts and styles stripped,
tags removed, whitespace collapsed, truncated to 4000 characters. Smaller
input is not just cheaper — the less of a hostile page reaches the model,
the less room it has to argue with the instructions.

**`retrieval` records what the panel reported.** Deterministic code
cannot fetch anything, so the contract writes this field from which
bucket the panel placed the source in. The field means "the panel
reported it could not read this source", and the UI says exactly that
rather than implying the contract checked.

## Unavailable is not contradicting

A source nobody could read goes into `unavailable_evidence` and is given
**no relationship at all** — not contradicting, not supporting, not
irrelevant.

This is §45's rule and it matters more than it looks. If an unreadable
source counted as contradicting, anyone could weaken a claim by filing
links that do not resolve. Absence of proof is not proof of absence, and
the protocol refuses to let a dead link argue.

## Version binding

Every record is bound to the claim version it was filed against.
`_version_evidence` filters on it, so a record filed against v1 can never
be read as part of v2's set.

When a challenge opens a new version, the previous version's active
evidence is **copied** into it as fresh records with new ids and cleared
findings, and the counter-evidence joins them. Copying rather than moving
is what lets v1 keep an immutable record of exactly what its round saw.

## Removal

A submitter may withdraw their own record while the window is still open.
The record is marked `REMOVED` rather than deleted: it leaves the active
set but stays readable, because a case history that can lose entries is
not a history.

Once evidence is frozen nothing can be withdrawn. A record the panel has
read cannot be taken back out of the account of what it read.

## Bounds

40 records per version · 500-character URLs · 500-character descriptions ·
64-character source types. Duplicate source URLs are rejected within a
version, so repetition cannot weight the record. URLs must be `http(s)`,
which keeps `file://` and `javascript:` out of the retrieval path.
