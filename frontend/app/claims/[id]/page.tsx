"use client";

/**
 * §38 — the case file.
 *
 * Every fact on this page comes from the contract. Where the protocol
 * has not produced something yet, the page says so rather than showing a
 * neutral placeholder that could be read as a finding (§59).
 *
 * The Graph tab draws the same record as a network (§37). Every node and
 * edge on it comes from contract state; nothing is inferred to make the
 * picture look fuller.
 */
import Link from "next/link";
import { use, useState } from "react";

import * as api from "@/lib/contracts/attestia";
import {
  keys, useAdjudications, useClaim, useClaimHistory,
  useChallenges as useChallengeList, useContractWrite, useEvidence,
  useRelatedCases,
} from "@/lib/hooks/useAttestia";
import { duration, seq, shortAddress, utcTime } from "@/lib/utils";
import {
  Banner, Button, Card, CardHead, Empty, Field, LinkButton, StatusPill,
  VerdictStamp,
} from "@/components/ui";
import { ClaimGraph } from "@/components/ClaimGraph";
import { EvidenceCard } from "@/components/Evidence";
import { Lifecycle } from "@/components/Lifecycle";
import { TxTrack } from "@/components/TxTrack";
import { RequireWallet } from "@/components/Wallet";

const TABS = ["Evidence", "Graph", "Challenges", "Adjudication", "History",
  "Attestation"] as const;
type Tab = (typeof TABS)[number];

