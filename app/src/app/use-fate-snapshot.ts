import type { Address } from "@solana/kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FateSnapshot, readFateSnapshot } from "../features/fate/data/snapshot";
import { RpcUnavailableError, subscribeToAccounts } from "../lib/rpc/client";

const NORMAL_POLL_MS = 15_000;
const FALLBACK_POLL_MS = 5_000;
const MAX_SUBSCRIPTION_RETRIES = 3;
const SUBSCRIPTION_RETRY_MS = 2_000;

export type FateSnapshotStatus =
  | "loading"
  | "ready"
  | "refreshing"
  | "stale"
  | "disconnected"
  | "error";

export function useFateSnapshot(walletAddress?: Address) {
  const [snapshot, setSnapshot] = useState<FateSnapshot | null>(null);
  const [status, setStatus] = useState<FateSnapshotStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pollingFallback, setPollingFallback] = useState(false);
  const snapshotRef = useRef<FateSnapshot | null>(null);
  const previousWalletAddress = useRef(walletAddress);
  const requestId = useRef(0);
  const configAddress = snapshot?.addresses.config;
  const drawAddress = snapshot?.addresses.draw;
  const vaultAddress = snapshot?.addresses.vault;
  const stakerPositionAddress = snapshot?.addresses.stakerPosition;
  const playerPositionAddress = snapshot?.addresses.playerPosition;

  const refresh = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    setStatus(snapshotRef.current ? "refreshing" : "loading");

    try {
      const nextSnapshot = await readFateSnapshot(walletAddress);
      if (currentRequestId !== requestId.current) return null;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setError(null);
      setStatus("ready");
      return nextSnapshot;
    } catch (nextError) {
      if (currentRequestId !== requestId.current) return null;
      const message = nextError instanceof Error ? nextError.message : "Unable to read Fate state";
      setError(message);
      setStatus(
        nextError instanceof RpcUnavailableError
          ? "disconnected"
          : snapshotRef.current
            ? "stale"
            : "error",
      );
      return null;
    }
  }, [walletAddress]);

  useEffect(() => {
    if (previousWalletAddress.current === walletAddress) return;
    previousWalletAddress.current = walletAddress;
    snapshotRef.current = null;
    setSnapshot(null);
    setError(null);
    setStatus("loading");
  }, [walletAddress]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      pollingFallback ? FALLBACK_POLL_MS : NORMAL_POLL_MS,
    );
    return () => window.clearInterval(interval);
  }, [pollingFallback, refresh]);

  useEffect(() => {
    if (!configAddress || !drawAddress || !vaultAddress) return;
    const accountAddresses = [
      configAddress,
      drawAddress,
      vaultAddress,
      ...(stakerPositionAddress ? [stakerPositionAddress] : []),
      ...(playerPositionAddress ? [playerPositionAddress] : []),
    ] satisfies Address[];
    const controller = new AbortController();
    let active = true;

    async function watch() {
      for (let attempt = 0; attempt < MAX_SUBSCRIPTION_RETRIES && active; attempt += 1) {
        try {
          const subscribed = await subscribeToAccounts(
            accountAddresses,
            () => void refresh(),
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (!subscribed) {
            setPollingFallback(true);
            return;
          }
          setPollingFallback(false);
        } catch (subscriptionError) {
          if (controller.signal.aborted) return;
          setPollingFallback(true);
          setError(
            subscriptionError instanceof Error
              ? `${subscriptionError.message}; using bounded RPC polling`
              : "RPC subscription dropped; using bounded RPC polling",
          );
          await new Promise((resolve) => window.setTimeout(resolve, SUBSCRIPTION_RETRY_MS));
        }
      }
    }

    void watch();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    configAddress,
    drawAddress,
    playerPositionAddress,
    refresh,
    stakerPositionAddress,
    vaultAddress,
  ]);

  return {
    snapshot,
    status,
    error,
    refreshing: status === "loading" || status === "refreshing",
    refresh,
  };
}
