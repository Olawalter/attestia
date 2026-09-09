import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A consensus-observed UTC second, rendered as a date.
 *
 * These are real timestamps now: the contract reads them from a public
 * clock through a validator round. Before the steward fix the only
 * "time" available was a caller-advanced counter, which is why the UI
 * used to render durations instead — printing that as a date would have
 * been inventing information the protocol did not have.
 */
export function utcTime(seconds: number): string {
  const value = Number(seconds || 0);
  if (value <= 0) return "—";
  return new Date(value * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** A per-claim sequence number. Ordering, never a clock. */
export function seq(value: number): string {
  return `#${Number(value || 0)}`;
}

/** Protocol seconds, rendered as a duration rather than a fake wall clock.
 *
 * The contract's clock counts seconds advanced by transactions, not
 * seconds since an epoch (see the contract's §12 note). Printing it as a
 * calendar date would be inventing information the protocol does not
 * have, so it is always shown as protocol time.
 */
export function protocolTime(seconds: number): string {
  const value = Number(seconds || 0);
  if (value <= 0) return "t+0";
  if (value < 60) return `t+${value}s`;
  if (value < 3600) return `t+${Math.floor(value / 60)}m`;
  if (value < 86400) return `t+${Math.floor(value / 3600)}h`;
  return `t+${Math.floor(value / 86400)}d`;
}

export function duration(seconds: number): string {
  const value = Math.max(0, Number(seconds || 0));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.round(value / 60)} min`;
  if (value < 86400) return `${Math.round(value / 3600)} h`;
  return `${Math.round(value / 86400)} d`;
}

export function shortAddress(address: string, chars = 4): string {
  if (!address) return "—";
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
