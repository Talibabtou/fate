"use client";

import type { WalletSession } from "./use-wallet-session";
import { StaticWalletControls, WalletControls } from "./wallet-controls";

export function FateNavbar({
  hasPrivy,
  network,
  walletSession,
}: {
  hasPrivy: boolean;
  network: string;
  walletSession: WalletSession;
}) {
  return (
    <header className="fate-header">
      <div className="brand-lockup">
        <span className="display-font brand-name">Fate</span>
        <span className="brand-note">one draw at a time</span>
      </div>
      <div className="header-actions">
        <span className="network-mark">{network}</span>
        {hasPrivy ? <WalletControls session={walletSession} /> : <StaticWalletControls />}
      </div>
    </header>
  );
}
