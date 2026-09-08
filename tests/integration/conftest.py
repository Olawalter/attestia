"""Deployment and transport helpers for the live suite.

`ContractFactory.deploy()` cannot bind this contract on a hosted network,
for two reasons that both live in the tooling rather than the contract:

  1. it derives the ABI with `get_contract_schema_for_code`, which
     `genlayer_py` refuses on any chain that is not localnet;
  2. that same call hexes the source with `eth_utils.encode_hex`, which
     is ASCII-only — and `contracts/attestia.py` carries `§`, `—` and box
     drawing in its comments, so the call raises UnicodeEncodeError
     before it ever reaches the network.

Neither is a reason to strip characters out of the source. The schema the
tests want is the one the CHAIN reports for the deployed address, which
`gen_getContractSchema` returns happily — and binding to that is the more
honest thing to test against anyway, since it describes what is deployed
rather than what the local file would compile to.
"""
import importlib
import json
import pathlib
import time
import urllib.error
import urllib.request

import pytest

from gltest import get_contract_factory, get_default_account
from gltest.assertions import tx_execution_succeeded
from gltest.contracts.contract import Contract
from gltest_cli.config.general import get_general_config

# The simulator endpoint refuses requests without a browser-shaped agent.
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def rpc_url() -> str:
    return get_general_config().get_rpc_url()


def rpc(method: str, params: list, timeout: int = 120) -> dict:
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        rpc_url(), data=body,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def fetch_schema(address: str, attempts: int = 12, delay: int = 10) -> dict:
    """Poll until the chain reports a schema for the address.

    A freshly accepted deploy is not instantly queryable on a hosted
    network, so this waits for the thing that is genuinely not ready
    instead of treating the first miss as a failure.
    """
    last = None
    for attempt in range(attempts):
        try:
            out = rpc("gen_getContractSchema", [address])
            schema = out.get("result")
            if isinstance(schema, dict) and schema.get("methods"):
                return schema
            last = json.dumps(out)[:200]
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            last = f"{type(err).__name__}: {err}"
        print(f"  schema not ready ({attempt + 1}/{attempts}): {last}")
        time.sleep(delay)
    raise AssertionError(f"no schema for {address} after {attempts} attempts: {last}")


def deploy_attestia() -> Contract:
    """A fresh disposable Attestia, bound to its on-chain schema.

    Retried across transient transport failures. A retry can at worst
    leave an extra disposable instance behind; it cannot duplicate a
    state change on the one under test, because the retry happens before
    any state exists.
    """
    factory = get_contract_factory("Attestia")

    address = None
    last = None
    for attempt in range(4):
        try:
            receipt = factory.deploy_contract_tx(args=[], consensus_max_rotations=3)
            assert tx_execution_succeeded(receipt), "deploy transaction reverted"
            data = receipt.get("data") or {}
            address = data.get("contract_address") or receipt.get("contract_address")
            assert address, f"no contract address in receipt: {str(receipt)[:200]}"
            print(f"\ndeployed disposable Attestia at {address}")
            break
        except Exception as err:      # noqa: BLE001 — transport errors vary
            last = err
            print(f"deploy attempt {attempt + 1} failed: {str(err)[:200]}")
            time.sleep(20)
    if address is None:
        raise last

    return Contract.new(address=address, schema=fetch_schema(address),
                        account=get_default_account())


# ── transport resilience ────────────────────────────────────────────────
#
# The public simulator RPC drops connections mid-flight: TLS record
# errors, resets, the occasional CDN 5xx served as HTML. Left alone these
# surface as protocol failures they are not — and worse, aborting while
# polling a receipt STRANDS a transaction that was already submitted.
#
# The retry sits at the transport boundary so it covers reads, receipt
# polling and submission alike. Re-broadcast is safe: the raw transaction
# is already signed, so its nonce and hash are fixed, and a node that saw
# the first copy answers the second with the same hash.
#
# Only TRANSPORT failures retry. An RPC that answers with a JSON-RPC
# error — a revert, a bad parameter — is a real answer and is raised
# immediately, because retrying it would only hide it.
TRANSIENT = (
    "SSL", "Max retries exceeded", "Connection aborted", "Connection reset",
    "Read timed out", "Remote end closed", "RemoteDisconnected",
    "Temporary failure", "timed out",
    "returned invalid JSON", "<!DOCTYPE html>", "Bad gateway",
    "502", "503", "504",
)

_ATTEMPTS = 6


def _install_transport_retry() -> None:
    provider = importlib.import_module("genlayer_py.provider.provider")
    if getattr(provider.GenLayerProvider, "_attestia_retry_installed", False):
        return

    original = provider.GenLayerProvider.make_request

    def make_request(self, method, params):
        last = None
        for attempt in range(_ATTEMPTS):
            try:
                return original(self, method, params)
            except Exception as err:      # noqa: BLE001 — provider wraps everything
                text = str(err)
                if not any(marker in text for marker in TRANSIENT):
                    raise
                last = err
                wait = 3 * (attempt + 1)
                print(f"  transient RPC on {method} "
                      f"({attempt + 1}/{_ATTEMPTS}), retrying in {wait}s")
                time.sleep(wait)
        raise last

    provider.GenLayerProvider.make_request = make_request
    provider.GenLayerProvider._attestia_retry_installed = True


_install_transport_retry()


def revert_reason(receipt) -> str:
    """Pull the contract's own rollback message out of a receipt.

    A bare `assert tx_execution_succeeded(...)` says a write failed and
    nothing about why, which turns every rule the contract enforces into
    a guessing game. The contract already answers the question.
    """
    try:
        leader = (receipt.get("consensus_data") or {}).get("leader_receipt")
        entry = leader[0] if isinstance(leader, list) else leader
        payload = (entry.get("result") or {}).get("payload")
        if isinstance(payload, str) and payload.strip():
            return payload.strip()
        if isinstance(payload, dict):
            return str(payload.get("message") or payload)[:400]
        return str(entry.get("execution_result") or "")[:400]
    except Exception:      # noqa: BLE001 — receipts vary between networks
        return str(receipt)[:400]


def consensus_summary(receipt) -> str:
    """Validator votes, for when a round does not land."""
    try:
        data = receipt.get("consensus_data") or {}
        return (f"status={receipt.get('status_name') or receipt.get('status')} "
                f"votes={data.get('validator_votes_name')}")
    except Exception:      # noqa: BLE001
        return "consensus data unavailable"


def must_succeed(receipt, what: str):
    """Assert a write landed, and say what the contract objected to if not.

    `tx_execution_succeeded` reads the LEADER receipt, so it can report
    SUCCESS for a round that failed consensus and committed nothing.
    Callers that depend on committed state must check the state too.
    """
    assert tx_execution_succeeded(receipt), (
        f"{what} failed: {revert_reason(receipt)} | {consensus_summary(receipt)}")
    return receipt


def must_fail(receipt, what: str) -> str:
    assert not tx_execution_succeeded(receipt), f"{what} unexpectedly succeeded"
    return revert_reason(receipt)


def read(contract, view: str, args: list):
    value = getattr(contract, view)(args=args).call()
    return json.loads(value) if isinstance(value, str) else value


@pytest.fixture(scope="module")
def contract():
    return deploy_attestia()
