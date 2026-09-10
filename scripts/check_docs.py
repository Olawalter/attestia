"""Prove the published deployment facts agree with each other AND with chain.

    python scripts/check_docs.py

WHY. An earlier doc update replaced the contract address and left the old
deployment's transaction hash and source hash beside it. Each value was
individually "real" — they just belonged to two different contracts. A
reader who verified the hash would have concluded the wrong address was
live. Nothing flagged it, because nothing checked that the facts on the
page describe ONE deployment.

This does. For every place a deployment is described it checks:

  1. the address, deploy tx and source hash agree across README, the
     deployment doc, the agent-integration example and the frontend's
     example env (which `prove_lifecycle.py` also reads its target from);
  2. the deploy tx's recipient IS that address (read from chain);
  3. the code at that address hashes to the stated source hash;
  4. the stated source hash is the hash of contracts/attestia.py.

Any mismatch exits non-zero with the exact disagreement.
"""
import base64
import hashlib
import json
import pathlib
import re
import sys
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
HEADER = '# { "Depends"'

ADDR = re.compile(r"0x[0-9a-fA-F]{40}")
TX = re.compile(r"0x[0-9a-f]{64}")
SHA = re.compile(r"\b[0-9a-f]{64}\b")


def rpc(method, params):
    req = urllib.request.Request(
        RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                              "params": params}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA})
    out = json.load(urllib.request.urlopen(req, timeout=90))
    if "error" in out:
        raise SystemExit(f"RPC {method} failed: {out['error']}")
    return out["result"]


def canon(text: str) -> str:
    text = text.replace("\r\n", "\n").lstrip("﻿")
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line.startswith(HEADER):
            lines = lines[i:]
            break
    return "\n".join(lines).rstrip("\n") + "\n"


def sha(text: str) -> str:
    return hashlib.sha256(canon(text).encode("utf-8")).hexdigest()


def field(text: str, label: str, pattern: re.Pattern) -> str | None:
    """The first value of `pattern` on a line mentioning `label`."""
    for line in text.splitlines():
        if label.lower() in line.lower():
            m = pattern.search(line)
            if m:
                return m.group(0)
    return None


def main() -> int:
    readme = (REPO / "README.md").read_text(encoding="utf-8")
    deploy = (REPO / "docs" / "deployment.md").read_text(encoding="utf-8")
    envex = (REPO / "frontend" / ".env.example").read_text(encoding="utf-8")
    agent = (REPO / "docs" / "agent-integration.md").read_text(encoding="utf-8")

    stated = {
        "README": {
            "address": field(readme, "- Contract:", ADDR),
            "deploy_tx": field(readme, "Deploy tx", TX),
            "source_sha": field(readme, "Source sha256", SHA),
        },
        "docs/deployment.md": {
            "address": field(deploy, "| Address", ADDR),
            "deploy_tx": field(deploy, "Deploy tx", TX),
            "source_sha": field(deploy, "Source sha256", SHA),
        },
        "frontend/.env.example": {
            "address": field(envex, "NEXT_PUBLIC_CONTRACT_ADDRESS", ADDR),
        },
        "docs/agent-integration.md": {
            "address": field(agent, "ATTESTIA =", ADDR),
        },
    }
    problems = []

    # 1. every document describes the same deployment
    for key in ("address", "deploy_tx", "source_sha"):
        values = {doc: v[key] for doc, v in stated.items() if key in v}
        if None in values.values():
            problems.append(f"{key} not found in: "
                            f"{[d for d, v in values.items() if v is None]}")
        distinct = {str(v).lower() for v in values.values() if v}
        if len(distinct) > 1:
            problems.append(f"{key} disagrees across documents: {values}")

    address = stated["README"]["address"]
    tx = stated["README"]["deploy_tx"]
    claimed = stated["README"]["source_sha"]

    # 2. the deploy tx deployed THIS address
    if tx:
        t = rpc("eth_getTransactionByHash", [tx]) or {}
        recipient = (t.get("to_address") or t.get("recipient") or t.get("to") or "")
        if recipient.lower() != str(address).lower():
            problems.append(f"deploy tx {tx[:18]}… was sent to {recipient}, "
                            f"not the stated address {address}")

    # 3. the code at the address is the stated source
    if address:
        onchain = base64.b64decode(rpc("gen_getContractCode", [address])).decode("utf-8")
        if sha(onchain) != claimed:
            problems.append(f"code at {address} hashes to {sha(onchain)}, "
                            f"docs say {claimed}")

    # 4. and the stated source is what this repository holds
    local = sha((REPO / "contracts" / "attestia.py").read_text(encoding="utf-8"))
    if local != claimed:
        problems.append(f"contracts/attestia.py hashes to {local}, docs say {claimed}")

    print(f"address    {address}")
    print(f"deploy tx  {tx}")
    print(f"source     {claimed}")
    if problems:
        print("\nDOCS DO NOT DESCRIBE ONE DEPLOYMENT:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\nDOCS CONSISTENT: one deployment, confirmed on chain, matching this source.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
