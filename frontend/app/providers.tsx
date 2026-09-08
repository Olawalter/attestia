"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { WalletProvider } from "@/lib/genlayer/wallet";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per mount, with calm defaults: the public RPC is shared
  // and rate-limited, and refetching on every window focus buys nothing
  // for records that change on the timescale of a challenge window.
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={client}>
      <WalletProvider>{children}</WalletProvider>
    </QueryClientProvider>
  );
}
