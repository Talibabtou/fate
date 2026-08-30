import { useCallback, useEffect, useState } from "react";
import { type ConfigAccount, type DrawAccount, dueAction } from "../domain/fate/index.ts";
import type { FateSnapshot } from "../features/fate/data/snapshot.ts";

export type LifecycleAction = "activate" | "settle";

export type LifecycleCheck = {
  snapshot: FateSnapshot | null;
  dueAction: LifecycleAction | null;
};

export function useLifecycleProgress({
  config,
  draw,
  network,
  now,
  refresh,
  snapshot,
}: {
  config: ConfigAccount | undefined;
  draw: DrawAccount | undefined;
  network: string;
  now: number;
  refresh: () => Promise<FateSnapshot | null>;
  snapshot: FateSnapshot | null;
}) {
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null);
  const currentAction = getLifecycleAction(config, draw, network, BigInt(Math.floor(now / 1000)));

  useEffect(() => {
    setLifecycleAction(currentAction);
  }, [currentAction]);

  const refreshAndDetect = useCallback(async (): Promise<LifecycleCheck> => {
    const nextSnapshot = await refresh();
    const candidate = nextSnapshot ?? snapshot;
    const nextAction = candidate
      ? getLifecycleAction(
          candidate.config,
          candidate.draw,
          network,
          BigInt(Math.floor(Date.now() / 1000)),
        )
      : null;
    setLifecycleAction(nextAction);
    return { snapshot: candidate, dueAction: nextAction };
  }, [network, refresh, snapshot]);

  useEffect(() => {
    const refreshOnActivity = () => {
      if (document.visibilityState === "hidden") return;
      void refreshAndDetect();
    };
    window.addEventListener("focus", refreshOnActivity);
    document.addEventListener("visibilitychange", refreshOnActivity);
    return () => {
      window.removeEventListener("focus", refreshOnActivity);
      document.removeEventListener("visibilitychange", refreshOnActivity);
    };
  }, [refreshAndDetect]);

  return { dueAction: lifecycleAction, refreshAndDetect };
}

export function getLifecycleAction(
  config: ConfigAccount | undefined,
  draw: DrawAccount | undefined,
  network: string,
  now: bigint,
): LifecycleAction | null {
  if (!config || !draw) return null;
  const action = dueAction(config, draw, now);
  if (action === "settle" && !["localnet", "devnet"].includes(network.toLowerCase())) {
    return null;
  }
  return action === "activate" || action === "settle" ? action : null;
}
