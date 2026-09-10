# Deployment

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Python | 3.12 | the direct-test harness targets it |
| Node | 22.6+ | Next.js 16 builds on 20+; `npm test` needs `--experimental-strip-types` |
| GenLayer CLI | current | `npm i -g genlayer` |

```bash
pip install -r requirements.txt
```

## Seed the runner bundle first

```bash
python scripts/fetch_genvm_bundle.py
```

Neither `genvm-lint` nor `gltest` direct mode can run without the ~128 MB
GenVM runner bundle, and on a cold cache fetching it does not currently
work unaided: `gltest` 0.29.2 asks GitHub for
`<release>/genvm-universal.tar.xz`, but the v0.3.0-rc line renamed that
asset to `genvm-runners-all.tar.xz`, so the request 404s and every direct
test errors at import. (`genvm-linter` 0.11.0 already tries both names,
which is why the linter survives and only the tests fail.)

Both tools also treat "the file exists" as "the file is good", so an
interrupted download leaves a truncated archive that fails on every later
run until deleted by hand. The script verifies the archive before
installing it and moves it into place atomically. It is idempotent.

## Local development

```bash
genvm-lint check contracts/attestia.py --json
pytest tests/direct/ -q
```

On Windows, run with `PYTHONUTF8=1` — the linter reads files with the
system codec and this contract carries `§`, `—` and box drawing.

```bash
cd frontend
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_CONTRACT_ADDRESS
npm run dev                       # http://localhost:3150
npm run typecheck && npm run build
npm test                          # wallet, schema compatibility, config
```

```bash
python scripts/check_docs.py      # the docs describe one deployment, on chain
```

## Deploying

```bash
genlayer network set studionet
genlayer deploy --contract contracts/attestia.py
```

Do not pass `--rpc` to reach StudioNet. It overrides the endpoint but not
the chain id, and the deploy fails with `InvalidChainId`. Select the
network instead.

StudioNet is gasless. Bradbury and Asimov need funded accounts, and
funding is handled manually.

Never hardcode a private key, seed phrase or API secret. The CLI uses its
keystore; the live tests read one key from a gitignored `.env`.

## Verify what landed

```bash
genlayer schema <address>
genlayer call   <address> get_protocol_info
genlayer code   <address> > onchain.py
python scripts/verify_deployment.py onchain.py
```

`verify_deployment.py` turns the README's address from a claim into a
check. It normalises three things and nothing else — CRLF line endings,
the CLI's BOM and `Result:` banner, and trailing blank lines — then
demands the rest match byte for byte, comments included.

Then point the app at it — locally, and in the hosting environment:

```bash
# frontend/.env.local, and the Vercel project's Production environment
NEXT_PUBLIC_CONTRACT_ADDRESS=0x…
```

`NEXT_PUBLIC_*` values are inlined at build time, so changing the Vercel
variable does nothing until the project is **redeployed**. Redeploying the
contract and forgetting this is the classic failure, and it is exactly
what happened here — see below.

## Running the live suite

Needs one funded StudioNet account.

```bash
cp .env.example .env          # set ATTESTIA_KEY; .env is gitignored
```

Then add the accounts block to `gltest.config.yaml` under `studionet:`

```yaml
  studionet:
    accounts:
      - "${ATTESTIA_KEY}"
```

It is not committed with that block because gltest interpolates `${VAR}`
eagerly at config load — a placeholder in the committed file breaks
`pytest tests/direct/` for anyone who has not set the variable, and the
offline suite should need no setup at all.

```bash
gltest tests/integration -v -s --network studionet
```

Note that gltest loads `.env` with `override=True`, so
`ATTESTIA_SKIP_PANEL` in that file **beats** the same variable exported
in your shell. Set it in `.env`.

Expect roughly eight minutes: three of the seven tests drive real panel
rounds.

## Debugging a failed transaction

```bash
genlayer receipt <txHash> --stdout --stderr
genlayer schema  <address>
genlayer code    <address>
```

Read the error prefix before changing anything:

| Prefix | Means | Do |
|---|---|---|
| `EXPECTED:` | a business rule refused you | read the message; it names the rule |
| `EXTERNAL:` | a source answered badly | check the URL yourself |
| `TRANSIENT:` | temporary infrastructure | retry |
| `LLM_ERROR:` | the panel returned nothing usable | retry; the round consumed nothing |

Two traps worth knowing:

**`tx_execution_succeeded` reads the leader receipt only.** A round that
fails consensus can report SUCCESS while committing nothing. Always check
the resulting state — the live suite's `_run_panel` does exactly that and
prints the validator votes when the state has not moved.

**ACCEPTED is not success.** A transaction can be accepted and then
revert. The frontend inspects the execution result rather than the
transaction status.

## Three tooling notes

**`ContractFactory.deploy()` cannot bind this contract on a hosted
network.** It derives the ABI from `get_contract_schema_for_code`, which
`genlayer_py` refuses off localnet, and which hexes the source with
ASCII-only `eth_utils.encode_hex` — so the `§` and `—` in the comments
raise `UnicodeEncodeError` before the call leaves the machine.
`tests/integration/conftest.py` sends the deploy, then fetches the schema
the chain reports via `gen_getContractSchema`. Stripping characters out
of the source to satisfy a client bug would be the wrong repair.

