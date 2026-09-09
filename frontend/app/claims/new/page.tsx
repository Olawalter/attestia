"use client";

/**
 * Submit a claim.
 *
 * Two transactions, shown as two: creating the claim and opening it for
 * evidence are separate protocol acts, and collapsing them into one
 * button would misrepresent what the chain is doing (§34).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import * as api from "@/lib/contracts/attestia";
import { useContractWrite, keys } from "@/lib/hooks/useAttestia";
import { duration } from "@/lib/utils";
import { Banner, Button, Card, CardHead } from "@/components/ui";
import { RequireWallet } from "@/components/Wallet";
import { TxTrack } from "@/components/TxTrack";

const MAX_CLAIM = 1000;

const CONTEST_WINDOWS = [
  { label: "2 minutes", seconds: 120 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "3 days", seconds: 3 * 86400 },
];

const WINDOWS = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
];

export default function NewClaimPage() {
  const router = useRouter();
  const { tx, run, busy } = useContractWrite();
  const [text, setText] = useState("");
  const [window, setWindow] = useState(3600);
  const [contest, setContest] = useState(3 * 24 * 3600);
  const [claimId, setClaimId] = useState("");

  const tooLong = text.length > MAX_CLAIM;
  const canSubmit = text.trim().length > 0 && !tooLong && !busy;

  async function createClaim() {
    const result = await run({
      run: (ctx) => api.createClaim(text.trim(), window, contest, ctx),
      invalidate: [keys.info, ["claims"]],
    });
    if (result.phase === "finalized") {
      // The contract mints the id; read it back rather than guessing.
      const page = await api.listClaims(0, 100);
      const mine = page.rows[page.rows.length - 1];
      if (mine) setClaimId(mine.claim_id);
    }
  }

  async function openForEvidence() {
    const result = await run({
      run: (ctx) => api.openClaim(claimId, ctx),
      invalidate: [keys.claim(claimId), ["claims"]],
    });
    if (result.phase === "finalized") router.push(`/claims/${claimId}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-serif text-3xl text-paper">Submit a claim</h1>
        <p className="mt-2 text-sm leading-relaxed text-paper-muted">
          State something disputable and checkable. The protocol will not decide
          whether it is true in the abstract — it decides what the evidence filed
          against it actually shows.
        </p>
      </header>

      <RequireWallet>
        <Card>
          <CardHead>The claim</CardHead>
          <div className="space-y-5 p-4">
            <div>
              <label htmlFor="claim-text" className="label">Claim text</label>
              <textarea
                id="claim-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                disabled={Boolean(claimId)}
                placeholder="Protocol X suffered a security exploit on June 12, 2026."
                className="mt-2 w-full resize-y border border-rule bg-ink-sunken px-3 py-2.5
                           font-serif text-[15px] leading-relaxed text-paper outline-none
                           placeholder:text-paper-faint focus:border-gold disabled:opacity-50"
              />
              <p className={`mt-1.5 font-mono text-[10px] ${
                tooLong ? "text-[#c2695e]" : "text-paper-faint"}`}>
                {text.length} / {MAX_CLAIM}
              </p>
            </div>

            <div>
              <span className="label">Evidence window</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {WINDOWS.map((option) => (
                  <button
                    key={option.seconds}
                    type="button"
                    disabled={Boolean(claimId)}
                    onClick={() => setWindow(option.seconds)}
                    className={`border px-3 py-1.5 font-mono text-xs transition-colors
                      disabled:opacity-50 ${
                      window === option.seconds
                        ? "border-gold text-gold"
                        : "border-rule text-paper-muted hover:border-rule-strong"}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-paper-faint">
                How long the record stays open for submissions, in real
                seconds. The deadline is checked against a clock the
                validator panel reads — not one anybody at a keyboard can
                move.
              </p>
            </div>

            <div>
              <span className="label">Challenge window</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {CONTEST_WINDOWS.map((option) => (
                  <button
                    key={option.seconds}
                    type="button"
                    disabled={Boolean(claimId)}
                    onClick={() => setContest(option.seconds)}
                    className={`border px-3 py-1.5 font-mono text-xs transition-colors
                      disabled:opacity-50 ${
                      contest === option.seconds
                        ? "border-gold text-gold"
                        : "border-rule text-paper-muted hover:border-rule-strong"}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-paper-faint">
                How long your verdict may be contested. You choose it now,
                before anyone knows what the verdict will be, and it is
                frozen at creation — neither you nor anyone else can
                shorten it afterwards.
              </p>
            </div>

            {!claimId ? (
              <Button variant="gold" onClick={createClaim} disabled={!canSubmit}>
                {busy ? "Working…" : "Create claim"}
              </Button>
            ) : (
              <div className="space-y-3">
                <Banner>
                  Claim <span className="font-mono text-paper">{claimId}</span> is
                  filed and sits in DRAFT. It accepts no evidence until it is
                  opened — a second transaction, because it is a second act.
                </Banner>
                <Button variant="gold" onClick={openForEvidence} disabled={busy}>
                  {busy ? "Working…" : `Open for evidence (${duration(window)})`}
                </Button>
              </div>
            )}

            <TxTrack tx={tx} />
          </div>
        </Card>
      </RequireWallet>
    </div>
  );
}
