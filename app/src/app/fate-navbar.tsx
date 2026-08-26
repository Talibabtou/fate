"use client";

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { StaticWalletControls, WalletControls, type WalletStatus } from "./wallet-controls";

export function FateNavbar({
  hasPrivy,
  network,
  onAddressChange,
  onStatusChange,
  onWalletChange,
}: {
  hasPrivy: boolean;
  network: string;
  onAddressChange: (address: string | null) => void;
  onStatusChange: (status: WalletStatus) => void;
  onWalletChange: (wallet: ConnectedStandardSolanaWallet | null) => void;
}) {
  return (
    <header className="fate-header">
      <div className="brand-lockup">
        <span className="display-font brand-name">Fate</span>
        <span className="brand-note">one draw at a time</span>
      </div>
      <div className="header-actions">
        <span className="network-mark">{network}</span>
        {hasPrivy ? (
          <WalletControls
            onAddressChange={onAddressChange}
            onStatusChange={onStatusChange}
            onWalletChange={onWalletChange}
          />
        ) : (
          <StaticWalletControls />
        )}
      </div>
    </header>
  );
}
