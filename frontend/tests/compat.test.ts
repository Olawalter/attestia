/**
 * The deployment compatibility guard, tested against the REAL schemas of
 * both deployments — captured from `gen_getContractSchema` into
 * tests/fixtures, not written by hand.
 *
 * Run: npm run test:compat
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CALLS, compareSchema, describe, type ContractSchema } from "../lib/contracts/compat.ts";

const fixture = (name: string): ContractSchema =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const PREFIX = fixture("schema-0x1685CC12-prefix"); // what production was pointed at
const FIXED = fixture("schema-0x8d57088F-fixed");   // what this build was written for

test("the fixed deployment satisfies every call this build makes", () => {
  const report = compareSchema(FIXED);
  assert.equal(report.compatible, true, describe(report));
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.arity, []);
});

test("the pre-fix deployment is refused, and the reason names the real fault", () => {
  const report = compareSchema(PREFIX);
  assert.equal(report.compatible, false);

  // The exact production failure: the build sends three arguments to a
  // method that takes two. This is what produced `exit_code 1`.
  assert.deepEqual(report.arity, [{ method: "create_claim", sends: 3, accepts: 2 }]);

  // And the security-fix methods simply are not there.
  assert.deepEqual(report.missing, ["check_evidence_binding", "force_close_evidence"]);

  const why = describe(report);
  assert.match(why, /create_claim takes 2 arguments, this build sends 3/);
  assert.match(why, /missing check_evidence_binding, force_close_evidence/);
});

test("a method accepting MORE parameters than sent is still compatible", () => {
  // Python fills the rest from defaults, so this must not be flagged.
  const report = compareSchema({
    methods: Object.fromEntries(Object.entries(CALLS).map(([m, n]) => [
      m, { params: Array.from({ length: n + 2 }, (_, i) => [`p${i}`, "any"] as [string, string]) },
    ])),
  });
  assert.equal(report.compatible, true);
});

test("an empty or malformed schema fails closed", () => {
  assert.equal(compareSchema({ methods: {} }).compatible, false);
  assert.equal(compareSchema(undefined as never).compatible, false);
});

test("CALLS matches every call site in attestia.ts — the table cannot drift", () => {
  // The guard is only as good as its table. If a wrapper's argument list
  // changes and CALLS does not, the guard would wave through exactly the
  // mismatch it exists to catch. So read the real call sites and compare.
  const src = readFileSync(new URL("../lib/contracts/attestia.ts", import.meta.url), "utf8");

  const sites = new Map<string, number>();
  const pattern = /(?:runWrite|read<[^>]+>)\(\s*"([a-z_]+)"(?:,\s*\[([^\]]*)\])?/g;
  for (const m of src.matchAll(pattern)) {
    const args = (m[2] ?? "").trim();
    const count = args === "" ? 0 : args.split(",").filter((a) => a.trim()).length;
    sites.set(m[1], count);
  }

  assert.ok(sites.size >= 20, `expected to find the call sites, found ${sites.size}`);
  for (const [method, count] of sites) {
    assert.equal(CALLS[method], count,
      `${method}: call site sends ${count}, CALLS says ${CALLS[method]}`);
  }
  for (const method of Object.keys(CALLS)) {
    assert.ok(sites.has(method), `CALLS lists ${method} but no call site uses it`);
  }
});
