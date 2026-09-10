"""Prove the deployed contract is the code in this repository.

    genlayer code <address> > onchain.py
    python scripts/verify_deployment.py onchain.py
    python scripts/verify_deployment.py onchain.py --source <other revision>

A README that names an address is a claim; this is what turns it into a
check anyone can repeat. The comparison normalises three things and
nothing else:

  * line endings — a Windows shell redirect rewrites LF as CRLF;
  * a UTF-8 BOM and the CLI's own "Result:" banner, which are printed
    around the code rather than stored on chain;
  * trailing blank lines.

Everything else must match byte for byte, including comments. If this
script says the bytes differ, the deployment does not match the source
and the README's address is stale.
"""
import hashlib
import pathlib
import sys

HEADER = '# { "Depends"'


def canonical(text: str) -> str:
    text = text.replace("\r\n", "\n").lstrip("﻿")
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line.startswith(HEADER):
            lines = lines[i:]
            break
    else:
        raise SystemExit("no runner header found — is this a GenLayer contract?")
    return "\n".join(lines).rstrip("\n") + "\n"


def main() -> int:
    # Optional `--source <file>` compares against another revision instead
    # of the working tree, e.g. `git show <commit>:contracts/attestia.py`.
    args = sys.argv[1:]
    source_path = None
    if len(args) == 3 and args[1] == "--source":
        source_path = pathlib.Path(args[2])
        args = args[:1]
    if len(args) != 1:
        print(__doc__)
        return 2

    root = pathlib.Path(__file__).resolve().parents[1]
    source_path = source_path or root / "contracts" / "attestia.py"
    source = canonical(source_path.read_text(encoding="utf-8"))
    onchain = canonical(pathlib.Path(args[0]).read_text(encoding="utf-8"))

    digest = hashlib.sha256(source.encode()).hexdigest()
    if source == onchain:
        print(f"MATCH   sha256 {digest}")
        print(f"        {len(source)} bytes, canonicalised")
        return 0

    import difflib
    print(f"DIFFER  source sha256 {digest}")
    print(f"        onchain sha256 {hashlib.sha256(onchain.encode()).hexdigest()}")
    diff = difflib.unified_diff(
        source.splitlines(), onchain.splitlines(), "source", "onchain", lineterm="", n=1)
    for line in list(diff)[:60]:
        print("   ", line[:120])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
