"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { type ConnectedStandardSolanaWallet, useWallets } from "@privy-io/react-auth/solana";
import { address } from "@solana/kit";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { type FateWalletChain, privyWalletChain } from "../lib/privy-wallet";
import { readSolBalance } from "../lib/rpc/client";

export type WalletStatus =
  | "unavailable"
  | "checking"
  | "disconnected"
  | "select-wallet"
  | "wrong-network"
  | "connected";

export type WalletSession = {
  ready: boolean;
  status: WalletStatus;
  wallet: ConnectedStandardSolanaWallet | null;
  address: string | null;
  balance: bigint | null;
  availableWallets: ConnectedStandardSolanaWallet[];
  expectedChain: FateWalletChain | null;
  onExpectedNetwork: boolean;
  disconnecting: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  selectWallet: (walletAddress: string) => void;
};

const staticWalletSession: WalletSession = {
  ready: true,
  status: "unavailable",
  wallet: null,
  address: null,
  balance: null,
  availableWallets: [],
  expectedChain: null,
  onExpectedNetwork: false,
  disconnecting: false,
  connect: () => undefined,
  disconnect: async () => undefined,
  selectWallet: () => undefined,
};

const WalletSessionContext = createContext<WalletSession | null>(null);

export function WalletSessionProvider({
  children,
  enabled,
}: Readonly<{ children: React.ReactNode; enabled: boolean }>) {
  if (!enabled) {
    return (
      <WalletSessionContext.Provider value={staticWalletSession}>
        {children}
      </WalletSessionContext.Provider>
    );
  }

  return <PrivyWalletSessionProvider>{children}</PrivyWalletSessionProvider>;
}

function PrivyWalletSessionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = usePrivyWalletSession();
  return <WalletSessionContext.Provider value={session}>{children}</WalletSessionContext.Provider>;
}

export function useWalletSession() {
  const session = useContext(WalletSessionContext);
  if (!session) {
    throw new Error("useWalletSession must be used inside WalletSessionProvider");
  }
  return session;
}

function usePrivyWalletSession(): WalletSession {
  const { connectWallet } = useConnectWallet();
  const { ready, wallets } = useWallets();
  const expectedChain = privyWalletChain();
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (wallets.length === 0) {
      setSelectedAddress(null);
      return;
    }
    if (selectedAddress && wallets.some((wallet) => wallet.address === selectedAddress)) return;
    if (wallets.length === 1) setSelectedAddress(wallets[0].address);
    else setSelectedAddress(null);
  }, [selectedAddress, wallets]);

  const wallet = useMemo(() => {
    if (selectedAddress) {
      return wallets.find((candidate) => candidate.address === selectedAddress) ?? null;
    }
    return wallets.length === 1 ? wallets[0] : null;
  }, [selectedAddress, wallets]);

  const onExpectedNetwork = Boolean(
    wallet &&
      expectedChain &&
      wallet.standardWallet.accounts.some((account) => account.chains.includes(expectedChain)),
  );
  const status: WalletStatus = !ready
    ? "checking"
    : wallets.length === 0
      ? "disconnected"
      : !wallet
        ? "select-wallet"
        : !expectedChain || !onExpectedNetwork
          ? "wrong-network"
          : "connected";

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

  async function disconnect() {
    if (!wallet) return;
    setDisconnecting(true);
    try {
      await wallet.disconnect();
      setSelectedAddress(null);
    } finally {
      setDisconnecting(false);
    }
  }

  return {
    ready,
    status,
    wallet,
    address: wallet?.address ?? null,
    balance,
    availableWallets: wallets,
    expectedChain,
    onExpectedNetwork,
    disconnecting,
    connect: () => {
      void connectWallet();
    },
    disconnect,
    selectWallet: setSelectedAddress,
  };
}
