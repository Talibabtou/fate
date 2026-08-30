"use client";

import { useEffect, useState } from "react";
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
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className={scrolled ? "fate-header is-scrolled" : "fate-header"}>
      <div className="brand-lockup">
        <span className="display-font brand-name">Fate</span>
      </div>
      <div className="header-actions">
        <span className="network-mark">{network}</span>
        {hasPrivy ? <WalletControls session={walletSession} /> : <StaticWalletControls />}
      </div>
    </header>
  );
}
