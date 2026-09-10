/**
 * Deployment compatibility guard.
 *
 * WHY THIS EXISTS. Production once served a build of this frontend whose
 * `NEXT_PUBLIC_CONTRACT_ADDRESS` still pointed at an OLDER deployment. The
 * build sent `create_claim(text, window, contest)`; the contract it reached
 * only took `create_claim(text, window)`. GenVM raised a bare Python
 * TypeError, every validator raised the same one, the network reached
 * MAJORITY_AGREE on a failed execution, and the user saw
 *
 *     Accepted by the network, then reverted: exit_code 1
 *
 * only AFTER signing. Nothing was wrong with either artefact on its own —
 * the frontend and the contract had simply drifted apart, and nothing
 * checked that they still matched.
 *
 * This module is that check. Before any write, the app reads the schema
 * the CHAIN reports for the configured address and confirms every method
 * this build calls exists there and accepts the arguments it will be
 * sent. A mismatch blocks writes with a message naming exactly what is
 * missing, so the failure happens before a signature, in plain words,
 * instead of after one as an exit code.
 *
 * The comparison is a pure function so it can be tested against real
 * captured schemas without a network.
 */

/**
 * Every contract method this build calls, and how many positional
 * arguments it sends. Kept beside the call sites in `attestia.ts`; if a
 * wrapper's argument list changes, this table must change with it.
 */
export const CALLS: Readonly<Record<string, number>> = {
  // writes
  create_claim: 3,
  open_claim: 1,
  submit_evidence: 5,
  remove_evidence: 2,
  close_evidence: 1,
  force_close_evidence: 1,
  start_adjudication: 1,
  adjudicate: 1,
  submit_challenge: 3,
  finalize_claim: 1,
  // reads
  get_protocol_info: 0,
  get_claim: 1,
  list_claims: 2,
  list_evidence: 2,
  get_evidence: 1,
  get_adjudication: 1,
  list_adjudications: 1,
  list_challenges: 1,
  get_challenge: 1,
  get_attestation: 1,
  verify_attestation: 1,
  get_claim_verdict: 1,
  get_claim_history: 1,
  check_evidence_binding: 2,
};

/** The subset of a GenLayer contract schema this check reads. */
export interface ContractSchema {
  methods: Record<string, { params: Array<[string, string]> }>;
}

export interface CompatReport {
  compatible: boolean;
  /** Methods this build calls that the contract does not have. */
  missing: string[];
  /** Methods that exist but accept fewer positional args than we send. */
  arity: Array<{ method: string; sends: number; accepts: number }>;
}

/**
 * Compare what this build calls against what a deployment exposes.
 *
 * A method is compatible when it exists and declares at least as many
 * positional parameters as this build sends. Declaring MORE is fine —
 * Python fills the rest from defaults. Declaring FEWER is exactly the
 * production failure: Python raises TypeError inside GenVM.
 */
export function compareSchema(schema: ContractSchema): CompatReport {
  const methods = schema?.methods ?? {};
  const missing: string[] = [];
  const arity: CompatReport["arity"] = [];

  for (const [method, sends] of Object.entries(CALLS)) {
    const spec = methods[method];
    if (!spec) {
      missing.push(method);
      continue;
    }
    const accepts = Array.isArray(spec.params) ? spec.params.length : 0;
    if (accepts < sends) arity.push({ method, sends, accepts });
  }

  return {
    compatible: missing.length === 0 && arity.length === 0,
    missing: missing.sort(),
    arity: arity.sort((a, b) => a.method.localeCompare(b.method)),
  };
}

/** A one-line, human explanation of a failed report. */
export function describe(report: CompatReport): string {
  const parts: string[] = [];
  if (report.missing.length) {
    parts.push(`missing ${report.missing.join(", ")}`);
  }
  for (const a of report.arity) {
    parts.push(`${a.method} takes ${a.accepts} argument${a.accepts === 1 ? "" : "s"}, `
      + `this build sends ${a.sends}`);
  }
  return parts.join("; ");
}
