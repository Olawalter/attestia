/**
 * STEWARD §6, §7, §23 — one production configuration, and proof that
 * reads, writes and the wallet all resolve through it.
 *
 * Asserting on constants would prove only that the constants agree. These
 * tests watch the requests that actually leave the app — the JSON-RPC
 * bodies sent to the network and the signing request handed to the wallet
 * — and check the address, chain and RPC inside them.
 *
 * What a GenLayer write looks like on the wire (observed, not assumed):
 * the wallet signs an `eth_sendTransaction` to the CONSENSUS contract, and
 * the Intelligent Contract is the second argument of its calldata
 * (`addTransaction(sender, recipient, …)`). So "writes target the
 * contract" means: that recipient word equals the configured address.
 *
 * Run: npm run test:config
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const PRODUCTION = "0x8d57088F8054c715DD0b0E9D396F61CA1826d1f9";
const OTHER = "0x1685CC12792e2cd275eadc7FbCfa63A8317152D3";
const SELECTED = "0xbbbbbb11111111111111111111111111111111bb";
const DECOY = "0xaaaaaa00000000000000000000000000000000aa";

process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = PRODUCTION;

// ─── the network, recorded ─────────────────────────────────────────────
interface RpcCall { url: string; method: string; params: unknown[] }
const rpc: RpcCall[] = [];
const ANSWERS: Record<string, unknown> = {
  eth_getTransactionCount: "0x0",
  eth_estimateGas: "0x5208",
  eth_gasPrice: "0x1",
};
globalThis.fetch = (async (url: string | URL, init?: { body?: string }) => {
  const body = JSON.parse(init?.body ?? "{}");
  const batch = Array.isArray(body) ? body : [body];
  const out = batch.map((c: { id: number; method: string; params: unknown[] }) => {
    rpc.push({ url: String(url), method: c.method, params: c.params });
    return { jsonrpc: "2.0", id: c.id, result: ANSWERS[c.method] ?? null };
  });
  return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]),
    { headers: { "content-type": "application/json" } });
}) as typeof fetch;

// ─── wallets, recorded ─────────────────────────────────────────────────
interface Signed { wallet: string; from: string; to: string; data: string }
function wallet(name: string, account: string, signed: Signed[]) {
  return {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0xf1cf";
      if (method === "eth_sendTransaction") {
        const tx = (params?.[0] ?? {}) as { from: string; to: string; data: string };
        signed.push({ wallet: name, from: tx.from, to: tx.to, data: tx.data });
        // Decline after recording: everything up to the signature is real,
        // and nothing waits on a network that is not there.
        throw Object.assign(new Error("declined"), { code: 4001 });
      }
      return null;
    },
  };
}

/** `addTransaction(sender, recipient, …)`: 4-byte selector, then 32-byte words. */
function calldataWord(data: string, index: number): string {
  const word = data.slice(2 + 8 + index * 64, 2 + 8 + (index + 1) * 64);
  return `0x${word.slice(24)}`;
}

const client = await import("../lib/genlayer/client.ts");
const api = await import("../lib/contracts/attestia.ts");
const { studionet } = await import("genlayer-js/chains");

async function readAndWrite() {
  rpc.length = 0;
  const signed: Signed[] = [];
  const g = globalThis as unknown as { window?: { ethereum?: unknown } };
  g.window = { ethereum: wallet("injected-decoy", DECOY, signed) };

  await api.getClaim("claim_000001").catch(() => undefined);
  const read = rpc.find((c) => c.method === "gen_call");

  const result = await api.createClaim("a claim", 0, 0, {
    account: SELECTED,
    provider: wallet("selected", SELECTED, signed) as never,
  });
  return { read, signed, result, calls: [...rpc] };
}

// ═══ one chain ════════════════════════════════════════════════════════════

