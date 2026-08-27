import type { Address } from "@solana/kit";
import { useCallback, useEffect, useState } from "react";
import { type FateSnapshot, readFateSnapshot } from "../features/fate/data/snapshot";
import { subscribeToAccounts } from "../lib/rpc/client";

const NORMAL_POLL_MS = 15_000;
const FALLBACK_POLL_MS = 5_000;
const MAX_SUBSCRIPTION_RETRIES = 3;
const SUBSCRIPTION_RETRY_MS = 2_000;

export function useFateSnapshot(walletAddress?: Address) {
  const [snapshot, setSnapshot] = useState<FateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pollingFallback, setPollingFallback] = useState(false);
  const configAddress = snapshot?.addresses.config;
  const drawAddress = snapshot?.addresses.draw;
  const vaultAddress = snapshot?.addresses.vault;
  const stakerPositionAddress = snapshot?.addresses.stakerPosition;
  const playerPositionAddress = snapshot?.addresses.playerPosition;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setSnapshot(await readFateSnapshot(walletAddress));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to read Fate state");
    } finally {
      setRefreshing(false);
    }
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
          await subscribeToAccounts(accountAddresses, () => void refresh(), controller.signal);
          if (controller.signal.aborted) return;
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

  return { snapshot, error, refreshing, refresh };
}
