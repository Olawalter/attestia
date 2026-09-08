"use client";

/**
 * §41 — the attestation screen, and §30's agent-facing answer.
 *
 * Verification is a contract call, not a rendering trick: the page asks
 * `verify_attestation`, which re-derives every claim the attestation
 * makes against live state. An attestation that fails any check is shown
 * as invalid, with the contract's own reason — never quietly rendered as
 * if it passed (§59).
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, ShieldAlert } from "lucide-react";

import { useAttestation, useAttestationCheck } from "@/lib/hooks/useAttestia";
import { getContractAddress } from "@/lib/genlayer/client";
import { protocolTime } from "@/lib/utils";
import {
  Banner, Button, Card, CardHead, Empty, Field, VerdictStamp,
} from "@/components/ui";

export default function VerifyPage() {
  return (
    <Suspense fallback={<Empty>Loading…</Empty>}>
      <VerifyScreen />
    </Suspense>
  );
}

function VerifyScreen() {
  const params = useSearchParams();
  const [input, setInput] = useState(params.get("id") ?? "");
  const [target, setTarget] = useState(params.get("id") ?? "");
  const [checking, setChecking] = useState(Boolean(params.get("id")));

  const { data: attestation, isLoading } = useAttestation(target);
  const { data: check, isFetching } = useAttestationCheck(target, checking);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-serif text-3xl text-paper">Verify an attestation</h1>
        <p className="mt-2 text-sm leading-relaxed text-paper-muted">
          An attestation is the finalized protocol state for one claim version.
          Verification re-derives it from the contract rather than trusting what
          the record says about itself.
        </p>
      </header>

      <Card>
        <CardHead>Attestation id</CardHead>
        <div className="flex flex-wrap gap-3 p-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="att_000001"
            className="min-w-0 flex-1 border border-rule bg-ink-sunken px-3 py-2
                       font-mono text-sm text-paper outline-none
                       placeholder:text-paper-faint focus:border-gold"
          />
          <Button variant="gold"
                  onClick={() => { setTarget(input.trim()); setChecking(true); }}
                  disabled={!input.trim()}>
            Verify
          </Button>
        </div>
      </Card>

      {target && isLoading && <Empty>Reading the attestation…</Empty>}

      {target && !isLoading && !attestation && !check?.valid && (
        <Banner kind="warn">
          No attestation with that id exists on this contract.
        </Banner>
      )}

      {attestation && (
        <Card>
          <CardHead right={
            checking && !isFetching && check ? (
              <span className={`flex items-center gap-1.5 font-mono text-[10px]
                                uppercase tracking-[0.14em] ${
                check.valid ? "text-verdict-supported" : "text-[#c2695e]"}`}>
                {check.valid
                  ? <><Check className="h-3 w-3" aria-hidden /> verified</>
                  : <><ShieldAlert className="h-3 w-3" aria-hidden /> invalid</>}
              </span>
            ) : isFetching ? (
              <span className="font-mono text-[10px] text-paper-faint">checking…</span>
            ) : null
          }>
            Attestation
          </CardHead>

          <div className="space-y-6 p-5">
            <p className="break-all font-mono text-sm text-gold">
              {attestation.attestation_id}
            </p>

            <div>
              <p className="label">Claim</p>
              <p className="mt-2 font-serif text-lg leading-snug text-paper">
                {attestation.claim_text}
              </p>
            </div>

            <div>
              <p className="label mb-2">Verdict</p>
              <VerdictStamp verdict={attestation.verdict} size="lg" />
            </div>

            <dl className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-3">
              <Field label="Claim version" mono>v{attestation.claim_version}</Field>
              <Field label="Evidence" mono>{attestation.evidence_count}</Field>
              <Field label="Challenges" mono>{attestation.challenge_count}</Field>
              <Field label="Adjudication" mono>{attestation.adjudication_id}</Field>
              <Field label="Adjudicated" mono>
                {protocolTime(attestation.adjudicated_at)}
              </Field>
              <Field label="Finalized" mono>
                {protocolTime(attestation.finalized_at)}
              </Field>
            </dl>

            <div className="border-t border-rule pt-4">
              <p className="label">Evidence snapshot hash</p>
              <p className="mt-1 break-all font-mono text-[11px] text-paper-muted">
                {attestation.evidence_snapshot_hash}
              </p>
            </div>

            <div className="border-t border-rule pt-4">
              <p className="label">GenLayer contract</p>
              <p className="mt-1 break-all font-mono text-[11px] text-paper-muted">
                {getContractAddress()}
              </p>
            </div>

            {check && (
              <div className="border-t border-rule pt-4">
                <p className="label">Verification</p>
                <p className={`mt-1.5 text-sm ${
                  check.valid ? "text-paper-muted" : "text-[#e0a49b]"}`}>
                  {check.reason}
                </p>
                {check.valid && (
                  <p className="mt-2 text-xs leading-relaxed text-paper-faint">
                    The claim still points at this attestation, the named
                    adjudication judged this version, and its verdict and
                    evidence hash both match.
                  </p>
                )}
              </div>
            )}

            <div className="border-t border-rule pt-4">
              <Link href={`/claims/${attestation.claim_id}`}
                    className="font-mono text-[11px] text-gold hover:underline">
                Open the full case file →
              </Link>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHead>For autonomous agents</CardHead>
        <div className="space-y-3 p-4">
          <p className="text-xs leading-relaxed text-paper-muted">
            Everything on this page is a contract read. An agent consumes the
            same protocol state directly, with no frontend in the path:
          </p>
          <pre className="overflow-x-auto border border-rule bg-ink-sunken p-3
                          font-mono text-[11px] leading-relaxed text-paper-muted">
{`verify_attestation("${target || "att_000001"}")
get_claim_verdict("claim_000001")
get_claim_history("claim_000001")`}
          </pre>
        </div>
      </Card>
    </div>
  );
}
