"use client";

/**
 * The wallet control (§33).
 *
 * Every state §33 lists is reachable and visible here: disconnected,
 * connecting, connected, wrong network, switching network. The picker
 * lists what actually announced itself over EIP-6963 — if two wallets
 * are installed, both appear and the user chooses, rather than the page
 * deciding for them.
 */
import { useState } from "react";
import { ChevronDown, Wallet as WalletIcon } from "lucide-react";

import { useWallet, CHAIN_NAME } from "@/lib/genlayer/wallet";
import { shortAddress } from "@/lib/utils";
import { Button, Banner } from "./ui";

export function WalletButton() {
  const {
    wallets, selected, address, status, error, connect, disconnect, switchNetwork,
  } = useWallet();
  const [open, setOpen] = useState(false);

  if (status === "connecting") {
    return <Button size="sm" disabled>Connecting…</Button>;
  }

  if (status === "switching-network") {
    return <Button size="sm" disabled>Switching network…</Button>;
  }

  if (status === "wrong-network") {
    return (
      <Button size="sm" variant="danger" onClick={switchNetwork}>
        Wrong network — switch to {CHAIN_NAME}
      </Button>
    );
  }

  if (status === "connected" && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-xs text-paper-muted sm:inline">
          {selected?.info.name}
        </span>
        <Button size="sm" variant="ghost" onClick={disconnect}
                title="Disconnect">
          <span className="font-mono text-xs text-paper">
            {shortAddress(address)}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((v) => !v)}
              aria-expanded={open} aria-haspopup="menu">
        <WalletIcon className="h-3.5 w-3.5" aria-hidden />
        Connect wallet
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </Button>

      {open && (
        <div role="menu"
             className="absolute right-0 z-50 mt-2 w-64 border border-rule bg-ink-raised p-1.5">
          {wallets.length === 0 ? (
            <div className="p-3">
              <Banner>
                No wallet announced itself. Install an EIP-6963 compatible
                wallet — MetaMask, Rabby, Trust, Coinbase Wallet and others
                all qualify — then reload.
              </Banner>
            </div>
          ) : (
            wallets.map((wallet) => (
              <button
                key={wallet.info.uuid}
                role="menuitem"
                onClick={async () => { setOpen(false); await connect(wallet); }}
                className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left
                           text-sm text-paper hover:bg-ink-sunken"
              >
                {wallet.info.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={wallet.info.icon} alt="" className="h-5 w-5" />
                ) : (
                  <WalletIcon className="h-4 w-4 text-paper-faint" aria-hidden />
                )}
                <span>{wallet.info.name}</span>
              </button>
            ))
          )}
          <p className="px-2.5 pb-1.5 pt-2 text-[10px] leading-relaxed text-paper-faint">
            Attestia never asks for a seed phrase, private key or wallet
            password.
          </p>
        </div>
      )}

      {error && (
        <div className="absolute right-0 z-50 mt-2 w-64">
          <Banner kind="warn">{error}</Banner>
        </div>
      )}
    </div>
  );
}

/** Gate for actions that need a connected wallet on the right chain. */
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const { status } = useWallet();
  if (status === "connected") return <>{children}</>;
  return (
    <Banner>
      {status === "wrong-network"
        ? `Connected to the wrong network — switch to ${CHAIN_NAME} to sign.`
        : "Connect a wallet to act on this case."}
    </Banner>
  );
}
