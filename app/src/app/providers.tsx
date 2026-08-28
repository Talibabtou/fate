"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { fatePublicConfig } from "../lib/public-config";

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  const appId = fatePublicConfig.privyAppId;

  // Keep the read-only preview usable until the public Privy app ID is configured.
  if (!appId) return children;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "#0b100f",
          showWalletLoginFirst: true,
          landingHeader: "Connect to Fate",
          loginMessage: "Choose a Solana wallet to continue.",
          walletList: ["jupiter", "phantom"],
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
