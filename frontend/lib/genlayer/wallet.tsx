"use client";

/**
 * §33 — wallet-agnostic discovery.
 *
 * The official boilerplate reads `window.ethereum` and calls it MetaMask.
 * §33 forbids exactly that, and it is wrong on its own terms: with more
 * than one extension installed that global is whichever won the injection
 * race, so a user can end up signing from a wallet they never chose.
 *
 * EIP-6963 fixes it properly. Wallets ANNOUNCE themselves, the page
 * collects the announcements, and the user picks one. `window.ethereum`
 * is used only as a last-resort fallback for a wallet too old to
 * announce, and it is labelled as an unidentified injected provider
 * rather than given a brand it may not have.
 *
 * No seed phrase, private key or wallet password is ever requested,
 * stored, or logged — here or anywhere else in this app.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";

import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_NAME, NETWORK_PARAMS } from "./client";

/** EIP-1193 provider surface, the part this app uses. */
export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface DiscoveredWallet {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

/** §33 — the connection states the UI must be able to show. */
export type WalletStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong-network"
  | "switching-network";

interface WalletContextValue {
  wallets: DiscoveredWallet[];
  selected: DiscoveredWallet | null;
  address: string | null;
  chainId: string | null;
  status: WalletStatus;
  error: string | null;
  connect: (wallet: DiscoveredWallet) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<DiscoveredWallet>;
  }
  interface Window {
    ethereum?: Eip1193Provider & { isMetaMask?: boolean };
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [selected, setSelected] = useState<DiscoveredWallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  // ── discovery ───────────────────────────────────────────────────────
  useEffect(() => {
    const seen = new Map<string, DiscoveredWallet>();

    const onAnnounce = (event: CustomEvent<DiscoveredWallet>) => {
      const detail = event.detail;
      if (!detail?.info?.uuid) return;
      seen.set(detail.info.uuid, detail);
      setWallets(Array.from(seen.values()));
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    // Ask anyone already loaded to announce itself.
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Fallback for a wallet too old to announce. It is NOT given a brand:
    // an unidentified injected provider is exactly what it is.
    const timer = window.setTimeout(() => {
      if (seen.size === 0 && window.ethereum) {
        const fallback: DiscoveredWallet = {
          info: {
            uuid: "injected-fallback",
            name: "Injected wallet",
            icon: "",
            rdns: "unknown.injected",
          },
          provider: window.ethereum,
        };
        seen.set(fallback.info.uuid, fallback);
        setWallets(Array.from(seen.values()));
      }
    }, 400);

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.clearTimeout(timer);
    };
  }, []);

  const applyChain = useCallback((raw: unknown) => {
    const hex = typeof raw === "string" ? raw : null;
    setChainId(hex);
    setStatus((prev) => {
      if (prev === "disconnected" || prev === "connecting") return prev;
      if (!hex) return prev;
      return hex.toLowerCase() === CHAIN_ID_HEX.toLowerCase()
        ? "connected"
        : "wrong-network";
    });
  }, []);

  // ── account / chain changes (§54.9) ─────────────────────────────────
  useEffect(() => {
    if (!selected?.provider?.on) return;
    const provider = selected.provider;

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[] | undefined;
      if (!accounts || accounts.length === 0) {
        setAddress(null);
        setStatus("disconnected");
        return;
      }
      setAddress(accounts[0]);
    };
    const onChain = (...args: never[]) => applyChain(args[0]);

    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [selected, applyChain]);

  const connect = useCallback(async (wallet: DiscoveredWallet) => {
    setError(null);
    setStatus("connecting");
    try {
      const accounts = (await wallet.provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!accounts?.length) {
        setStatus("disconnected");
        setError("The wallet returned no accounts.");
        return;
      }
      const currentChain = (await wallet.provider.request({
        method: "eth_chainId",
      })) as string;

      setSelected(wallet);
      setAddress(accounts[0]);
      setChainId(currentChain);
      setStatus(
        currentChain?.toLowerCase() === CHAIN_ID_HEX.toLowerCase()
          ? "connected"
          : "wrong-network",
      );
    } catch (err) {
      setStatus("disconnected");
      const code = (err as { code?: number })?.code;
      // 4001 is the user declining, which is not a failure to report as one.
      setError(code === 4001
        ? "Connection request declined."
        : (err as Error)?.message || "Could not connect to the wallet.");
    }
  }, []);

  const disconnect = useCallback(() => {
    setSelected(null);
    setAddress(null);
    setChainId(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!selected) return;
    setStatus("switching-network");
    setError(null);
    try {
      await selected.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
      setStatus("connected");
      setChainId(CHAIN_ID_HEX);
    } catch (err) {
      // 4902 — the chain is unknown to this wallet, so offer to add it.
      if ((err as { code?: number })?.code === 4902) {
        try {
          await selected.provider.request({
            method: "wallet_addEthereumChain",
            params: [NETWORK_PARAMS],
          });
          setStatus("connected");
          setChainId(CHAIN_ID_HEX);
          return;
        } catch (addErr) {
          setError((addErr as Error)?.message
            || `Could not add ${CHAIN_NAME} to this wallet.`);
        }
      } else {
        setError((err as Error)?.message || "Network switch declined.");
      }
      setStatus("wrong-network");
    }
  }, [selected]);

  const value = useMemo<WalletContextValue>(() => ({
    wallets, selected, address, chainId, status, error,
    connect, disconnect, switchNetwork,
  }), [wallets, selected, address, chainId, status, error,
      connect, disconnect, switchNetwork]);

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

export { CHAIN_ID, CHAIN_ID_HEX, CHAIN_NAME };
