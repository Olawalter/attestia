"use client";

/**
 * §42 — search and discovery.
 *
 * Filtering happens over state read from the contract, and every result
 * links straight back to the authoritative record. Nothing is served
 * from an index that could disagree with the chain.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { useClaims } from "@/lib/hooks/useAttestia";
import { protocolTime } from "@/lib/utils";
import {
  Card, CardHead, Empty, LinkButton, StatusPill, VerdictStamp,
} from "@/components/ui";
import type { ClaimSummary } from "@/lib/contracts/types";

const VERDICTS = [
  "SUPPORTED", "PARTIALLY_SUPPORTED", "CONTRADICTED", "INCONCLUSIVE", "OUTDATED",
];
const STATUSES = [
  "DRAFT", "OPEN", "EVIDENCE_CLOSED", "ADJUDICATING", "ADJUDICATED",
  "CHALLENGED", "RE_ADJUDICATING", "FINALIZED",
];

export default function ClaimsPage() {
  const { data, isLoading, error } = useClaims(0, 100);
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState("");
  const [status, setStatus] = useState("");
  const [minEvidence, setMinEvidence] = useState(0);
  const [finalizedOnly, setFinalizedOnly] = useState(false);

  const rows = useMemo(() => {
    const all: ClaimSummary[] = data?.rows ?? [];
    const needle = query.trim().toLowerCase();
    return all
      .filter((c) => !needle
        || c.claim_text.toLowerCase().includes(needle)
        || c.claim_id.toLowerCase().includes(needle))
      .filter((c) => !verdict || c.current_verdict === verdict)
      .filter((c) => !status || c.status === status)
      .filter((c) => c.evidence_count >= minEvidence)
      .filter((c) => !finalizedOnly || c.status === "FINALIZED")
      .reverse();
  }, [data, query, verdict, status, minEvidence, finalizedOnly]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-paper">Claims</h1>
          <p className="mt-2 text-sm text-paper-muted">
            Every case on the contract. Public, enumerable, and linked to the
            record it rests on.
          </p>
        </div>
        <LinkButton href="/claims/new" variant="gold">Submit a claim</LinkButton>
      </header>

      <Card>
        <CardHead>Filter the docket</CardHead>
        <div className="space-y-4 p-4">
          <label className="flex items-center gap-2.5 border border-rule bg-ink-sunken px-3 py-2">
            <Search className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
            <span className="sr-only">Search claims</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search claim text or id"
              className="w-full bg-transparent text-sm text-paper outline-none
                         placeholder:text-paper-faint"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-4">
            <Select label="Verdict" value={verdict} onChange={setVerdict}
                    options={VERDICTS} anyLabel="Any verdict" />
            <Select label="Status" value={status} onChange={setStatus}
                    options={STATUSES} anyLabel="Any status" />
            <div>
              <span className="label">Minimum evidence</span>
              <input
                type="number" min={0} value={minEvidence}
                onChange={(e) => setMinEvidence(Math.max(0, Number(e.target.value)))}
                className="mt-1 w-full border border-rule bg-ink-sunken px-2.5 py-1.5
                           font-mono text-xs text-paper outline-none focus:border-gold"
              />
            </div>
            <div>
              <span className="label">Finalized</span>
              <label className="mt-1 flex h-[34px] items-center gap-2 border border-rule
                                bg-ink-sunken px-2.5 text-xs text-paper-muted">
                <input type="checkbox" checked={finalizedOnly}
                       onChange={(e) => setFinalizedOnly(e.target.checked)}
                       className="accent-[#d4af37]" />
                Finalized only
              </label>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHead right={
          <span className="font-mono text-[10px] text-paper-faint">
            {rows.length} of {data?.total ?? 0}
          </span>
        }>
          Docket
        </CardHead>

        {isLoading ? (
          <Empty>Reading the contract…</Empty>
        ) : error ? (
          <Empty>{(error as Error).message}</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            {(data?.total ?? 0) === 0
              ? "No claims on this contract yet."
              : "No claims match these filters."}
          </Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {rows.map((claim) => (
              <li key={claim.claim_id}>
                <Link href={`/claims/${claim.claim_id}`}
                      className="block px-4 py-4 hover:bg-ink-sunken">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="font-serif text-[15px] leading-snug text-paper">
                        {claim.claim_text}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="font-mono text-[10px] text-paper-faint">
                          {claim.claim_id}
                        </span>
                        <StatusPill status={claim.status} />
                        <span className="font-mono text-[10px] text-paper-faint">
                          v{claim.current_version}
                        </span>
                        <span className="font-mono text-[10px] text-paper-faint">
                          {claim.evidence_count} evidence · {claim.challenge_count} challenges
                        </span>
                        <span className="font-mono text-[10px] text-paper-faint">
                          filed {protocolTime(claim.created_at)}
                        </span>
                      </div>
                    </div>
                    <VerdictStamp verdict={claim.current_verdict} size="sm" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Select({ label, value, onChange, options, anyLabel }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; anyLabel: string;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-rule bg-ink-sunken px-2.5 py-1.5
                   font-mono text-xs text-paper outline-none focus:border-gold"
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option.replace(/_/g, " ")}</option>
        ))}
      </select>
    </div>
  );
}
