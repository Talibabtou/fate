"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  // Keep the read-only preview usable until the public Privy app ID is configured.
  if (!appId) return children;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          showWalletLoginFirst: true,
          walletChainType: "solana-only",
        },
        embeddedWallets: {
          solana: { createOnLogin: "off" },
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        loginMethods: ["wallet"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
