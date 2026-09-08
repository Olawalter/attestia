"use client";

/**
 * TanStack Query hooks (§32).
 *
 * After a write the app REFETCHES authoritative state rather than
 * patching a local cache: the contract is the protocol, and a screen that
 * shows an optimistic guess is showing something that has not happened
 * yet (§59).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "../contracts/attestia";
import { hasContract } from "../genlayer/client";
import type { TxPhase } from "../contracts/types";
import { useWallet } from "../genlayer/wallet";
import { useCallback, useState } from "react";

const enabled = () => hasContract();

export const keys = {
  info: ["protocol-info"] as const,
  claims: (offset: number, limit: number) => ["claims", offset, limit] as const,
  claim: (id: string) => ["claim", id] as const,
  evidence: (id: string, version: number) => ["evidence", id, version] as const,
  adjudications: (id: string) => ["adjudications", id] as const,
  challenges: (id: string) => ["challenges", id] as const,
  history: (id: string) => ["history", id] as const,
  attestation: (id: string) => ["attestation", id] as const,
  verify: (id: string) => ["verify", id] as const,
};

export function useProtocolInfo() {
  return useQuery({
    queryKey: keys.info,
    queryFn: api.getProtocolInfo,
    enabled: enabled(),
    staleTime: 15_000,
  });
}

export function useClaims(offset = 0, limit = 50) {
  return useQuery({
    queryKey: keys.claims(offset, limit),
    queryFn: () => api.listClaims(offset, limit),
    enabled: enabled(),
    staleTime: 10_000,
  });
}

export function useClaim(claimId: string) {
  return useQuery({
    queryKey: keys.claim(claimId),
    queryFn: () => api.getClaim(claimId),
    enabled: enabled() && Boolean(claimId),
    staleTime: 5_000,
  });
}

export function useEvidence(claimId: string, version = 0) {
  return useQuery({
    queryKey: keys.evidence(claimId, version),
    queryFn: () => api.listEvidence(claimId, version),
    enabled: enabled() && Boolean(claimId),
    staleTime: 5_000,
  });
}

export function useAdjudications(claimId: string) {
  return useQuery({
    queryKey: keys.adjudications(claimId),
    queryFn: () => api.listAdjudications(claimId),
    enabled: enabled() && Boolean(claimId),
    staleTime: 5_000,
  });
}

export function useChallenges(claimId: string) {
  return useQuery({
    queryKey: keys.challenges(claimId),
    queryFn: () => api.listChallenges(claimId),
    enabled: enabled() && Boolean(claimId),
    staleTime: 5_000,
  });
}

export function useClaimHistory(claimId: string) {
  return useQuery({
    queryKey: keys.history(claimId),
    queryFn: () => api.getClaimHistory(claimId),
    enabled: enabled() && Boolean(claimId),
    staleTime: 5_000,
  });
}

export function useAttestation(attestationId: string) {
  return useQuery({
    queryKey: keys.attestation(attestationId),
    queryFn: () => api.getAttestation(attestationId),
    enabled: enabled() && Boolean(attestationId),
    staleTime: 30_000,
  });
}

export function useAttestationCheck(attestationId: string, run: boolean) {
  return useQuery({
    queryKey: keys.verify(attestationId),
    queryFn: () => api.verifyAttestation(attestationId),
    enabled: enabled() && Boolean(attestationId) && run,
    staleTime: 0,
  });
}

/**
 * §18 — semantic discovery, kept firmly in its place.
 *
 * Two cases are "related" here when they rest on the SAME SOURCE. That is
 * a fact about the record, checkable by anyone, and it is deliberately
 * not a claim that the cases share a truth: §18 is explicit that
 * similarity must not equal truth, and only adjudication assigns meaning.
 *
 * It runs on demand rather than on page load, because it costs one read
 * per other claim and the public RPC is shared.
 */
export function useRelatedCases(claimId: string, run: boolean) {
  return useQuery({
    queryKey: ["related", claimId] as const,
    enabled: enabled() && Boolean(claimId) && run,
    staleTime: 60_000,
    queryFn: async () => {
      const page = await api.listClaims(0, 100);
      const others = page.rows
        .filter((row) => row.claim_id !== claimId)
        .slice(0, 25);           // bounded: this is N reads, not one

      const mine = await api.listEvidence(claimId, 0);
      const mySources = new Set(mine.map((e) => e.source_url));
      if (mySources.size === 0) return [];

      const found = await Promise.all(others.map(async (row) => {
        try {
          const theirs = await api.listEvidence(row.claim_id, 0);
          const shared = theirs.find((e) => mySources.has(e.source_url));
          return shared
            ? { claim_id: row.claim_id, claim_text: row.claim_text,
                sharedSource: shared.source_url }
            : null;
        } catch {
          return null;          // one unreadable claim must not break the rest
        }
      }));

      return found.filter((x): x is NonNullable<typeof x> => x !== null);
    },
  });
}

/** What the UI needs to narrate a write truthfully (§34). */
export interface TxState {
  phase: TxPhase;
  hash: string;
  message: string;
}

const IDLE: TxState = { phase: "idle", hash: "", message: "" };

/**
 * Drive one contract write and expose its real phases.
 *
 * The mutation resolves on `finalized` OR `reverted` — a revert is an
 * answer, not an exception — so the caller must read `phase` rather than
 * assuming that "it resolved" means "it worked".
 */
export function useContractWrite() {
  const { address, selected, status } = useWallet();
  const queryClient = useQueryClient();
  const [tx, setTx] = useState<TxState>(IDLE);

  const reset = useCallback(() => setTx(IDLE), []);

  const mutation = useMutation({
    mutationFn: async (input: {
      run: (ctx: api.WriteContext) => Promise<{ hash: string; phase: TxPhase; message?: string }>;
      invalidate?: readonly (readonly unknown[])[];
    }) => {
      if (!address || !selected) throw new Error("Connect a wallet first.");
      if (status === "wrong-network") {
        throw new Error("Switch to the GenLayer network before signing.");
      }
      setTx({ phase: "signing", hash: "", message: "" });

      const result = await input.run({
        account: address,
        provider: selected.provider,
        onPhase: (phase, detail) =>
          setTx((prev) => ({
            phase,
            hash: detail?.hash ?? prev.hash,
            message: detail?.message ?? "",
          })),
      });

      // Refetch authoritative state; never patch it locally.
      for (const key of input.invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      await queryClient.invalidateQueries({ queryKey: keys.info });
      return result;
    },
    onError: (err: Error) =>
      setTx({ phase: "failed", hash: "", message: err.message }),
  });

  return { tx, reset, run: mutation.mutateAsync, busy: mutation.isPending };
}
