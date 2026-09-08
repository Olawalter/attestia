"use client";

/**
 * §34, §59 — the write lifecycle, shown as it actually happened.
 *
 * The rule this component exists to enforce: a transaction hash means
 * SUBMITTED, not success. Nothing here says finalized until the receipt
 * has been read, and a revert is reported as a revert with the contract's
 * own reason rather than being smoothed into a generic error.
 */
import { Check, CircleDot, Loader2, X } from "lucide-react";

import type { TxPhase } from "@/lib/contracts/types";
import type { TxState } from "@/lib/hooks/useAttestia";
import { cn } from "@/lib/utils";

const SEQUENCE: { phase: TxPhase; label: string }[] = [
  { phase: "signing", label: "Awaiting wallet signature" },
  { phase: "submitted", label: "Transaction submitted" },
  { phase: "pending", label: "GenLayer consensus" },
  { phase: "finalized", label: "Finalized on chain" },
];

const ORDER: Record<string, number> = {
  idle: -1, signing: 0, submitted: 1, pending: 2, finalized: 3,
};

export function TxTrack({ tx }: { tx: TxState }) {
  if (tx.phase === "idle") return null;

  const failed = tx.phase === "reverted" || tx.phase === "failed"
    || tx.phase === "rejected";
  const reached = ORDER[tx.phase] ?? -1;

  return (
    <div className="border border-rule bg-ink-sunken p-3">
      <ol className="space-y-1.5">
        {SEQUENCE.map((step, index) => {
          const done = !failed && reached > index;
          const active = !failed && reached === index;
          const stalled = failed && reached >= index;
          return (
            <li key={step.phase} className="flex items-center gap-2 text-xs">
              {done ? (
                <Check className="h-3.5 w-3.5 text-verdict-supported" aria-hidden />
              ) : active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" aria-hidden />
              ) : stalled ? (
                <X className="h-3.5 w-3.5 text-[#c2695e]" aria-hidden />
              ) : (
                <CircleDot className="h-3.5 w-3.5 text-paper-faint/40" aria-hidden />
              )}
              <span className={cn(
                done && "text-paper-muted",
                active && "text-paper",
                !done && !active && "text-paper-faint/60",
              )}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {tx.hash && (
        <p className="mt-2.5 break-all border-t border-rule pt-2 font-mono text-[10px] text-paper-faint">
          {tx.hash}
        </p>
      )}

      {failed && (
        <p className="mt-2 border-t border-rule pt-2 text-xs text-[#e0a49b]">
          {tx.phase === "rejected" && "Signature declined in the wallet."}
          {tx.phase === "reverted"
            && `Accepted by the network, then reverted: ${tx.message}`}
          {tx.phase === "failed" && (tx.message || "The transaction failed.")}
        </p>
      )}
    </div>
  );
}
