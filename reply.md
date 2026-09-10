# Reply to the steward — round 2: production wiring

> Publish the frontend against the production contract
> `0x1685CC12792e2cd275eadc7FbCfa63A8317152D3`, diagnose and fix the actual
> execution failure, ensure production read/write/demo paths use the same
> deployed Intelligent Contract, and demonstrate one completed production
> lifecycle.

Everything below is in `a3a2431`.

**The short version.**

- `exit_code 1` was a split deployment. The live build still had
  `NEXT_PUBLIC_CONTRACT_ADDRESS=0x1685CC12…`, which is the **pre-fix**
  contract. Its code is byte-identical to the original commit `f6be234`.
  The post-fix frontend sent `create_claim` three arguments, and that
  contract's `create_claim` takes two. GenVM raised a `TypeError` inside
  the contract, and the frontend reported the result payload verbatim.
- `0x1685CC12` **cannot** be the production contract, and I've documented
  why instead of deploying around it (§23). It still exposes
  `advance_clock`, the caller-settable global clock that round 1 removed,
  and deployed code can't be changed. Pointing production at it would
  reinstate the vulnerability you asked me to fix. Production is
  `0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9`, the fixed contract. That
  was a decision, and this section is the record of it.
- One full lifecycle ran on `0x8d57088F`: 11 transactions, every one
  FINALIZED, ending in a verified attestation. Anyone can re-check the
  report against the chain with one command.
- One step remains, and it isn't mine to take: setting the Vercel
  variable and redeploying. Until the live site is checked after that
  redeploy, I don't claim it serves the right contract. See §8.

---

## 1. The two addresses

Every value in this table was read from chain.

| | `0x1685CC12…52D3` | `0x8d57088F…d1f9` |
|---|---|---|
| Network / chain | StudioNet, 61999 | StudioNet, 61999 |
| Deploy tx | `0x10cac1daaafb7e7f6f1a818e4d361bbf84401cd2d903fe0cca916e4b27a41870` | `0x8c9eed482929d85c27fbaace153322ade457812c361a81578e18f76e5ae80d7e` |
| Deployed | 2026-09-08 08:20 UTC | 2026-09-09 20:53 UTC |
| Code | = commit `f6be234` (original build) | = commit `fb328c3` (round-1 fix) |
| Code sha256 | `370a8905896abf472e6ca6f794321533a410ce4f852519d79cc15fa9b4a6f6d6` | `4b3d78cadc9fafd704f0ee6cc535d580350a5ba939d3458d9d9d2dc2cde00899` |
| Methods | 23 | 24 |
| `advance_clock` | **present** | absent |
| `create_claim` | `(claim_text, evidence_window_seconds)` | `(…, challenge_window_seconds)` |
| `check_evidence_binding`, `force_close_evidence` | absent | present |
| Accepts every call the current frontend makes | **no** | yes |
| What the live site targeted | this one | — |

Reproduce it:

```bash
genlayer code 0x1685CC12792e2cd275eadc7FbCfa63A8317152D3 > old.py
git show f6be234:contracts/attestia.py > f6be234.py
python scripts/verify_deployment.py old.py --source f6be234.py   # MATCH 370a8905…
python scripts/verify_deployment.py old.py                        # DIFFER from current source
genlayer schema 0x1685CC12792e2cd275eadc7FbCfa63A8317152D3        # advance_clock present
```

## 2. Why production is not `0x1685CC12`

Your request contains two requirements that one address can't meet
together. One is that production use `0x1685CC12`. The other is that
there be no caller-controlled clock (§10, §27), and the code at
`0x1685CC12` has one. §23 covers exactly this case: *"If the address
itself is invalid or incompatible, stop and document the evidence rather
than silently deploying a replacement against a different address."*

So I haven't deployed a replacement at all. `0x8d57088F` is the contract
from round 1, the one you reviewed, and it is byte-verified against this
repository. The owner chose it with this evidence in hand, and I'm stating
it here so the change isn't silent. If you still want `0x1685CC12`
specifically, the only way to make it work with this frontend is to
revert the frontend to the pre-fix code, and that brings back
`advance_clock`. I don't recommend it.

## 3. `exit_code 1`: the trace

I reproduced it on chain with the current frontend's exact call shape. I
used a throwaway deployment of the same bytes (`0xAc0d48F0…0dE5`, code
sha256 `370a8905…`, identical to `0x1685CC12`), so nothing was written to
the address under review.

```text
transaction        0xf6c9388a58774cac36ac0dc3357a15453323e0f9ee44ba8608080835cd084161
GenLayer tx id     same (Studio uses the hash as the id)
destination        0xAc0d48F0…0dE5  (same bytes as 0x1685CC12)
chain              61999
function           create_claim
arguments          ("Arity repro.", <evidence window>, <challenge window>)  — 3
status             FINALIZED   (decision taken, appeal window passed, not appealed)
consensus          MAJORITY_AGREE  (3 agree, 2 idle, of 5)
leader execution   ERROR
result payload     "exit_code 1"
leader stderr      TypeError: Attestia.create_claim() takes from 2 to 3
                   positional arguments but 4 were given
```

