/**
 * STEWARD FIX — multi-wallet signing tests (§11, §12).
 *
 * The steward's point was that a wallet appearing in the UI, connecting,
 * and showing its address proves nothing about which wallet SIGNS. These
 * tests exercise the actual write path: they build a GenLayer client the
 * same way the app does and assert which provider received the call.
 *
 * genlayer-js routes a fixed set of methods to a provider whenever the
 * configured account is an address string rather than a viem Account:
 *
 *     PROVIDER_METHODS = { eth_accounts, eth_requestAccounts,
 *                          eth_sendTransaction, eth_signTransaction,
 *                          personal_sign, eth_signTypedData_v4 }
 *     const provider = config.provider
 *       || (typeof window !== "undefined" ? window.ethereum : void 0);
 *
 * That fallback is the whole bug: omit `provider` and the library picks
 * `window.ethereum`, whoever that happens to be. `eth_accounts` is used
 * below because it is on that list and needs no network.
 *
 * Run: npm run test:wallet
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { writeClient } from "../lib/genlayer/client.ts";

const ADDR_A = "0xAAaAaA00000000000000000000000000000000aA";
const ADDR_B = "0xBbBBbB11111111111111111111111111111111bB";

interface Recorder {
  name: string;
  address: string;
  calls: string[];
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}

/** A minimal EIP-1193 provider that records what it was asked to do. */
function fakeWallet(name: string, address: string): Recorder {
  const calls: string[] = [];
  return {
    name,
    address,
    calls,
    async request({ method }: { method: string; params?: unknown }) {
      calls.push(method);
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [address];
        case "eth_chainId":
          return "0xf1cf";
        case "eth_sendTransaction":
        case "eth_signTransaction":
          return `0x${"11".repeat(32)}`;
        case "personal_sign":
        case "eth_signTypedData_v4":
          return `0x${"22".repeat(65)}`;
        default:
          return null;
      }
    },
  };
}

/** Put a wallet behind `window.ethereum`, as an extension would. */
function injectAsWindowEthereum(wallet: Recorder | null) {
  const g = globalThis as unknown as { window?: { ethereum?: unknown } };
  g.window = g.window ?? {};
  g.window.ethereum = wallet ?? undefined;
}

/** Ask through the client, and report who actually got it. */
async function whoAnswered(
  selected: Recorder,
  others: Recorder[],
): Promise<{ answered: string[]; result: unknown }> {
  const client = writeClient(selected.address, selected as never);
  const result = await client.request({ method: "eth_accounts" } as never);
  const answered = [selected, ...others]
    .filter((w) => w.calls.includes("eth_accounts"))
    .map((w) => w.name);
  return { answered, result };
}

// ═══ Test A — Provider A selected, B also available ═══════════════════════

test("Provider A selected: A signs, B is untouched", async () => {
  const a = fakeWallet("A", ADDR_A);
  const b = fakeWallet("B", ADDR_B);
  injectAsWindowEthereum(b); // B is the injected global — the trap

  const { answered, result } = await whoAnswered(a, [b]);

  assert.deepEqual(answered, ["A"], "only the selected wallet may be called");
  assert.deepEqual(result, [ADDR_A], "the account returned must be A's");
  assert.equal(b.calls.length, 0, "B must never see the request");
});

// ═══ Test B — Provider B selected, A also available ═══════════════════════

test("Provider B selected: B signs, A is untouched", async () => {
  const a = fakeWallet("A", ADDR_A);
  const b = fakeWallet("B", ADDR_B);
  injectAsWindowEthereum(a);

  const { answered, result } = await whoAnswered(b, [a]);

  assert.deepEqual(answered, ["B"]);
  assert.deepEqual(result, [ADDR_B]);
  assert.equal(a.calls.length, 0, "A must never see the request");
});

// ═══ Test C — the mandatory one (§11) ════════════════════════════════════

test("window.ethereum is A but B is selected: B signs", async () => {
  // This is the exact scenario the steward described, and the exact
  // scenario the old code got wrong: MetaMask injected as the global,
  // Rabby chosen in the picker.
  const metamask = fakeWallet("MetaMask", ADDR_A);
  const rabby = fakeWallet("Rabby", ADDR_B);
  injectAsWindowEthereum(metamask);

  const { answered, result } = await whoAnswered(rabby, [metamask]);

  assert.deepEqual(answered, ["Rabby"],
    "the selected wallet must sign, not the injected global");
  assert.deepEqual(result, [ADDR_B]);
  assert.equal(metamask.calls.length, 0,
    "window.ethereum must not be consulted once a wallet is selected");
});

// ═══ §12 — the signing request itself, and its sender ═════════════════════

test("the SIGNING request reaches the selected wallet, sent from its account", async () => {
  // Account lookup is not signing. This sends the method a write actually
  // ends in — eth_sendTransaction — and checks who was asked to sign it
  // and on whose behalf.
  const seen: Array<{ wallet: string; method: string; from?: string }> = [];
  const recording = (name: string, address: string): Recorder => {
    const base = fakeWallet(name, address);
    return {
      ...base,
      async request(args: { method: string; params?: unknown }) {
        const tx = Array.isArray(args.params) ? (args.params[0] as { from?: string }) : undefined;
        seen.push({ wallet: name, method: args.method, from: tx?.from });
        return base.request(args);
      },
    };
  };

  const metamask = recording("MetaMask", ADDR_A);
  const rabby = recording("Rabby", ADDR_B);
  injectAsWindowEthereum(metamask);

  const client = writeClient(rabby.address, rabby as never);
  const hash = await client.request({
    method: "eth_sendTransaction",
    params: [{ from: ADDR_B, to: "0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9", data: "0x" }],
  } as never);

  const signing = seen.filter((s) => s.method === "eth_sendTransaction");
  assert.equal(signing.length, 1, "exactly one signing request");
  assert.equal(signing[0].wallet, "Rabby", "the selected wallet was asked to sign");
  assert.equal(signing[0].from, ADDR_B, "and the transaction's sender is its account");
  assert.ok(!seen.some((s) => s.wallet === "MetaMask"),
    "the injected global saw nothing at all");
  assert.match(String(hash), /^0x[0-9a-f]{64}$/, "the selected wallet returned the hash");
});

// ═══ The regression this replaced ════════════════════════════════════════

test("omitting the provider is what fell back to window.ethereum", async () => {
  // Documents the original defect against the real library, so nobody
  // has to take the claim on trust — and so the fix cannot be quietly
  // reverted without this failing.
  const { createClient } = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");

  const metamask = fakeWallet("MetaMask", ADDR_A);
  injectAsWindowEthereum(metamask);

  const unfixed = createClient({
    chain: studionet,
    endpoint: "https://studio.genlayer.com/api",
    account: ADDR_B as `0x${string}`, // Rabby's address…
    // …and no provider, exactly as the old writeClient did.
  });
  const result = await unfixed.request({ method: "eth_accounts" } as never);

  assert.ok(metamask.calls.includes("eth_accounts"),
    "without an explicit provider the library reaches for window.ethereum");
  assert.deepEqual(result, [ADDR_A],
    "and it answers with the WRONG wallet's account");
});

// ═══ Fail closed ═════════════════════════════════════════════════════════

test("no provider means no client, never a silent fallback", () => {
  const metamask = fakeWallet("MetaMask", ADDR_A);
  injectAsWindowEthereum(metamask);

  assert.throws(
    () => writeClient(ADDR_B, undefined as never),
    /refusing to fall back to window\.ethereum/,
    "a missing provider must fail loudly rather than pick a wallet",
  );
  assert.equal(metamask.calls.length, 0);
});
