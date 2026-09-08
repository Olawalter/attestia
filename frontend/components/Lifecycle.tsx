"use client";

/**
 * §40 — the adjudication lifecycle.
 *
 * Each stage is derived from contract state, never from a timer or an
 * optimistic guess. "Consensus" is marked reached only because an
 * adjudication record exists on chain; "Finalization" only because the
 * claim actually says FINALIZED. §59 is the whole design constraint
 * here: the UI must not be able to run ahead of the protocol.
 */
import { Check, Circle, Loader2 } from "lucide-react";

import type { Claim } from "@/lib/contracts/types";
import { cn } from "@/lib/utils";

type StageState = "done" | "active" | "pending";

const ORDER = [
  "DRAFT", "OPEN", "EVIDENCE_CLOSED", "ADJUDICATING", "RE_ADJUDICATING",
  "ADJUDICATED", "CHALLENGED", "FINALIZED",
];

export function Lifecycle({ claim }: { claim: Claim }) {
  const reached = (statuses: string[]) => statuses.includes(claim.status);
  const past = (status: string) =>
    ORDER.indexOf(claim.status) > ORDER.indexOf(status);

  const adjudicating = reached(["ADJUDICATING", "RE_ADJUDICATING"]);
  const hasVerdict = claim.adjudication_count > 0;
  const finalized = claim.status === "FINALIZED";

  const stages: { label: string; state: StageState; note?: string }[] = [
    {
      label: "Evidence collection",
      state: claim.status === "OPEN" ? "active"
        : claim.status === "DRAFT" ? "pending" : "done",
      note: `${claim.evidence_count} on version ${claim.current_version}`,
    },
    {
      label: "Evidence frozen",
      state: claim.status === "EVIDENCE_CLOSED" ? "active"
        : past("EVIDENCE_CLOSED") ? "done" : "pending",
    },
    {
      label: "Panel evaluation",
      state: adjudicating ? "active" : hasVerdict ? "done" : "pending",
      note: adjudicating ? "validators are running the round" : undefined,
    },
    {
      label: "Consensus",
      state: hasVerdict ? "done" : "pending",
      note: hasVerdict
        ? `${claim.adjudication_count} round${claim.adjudication_count > 1 ? "s" : ""} recorded`
        : undefined,
    },
    {
      label: "Finalization",
      state: finalized ? "done"
        : claim.status === "ADJUDICATED" ? "active" : "pending",
      note: claim.status === "ADJUDICATED" ? "challenge window open" : undefined,
    },
  ];

  return (
    <ol className="space-y-2.5">
      {stages.map((stage) => (
        <li key={stage.label} className="flex items-center gap-2.5">
          {stage.state === "done" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-verdict-supported" aria-hidden />
          ) : stage.state === "active" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gold" aria-hidden />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0 text-paper-faint/30" aria-hidden />
          )}
          <span className={cn(
            "text-xs",
            stage.state === "done" && "text-paper-muted",
            stage.state === "active" && "text-paper",
            stage.state === "pending" && "text-paper-faint/60",
          )}>
            {stage.label}
          </span>
          {stage.note && (
            <span className="ml-auto font-mono text-[10px] text-paper-faint">
              {stage.note}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
