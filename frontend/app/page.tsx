"use client";

/**
 * §35 — the landing page.
 *
 * The hero is followed immediately by REAL protocol state read from the
 * deployed contract. If the contract has no claims yet it says so; there
 * is no illustrative sample data anywhere on this page, because a
 * homepage that invents activity is the first place a reviewer stops
 * trusting the rest (§59).
 */
import Link from "next/link";

import { useClaims, useProtocolInfo } from "@/lib/hooks/useAttestia";
import { getContractAddress } from "@/lib/genlayer/client";
import { Card, CardHead, Empty, LinkButton, StatusPill, VerdictStamp } from "@/components/ui";

export default function Home() {
  const { data: info, isLoading: infoLoading } = useProtocolInfo();
  const { data: claims, isLoading: claimsLoading } = useClaims(0, 5);

  const recent = claims?.rows ? [...claims.rows].reverse() : [];

  return (
    <div className="space-y-16">
      {/* ── hero ── */}
      <section className="pt-6">
        <p className="label mb-6">Decentralized evidence and adjudication</p>
        <h1 className="max-w-3xl font-serif text-4xl leading-[1.15] text-paper sm:text-5xl">
          Claims connected to evidence.
          <br />
          <span className="text-gold">Judgment secured by consensus.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-paper-muted">
          Attestia turns disputed real-world claims into verifiable, versioned
          attestations through GenLayer&apos;s decentralized AI judgment.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/claims" variant="gold" size="lg">
            Explore claims
          </LinkButton>
          <LinkButton href="/claims/new" size="lg">
            Submit a claim
          </LinkButton>
        </div>
      </section>

      {/* ── live protocol state ── */}
      <section>
        <div className="grid gap-px border border-rule bg-rule sm:grid-cols-4">
          <Stat label="Claims on record"
                value={infoLoading ? null : info?.claim_count ?? 0} />
          <Stat label="Clock" value={infoLoading ? null : "consensus-observed"} />
          <Stat label="Default challenge window"
                value={infoLoading ? null
                  : `${Math.round((info?.default_challenge_window_seconds ?? 0) / 86400)}d`} />
          <Stat label="Protocol version"
                value={infoLoading ? null : info?.version ?? "Unavailable"} />
        </div>
        <p className="mt-3 font-mono text-[10px] text-paper-faint">
          Read live from {getContractAddress() || "no configured contract"}
        </p>
      </section>

      {/* ── how it works ── */}
      <section>
        <h2 className="label mb-5">The protocol</h2>
        <div className="grid gap-px border border-rule bg-rule md:grid-cols-3">
          <Step n="01" title="Evidence, not opinion">
            Anyone attaches sources to a claim. What a submitter says a source
            proves is recorded as a claim about it — never as a finding.
          </Step>
          <Step n="02" title="Adjudication by panel">
            The record is frozen and put to GenLayer validators. Each one
            retrieves the same sources, reasons independently, and the network
            compares their determinations.
          </Step>
          <Step n="03" title="Versioned attestation">
            A verdict opens a challenge window. Contest it and the claim gains a
            version; the old ruling stays exactly as it was. What finalizes
            becomes an attestation an agent can verify.
          </Step>
        </div>
      </section>

      {/* ── recent claims ── */}
      <section>
        <Card>
          <CardHead right={
            <Link href="/claims" className="font-mono text-[10px] tracking-[0.1em] text-gold hover:underline">
              ALL CLAIMS
            </Link>
          }>
            Recently filed
          </CardHead>

          {claimsLoading ? (
            <Empty>Reading the contract…</Empty>
          ) : recent.length === 0 ? (
            <Empty>
              No claims on this contract yet. Submitting one is the first step of
              the protocol.
            </Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {recent.map((claim) => (
                <li key={claim.claim_id}>
                  <Link href={`/claims/${claim.claim_id}`}
                        className="flex items-start justify-between gap-6 px-4 py-4 hover:bg-ink-sunken">
                    <div className="min-w-0">
                      <p className="font-serif text-[15px] leading-snug text-paper">
                        {claim.claim_text}
                      </p>
                      <p className="mt-1.5 flex items-center gap-3">
                        <span className="font-mono text-[10px] text-paper-faint">
                          {claim.claim_id}
                        </span>
                        <StatusPill status={claim.status} />
                        <span className="font-mono text-[10px] text-paper-faint">
                          v{claim.current_version} · {claim.evidence_count} evidence
                        </span>
                      </p>
                    </div>
                    <VerdictStamp verdict={claim.current_verdict} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="bg-ink px-4 py-5">
      <p className="label">{label}</p>
      <p className="mt-2 font-mono text-xl text-paper">
        {value === null ? <span className="text-paper-faint">…</span> : value}
      </p>
    </div>
  );
}

function Step({ n, title, children }: {
  n: string; title: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-ink p-5">
      <p className="font-mono text-[10px] tracking-[0.2em] text-gold">{n}</p>
      <h3 className="mt-3 text-sm font-medium text-paper">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-paper-muted">{children}</p>
    </div>
  );
}
