# Agent integration

Attestia is meant to be an evidence primitive for other software. An
autonomous agent should be able to answer "has this claim been settled,
and on what?" without understanding the frontend, and without trusting
it.

## The questions an agent can ask

| Question | Call |
|---|---|
| What was claimed? | `get_claim(claim_id)` |
| Which version is current? | `get_claim_verdict(claim_id).version` |
| What verdict? | `get_claim_verdict(claim_id).verdict` |
| Was it finalized? | `get_claim_verdict(claim_id).finalized` |
| How much evidence? | `get_claim_verdict(claim_id).evidence_count` |
| Was it challenged? | `get_claim_verdict(claim_id).challenge_count` |
| Which attestation represents the result? | `get_claim_verdict(claim_id).attestation_id` |
| Is that attestation actually valid? | `verify_attestation(attestation_id)` |
| How did it get here? | `get_claim_history(claim_id)` |

## The compact answer

`get_claim_verdict` exists for exactly this: one call, fixed shape, no
prose.

```json
{
  "claim_id": "claim_000005",
  "version": 1,
  "verdict": "SUPPORTED",
  "status": "FINALIZED",
  "finalized": true,
  "evidence_count": 1,
  "challenge_count": 0,
  "attestation_id": "att_000001"
}
```

`verdict` is `""` when no panel has ruled. That is not an oversight and
must not be read as a neutral result — it means there is no verdict. An
agent that treats `""` as anything other than "unknown" is inventing a
finding.

## Verification

Do not trust an attestation's own fields. Ask the contract to re-derive
them:

```json
verify_attestation("att_000001")

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

`valid: false` comes with a reason naming what failed — a missing
adjudication, a version that moved on, a verdict that does not match the
round it cites, a snapshot hash that does not line up. An unknown id
returns `valid: false, "no such attestation"` rather than raising, so a
caller cannot accidentally swallow the negative.

## Reading it from code

```python
from eth_account import Account
from genlayer_py import create_client
from genlayer_py.chains import studionet

# genlayer_py wants an account even for reads; a throwaway one signs nothing.
client = create_client(chain=studionet, account=Account.create())
ATTESTIA = "0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9"

def settled(claim_id: str):
    """Return (verdict, attestation_id) only when it is genuinely final."""
    answer = client.read_contract(
        address=ATTESTIA, function_name="get_claim_verdict", args=[claim_id])
    if not answer["finalized"]:
        return None

    check = client.read_contract(
        address=ATTESTIA, function_name="verify_attestation",
        args=[answer["attestation_id"]])
    if not check["valid"]:
        raise ValueError(f"attestation failed verification: {check['reason']}")

    return check["verdict"], check["attestation_id"]
```

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const client = createClient({ chain: studionet });

const answer = await client.readContract({
  address: ATTESTIA,
  functionName: "get_claim_verdict",
  args: [claimId],
});
```

Reads come back as JS `Map`s in genlayer-js, including nested values.
`frontend/lib/contracts/attestia.ts` has a `fromGenLayer` helper that
converts once at the boundary.

## Filing a claim programmatically

An agent can drive the whole lifecycle; nothing here is reserved for
humans.

```text
create_claim(claim_text, evidence_window_seconds)   → claim_id
open_claim(claim_id)
submit_evidence(claim_id, url, type, description, declared_relationship)
close_evidence(claim_id)
start_adjudication(claim_id)
adjudicate(claim_id)                                 → adjudication_id
                                                       (minutes: real panel)
finalize_claim(claim_id)                             → attestation_id
```

Two things to build around:

**`adjudicate` takes minutes.** It is retrieval plus a model call on
every validator, then consensus. Poll the claim state rather than
assuming.

**Deadlines run on real UTC seconds, and nobody can move them.** The
contract observes time through a validator round against a public clock;
there is no `advance_clock` and no way to set protocol time. An agent
waiting for a challenge window to close simply waits — `finalize_claim`
refuses until consensus reads a time past the deadline.

**`check_evidence_binding(evidence_id, content_digest)`** answers the
question an agent actually needs before trusting an attestation: is the
document I am holding the document the panel read? Canonicalise the
source the same way the contract does — strip `<script>`/`<style>`, drop
tags, collapse whitespace, truncate to 4000 characters — take sha256, and
compare.

## What the answer does and does not mean

An attestation says: *a GenLayer validator panel, reading this specific
frozen record, reached this verdict, and nothing has superseded it.*

It does not say the claim is true in the world, that the sources were
authentic, or that no better evidence exists. It names the record so a
consumer can look for themselves — which is the most an evidence
primitive should promise.

## Suggested consumption pattern

1. Call `get_claim_verdict`. If `finalized` is false, treat the claim as
   unresolved and stop.
2. Call `verify_attestation` on the id it returned. If `valid` is false,
   treat it as unresolved and surface the reason.
3. Use the verdict, and keep the `attestation_id` so your own output can
   be audited back to the record.
4. If the decision matters, read `get_claim_history` and look at what was
   contested and how the versions moved.
