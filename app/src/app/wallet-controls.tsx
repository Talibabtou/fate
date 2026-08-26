"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { type ConnectedStandardSolanaWallet, useWallets } from "@privy-io/react-auth/solana";
import { address } from "@solana/kit";
import { useEffect, useRef, useState } from "react";
import { readSolBalance } from "../lib/fate-browser";
import { privyWalletChain } from "../lib/privy-wallet";

export type WalletStatus =
  | "unavailable"
  | "checking"
  | "disconnected"
  | "wrong-network"
  | "connected";

export function WalletControls({
  onStatusChange,
  onAddressChange,
  onWalletChange,
}: {
  onStatusChange: (status: WalletStatus) => void;
  onAddressChange: (address: string | null) => void;
  onWalletChange: (wallet: ConnectedStandardSolanaWallet | null) => void;
}) {
  const { connectWallet } = useConnectWallet();
  const { ready, wallets } = useWallets();
  const wallet = wallets[0];
  const chain = privyWalletChain();
  const [disconnecting, setDisconnecting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const onExpectedNetwork = Boolean(
    wallet &&
      chain &&
      wallet.standardWallet.accounts.some((account) => account.chains.includes(chain)),
  );
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    const status: WalletStatus = !ready
      ? "checking"
      : !wallet
        ? "disconnected"
        : !chain || !onExpectedNetwork
          ? "wrong-network"
          : "connected";
    onStatusChange(status);
  }, [chain, onExpectedNetwork, onStatusChange, ready, wallet]);

  useEffect(() => {
    onAddressChange(wallet?.address ?? null);
    onWalletChange(wallet ?? null);
  }, [onAddressChange, onWalletChange, wallet]);

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

  useEffect(() => {
    let active = true;
    if (!wallet || !onExpectedNetwork) {
      setBalance(null);
      return () => {
        active = false;
      };
    }

    void readSolBalance(address(wallet.address)).then(
      (nextBalance) => {
        if (active) setBalance(nextBalance);
      },
      () => {
        if (active) setBalance(null);
      },
    );

    return () => {
      active = false;
    };
  }, [onExpectedNetwork, wallet]);

  async function disconnectWallet() {
    if (!wallet) return;
    setDisconnecting(true);
    try {
      await wallet.disconnect();
    } finally {
      setDisconnecting(false);
    }
  }

  if (!ready) return <span className="wallet-state">Checking wallet…</span>;
  if (!wallet) {
    return (
      <button className="wallet-button" onClick={() => connectWallet()} type="button">
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
        <span className={onExpectedNetwork ? "wallet-dot is-connected" : "wallet-dot is-wrong"} />
        <span className="wallet-trigger-balance">{formatWalletBalance(balance)}</span>
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
            <strong>{formatWalletBalance(balance)}</strong>
          </div>
          {!onExpectedNetwork ? (
            <p className="wallet-network-warning">
              {chain
                ? "Switch to the configured Solana network."
                : "Privy signing is available on devnet."}
            </p>
          ) : null}
          <button
            className="wallet-disconnect"
            disabled={disconnecting}
            onClick={() => void disconnectWallet()}
            role="menuitem"
            type="button"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : null}
    </div>
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
