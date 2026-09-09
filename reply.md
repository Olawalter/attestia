# Reply to the steward

> Please replace the caller-controlled global clock with a non-manipulable
> time or lifecycle mechanism and add adversarial tests proving that no
> account can prematurely expire another claim's evidence or challenge
> window. Also pass the selected EIP-6963 provider into the GenLayer write
> client and verify the multi-wallet signing path; for trustworthy
> attestations, bind each verdict to the fetched content or an
> authenticated source record.

All three were real. Each is fixed in `fb328c3`, and each was verified
against the thing itself rather than against my assumption about it —
the runner for the clock, the library source for the wallet, a live
validator panel for the result.

**Deployment of record:** `0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9`
(StudioNet, byte-verified against the pushed source with
`scripts/verify_deployment.py`).

---

## 1. The clock

### What was wrong

Worse than reported. There were two paths, not one.

**Direct.** `protocol_clock` was a single global counter and
`advance_clock(seconds)` was `@gl.public.write` with no caller check. Any
funded account could push the clock past any other account's deadline.

**Incidental.** Every write called `_tick(1)`. Ordinary activity on one
claim aged every other claim in the contract — an attacker did not even
need `advance_clock`, only to be busy. That is the part I had not seen
until the audit, and it is why the fix had to remove the shared counter
rather than just gate the setter.

The original design note argued the clock was permissionless "because a
deadline nobody can reach is not a deadline". The liveness concern was
real; the conclusion was wrong. Reachability does not require that
*anyone can choose the answer*.

### What replaced it

No settable clock exists. `_observe_time()` runs a non-deterministic
round: the leader reads a public time source, **every validator reads it
independently**, and the round lands only if the readings agree within
`CLOCK_TOLERANCE` (300s). Readings outside `CLOCK_FLOOR..CLOCK_CEIL` are
refused outright, so a broken or hostile source cannot date a case to
1970 or 2200.

Tolerance rather than equality is deliberate: two honest nodes never read
the same instant, and demanding an exact match would fail every round for
a reason unrelated to honesty.

Time is consulted at exactly three points:

| Where | Why it needs a clock |
|---|---|
| `open_claim` | anchors `opened_at` and the evidence deadline — creator-only, so nobody else starts or shortens your window |
| `adjudicate` | dates the verdict, which sets the challenge deadline |
| `finalize_claim`, `force_close_evidence` | the only two actions that can end someone else's window |

`submit_evidence` and `submit_challenge` read no clock at all. The
evidence window bounds how long the record stays open and is enforced at
close; a challenge is admissible until the claim finalizes, and
finalization is itself consensus-gated. So a challenger cannot be shut
out early by anyone's transaction — the guarantee moved from *"the clock
says you are late"* to *"nobody could have ended your window early"*.

`created_at`/`updated_at` became `created_seq`/`updated_seq`, because they
were only ever ordering and a name that looks like a timestamp invites
the next reader to treat it as one.

### On the choice of mechanism

An authoritative runner timestamp would have been simpler, and it does
not exist here. `gl.vm.get_timestamp()` is documented for v0.3.0 but is
absent from the std lib the pinned runner bundles, and `gl.message`
carries only `contract_address`, `sender_address`, `origin_address`,
`value`, `chain_id` — no `datetime`. Both were checked by extracting the
runner from the bundle, and v0.3.0-rc7 is the newest release available.

### One deliberate change of terms

The challenge window is now a **per-claim term set at creation**
(`MIN_CHALLENGE_WINDOW` 60s, default 3 days) rather than a global
constant. The creator chooses it before anyone knows what the verdict
will be, it is frozen at creation, and nobody — creator included — can
shorten it afterwards. This also makes the window testable live: a run
can now wait one out honestly, which is how the evidence below was
produced.

---

## 2. The wallet

### What was wrong

`writeClient` accepted the selected provider and discarded it. The
parameter was named `_provider`, and the docstring asserted that
genlayer-js "routes signing through the injected provider". That was my
assumption, never verified.

The library's own source says otherwise:

```js
const provider = config.provider
  || (typeof window !== "undefined" ? window.ethereum : void 0);
```

Omitting `provider` falls back to `window.ethereum` — whichever extension
won the injection race. So a user could select Rabby in the picker and
have MetaMask sign. Discovery, selection and display were all correct;
the one step that mattered was not.

### What changed

`config.provider` is a supported field. It is now passed explicitly, and
a missing provider throws rather than falling back:

```ts
if (!provider) {
  throw new Error(
    "No wallet provider supplied — refusing to fall back to window.ethereum.");
}
```

### How signing was verified

`npm run test:wallet` (5 passed) drives the real library with two
recording providers:

| Test | Asserts |
|---|---|
| A selected, B injected | A receives the call; B's call log is empty |
| B selected, A injected | B receives the call; A's call log is empty |
| **`window.ethereum` = A, selected = B** | **B signs** — the case you named |
| old client reconstructed | answers with the **wrong** wallet's account |
| no provider supplied | throws; the injected wallet is never consulted |

The fourth test is the one I would point at. It rebuilds a client the old
way and asserts it returns MetaMask's address while Rabby was selected —
so the defect is pinned in executable form rather than described, and the
fix cannot be quietly reverted without that test failing.

---

## 3. Evidence binding

### What was wrong

`evidence_snapshot_hash` covered the evidence **record** — ids, urls,
source types, descriptions, declared relationships. The fetched content
was never hashed. A verdict was therefore bound to the paperwork, and the
source could change afterwards with the verdict still standing over it.

Validators compared decision fingerprints, but the fingerprint described
only the *conclusion*. A leader that reached a plausible verdict over the
wrong document matched a validator that read the right one.

