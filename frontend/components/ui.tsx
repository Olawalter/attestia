"use client";

/**
 * Shared primitives, in the shadcn/ui idiom (§32): composition, CVA
 * variants, `cn` for class merging.
 *
 * Several of these exist specifically to make §59 hard to violate. A
 * verdict cannot be rendered without going through `VerdictStamp`, which
 * refuses to print anything for an empty verdict; a submitter's opinion
 * cannot be rendered as a finding, because `RelationshipTag` labels the
 * two differently and says which is which.
 */
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, ExternalLink, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Relationship, Verdict } from "@/lib/contracts/types";

// ─── button ─────────────────────────────────────────────────────────────
const button = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors " +
  "disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap",
  {
    variants: {
      variant: {
        gold: "bg-gold text-ink hover:bg-[#e0be48]",
        outline: "border border-rule-strong text-paper hover:border-gold hover:text-gold",
        ghost: "text-paper-muted hover:text-paper",
        danger: "border border-[#5d302b] text-[#c2695e] hover:bg-[#1a0f0e]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-sm",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

export function LinkButton({
  href, className, variant, size, children,
}: { href: string; children: React.ReactNode } & VariantProps<typeof button> & {
  className?: string;
}) {
  return (
    <Link href={href} className={cn(button({ variant, size }), className)}>
      {children}
    </Link>
  );
}

// ─── surfaces ───────────────────────────────────────────────────────────
export function Card({ className, children }: {
  className?: string; children: React.ReactNode;
}) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHead({ children, right }: {
  children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-rule px-4 py-2.5">
      <span className="label">{children}</span>
      {right}
    </div>
  );
}

export function Field({ label, children, mono }: {
  label: string; children: React.ReactNode; mono?: boolean;
}) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={cn("mt-1 text-sm text-paper break-words",
                        mono && "font-mono text-xs")}>
        {children}
      </dd>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-paper-faint">{children}</p>
  );
}

export function Banner({ kind = "info", children }: {
  kind?: "info" | "warn"; children: React.ReactNode;
}) {
  const Icon = kind === "warn" ? AlertTriangle : Info;
  return (
    <div
      role={kind === "warn" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2.5 border px-3 py-2.5 text-xs leading-relaxed",
        kind === "warn"
          ? "border-[#5d302b] bg-[#160e0d] text-[#e0a49b]"
          : "border-rule bg-ink-sunken text-paper-muted",
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Mono({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("font-mono text-xs text-paper-muted", className)}>
      {value}
    </span>
  );
}

export function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1.5 font-mono text-xs text-gold hover:underline"
    >
      Open source <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

// ─── protocol vocabulary ────────────────────────────────────────────────

const VERDICT_STYLE: Record<string, string> = {
  SUPPORTED: "text-verdict-supported",
  PARTIALLY_SUPPORTED: "text-verdict-partial",
  CONTRADICTED: "text-verdict-contradicted",
  INCONCLUSIVE: "text-verdict-inconclusive",
  OUTDATED: "text-verdict-outdated",
};

/**
 * §59 — a verdict is printed only when the protocol has actually reached
 * one. An empty verdict renders as an explicit absence, never as a
 * neutral-looking placeholder that could be mistaken for a finding.
 */
export function VerdictStamp({ verdict, size = "md" }: {
  verdict: Verdict; size?: "sm" | "md" | "lg";
}) {
  if (!verdict) {
    return (
      <span className={cn("stamp border-dashed text-paper-faint",
                          size === "lg" && "text-sm")}>
        No verdict yet
      </span>
    );
  }
  return (
    <span
      className={cn("stamp", VERDICT_STYLE[verdict] ?? "text-paper",
                    size === "lg" && "px-3 py-1.5 text-sm",
                    size === "sm" && "px-2 py-0.5 text-[10px]")}
    >
      {verdict.replace(/_/g, " ")}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Collecting evidence",
  EVIDENCE_CLOSED: "Evidence frozen",
  ADJUDICATING: "Adjudicating",
  ADJUDICATED: "Challenge window",
  CHALLENGED: "Challenged",
  RE_ADJUDICATING: "Re-adjudicating",
  FINALIZED: "Finalized",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * §15, §39 — a submitter's declaration and the panel's finding are
 * different things and must never look the same. The declared value is
 * shown quietly and labelled as a claim about the source; the
 * adjudicated one is shown as a finding, and only exists once a panel
 * has ruled.
 */
export function RelationshipTag({ value, adjudicated }: {
  value: Relationship; adjudicated: boolean;
}) {
  if (!value || value === "UNCLASSIFIED") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">
        {adjudicated ? "not classified" : "unclassified"}
      </span>
    );
  }
  const tone = adjudicated
    ? {
        SUPPORTS: "text-verdict-supported",
        CONTRADICTS: "text-verdict-contradicted",
        PARTIALLY_SUPPORTS: "text-verdict-partial",
        IRRELEVANT: "text-paper-faint",
        OUTDATED: "text-verdict-outdated",
        RELATED: "text-paper-muted",
      }[value] ?? "text-paper"
    : "text-paper-faint";

  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.12em]",
        tone,
        adjudicated && "border-b border-current pb-px",
      )}
      title={adjudicated
        ? "Determined by the validator panel"
        : "Asserted by the submitter — not verified"}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

const RETRIEVAL_LABEL: Record<string, string> = {
  SOURCE_OK: "retrieved",
  SOURCE_UNAVAILABLE: "could not be retrieved",
  SOURCE_INVALID: "returned nothing usable",
};

export function RetrievalTag({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className={cn(
      "font-mono text-[10px] uppercase tracking-[0.12em]",
      value === "SOURCE_OK" ? "text-paper-faint" : "text-[#c2695e]",
    )}>
      {RETRIEVAL_LABEL[value] ?? value}
    </span>
  );
}
