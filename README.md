# Attestia

> A decentralized evidence and adjudication protocol that turns disputed
> real-world claims into versioned, consensus-backed attestations.

**Deterministic code governs the case. GenLayer governs the judgment.**

---

## 1. What Attestia is

Attestia is a GenLayer protocol for the class of dispute that neither a
blockchain nor a single model can settle on its own: a claim about the
world, a pile of sources that partly agree, and a question about what
those sources actually establish.

Humans and autonomous agents file claims, attach evidence, contest
verdicts, and end up with a finalized attestation another program can
verify — with the whole history of how it got there still on chain.

```text
CLAIM → EVIDENCE → CHALLENGE → EVIDENCE FREEZE → GENLAYER ADJUDICATION
      → VALIDATOR CONSENSUS → VERDICT → CHALLENGE WINDOW
      → FINALIZATION → ATTESTATION
```

## 2. Why it exists

The internet has no neutral, programmable way to resolve conflicting
claims when the disagreement turns on interpreting language and evidence.

> "Protocol X suffered a security exploit on June 12, 2026."

One source says it happened. Another says the incident was unrelated. A
third says the event occurred but the reported impact was wrong.

A deterministic chain cannot read those sources. A single model can read
them, but its answer is one opinion nobody independently checked — and an
opinion that decides something ought to be reproducible by parties who do
not trust each other.

Attestia makes the case a persistent on-chain object and puts the one
irreducibly semantic question to a panel that answers it independently.

## 3. Why GenLayer is necessary

Everything except the judgment could run on any chain: state machine,
permissions, versioning, deadlines, attestations. The judgment could not.

`adjudicate` runs `gl.vm.run_nondet_unsafe`. Leader **and every
validator** retrieve the frozen sources themselves, run the same prompt,
normalise with the same code, and compare decision fingerprints. A
validator does not inspect the leader's JSON for well-formedness and call
that verification — it produces its own adjudication. Agreement means
independent nodes reading the same record reached the same
determinations.

| Layer | Owns |
|---|---|
| **The contract** | claims, versions, evidence, challenges, adjudication records, attestations, lifecycle, history |
| **GenLayer consensus** | whether a source addresses the claim, supports it, contradicts it, partly supports it, is outdated, or could not be read at all |
| **External sources** | raw material — untrusted until validators retrieve it themselves |

## 4. How adjudication works

The panel is asked what is true about the record. The contract decides
what follows.

Evidence is frozen for the current version, hashed, and handed to the
panel with the claim. Each node returns a structured result: a verdict,
and every frozen source sorted into exactly one bucket. That result is
then validated deterministically before a single field reaches storage —
verdict in the enum, every evidence id real, belonging to this claim and
this version, no id in two buckets, none omitted, reasoning present,
lengths bounded, and the verdict coherent with its own buckets.

`_normalize_result` returns a **fixed key set**. A response that invents
`finalize`, `attestation_id` or `confidence` is not rejected by name — the
field is simply never carried out, so nothing downstream can read it.
Rejection by name would mean anticipating every name a model might pick.

| Verdict | Meaning |
|---|---|
| `SUPPORTED` | readable evidence establishes the claim as written |
| `PARTIALLY_SUPPORTED` | the substance holds but a detail does not, or sources genuinely conflict |
| `CONTRADICTED` | readable evidence establishes the claim is wrong |
| `OUTDATED` | true of an earlier state of the world; a later source supersedes it |
| `INCONCLUSIVE` | the readable record cannot settle it — a real answer, not a failure to answer |

`TRUE` and `FALSE` are deliberately absent. A claim is judged against the
evidence on the record, not against the world.

## 5. How evidence works

Anyone may file evidence. What a submitter says about a source is stored
as `declared_relationship` — an assertion, recorded and never trusted.
Only adjudication writes `adjudicated_relationship`, and the UI shows the
two differently so a submitter's opinion can never be mistaken for a
finding.

Nothing is fetched at submission. Retrieval happens during adjudication,
on every node, and outcomes are classified:

| Outcome | Meaning |
|---|---|
| `SOURCE_OK` | retrieved; content carried into the prompt |
| `SOURCE_UNAVAILABLE` | transport failed or a non-2xx answer — an error page is not the document |
| `SOURCE_INVALID` | reachable, nothing usable in it |

A source nobody could read goes into `unavailable_evidence` and is given
**no relationship at all**. It is not contradicting, not supporting, not
irrelevant. Absence of proof is not proof of absence.

## 6. How challenges work

A verdict opens a challenge window; it is not final on arrival. Anyone
may contest it with a reason and optional counter-evidence.

A challenge never edits the past. It opens a **new version**: the previous
version's active evidence is copied forward as fresh, version-bound
records, the counter-evidence joins them, and the claim returns to the
panel. The earlier adjudication stays exactly as it was written, and stays
queryable.

## 7. How versioning works

```text
claim_000042
  v1 → SUPPORTED              (adj_000001, superseded)
  v2 → PARTIALLY_SUPPORTED    (adj_000002, current)
```

Every version owns an immutable record of precisely what its round was
shown. That is what makes "v1 said SUPPORTED" a fact rather than a story,
and it is why evidence is copied rather than moved.

## 8. How attestations work

