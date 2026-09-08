# Deployment

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Python | 3.12 | the direct-test harness targets it |
| Node | 20+ | Next.js 16 |
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

Then point the app at it:

```bash
# frontend/.env.local
NEXT_PUBLIC_CONTRACT_ADDRESS=0x…
```

Redeploying and forgetting this is the classic failure: the app keeps
serving the old contract and every number on screen is quietly stale.

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
| Address | `0x1685CC12792e2cd275eadc7FbCfa63A8317152D3` |
| Deploy tx | `0x10cac1daaafb7e7f6f1a818e4d361bbf84401cd2d903fe0cca916e4b27a41870` |
| Consensus | 5 validators, 5 AGREE |
| Runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Source sha256 | `370a8905896abf472e6ca6f794321533a410ce4f852519d79cc15fa9b4a6f6d6` |

Byte-verified with `scripts/verify_deployment.py` against this source.
