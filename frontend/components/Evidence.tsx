"use client";

/**
 * §39 — the evidence card.
 *
 * The rule the layout enforces: user-provided evidence must never look
 * authoritative before adjudication. The submitter's own view of the
 * source sits in small type under a label that calls it an assertion;
 * the panel's finding, when there is one, is the line that carries
 * weight. Before a ruling there is simply nothing in that position.
 */
import { RelationshipTag, RetrievalTag, SourceLink } from "./ui";
import { hostOf, protocolTime, shortAddress } from "@/lib/utils";
import type { Evidence } from "@/lib/contracts/types";

export function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const ruled = Boolean(evidence.adjudicated_in);
  const removed = evidence.status === "REMOVED";

  return (
    <article className={`border border-rule bg-ink-raised p-4 ${
      removed ? "opacity-45" : ""}`}>
      <header className="flex items-start justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
          {evidence.source_type.replace(/_/g, " ")}
        </p>
        <span className="font-mono text-[10px] text-paper-faint">
          {evidence.evidence_id}
        </span>
      </header>

      <p className="mt-2.5 text-sm leading-relaxed text-paper">
        {evidence.description}
      </p>

      <p className="mt-2 font-mono text-[11px] text-paper-muted">
        {hostOf(evidence.source_url)}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule pt-3
                     sm:grid-cols-4">
        <div>
          <dt className="label">Submitted by</dt>
          <dd className="mt-1 font-mono text-[11px] text-paper-muted">
            {shortAddress(evidence.submitted_by)}
          </dd>
        </div>
        <div>
          <dt className="label">Version</dt>
          <dd className="mt-1 font-mono text-[11px] text-paper-muted">
            v{evidence.claim_version}
          </dd>
        </div>
        <div>
          <dt className="label">Submitted</dt>
          <dd className="mt-1 font-mono text-[11px] text-paper-muted">
            {protocolTime(evidence.submitted_at)}
          </dd>
        </div>
        <div>
          <dt className="label">Status</dt>
          <dd className="mt-1 font-mono text-[11px] text-paper-muted">
            {evidence.status.toLowerCase()}
          </dd>
        </div>
      </dl>

      <div className="mt-4 space-y-2 border-t border-rule pt-3">
        <div className="flex items-baseline gap-2">
          <span className="label shrink-0">Panel finding</span>
          {ruled ? (
            <RelationshipTag value={evidence.adjudicated_relationship} adjudicated />
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]
                             text-paper-faint/70">
              not yet adjudicated
            </span>
          )}
          {ruled && <RetrievalTag value={evidence.retrieval} />}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="label shrink-0">Submitter asserts</span>
          <RelationshipTag value={evidence.declared_relationship} adjudicated={false} />
        </div>
      </div>

      <footer className="mt-4 flex items-center justify-between gap-4 border-t border-rule pt-3">
        <SourceLink url={evidence.source_url} />
        {ruled && (
          <span className="font-mono text-[10px] text-paper-faint">
            in {evidence.adjudicated_in}
          </span>
        )}
      </footer>
    </article>
  );
}
