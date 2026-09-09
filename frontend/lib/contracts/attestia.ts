"use client";

/**
 * The typed contract client (§54).
 *
 * One function per schema method, named exactly as the contract names it,
 * so a reader can line this file up against `genlayer schema <address>`
 * and see that nothing was invented.
 */
import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable, TransactionHash } from "genlayer-js/types";

import { getContractAddress, readClient, writeClient } from "../genlayer/client";
import type { Eip1193Provider } from "../genlayer/wallet";
import type {
  Adjudication, Attestation, AttestationCheck, BindingCheck, Challenge, Claim, ClaimHistory,
  ClaimPage, ClaimVerdict, Evidence, ProtocolInfo, TxPhase,
} from "./types";

/**
 * genlayer-js returns GenLayer collections as JS `Map`s, and nested
 * values come back the same way. Everything crossing into React is
 * converted once, here, so no component has to know that.
 */
export function fromGenLayer<T>(value: unknown): T {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) out[String(k)] = fromGenLayer(v);
    return out as T;
  }
  if (Array.isArray(value)) return value.map((v) => fromGenLayer(v)) as T;
  if (typeof value === "bigint") return Number(value) as T;
  return value as T;
}

async function read<T>(
  functionName: string,
  args: CalldataEncodable[] = [],
): Promise<T> {
  const address = getContractAddress();
  if (!address) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ADDRESS is not set — this app has no contract to read.",
    );
  }
  const client = readClient();
  const raw = await client.readContract({
    address: address as `0x${string}`,
    functionName,
    args,
  });
  return fromGenLayer<T>(raw);
}

// ─── reads (§57) ────────────────────────────────────────────────────────
export const getProtocolInfo = () => read<ProtocolInfo>("get_protocol_info");
export const getClaim = (claimId: string) => read<Claim>("get_claim", [claimId]);
export const listClaims = (offset = 0, limit = 50) =>
  read<ClaimPage>("list_claims", [offset, limit]);
export const listEvidence = (claimId: string, version = 0) =>
  read<Evidence[]>("list_evidence", [claimId, version]);
export const getEvidence = (evidenceId: string) =>
  read<Evidence>("get_evidence", [evidenceId]);
export const getAdjudication = (adjudicationId: string) =>
  read<Adjudication>("get_adjudication", [adjudicationId]);
export const listAdjudications = (claimId: string) =>
  read<Adjudication[]>("list_adjudications", [claimId]);
export const listChallenges = (claimId: string) =>
  read<Challenge[]>("list_challenges", [claimId]);
export const getChallenge = (challengeId: string) =>
  read<Challenge>("get_challenge", [challengeId]);
export const getAttestation = (attestationId: string) =>
  read<Attestation>("get_attestation", [attestationId]);
export const verifyAttestation = (attestationId: string) =>
  read<AttestationCheck>("verify_attestation", [attestationId]);
export const getClaimVerdict = (claimId: string) =>
  read<ClaimVerdict>("get_claim_verdict", [claimId]);
export const getClaimHistory = (claimId: string) =>
  read<ClaimHistory>("get_claim_history", [claimId]);
export const checkEvidenceBinding = (evidenceId: string, contentDigest: string) =>
  read<BindingCheck>("check_evidence_binding", [evidenceId, contentDigest]);

// ─── writes (§34) ───────────────────────────────────────────────────────

export interface WriteContext {
  account: string;
  provider: Eip1193Provider;
  /** Called at each real phase transition. Never called speculatively. */
  onPhase?: (phase: TxPhase, detail?: { hash?: string; message?: string }) => void;
}

/**
 * Run a write and report the lifecycle honestly (§34, §59).
 *
 * The rule this enforces: a transaction hash means SUBMITTED and nothing
 * more. GenLayer can accept a transaction that then reverted, so the
 * receipt is inspected before anything is called finalized — showing
 * "Success" on a hash is how a failed write ends up looking like a
 * successful one.
 */