Stage by stage, the submission was accepted, a GenLayer transaction was
created, the leader executed it and the contract raised, the validators
agreed that it fails, and the transaction finalized as a failure. The
frontend's message was accurate. It was the call that was wrong.

What it was **not**: a wallet or signer problem, a network or chain-id
mismatch, a stale receipt, an Equivalence Principle or validator
rejection, a web-access failure, or LLM output parsing. It was one
environment variable naming the wrong deployment, in a build nothing
checked against the chain.

**What fixes it:** production pointing at `0x8d57088F` (§8). **What
prevents it recurring:** `lib/contracts/compat.ts` reads the schema the
chain reports for the configured address and compares it with every call
this build makes. On a mismatch the app names the missing methods or
missing arguments and **refuses to open the wallet**. The user gets the
problem in words instead of signing a transaction that can only revert.
`tests/compat.test.ts` runs that comparison against both addresses' real
schemas, captured from chain.

## 4. One production configuration (§6, §7, §23)

- Every address, chain id and RPC in the app resolves through
  `lib/genlayer/client.ts` (`productionConfig()`). Reads, writes, the
  schema check and transaction tracking all use it, and no other module
  holds a copy.
- **Found and fixed:** the wallet's chain id came from its own env var
  while the clients were built with `studionet`. A wallet could be
  switched to one chain while the transaction was built for another. The
  chain id is now read from the same chain object the clients use.
- `tests/config.test.ts` checks the requests that actually leave the app,
  not the constants. The `gen_call` of a read and the calldata of the
  signed write (`addTransaction(sender, recipient, …)`) carry the same
  contract, over the one RPC, signed by the selected wallet from its
  account. Changing the configured address moves reads and writes
  together. Five deliberate breakages (a divergent chain id, a second
  write address, a dropped provider, and two different RPCs) are each
  caught.
- Every page's footer now shows the contract used for reads and writes,
  the network, chain and RPC, and the connected signer with the chain its
  wallet is on. You can check the live site without dev tools.
- `scripts/prove_lifecycle.py` takes its target from
  `frontend/.env.example`. `scripts/check_docs.py` checks that README,
  the deployment doc, the agent example and the env example all name one
  deployment, that its deploy tx really created that address, and that its
  code is this repository's source. It fails on the documents as they
  stood before this round.

## 5. The production lifecycle

This ran on `0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9`, and every write
is recorded with its tx, decision, execution, finality and the state read
back afterwards. The full record is `docs/production-evidence.md`. Check
it yourself:

```bash
python scripts/prove_lifecycle.py --verify docs/production-evidence.json
# … REPORT MATCHES CHAIN
```

| Step | Function | Tx | Decision | Execution | Finality | State after |
|---|---|---|---|---|---|---|
| create | `create_claim` | `0x7ca5b5b5…cbae` | MAJORITY_AGREE | SUCCESS | FINALIZED | DRAFT v1 |
| open | `open_claim` | `0x63fde8d3…7e02` | MAJORITY_AGREE | SUCCESS | FINALIZED | OPEN v1 |
| evidence | `submit_evidence` | `0x1262a01b…2229` | MAJORITY_AGREE | SUCCESS | FINALIZED | OPEN v1, 1 source |
| freeze | `close_evidence` | `0x13c5638d…c8d9` | MAJORITY_AGREE | SUCCESS | FINALIZED | EVIDENCE_CLOSED |
| | `start_adjudication` | `0x6ef651bf…ead3` | MAJORITY_AGREE | SUCCESS | FINALIZED | ADJUDICATING |
| adjudicate | `adjudicate` | `0x01b0c653…1c9e` | MAJORITY_AGREE | SUCCESS | FINALIZED | ADJUDICATED v1 · SUPPORTED |
| challenge | `submit_challenge` | `0x25378b9d…3771` | MAJORITY_AGREE | SUCCESS | FINALIZED | CHALLENGED v2 |
| | `start_adjudication` | `0x657cd1ea…c465` | MAJORITY_AGREE | SUCCESS | FINALIZED | RE_ADJUDICATING v2 |
| re-adjudicate | `adjudicate` | `0xd7c8b57a…da54` | MAJORITY_AGREE | SUCCESS | FINALIZED | ADJUDICATED v2 · SUPPORTED |
| early finalize | `finalize_claim` | `0x9e14d02a…9841` | MAJORITY_AGREE | **ERROR** | FINALIZED | unchanged |
| finalize | `finalize_claim` | `0x32ff4b78…a278` | MAJORITY_AGREE | SUCCESS | FINALIZED | FINALIZED v2 · SUPPORTED |

