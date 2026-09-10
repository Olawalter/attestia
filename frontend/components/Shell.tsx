"use client";

/**
 * The application shell: a command strip over a working surface.
 *
 * The layout is deliberately not a dashboard. Attestia is a place where
 * records are read and filed, so the chrome is thin, the rules are
 * hairlines, and the page itself is the document.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { getContractAddress, hasContract, productionConfig } from "@/lib/genlayer/client";
import { useWallet } from "@/lib/genlayer/wallet";
import { useDeploymentCheck } from "@/lib/hooks/useAttestia";
import { describe } from "@/lib/contracts/compat";
import { cn } from "@/lib/utils";
import { WalletButton } from "./Wallet";
import { Banner } from "./ui";

const NAV = [
  { href: "/claims", label: "Claims" },
  { href: "/claims/new", label: "Submit a claim" },
  { href: "/verify", label: "Verify" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const configured = hasContract();
  const { data: compat } = useDeploymentCheck();

  return (
    <div className="min-h-screen">
      {!configured && (
        <div role="alert"
             className="border-b border-[#5d302b] bg-[#160e0d] px-4 py-2 text-center
                        font-mono text-[11px] text-[#e0a49b]">
          NEXT_PUBLIC_CONTRACT_ADDRESS is not set — this app has no contract to read.
        </div>
      )}
      {compat && !compat.compatible && (
        <div role="alert"
             className="border-b border-[#5d302b] bg-[#160e0d] px-4 py-2 text-center
                        font-mono text-[11px] leading-relaxed text-[#e0a49b]">
          {getContractAddress()} is not the deployment this app was built for
          — {describe(compat)}. Writes are disabled; reads may be incomplete.
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-rule bg-ink/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="font-mono text-sm tracking-[0.2em] text-paper">
              ATTESTIA
            </span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-6 sm:flex">
            {NAV.map((item) => {
              const active = path === item.href
                || (item.href !== "/claims/new" && path.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "text-sm transition-colors",
                    active ? "text-gold" : "text-paper-muted hover:text-paper",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <WalletButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>

      <footer className="mt-16 border-t border-rule">
        <div className="mx-auto max-w-6xl space-y-3 px-5 py-6">
          <p className="font-mono text-[10px] leading-relaxed tracking-[0.1em] text-paper-faint">
            DETERMINISTIC CODE GOVERNS THE CASE. GENLAYER GOVERNS THE JUDGMENT.
          </p>
          <DeploymentReadout />
        </div>
      </footer>
    </div>
  );
}

/**
 * What this page is actually wired to (steward §7, §22).
 *
 * Every value comes from `productionConfig()` and the connected wallet —
 * the same values the read and write clients use — so a reader of the
 * live site can check the deployment without opening dev tools: one
 * contract for reads and writes, the chain, the RPC, and which wallet
 * would sign, on which chain it currently sits.
 */
function DeploymentReadout() {
  const cfg = productionConfig();
  const { selected, address, chainId } = useWallet();
  if (!cfg.contractAddress) return null;

  const walletChain = chainId ? Number.parseInt(chainId, 16) : null;
  const onChain = walletChain === cfg.chainId;
  let rpcHost = cfg.rpc;
  try {
    rpcHost = new URL(cfg.rpc).host;
  } catch {
    // an unparseable override is shown as configured
  }

  return (
    <dl className="grid gap-x-6 gap-y-1 font-mono text-[10px] leading-relaxed text-paper-faint
                   sm:grid-cols-[auto_1fr]">
      <dt>READS + WRITES</dt>
      <dd className="break-all text-paper-muted" data-testid="contract-address">
        {cfg.contractAddress}
      </dd>
      <dt>NETWORK</dt>
      <dd>{cfg.network} · chain {cfg.chainId} · {rpcHost}</dd>
      {selected && address && (
        <>
          <dt>SIGNER</dt>
          <dd className="break-all">
            {selected.info.name} · {address} ·{" "}
            <span className={onChain ? "text-paper-muted" : "text-[#e0a49b]"}>
              wallet on chain {walletChain ?? "unknown"}
              {onChain ? "" : ` — expected ${cfg.chainId}`}
            </span>
          </dd>
        </>
      )}
    </dl>
  );
}

/**
 * The mark: a seal split by a rule.
 *
 * The upper half is the record — stacked lines of evidence. The lower is
 * the finding stamped across it. The rule between them is the boundary
 * this whole protocol is built on: what the case holds, and what the
 * panel concluded, are not the same layer.
 */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <rect x="1" y="1" width="22" height="22" fill="none"
            stroke="#d4af37" strokeWidth="1.2" />
      <line x1="5" y1="7" x2="15" y2="7" stroke="#f5f5f2" strokeWidth="1.2" />
      <line x1="5" y1="10" x2="19" y2="10" stroke="#f5f5f2" strokeWidth="1.2" />
      <line x1="1" y1="13.5" x2="23" y2="13.5" stroke="#d4af37" strokeWidth="1.2" />
      <path d="M6 18.5 L10 21 L18 16" fill="none" stroke="#d4af37"
            strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

export { Banner };