**The public RPC drops connections.** TLS errors, resets and CDN 5xx
pages arrive mid-flight, including while polling a receipt — where
aborting strands an already-submitted transaction. The conftest patches
the provider transport to retry those and only those; a JSON-RPC error is
a real answer and is raised immediately.

**Verify the graph with a screenshot, not a DOM count.** React Flow
measures nodes with a ResizeObserver and does not create edges until
those measurements land — and measurement only happens while the document
is painting. An automated browser whose pane is not rendering will report
zero edges on a completely healthy graph.

## Current deployment

| | |
|---|---|
| Network | GenLayer StudioNet, chain id 61999 |
| Address | `0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9` |
| Deploy tx | `0x8c9eed482929d85c27fbaace153322ade457812c361a81578e18f76e5ae80d7e` |
| Consensus | 5 validators, 5 AGREE |
| Runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Source sha256 | `4b3d78cadc9fafd704f0ee6cc535d580350a5ba939d3458d9d9d2dc2cde00899` |

Byte-verified with `scripts/verify_deployment.py` against this source.
`scripts/check_docs.py` re-checks, against chain, that this table, the
README, the agent-integration example and `frontend/.env.example` all
describe this one deployment.

## Why production moved, and why it cannot move back

Two Attestia contracts exist on StudioNet. Only one satisfies the
protocol's security requirements, and deployed code cannot be changed, so
the choice between them is not a configuration preference.

| | `0x1685CC12…52D3` | `0x8d57088F…d1f9` |
|---|---|---|
| Code | byte-identical to commit `f6be234` (original build) | byte-identical to commit `fb328c3` (steward fix) |
| Code sha256 | `370a8905…a6f6d6` | `4b3d78ca…c2cde00899` |
| Methods | 23 | 24 |
| `advance_clock` — anyone sets the global clock | **present** | absent |
| Consensus-observed deadlines | no | yes |
| `create_claim` parameters | `claim_text, evidence_window_seconds` | `+ challenge_window_seconds` |
| Content-bound verdicts, `check_evidence_binding` | absent | present |

Reproduce every row:

```bash
genlayer code 0x1685CC12792e2cd275eadc7FbCfa63A8317152D3 > old.py
git show f6be234:contracts/attestia.py > f6be234.py
python scripts/verify_deployment.py old.py --source f6be234.py
genlayer schema 0x1685CC12792e2cd275eadc7FbCfa63A8317152D3
```

**What the production site was doing.** Its Vercel build still had
`NEXT_PUBLIC_CONTRACT_ADDRESS=0x1685CC12…`, while its code was the
post-fix frontend. Every read went to the pre-fix contract, and every
`create_claim` sent three arguments to a method that takes two. GenVM
raised a `TypeError` inside the contract, the transaction was accepted by
the network and its execution failed, and the frontend reported the
leader receipt's payload verbatim: `exit_code 1`.

Reproduced on chain with the current frontend's call shape, against a
throwaway deployment of the same bytes (`0xAc0d48F0…0dE5`, code sha256
`370a8905…a6f6d6`, identical to `0x1685CC12`) so that nothing was written
to the address under review. Transaction
`0xf6c9388a58774cac36ac0dc3357a15453323e0f9ee44ba8608080835cd084161`:
FINALIZED, MAJORITY_AGREE, leader execution `ERROR`, result payload
`exit_code 1`, and the leader's stderr ends in
`TypeError: Attestia.create_claim() takes from 2 to 3 positional arguments
but 4 were given`. The validators agreed, correctly, that the call fails.

It was not a wallet problem, a network or chain mismatch, a consensus
failure or a web-access failure; it was one environment variable naming
the wrong deployment, in a build that nothing checked against the chain.

**What now prevents a repeat.**

- `lib/contracts/compat.ts` reads the schema the chain reports for the
  configured address and compares it with every call this build makes.
  On a mismatch the app shows which methods are missing or take fewer
  arguments, and **refuses to open the wallet** — the user is told in
  words instead of signing a transaction that can only revert.
  `tests/compat.test.ts` runs that comparison against the real schemas of
  both addresses, captured from chain.
- Every address, chain id and RPC in the app resolves through
  `lib/genlayer/client.ts`; the chain id is read from the same chain
  object the clients are built with. `tests/config.test.ts` checks the
  requests that actually leave the app: reads and the signed write carry
  the same contract, over the same RPC, from the selected wallet.
- The footer of every page states the contract used for reads and
  writes, the network, chain and RPC, and the connected signer with the
  chain its wallet is on — checkable on the live site without dev tools.

**Moving production.** In the Vercel project, set Production
`NEXT_PUBLIC_CONTRACT_ADDRESS=0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9`,
redeploy, then confirm on the live site that the footer shows that
address and that no compatibility banner appears.

## Production lifecycle

`scripts/prove_lifecycle.py` drives one claim through the entire protocol
against the production contract, recording for every write the
transaction, the validators' decision, the execution result, finality,
and the state read back afterwards. The record is
[production-evidence.md](production-evidence.md); re-check it against the
network with:

```bash
python scripts/prove_lifecycle.py --verify docs/production-evidence.json
```
