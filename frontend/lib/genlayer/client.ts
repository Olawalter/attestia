"use client";

/**
 * genlayer-js wiring (§32, §54).
 *
 * Every signature here was checked against the official boilerplate and
 * the deployed schema rather than assumed: `createClient` from
 * `genlayer-js`, `studionet` from `genlayer-js/chains`, and the
 * `readContract` / `writeContract` / `waitForTransactionReceipt` shapes.
 */
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Eip1193Provider } from "./wallet";

export const CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "61999",
);
export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
export const CHAIN_NAME =
  process.env.NEXT_PUBLIC_GENLAYER_CHAIN_NAME || "GenLayer Studio";
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

/** For `wallet_addEthereumChain` when the wallet does not know the chain. */
export const NETWORK_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN_NAME,
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [] as string[],
};

/**
 * §59 — a missing address is reported, never invented. Returning "" lets
 * the build succeed and the UI say plainly that it has no contract to
 * read, which is the honest failure mode.
 */
export function getContractAddress(): string {
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
}

export function hasContract(): boolean {
  return Boolean(getContractAddress());
}

/** A read-only client. No account, so it can never sign anything. */
export function readClient() {
  return createClient({ chain: studionet, endpoint: RPC_URL });
}

/**
 * A client bound to the connected wallet, for writes.
 *
 * genlayer-js takes the account address and routes signing through the
 * injected provider; the app never sees key material.
 */
export function writeClient(account: string, _provider: Eip1193Provider) {
  return createClient({
    chain: studionet,
    endpoint: RPC_URL,
    account: account as `0x${string}`,
  });
}