### What changed

Every node digests the canonical text it retrieved and the map of
`evidence_id → (retrieval, digest)` goes **inside the decision
fingerprint**:

```
source → fetched content → canonical text → sha256
       → adjudication → verdict + binding
```

Canonicalisation (§15) strips `<script>`/`<style>`, drops tags, collapses
whitespace and truncates at 4000 characters — enough that formatting
differences do not split honest nodes, not so much that meaning is
normalised away. A test re-implements that rule independently rather than
importing it, because a test that reuses the implementation it checks
proves only that the code equals itself.

Consequences:

- a verdict names the bytes it rests on, on the adjudication record and
  on each piece of evidence;
- validators that read different bytes **cannot agree at all**, so a
  source substituted between leader and validator fails the round;
- an unreadable source is bound to nothing — empty digest, no
  relationship, and `verify_attestation` reports an attestation carrying
  no binding as invalid rather than valid;
- `check_evidence_binding(evidence_id, digest)` is a public view, so
  anyone holding a document can ask whether it is the document the panel
  read.

A verdict over content X can no longer be presented as a verdict over
modified content Y: Y hashes differently and the contract says so.

---

## Adversarial tests

Alice owns the claim. Bob is an ordinary funded account with the whole
public surface available — the threat is a legitimate user, not a
stranger who cannot reach the contract.

| Test | Proves |
|---|---|
| `test_bob_has_no_reachable_method_that_moves_alices_deadlines` | sweeps **every** public write Bob can reach and asserts Alice's lifecycle state is byte-identical afterwards |
| `test_the_clock_setter_does_not_exist` | `advance_clock`/`set_time`/`set_timestamp`/`tick` are absent from the surface |
| `test_bob_cannot_expire_alices_evidence_window` | window stays open, deadline unchanged, and Alice can still file |
| `test_bob_cannot_expire_alices_challenge_window` | Bob cannot force finalization; Alice's right to contest survives |
| `test_bob_cannot_shorten_the_window_by_being_busy` | the incidental attack — Bob runs six of his own claims; Alice's deadlines do not move |
| `test_claims_share_no_mutable_lifecycle_state` | Claim B runs its whole life to FINALIZED; Claim A is untouched |
| `test_legitimate_expiry_still_happens` | after the real window elapses, a stranger *can* close a stalled claim and the case proceeds to a verified attestation |
| `test_finalization_waits_for_the_real_deadline` | the deadline binds the owner too — it is a rule, not a permission |

The sweep is written to walk the write surface rather than name the one
function that used to be dangerous, so a future clock-ish method is
caught by the existing test.

Evidence tampering is covered by nine more in `test_evidence_binding.py`,
including cosmetic-difference stability, changed-source divergence, and
the unreadable-source fail-closed path.

---

## Verification

```
genvm-lint check      ok — 24 methods (14 view, 10 write)
pytest tests/direct   89 passed        (was 71)
npm run test:wallet   5 passed
gltest integration    7 passed on StudioNet, real panel, 11m09s
tsc --noEmit          clean
next build            clean, 6 routes
```

The live run is the part worth reading. The consensus clock refused an
early finalize and then allowed it once the window had genuinely closed:

```
early finalize refused: EXPECTED: challenge window is open until 1788988241;
                        consensus reads 1788988146
waiting 107s for the challenge window to actually close
→ PASSED
```

That is a validator panel independently reading the real time, comparing
it to a stored deadline, and refusing a transaction 95 seconds early —
against a deployment where no account has any way to influence the
answer.

---

## Your five questions

> Can Bob cause Alice's evidence window to expire early?

**No.** `close_evidence` is creator-only; `force_close_evidence` must
prove the deadline passed against consensus. Both asserted.

> Can Bob cause Alice's challenge window to expire early?

**No.** Only finalization ends it, and finalization is consensus-gated.
Challenges are admissible until the claim finalizes, so there is no clock
to race.

> If Rabby is selected while MetaMask is also injected, which wallet signs?

**Rabby.** Asserted directly, with the old behaviour pinned alongside it.

> Can a verdict for content X later be presented as a trustworthy verdict
> for modified content Y?

**No.** Y hashes differently, `check_evidence_binding` reports the
mismatch, and the binding is part of the fingerprint the round was
accepted on.

> Can a leader submit a valid-looking but source-inconsistent verdict and
> have it accepted without independent verification?

**No.** Validators re-run the retrieval and the prompt, and compare a
fingerprint that now includes what each of them read.

---

## Limitations

Stated because they are real, not to hedge.

1. **The time source is now the dependency.** A compromised source that
   fooled every validator simultaneously could shift a deadline by more
   than the tolerance. Readings are range-checked and cross-validated,
   which bounds the exposure without removing it. This is a smaller and
   more visible trust assumption than a public setter, not zero.
2. **The stored timestamp is the leader's, within tolerance.** Validators
   confirm it is a real reading; they do not force it to the second. A
   leader can jitter a recorded time by up to five minutes.
3. **Validator disagreement still cannot be staged offline.** `mock_llm`
   answers leader and validators identically, so the binding tests prove
   the *input* to the comparison; live rounds prove agreement. I have not
   claimed a direct test demonstrates rejection.
4. **A genuinely volatile page can no longer be attested to.** Nodes
   reading different bytes fail the round. That is fail-closed working as
   intended, but it is a behaviour change worth naming.
5. **Four consensus rounds per case** instead of one. That is the price of
   non-manipulable time on a runner with no timestamp primitive.
6. **Tests that asserted the old clock were rewritten, not patched.** They
   were asserting the vulnerability. Two new tests guard against the
   mechanism returning.
