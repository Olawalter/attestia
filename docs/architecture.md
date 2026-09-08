# Architecture

## The boundary

Everything in Attestia is organised around one line: what the protocol
can decide deterministically, and what it must put to a panel.

```text
                        ATTESTIA
                            │
            ┌───────────────┴────────────────┐
            │                                │
     Deterministic                    Non-deterministic
     Protocol Logic                        Judgment
            │                                │
            ▼                                ▼
     claim state                     evidence interpretation
     versions                        source retrieval
     deadlines                       semantic relationship
     permissions                     verdict proposal
     identity                        validator judgment
     attestations                    fraud observation
            │                                │
            └───────────────┬────────────────┘
                            ▼
                    GenLayer Consensus
                            │
                            ▼
                    Accepted Verdict
                            │
                            ▼
                       Attestation
```

The left column is code anyone can audit and re-run. The right column is
the part that needs a model to read unstructured evidence and several
independent parties to agree on what it shows. The arrow between them
runs one way only: the panel's answer becomes protocol state after
consensus and deterministic validation, and never before.

## Repository layout

```text
contracts/attestia.py        the protocol, one deployed contract
scripts/
  fetch_genvm_bundle.py      seeds the GenVM runner bundle on a cold cache
  verify_deployment.py       proves the deployment matches this source
tests/direct/                71 tests, offline
tests/integration/           7 tests, live panel
frontend/                    Next.js 16 app, 6 routes
docs/                        this directory
```

## Why one file, not four

§8 sketches `attestia.py` / `types.py` / `constants.py` / `adjudication.py`
and says supporting modules **may** separate concerns. They are separated
— as four banner sections in one module rather than four importable
files, for a mechanical reason:

A multi-file contract package needs the `py-genlayer-multi` runner. But
`gltest` direct mode resolves the SDK by looking up the literal key
`py-genlayer` in the `Depends` header (`RUNNER_TYPE = "py-genlayer"` in
its `sdk_loader`). A multi-file contract therefore cannot be exercised by
the direct suite that §47 and §48 require. One deployed contract is
mandatory and passing tests are mandatory; the file split is optional, so
the file split gave way.

The sections are `CONSTANTS`, `TYPES`, `ADJUDICATION`, and the contract
class itself.

## Storage model

GenLayer storage does not persist ordinary `dict`, `list` or `set`, and
does not support a `DynArray` of dataclasses or dataclasses nested in
dataclasses. That shapes every model:

- **Collections are `TreeMap[str, T]`.** Claims, evidence, adjudications,
  challenges and attestations are all keyed by minted string ids.
- **Sequences of structured data are canonical JSON strings.** The
  per-claim evidence list, the adjudication buckets, and the evidence
  snapshot are stored as text and parsed on read. `_canon` gives one
  byte-exact encoding (sorted keys, no whitespace) so hashes reproduce.
- **Enums are stored as their `str` value**, and every value is a module
  constant, so a typo is a `NameError` at load rather than a silently
  false branch at runtime.
- **Counters and timestamps are `u256`.**

Identity is minted by the contract from monotonic sequences —
`claim_000001`, `ev_000002`, `adj_000001`, `chal_000001`, `att_000001`.
A frontend can never choose protocol identity, and Python object ids are
not stable across nodes.

## Module-level pure functions

`_canon`, `_clip`, `_sha256_hex`, `_classify_fetch`,
`_normalize_source_text`, `_build_prompt`, `_normalize_result`,
`_decision_fingerprint` and `_handle_leader_error` are module level, not
methods.

That is deliberate. They run inside non-deterministic closures, and a
closure that captured `self` would drag contract storage into a context
that must not read it. They receive plain data copied out of storage
beforehand.

## The adjudication path

```text
adjudicate(claim_id)
  │
  ├─ guards: state, evidence present
  ├─ copy storage into memory (claim text, evidence view, ids)
  ├─ hash the frozen snapshot
  │
  └─ gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        ├─ leader_fn:    fetch each URL → classify → normalise text
        │                → prompt → parse → _normalize_result
        └─ validator_fn: the same work, independently
                         → compare _decision_fingerprint
  │
  ├─ deterministic validation already applied by _normalize_result
  └─ THEN mutate state: store adjudication, classify each evidence
     record, set verdict, open the challenge window
```

The retrieval loop is duplicated in the two closures rather than shared.
`genvm-lint` requires every `gl.nondet.*` call to sit directly inside a
closure passed to `run_nondet_unsafe`; behind another call frame it
reports the call as unreachable from the equivalence block. The two
copies must stay identical — if the leader framed evidence differently
from the validators, rounds would fail for reasons unrelated to the
judgment.

## What the fingerprint compares

```text
claim_id · claim_version · verdict
         · supporting / contradicting / partially_supporting
         · irrelevant / outdated / unavailable   (each sorted)
```

`reason` is excluded. It is prose, and two validators reaching the
identical determination will not write the same paragraph; a fingerprint
that failed on that would be measuring vocabulary rather than judgment.

Everything included is a determination the protocol will actually record
and show. That is the rule: **require agreement on what has a
consequence, and only on that.**

## State safety

The ordering in §25 is the whole safety argument, and it is followed
literally:

```text
read state → copy to memory → nondeterministic evaluation
→ validator acceptance → deterministic validation → state mutation
```

An early draft violated it by setting `ADJUDICATING` inside `adjudicate`
just before the panel ran. A rejected answer then left the claim stranded
mid-round with no way to retry. The fix was to make `start_adjudication`
its own transaction: the in-flight state is still real and observable, but
`adjudicate` now mutates nothing until the panel has been accepted. A
refused round costs the claim nothing and can simply be run again.

## Frontend

Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4,
TanStack Query, genlayer-js, React Flow.

- `lib/genlayer/client.ts` — the only place chain, RPC and contract
  address are read. A missing address produces a stated error, never a
  fabricated default.
- `lib/genlayer/wallet.tsx` — EIP-6963 discovery. The official
  boilerplate reads `window.ethereum` and calls it MetaMask; §33 forbids
  that, and it is wrong anyway, because with two extensions installed
  that global is whichever won the injection race.
- `lib/contracts/attestia.ts` — one function per schema method, named as
  the contract names it, so the file lines up against
  `genlayer schema <address>`.
- `lib/hooks/useAttestia.ts` — a query per view; after a write the app
  refetches authoritative state rather than patching a local cache.

Three components enforce §59 structurally rather than by discipline:
`VerdictStamp` refuses to print anything for an empty verdict,
`RelationshipTag` styles and labels an assertion differently from a
finding, and `Lifecycle` derives every stage from contract state.