test("the wallet and both GenLayer clients are on one chain", () => {
  const w = client.writeClient(SELECTED, wallet("selected", SELECTED, []) as never);
  assert.equal(client.CHAIN_ID, studionet.id, "chain id comes from the client's chain object");
  assert.equal(client.readClient().chain?.id, client.CHAIN_ID, "read client");
  assert.equal(w.chain?.id, client.CHAIN_ID, "write client");
  assert.equal(client.NETWORK_PARAMS.chainId, client.CHAIN_ID_HEX,
    "the chain the wallet is asked to switch to");
  assert.equal(client.CHAIN_ID_HEX, `0x${studionet.id.toString(16)}`);
  assert.deepEqual(client.NETWORK_PARAMS.rpcUrls, [client.RPC_URL],
    "the RPC the wallet is given is the RPC the clients use");
});

test("productionConfig() reports the same values the clients use", () => {
  const cfg = client.productionConfig();
  assert.equal(cfg.contractAddress, PRODUCTION);
  assert.equal(cfg.chainId, client.CHAIN_ID);
  assert.equal(cfg.rpc, client.RPC_URL);
  assert.equal(cfg.network, studionet.name);
});

// ═══ one contract, for reads and writes ══════════════════════════════════

test("reads and writes reach the SAME contract, over the configured RPC", async () => {
  const { read, signed, calls } = await readAndWrite();

  assert.ok(read, "the read produced a gen_call");
  assert.equal((read.params[0] as { to: string }).to, PRODUCTION, "read target");

  assert.equal(signed.length, 1, "exactly one signing request");
  assert.equal(calldataWord(signed[0].data, 1), PRODUCTION.toLowerCase(),
    "write target — the recipient inside addTransaction");

  const urls = new Set(calls.map((c) => c.url));
  assert.deepEqual([...urls], [client.RPC_URL], "every request went to the one RPC");
});

test("the write is signed by the SELECTED wallet, from its account", async () => {
  const { signed, result } = await readAndWrite();

  assert.equal(signed[0].wallet, "selected", "window.ethereum was not asked to sign");
  assert.equal(signed[0].from.toLowerCase(), SELECTED, "transaction sender");
  assert.equal(calldataWord(signed[0].data, 0), SELECTED, "sender inside addTransaction");
  assert.equal(result.phase, "rejected", "a declined signature is reported as declined");
});

test("changing the one configured address moves reads AND writes together", async () => {
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = OTHER;
  try {
    const { read, signed } = await readAndWrite();
    assert.equal((read!.params[0] as { to: string }).to, OTHER);
    assert.equal(calldataWord(signed[0].data, 1), OTHER.toLowerCase());
  } finally {
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = PRODUCTION;
  }
});

// ═══ nothing else holds a copy ═══════════════════════════════════════════

test("no app module hardcodes an address, a chain id, an RPC or its own client", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));
  assert.ok(files.length > 10, "the scan found the app source");

  const offences: string[] = [];
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const src = readFileSync(file, "utf-8");
    if (/0x[0-9a-fA-F]{40}/.test(src)) offences.push(`${rel}: address literal`);
    if (/\b61999\b|0xf1cf/i.test(src)) offences.push(`${rel}: chain id literal`);
    if (/https?:\/\/[^"'`\s]*genlayer\.com/.test(src)) offences.push(`${rel}: RPC literal`);
    if (rel !== "lib/genlayer/client.ts") {
      if (/\bcreateClient\s*\(/.test(src)) offences.push(`${rel}: builds its own client`);
      if (/genlayer-js\/chains/.test(src)) offences.push(`${rel}: picks its own chain`);
      if (/NEXT_PUBLIC_CONTRACT_ADDRESS\s*\|\||process\.env\.NEXT_PUBLIC_CONTRACT_ADDRESS/.test(src)) {
        offences.push(`${rel}: reads the address itself`);
      }
    }
  }
  assert.deepEqual(offences, [], "everything resolves through lib/genlayer/client.ts");
});