The result is `att_000001`: SUPPORTED at v2, adjudication `adj_000002`,
content binding `8c693c2d19fc55cd958dc3bc9c656475396015119dd3a2da84a6db7331dd3bed`.
`verify_attestation` returns `valid: true`.

The early finalize is in the record on purpose. The validators read the
time themselves and the contract refused: *challenge window is open until
1789071574; consensus reads 1789071515*. It succeeded once the window had
actually closed.

**Steps in the request that Attestia does not have.** The prompt's
sequence (fund, accept, fulfill, settle) and its deductible tests describe
a protocol with escrow and payment. Attestia has neither. It holds no
funds, and it has no acceptance step, no fulfilment, no settlement and no
deductible, so no model output can change an amount it doesn't hold. I
haven't invented transactions to fill those rows. They are marked not
applicable here, and nothing more. The steps Attestia does have are all
in the table.

This run was signed by a key the script holds, through `genlayer_py`. It
proves the lifecycle through real consensus and real finality. It does
not pass through a browser wallet or the hosted site; §4's tests cover
the wallet path, and §8 covers the site.

## 6. Security verification (§29)

| Property | Proven by |
|---|---|
| time / lifecycle | `test_adversarial_time.py`: Bob can reach no method that moves Alice's deadlines, can't expire her evidence or challenge window, can't age her claim by being busy; no clock setter exists. Plus the clock tests in `test_validators.py`: a leader moving time ±days is refused, a validator reads the clock itself, and an unreadable clock fails closed. Live: the early-finalize refusal above. |
| provider selection | `wallet-provider.test.ts` (6): with `window.ethereum` = MetaMask and Rabby selected, Rabby receives the `eth_sendTransaction` and it is sent from Rabby's account; the old client is pinned answering with the wrong wallet. `config.test.ts`: the same on a real `createClaim` write. |
| evidence binding | `test_evidence_binding.py`: the digest is of what was read, it survives cosmetic differences, a changed source changes it, an unreadable source is bound to nothing, and the attestation carries the binding. |
| validator verification | `test_validators.py` (11), new this round. It replays the contract's **own** validator closures against the leader's result. A validator that read different bytes, reached a different ruling, or received a forged verdict or forged binding refuses. Reworded prose over the same findings still agrees, so the comparison is no stricter than it needs to be. |
| deductible | not applicable: Attestia stores and pays no amounts (§5) |
| challenge / re-adjudication | `test_lifecycle.py`: a challenge opens a new version without touching history and a re-adjudication produces a second verdict. Live: v1 → challenge → v2. |
| finalization | `test_lifecycle.py`: blocked inside the challenge window, mints one attestation, not repeatable. Live: refused early, then finalized. |

I broke each validator property in the contract on purpose: blind
acceptance, a widened tolerance, trusting the leader's clock, dropping the
binding from the fingerprint, comparing only the verdict, comparing the
prose, and agreeing to any leader failure. Each breakage fails at least
one of these tests (8/8). The contract was restored afterwards, and the
deployed bytes still match it.

## 7. A correction to round 1

Round 1's limitation 3 said validator disagreement *"cannot be staged
offline"*. That was wrong, and I should have checked it. gltest's direct
mode captures each non-deterministic block's validator function, and
`direct_vm.run_validator()` replays it against the leader's result with
swapped mocks. That is what `test_validators.py` now uses. A real
network's validators agreeing is still something only the network shows,
and the lifecycle above is that evidence.

## 8. Commands run, and what is left

```text
genvm-lint check contracts/attestia.py   passed — 24 methods (14 view, 10 write)
pytest tests/direct                      100 passed
npm test (frontend)                      17 passed — wallet 6, compat 5, config 6
tsc --noEmit                             clean
next build                               clean, 6 routes
scripts/check_docs.py                    DOCS CONSISTENT: one deployment, confirmed on chain
scripts/prove_lifecycle.py --verify      REPORT MATCHES CHAIN
```

**Left, and not claimed:** the hosted frontend. Its Production environment
needs `NEXT_PUBLIC_CONTRACT_ADDRESS=0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9`
and a redeploy, because `NEXT_PUBLIC_*` values are fixed at build time.
After that, the footer on every page should show that address, and no
compatibility banner should appear. I'll confirm both on the live site
before calling round 2 closed.

---

# Round 1 — security fixes

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
3. ~~**Validator disagreement still cannot be staged offline.**~~
   *Wrong — corrected in round 2, §7. `direct_vm.run_validator()` replays
   the contract's validator closure with swapped mocks;
   `tests/direct/test_validators.py` uses it.*
4. **A genuinely volatile page can no longer be attested to.** Nodes
   reading different bytes fail the round. That is fail-closed working as
   intended, but it is a behaviour change worth naming.
5. **Four consensus rounds per case** instead of one. That is the price of
   non-manipulable time on a runner with no timestamp primitive.
6. **Tests that asserted the old clock were rewritten, not patched.** They
   were asserting the vulnerability. Two new tests guard against the
   mechanism returning.
