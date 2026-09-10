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

/**
 * ONE network definition, and every consumer derives from it.
 *
 * The chain id used to come from its own env var while the clients were
 * built with `studionet` — so a wallet could be switched to one chain and
 * the transaction built for another, with nothing noticing. The id and
 * name are now read off the same chain object the clients are built with,
 * and the RPC is one value shared by the clients and the wallet's
 * add-network request. `tests/config.test.ts` holds all of them equal.
 */
export const CHAIN = studionet;
export const CHAIN_ID = CHAIN.id;
export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
export const CHAIN_NAME = CHAIN.name;
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || CHAIN.rpcUrls.default.http[0];

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

/**
 * The production configuration, in one place (steward §6).
 *
 * Reads, writes, the schema check, transaction tracking and the footer
 * readout all resolve through this module; nothing else in the app holds
 * an address, a chain id or an RPC. The ABI is not a file this build
 * ships: it is the schema the chain reports for `contractAddress`
 * (`gen_getContractSchema`), compared against the calls this build makes
 * by `lib/contracts/compat.ts` before anything is signed.
 */
export function productionConfig() {
  return {
    contractAddress: getContractAddress(),
    chainId: CHAIN_ID,
    network: CHAIN_NAME,
    rpc: RPC_URL,
    abi: "gen_getContractSchema(contractAddress), checked by lib/contracts/compat.ts",
  } as const;
}

/** A read-only client. No account, so it can never sign anything. */
export function readClient() {
  return createClient({ chain: CHAIN, endpoint: RPC_URL });
}

/**
 * A client bound to the SELECTED wallet, for writes.
 *
 * STEWARD FIX (wallet trust).
 *
 * This function used to take the provider and throw it away — the
 * parameter was literally named `_provider` — on the assumption that
 * genlayer-js would route signing through whatever the user had
 * connected. It does not. Its own source reads:
 *
 *     const provider = config.provider
 *       || (typeof window !== "undefined" ? window.ethereum : void 0);
 *
 * so omitting `provider` falls back to `window.ethereum`. With two
 * wallets installed that global is whichever extension won the injection
 * race, which meant a user could select Rabby in our picker and have
 * MetaMask sign. Connection was never the problem; signing was.
 *
 * Passing the selected provider explicitly is the whole fix: `config.provider`
 * takes precedence, so the wallet the user chose is the wallet that signs.
 * The app still never sees key material — the provider does the signing.
 */
export function writeClient(account: string, provider: Eip1193Provider) {
  if (!provider) {
    // Fail closed rather than let the fallback pick a wallet for the user.
    throw new Error(
      "No wallet provider supplied — refusing to fall back to window.ethereum.",
    );
  }
  return createClient({
    chain: CHAIN,
    endpoint: RPC_URL,
    account: account as `0x${string}`,
    // Structural pass-through: genlayer-js types this as its internal
    // EthereumProvider, which it does not export. Our Eip1193Provider is
    // the same shape (`request`, plus optional `on`/`removeListener`).
    provider: provider as unknown as
      NonNullable<Parameters<typeof createClient>[0]>["provider"],
  });
}