Finalization is deterministic and permissionless, and requires all of:
an accepted adjudication for the current version, an elapsed challenge
window, no still-open challenge, and someone to send the transaction — a
deadline passing is not itself a state change.

The attestation records the claim text, version, verdict, adjudication
id, evidence and challenge counts, timestamps, and the evidence snapshot
hash. `verify_attestation` re-derives every one of those against live
state rather than echoing them, and reports invalid with a reason when
anything fails to line up.

## 9. Running locally

```bash
pip install -r requirements.txt
python scripts/fetch_genvm_bundle.py     # seeds the GenVM runner bundle
genvm-lint check contracts/attestia.py
pytest tests/direct/ -q                  # 71 tests, offline
```

```bash
cd frontend
npm install
cp .env.example .env.local               # set NEXT_PUBLIC_CONTRACT_ADDRESS
npm run dev                              # http://localhost:3150
```

## 10. Testing

```text
genvm-lint check      passes — 23 methods (13 view, 10 write)
pytest tests/direct   89 passed, offline
gltest tests/integr.  7 passed on StudioNet, real panel  (11m09s)
npm run test:wallet   5 passed — the selected wallet signs
tsc --noEmit          clean
next build            clean, 6 routes
```

The live suite is the one that proves consensus. Direct mode answers the
leader and every validator with the same canned response, so it can never
show that independent nodes agree — it proves the deterministic half:
guards, bounds, versioning, and that a malformed or dishonest panel answer
never becomes protocol state.

The last live run walked the whole golden path on chain — claim, evidence,
freeze, real panel round, verdict, challenge, second version,
re-adjudication, finalization, attestation, verification — ending at
`claim_000005 v1 → SUPPORTED → att_000001`.

See [docs/](docs/) for the full architecture, and
[docs/security.md](docs/security.md) for the threat model and the
assumptions this protocol does not hide.

## 11. Deployment

- Network: **GenLayer StudioNet** (chain id 61999)
- Contract: `0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9`
- Deploy tx: `0x10cac1daaafb7e7f6f1a818e4d361bbf84401cd2d903fe0cca916e4b27a41870`
- Consensus on deploy: 5 validators, 5 AGREE
- Runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
- Source sha256: `4b3d78cadc9fafd704f0ee6cc535d580350a5ba939d3458d9d9d2dc2cde00899`

An address in a README is a claim until someone checks it, so the check
ships with the repository:

```bash
genlayer code 0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9 > onchain.py
python scripts/verify_deployment.py onchain.py
# MATCH   sha256 370a8905896abf472e6ca6f794321533a410ce4f852519d79cc15fa9b4a6f6d6
```

That comparison was run against this deployment and matched.

## 12. Consuming an attestation as an agent

Attestia is meant to be an evidence primitive for other software, so the
read surface answers an agent's questions directly — no frontend in the
path.

```python
verify_attestation("att_000001")
# { "valid": true, "verdict": "SUPPORTED", "claim_version": 1,
#   "finalized": true, "evidence_count": 1, "challenge_count": 0,
#   "reason": "verified against protocol state", ... }

get_claim_verdict("claim_000001")
get_claim_history("claim_000001")
```

Full details, including what each field does and does not promise, are in
[docs/agent-integration.md](docs/agent-integration.md).

## Known limitations

Stated rather than left implicit.

- **Protocol time is a tick counter, not a wall clock.** The pinned GenVM
  runner exposes no deterministic timestamp — `gl.vm.get_timestamp()` is
  documented for v0.3.0 but absent from the runner's std lib, and
  `gl.message` carries no `datetime`. Both facts were checked against the
  extracted runner, not assumed. Deadlines are therefore real UTC seconds
  **observed through a validator round**: the leader reads a public
  clock, every validator reads it independently, and the round lands only
  if they agree within five minutes. The residual dependency is that time
  source — readings are range-checked and cross-validated, which bounds
  the exposure without removing it.
- **`retrieval` records what the panel reported, not what the contract
  saw.** Deterministic code cannot fetch anything; retrieval happens
  inside the nondeterministic block. The field means "the panel reported
  it could not read this source", and that is what the UI says.
- **Verdicts are bound to the content that produced them.** Each round
  digests the canonical text every node retrieved and carries that map in
  the consensus fingerprint, so a verdict names the bytes it rests on and
  validators that read different bytes cannot agree at all.
  `check_evidence_binding` lets anyone test a document against what the
  panel read. What is still NOT verified is a submitter's own hash claim —
  Attestia stores none, precisely to avoid implying one was checked.
- **A source that changes between rounds breaks consensus rather than
  passing quietly.** That is deliberate (§18 fail-closed), but it does
  mean a genuinely volatile page cannot be attested to.
- **A captured validator majority can agree on a false verdict.** That is
  GenLayer's trust model, not something a contract fixes from inside. The
  challenge-and-version mechanism exists so a bad verdict can be
  contested and superseded on the record, not so it can be prevented.
- **Prompt injection is defended in depth, not proven impossible.** The
  prompt separates protocol instructions from quoted evidence and says
  which may issue instructions, and the structured-output gate stands
  between any captured model and the record. The direct suite proves the
  gate holds; it cannot prove a model never yields.