export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>("Evidence");

  const { data: claim, isLoading, error } = useClaim(id);
  const { data: evidence } = useEvidence(id, 0);
  const { data: adjudications } = useAdjudications(id);
  const { data: challenges } = useChallengeList(id);
  const { data: history } = useClaimHistory(id);
  const { tx, run, busy } = useContractWrite();
  const [findRelated, setFindRelated] = useState(false);
  const { data: related, isFetching: relatedLoading } =
    useRelatedCases(id, findRelated);

  if (isLoading) return <Empty>Reading the case file…</Empty>;
  if (error) return <Banner kind="warn">{(error as Error).message}</Banner>;
  if (!claim) return <Empty>No such claim.</Empty>;

  const currentEvidence = (evidence ?? []).filter(
    (e) => e.claim_version === claim.current_version);
  const latestAdjudication = (adjudications ?? []).at(-1);

  const invalidate = [
    keys.claim(id), keys.evidence(id, 0), keys.adjudications(id),
    keys.challenges(id), keys.history(id), ["claims"],
  ];

  return (
    <div className="space-y-8">
      {/* ── case header ── */}
      <header className="border-b border-rule pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs tracking-[0.16em] text-gold">
            {claim.claim_id.toUpperCase()}
          </span>
          <StatusPill status={claim.status} />
          <span className="font-mono text-[10px] text-paper-faint">
            version {claim.current_version}
          </span>
        </div>

        <h1 className="mt-4 max-w-3xl font-serif text-2xl leading-snug text-paper sm:text-3xl">
          {claim.claim_text}
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-6">
          <VerdictStamp verdict={claim.current_verdict} size="lg" />
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            <Counted label="Evidence" value={claim.evidence_count} />
            <Counted label="Challenges" value={claim.challenge_count} />
            <Counted label="Adjudications" value={claim.adjudication_count} />
          </dl>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        {/* ── record ── */}
        <div className="min-w-0 space-y-6">
          <div role="tablist" aria-label="Case sections"
               className="flex flex-wrap gap-x-6 border-b border-rule">
            {TABS.map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${
                  tab === name
                    ? "border-gold text-paper"
                    : "border-transparent text-paper-muted hover:text-paper"}`}
              >
                {name}
              </button>
            ))}
          </div>

          {tab === "Evidence" && (
            <section className="space-y-4">
              {currentEvidence.length === 0 ? (
                <Empty>No evidence filed on version {claim.current_version} yet.</Empty>
              ) : (
                currentEvidence.map((item) => (
                  <EvidenceCard key={item.evidence_id} evidence={item} />
                ))
              )}

              {claim.status === "OPEN" && (
                <SubmitEvidence claimId={id} invalidate={invalidate}
                                run={run} busy={busy} tx={tx} />
              )}
            </section>
          )}

          {tab === "Graph" && (
            <section className="space-y-4">
              <ClaimGraph
                claim={claim}
                evidence={evidence ?? []}
                adjudications={adjudications ?? []}
                challenges={challenges ?? []}
                related={related ?? []}
              />

              <Card>
                <CardHead>Related cases</CardHead>
                <div className="space-y-3 p-4">
                  <p className="text-xs leading-relaxed text-paper-muted">
                    Two cases are related here when they rest on the same
                    source. That is a fact about the record — not a claim
                    that they share a conclusion. Only adjudication assigns
                    meaning to a source.
                  </p>
                  {!findRelated ? (
                    <Button size="sm" onClick={() => setFindRelated(true)}>
                      Search for shared sources
                    </Button>
                  ) : relatedLoading ? (
                    <p className="font-mono text-[11px] text-paper-faint">
                      Reading other cases…
                    </p>
                  ) : (related ?? []).length === 0 ? (
                    <p className="font-mono text-[11px] text-paper-faint">
                      No other case on this contract cites a source this one
                      cites.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {(related ?? []).map((item) => (
                        <li key={item.claim_id}>
                          <Link href={`/claims/${item.claim_id}`}
                                className="block border border-rule bg-ink-sunken p-3
                                           hover:border-rule-strong">
                            <p className="font-serif text-[13px] text-paper">
                              {item.claim_text}
                            </p>
                            <p className="mt-1 font-mono text-[10px] text-paper-faint">
                              {item.claim_id} · shares {item.sharedSource}
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </section>
          )}

          {tab === "Adjudication" && (
            <section className="space-y-4">
              {!latestAdjudication ? (
                <Empty>
                  This version has not been adjudicated. Nothing here is a
                  verdict until the panel has produced one.
                </Empty>
              ) : (
                <AdjudicationRecord adjudication={latestAdjudication} />
              )}
            </section>
          )}

          {tab === "Challenges" && (
            <section className="space-y-4">
              {(challenges ?? []).length === 0 ? (
                <Empty>No challenges filed.</Empty>
              ) : (
                (challenges ?? []).map((ch) => (
                  <Card key={ch.challenge_id}>
                    <CardHead right={
                      <span className="font-mono text-[10px] text-paper-faint">
                        {ch.status}
                      </span>
                    }>
                      {ch.challenge_id} · v{ch.target_version} → v{ch.resulting_version}
                    </CardHead>
                    <div className="space-y-3 p-4">
                      <p className="text-sm leading-relaxed text-paper">{ch.reason}</p>
                      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <Field label="Filed by" mono>{shortAddress(ch.submitted_by)}</Field>
                        <Field label="Filed" mono>{seq(ch.submitted_seq)}</Field>
                        <Field label="Counter-evidence" mono>
                          {ch.counter_evidence_ids.length || "none"}
                        </Field>
                      </dl>
                    </div>
                  </Card>
                ))
              )}
            </section>
          )}

          {tab === "History" && (
            <section className="space-y-4">
              {!history || history.versions.length === 0 ? (
                <Empty>No adjudication history yet.</Empty>
              ) : (
                <ol className="space-y-3">
                  {history.versions.map((version) => (
                    <li key={version.adjudication_id}>
                      <Card className={version.superseded ? "opacity-70" : ""}>
                        <CardHead right={
                          <span className="font-mono text-[10px] text-paper-faint">
                            {version.superseded ? "superseded" : "current"}
                          </span>
                        }>
                          Version {version.claim_version} · round {version.round_number}
                        </CardHead>
                        <div className="space-y-3 p-4">
                          <VerdictStamp verdict={version.verdict} size="sm" />
                          <p className="text-[13px] leading-relaxed text-paper-muted">
                            {version.reason}
                          </p>
                          <p className="font-mono text-[10px] text-paper-faint">
                            {version.adjudication_id} · evidence hash{" "}
                            {version.evidence_snapshot_hash.slice(0, 16)}…
                          </p>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-xs leading-relaxed text-paper-faint">
                A superseded verdict is never rewritten. Each version keeps the
                record it was decided on, which is what makes this history
                evidence rather than a summary.
              </p>
            </section>
          )}

          {tab === "Attestation" && (
            <section>
              {claim.current_attestation_id ? (
                <Card>
                  <CardHead>Finalized</CardHead>
                  <div className="space-y-4 p-4">
                    <Field label="Attestation" mono>
                      {claim.current_attestation_id}
                    </Field>
                    <LinkButton href={`/verify?id=${claim.current_attestation_id}`}
                                variant="gold" size="sm">
                      Open and verify
                    </LinkButton>
                  </div>
                </Card>
              ) : (
                <Empty>
                  No attestation. One is minted when the claim finalizes, and
                  not before.
                </Empty>
              )}
            </section>
          )}
        </div>

        {/* ── side rail ── */}
        <aside className="space-y-6">
          <Card>
            <CardHead>Protocol lifecycle</CardHead>
            <div className="p-4">
              <Lifecycle claim={claim} />
            </div>
          </Card>

          <Card>
            <CardHead>Case record</CardHead>
            <dl className="space-y-3 p-4">
              <Field label="Creator" mono>{shortAddress(claim.creator)}</Field>
              <Field label="Filed" mono>{seq(claim.created_seq)}</Field>
              {claim.opened_at > 0 && (
                <Field label="Opened" mono>{utcTime(claim.opened_at)}</Field>
              )}
              <Field label="Evidence deadline" mono>
                {utcTime(claim.evidence_deadline)}
                {claim.evidence_window_open && (
                  <span className="ml-2 text-verdict-supported">open</span>
                )}
              </Field>
              {claim.challenge_deadline > 0 && (
                <Field label="Challenge window closes" mono>
                  {utcTime(claim.challenge_deadline)}
                </Field>
              )}
            </dl>
          </Card>

          <Card>
            <CardHead>Advance the case</CardHead>
            <div className="space-y-3 p-4">
              <RequireWallet>
                <Actions claim={claim} invalidate={invalidate} run={run} busy={busy} />
              </RequireWallet>
              <TxTrack tx={tx} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Counted({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 font-mono text-lg text-paper">{value}</dd>
    </div>
  );
}

/** The actions legal from the claim's CURRENT state — nothing else is shown. */
function Actions({ claim, invalidate, run, busy }: {
  claim: import("@/lib/contracts/types").Claim;
  invalidate: readonly (readonly unknown[])[];
  run: ReturnType<typeof useContractWrite>["run"];
  busy: boolean;
}) {
  const id = claim.claim_id;
  const go = (fn: (ctx: api.WriteContext) => Promise<{ hash: string; phase: import("@/lib/contracts/types").TxPhase; message?: string }>) =>
    run({ run: fn, invalidate });

  if (claim.status === "DRAFT") {
    return (
      <Button variant="gold" disabled={busy}
              onClick={() => go((ctx) => api.openClaim(id, ctx))}>
        Open for evidence
      </Button>
    );
  }

  if (claim.status === "OPEN") {
    return (
      <div className="space-y-3">
        <Button variant="gold" disabled={busy}
                onClick={() => go((ctx) => api.closeEvidence(id, ctx))}>
          Close evidence collection
        </Button>
        <p className="text-xs leading-relaxed text-paper-faint">
          Freezing the record is what makes adjudication possible. Anything
          filed afterwards belongs to a later version.
        </p>
      </div>
    );
  }

  if (claim.status === "EVIDENCE_CLOSED" || claim.status === "CHALLENGED") {
    return (
      <Button variant="gold" disabled={busy}
              onClick={() => go((ctx) => api.startAdjudication(id, ctx))}>
        Send to the panel
      </Button>
    );
  }

  if (claim.status === "ADJUDICATING" || claim.status === "RE_ADJUDICATING") {
    return (
      <div className="space-y-3">
        <Button variant="gold" disabled={busy}
                onClick={() => go((ctx) => api.adjudicate(id, ctx))}>
          Run adjudication
        </Button>
        <p className="text-xs leading-relaxed text-paper-faint">
          Validators each retrieve the frozen sources and reason independently.
          This takes minutes, not seconds.
        </p>
      </div>
    );
  }

  if (claim.status === "ADJUDICATED") {
    return <AdjudicatedActions claim={claim} invalidate={invalidate}
                               run={run} busy={busy} />;
  }

  return (
    <p className="text-xs leading-relaxed text-paper-faint">
      This claim is finalized. Nothing further can change it.
    </p>
  );
}

function AdjudicatedActions({ claim, invalidate, run, busy }: {
  claim: import("@/lib/contracts/types").Claim;
  invalidate: readonly (readonly unknown[])[];
  run: ReturnType<typeof useContractWrite>["run"];
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const id = claim.claim_id;

  // The browser's own clock is used only to HINT which action is likely
  // to succeed. It is never authoritative: the contract decides against a
  // consensus-observed time, and if the hint is wrong the write reverts
  // with the real reason (§59).
  const nowSeconds = Math.floor(Date.now() / 1000);
  const likelyOpen = nowSeconds <= claim.challenge_deadline;
  const remaining = Math.max(0, claim.challenge_deadline - nowSeconds);

  return (
    <div className="space-y-4">
      {likelyOpen && (
        <div className="space-y-2.5">
          <p className="text-xs text-paper-muted">
            Challenge window closes {utcTime(claim.challenge_deadline)}
            {remaining > 0 ? ` — about ${duration(remaining)} from now` : ""}.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this verdict wrong?"
            className="w-full resize-y border border-rule bg-ink-sunken px-2.5 py-2
                       text-xs text-paper outline-none placeholder:text-paper-faint
                       focus:border-gold"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Counter-evidence URL (optional)"
            className="w-full border border-rule bg-ink-sunken px-2.5 py-2 font-mono
                       text-[11px] text-paper outline-none placeholder:text-paper-faint
                       focus:border-gold"
          />
          {url && (
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does that source show?"
              className="w-full border border-rule bg-ink-sunken px-2.5 py-2 text-xs
                         text-paper outline-none placeholder:text-paper-faint
                         focus:border-gold"
            />
          )}
          <Button variant="gold" size="sm" disabled={busy || !reason.trim()}
                  onClick={() => run({
                    run: (ctx) => api.submitChallenge(
                      id, reason.trim(),
                      url.trim()
                        ? JSON.stringify([{
                            source_url: url.trim(),
                            source_type: "COUNTER_EVIDENCE",
                            description: description.trim() || "Counter-evidence.",
                          }])
                        : "[]",
                      ctx),
                    invalidate,
                  })}>
            Challenge this verdict
          </Button>
        </div>
      )}

      <div className="border-t border-rule pt-3">
        <Button variant="gold" disabled={busy}
                onClick={() => run({
                  run: (ctx) => api.finalizeClaim(id, ctx), invalidate,
                })}>
          Finalize and mint attestation
        </Button>
        <p className="mt-2 text-[11px] leading-relaxed text-paper-faint">
          Finalizing asks the validator panel what time it is and refuses if
          the challenge window has not actually closed. Nobody — not you,
          not the claim&apos;s creator — can bring that moment forward.
        </p>
      </div>
    </div>
  );
}

function SubmitEvidence({ claimId, invalidate, run, busy, tx }: {
  claimId: string;
  invalidate: readonly (readonly unknown[])[];
  run: ReturnType<typeof useContractWrite>["run"];
  busy: boolean;
  tx: ReturnType<typeof useContractWrite>["tx"];
}) {
  const [url, setUrl] = useState("");
  const [type, setType] = useState("NEWS_REPORT");
  const [description, setDescription] = useState("");
  const [declared, setDeclared] = useState("UNCLASSIFIED");

  const ready = url.trim().length > 0 && description.trim().length > 0;

  return (
    <Card>
      <CardHead>File evidence</CardHead>
      <div className="space-y-3 p-4">
        <RequireWallet>
          <>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="w-full border border-rule bg-ink-sunken px-3 py-2 font-mono
                         text-xs text-paper outline-none placeholder:text-paper-faint
                         focus:border-gold"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={type}
                onChange={(e) => setType(e.target.value.toUpperCase())}
                placeholder="SOURCE TYPE"
                className="border border-rule bg-ink-sunken px-3 py-2 font-mono text-xs
                           text-paper outline-none focus:border-gold"
              />
              <select
                value={declared}
                onChange={(e) => setDeclared(e.target.value)}
                className="border border-rule bg-ink-sunken px-3 py-2 font-mono text-xs
                           text-paper outline-none focus:border-gold"
              >
                <option value="UNCLASSIFIED">I make no claim about it</option>
                <option value="SUPPORTS">I say it supports</option>
                <option value="CONTRADICTS">I say it contradicts</option>
                <option value="PARTIALLY_SUPPORTS">I say it partly supports</option>
                <option value="RELATED">I say it is related</option>
                <option value="OUTDATED">I say it is outdated</option>
              </select>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this source, and what does it show?"
              className="w-full resize-y border border-rule bg-ink-sunken px-3 py-2
                         text-xs text-paper outline-none placeholder:text-paper-faint
                         focus:border-gold"
            />
            <p className="text-[11px] leading-relaxed text-paper-faint">
              What you say about a source is recorded as your assertion. The
              panel decides its actual relationship to the claim.
            </p>
            <Button variant="gold" size="sm" disabled={!ready || busy}
                    onClick={() => run({
                      run: (ctx) => api.submitEvidence(
                        claimId, url.trim(), type.trim() || "UNSPECIFIED",
                        description.trim(), declared, ctx),
                      invalidate,
                    })}>
              Submit evidence
            </Button>
            <TxTrack tx={tx} />
          </>
        </RequireWallet>
      </div>
    </Card>
  );
}

function AdjudicationRecord({ adjudication }: {
  adjudication: import("@/lib/contracts/types").Adjudication;
}) {
  const buckets: [string, string[]][] = [
    ["Supporting", adjudication.supporting_evidence],
    ["Contradicting", adjudication.contradicting_evidence],
    ["Partially supporting", adjudication.partially_supporting_evidence],
    ["Outdated", adjudication.outdated_evidence],
    ["Irrelevant", adjudication.irrelevant_evidence],
    ["Could not be retrieved", adjudication.unavailable_evidence],
  ];

  return (
    <Card>
      <CardHead right={
        <span className="font-mono text-[10px] text-paper-faint">
          round {adjudication.round_number}
        </span>
      }>
        GenLayer consensus reached
      </CardHead>
      <div className="space-y-5 p-4">
        <VerdictStamp verdict={adjudication.verdict} size="lg" />

        <p className="font-serif text-[15px] leading-relaxed text-paper-muted">
          {adjudication.reason}
        </p>

        <dl className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-2">
          {buckets.filter(([, ids]) => ids.length > 0).map(([label, ids]) => (
            <div key={label}>
              <dt className="label">{label}</dt>
              <dd className="mt-1 font-mono text-[11px] text-paper-muted">
                {ids.join(", ")}
              </dd>
            </div>
          ))}
        </dl>

        <div className="border-t border-rule pt-3">
          <p className="label">Evidence snapshot</p>
          <p className="mt-1 break-all font-mono text-[10px] text-paper-faint">
            {adjudication.evidence_snapshot_hash}
          </p>
        </div>
      </div>
    </Card>
  );
}
