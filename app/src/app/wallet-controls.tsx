"use client";

import { useEffect, useRef, useState } from "react";
import type { WalletSession } from "./use-wallet-session";

export type { WalletStatus } from "./use-wallet-session";

export function WalletControls({ session }: { session: WalletSession }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { wallet } = session;

  useEffect(() => {
    if (!menuOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!wallet) setMenuOpen(false);
  }, [wallet]);

  if (!session.ready) return <span className="wallet-state">Checking wallet…</span>;
  if (!wallet) {
    if (session.status === "select-wallet") {
      return (
        <div className="wallet-menu" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="wallet-button"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            Choose wallet
          </button>
          {menuOpen ? (
            <WalletChoices session={session} onSelect={() => setMenuOpen(false)} />
          ) : null}
        </div>
      );
    }
    return (
      <button className="wallet-button" onClick={session.connect} type="button">
        Connect wallet
      </button>
    );
  }

  return (
    <div className="wallet-menu" ref={menuRef}>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="wallet-trigger"
        onClick={() => setMenuOpen((open) => !open)}
        title={wallet.address}
        type="button"
      >
        <span
          className={session.onExpectedNetwork ? "wallet-dot is-connected" : "wallet-dot is-wrong"}
        />
        <span className="wallet-trigger-balance">{formatWalletBalance(session.balance)}</span>
        <span aria-hidden="true" className={menuOpen ? "wallet-chevron is-open" : "wallet-chevron"}>
          ↓
        </span>
      </button>

      {menuOpen ? (
        <div className="wallet-popover" role="menu">
          <div className="wallet-popover-address">
            <span className="wallet-popover-label">Connected wallet</span>
            <span className="mono">{compactAddress(wallet.address)}</span>
          </div>
          <div className="wallet-popover-balance">
            <span>Balance</span>
            <strong>{formatWalletBalance(session.balance)}</strong>
          </div>
          {!session.onExpectedNetwork ? (
            <p className="wallet-network-warning">
              {session.expectedChain
                ? "Switch to the configured Solana network."
                : "Privy external wallets support devnet, testnet, or mainnet."}
            </p>
          ) : null}
          {session.availableWallets.length > 1 ? (
            <WalletChoices session={session} onSelect={() => setMenuOpen(false)} />
          ) : null}
          <button
            className="wallet-disconnect"
            disabled={session.disconnecting}
            onClick={() => void session.disconnect()}
            role="menuitem"
            type="button"
          >
            {session.disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WalletChoices({ session, onSelect }: { session: WalletSession; onSelect: () => void }) {
  return (
    <fieldset className="wallet-choices">
      <legend className="wallet-popover-label">Available wallets</legend>
      {session.availableWallets.map((candidate) => (
        <button
          className={
            candidate.address === session.address ? "wallet-choice is-selected" : "wallet-choice"
          }
          key={candidate.address}
          onClick={() => {
            session.selectWallet(candidate.address);
            onSelect();
          }}
          role="menuitem"
          type="button"
        >
          <span className="mono">{compactAddress(candidate.address)}</span>
          {candidate.address === session.address ? <span aria-hidden="true">✓</span> : null}
        </button>
      ))}
    </fieldset>
  );
}

export function StaticWalletControls() {
  return (
    <button
      className="wallet-button"
      disabled
      title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable wallet access"
      type="button"
    >
      Connect wallet
    </button>
  );
}

const SOL = 1_000_000_000n;

function formatWalletBalance(lamports: bigint | null) {
  return lamports === null ? "— SOL" : `${(Number(lamports) / Number(SOL)).toFixed(3)} SOL`;
}

function compactAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