export async function runWrite(
  functionName: string,
  args: CalldataEncodable[],
  ctx: WriteContext,
): Promise<{ hash: string; phase: TxPhase; message?: string }> {
  const address = getContractAddress();
  if (!address) throw new Error("No contract address configured.");

  const client = writeClient(ctx.account, ctx.provider);

  ctx.onPhase?.("signing");
  let hash: string;
  try {
    hash = (await client.writeContract({
      address: address as `0x${string}`,
      functionName,
      args,
      value: BigInt(0),
    })) as unknown as string;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4001) {
      ctx.onPhase?.("rejected", { message: "Signature declined in the wallet." });
      return { hash: "", phase: "rejected", message: "Signature declined." };
    }
    const message = (err as Error)?.message || "The wallet could not submit this.";
    ctx.onPhase?.("failed", { message });
    return { hash: "", phase: "failed", message };
  }

  ctx.onPhase?.("submitted", { hash });
  ctx.onPhase?.("pending", { hash });

  // FINALIZED, not ACCEPTED: a GenLayer transaction can be accepted and
  // then revert, so waiting for acceptance would report failures as
  // successes (§34).
  const receipt = (await client.waitForTransactionReceipt({
    hash: hash as unknown as TransactionHash,
    status: TransactionStatus.FINALIZED,
    retries: 200,
    interval: 4000,
  })) as unknown;

  const plain = fromGenLayer<Record<string, unknown>>(receipt);
  const reverted = revertReason(plain);
  if (reverted) {
    ctx.onPhase?.("reverted", { hash, message: reverted });
    return { hash, phase: "reverted", message: reverted };
  }

  ctx.onPhase?.("finalized", { hash });
  return { hash, phase: "finalized" };
}

/**
 * Pull a revert out of a receipt, or null if the write really succeeded.
 *
 * A GenLayer transaction can be ACCEPTED and still have reverted inside
 * the contract, so the execution result is what decides — not the
 * transaction status.
 */
export function revertReason(receipt: Record<string, unknown>): string | null {
  const consensus = (receipt?.consensus_data ?? receipt) as Record<string, unknown>;
  const leaderReceipt = (consensus?.leader_receipt
    ?? receipt?.leader_receipt) as unknown;
  const first = Array.isArray(leaderReceipt) ? leaderReceipt[0] : leaderReceipt;
  const entry = first as Record<string, unknown> | undefined;
  if (!entry) return null;

  const result = String(entry.execution_result ?? "");
  if (result && result.toUpperCase() !== "SUCCESS") {
    const payload = (entry.result as Record<string, unknown> | undefined)?.payload;
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    if (payload && typeof payload === "object") {
      const message = (payload as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    return `Transaction reverted (${result}).`;
  }
  return null;
}

// One wrapper per write method, matching the deployed schema exactly.
export const createClaim = (
  text: string, windowSeconds: number, challengeWindowSeconds: number,
  ctx: WriteContext,
) => runWrite("create_claim", [text, windowSeconds, challengeWindowSeconds], ctx);

export const openClaim = (claimId: string, ctx: WriteContext) =>
  runWrite("open_claim", [claimId], ctx);

export const submitEvidence = (
  claimId: string, sourceUrl: string, sourceType: string,
  description: string, declaredRelationship: string, ctx: WriteContext,
) => runWrite(
  "submit_evidence",
  [claimId, sourceUrl, sourceType, description, declaredRelationship],
  ctx,
);

export const removeEvidence = (claimId: string, evidenceId: string, ctx: WriteContext) =>
  runWrite("remove_evidence", [claimId, evidenceId], ctx);

export const closeEvidence = (claimId: string, ctx: WriteContext) =>
  runWrite("close_evidence", [claimId], ctx);

export const startAdjudication = (claimId: string, ctx: WriteContext) =>
  runWrite("start_adjudication", [claimId], ctx);

export const adjudicate = (claimId: string, ctx: WriteContext) =>
  runWrite("adjudicate", [claimId], ctx);

export const submitChallenge = (
  claimId: string, reason: string, counterEvidenceJson: string, ctx: WriteContext,
) => runWrite("submit_challenge", [claimId, reason, counterEvidenceJson], ctx);

export const finalizeClaim = (claimId: string, ctx: WriteContext) =>
  runWrite("finalize_claim", [claimId], ctx);

// STEWARD FIX: `advance_clock` is gone. Nothing here can set protocol
// time; the contract observes it through consensus.
export const forceCloseEvidence = (claimId: string, ctx: WriteContext) =>
  runWrite("force_close_evidence", [claimId], ctx);
