"use client";

import { address } from "@solana/kit";
import { useEffect, useState } from "react";
import { activationThreshold, type DrawAccount, DrawPhase } from "../domain/fate";
import { fatePublicConfig } from "../lib/public-config";
import { fateProgramAddress } from "../lib/rpc/config";
import type { FateViewModel } from "./fate/fate-view-model";
import { FateFooter } from "./fate-footer";
import { FateMain } from "./fate-main";
import { FateNavbar } from "./fate-navbar";
import { FateToastStack } from "./fate-toast-stack";
import { useFateActions } from "./use-fate-actions";
import { useFateSnapshot } from "./use-fate-snapshot";
import { useLifecycleProgress } from "./use-lifecycle-progress";
import { useWalletSession, WalletSessionProvider } from "./use-wallet-session";

const phaseLabels: Record<number, string> = {
  [DrawPhase.Funding]: "Funding",
  [DrawPhase.Activated]: "Countdown",
  [DrawPhase.Locked]: "Locked",
  [DrawPhase.AwaitingRandomness]: "Settling",
  [DrawPhase.Settled]: "Settled",
  [DrawPhase.Voided]: "Voided",
};

export function FatePage() {
  const hasPrivy = Boolean(fatePublicConfig.privyAppId);
  return (
    <WalletSessionProvider enabled={hasPrivy}>
      <FatePageContent hasPrivy={hasPrivy} />
    </WalletSessionProvider>
  );
}

function FatePageContent({ hasPrivy }: { hasPrivy: boolean }) {
  const walletSession = useWalletSession();
  const walletAddress = walletSession.address;
  const wallet = walletSession.wallet;
  const walletStatus = walletSession.status;
  const { snapshot, error, refreshing, refresh } = useFateSnapshot(
    walletAddress ? address(walletAddress) : undefined,
  );
  const [mode, setMode] = useState<"staker" | "player">("player");
  const [amount, setAmount] = useState("0.10");
  const [withdrawalShares, setWithdrawalShares] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const draw = snapshot?.draw;
  const config = snapshot?.config;
  const phase = draw ? (phaseLabels[draw.phase] ?? "Unknown") : "Connecting";
  const stakerTvlLamports = draw
    ? draw.firstPlayerAt > 0n
      ? draw.stakerTvlSnapshot
      : (snapshot?.vault.activeAssetsLamports ?? 0n)
    : null;
  const activationThresholdLamports = draw
    ? currentActivationThreshold(draw, snapshot?.vault.activeAssetsLamports ?? 0n, now)
    : null;
  const progress = draw ? thresholdProgress(draw, activationThresholdLamports ?? 0n) : 0;
  const isPlayer = mode === "player";
  const network = networkLabel();
  const programAddress = fateProgramAddress();

  const lifecycle = useLifecycleProgress({
    config,
    draw,
    network,
    now,
    refresh,
    snapshot,
  });
  const actions = useFateActions({
    amount,
    beforeUserAction: lifecycle.refreshAndDetect,
    isPlayer,
    network,
    programAddress,
    refresh,
    snapshot,
    wallet,
    walletStatus,
    withdrawalShares,
    onWithdrawalSharesChange: setWithdrawalShares,
  });
  const view: FateViewModel = {
    activationThresholdLamports,
    config,
    draw,
    isPlayer,
    mode,
    network,
    now,
    phase,
    playerPosition: snapshot?.playerPosition ?? null,
    programAddress,
    progress,
    progressAction: lifecycle.dueAction,
    refreshing,
    stakerPosition: snapshot?.stakerPosition ?? null,
    stakerTvlLamports,
    withdrawalShares,
  };

  return (
    <main className="fate-page">
      <FateNavbar hasPrivy={hasPrivy} network={networkLabel()} walletSession={walletSession} />
      <FateMain
        view={view}
        amount={amount}
        onAmountChange={setAmount}
        onCancelReview={actions.cancelReview}
        onConfirmReview={() => void actions.confirmReview()}
        onModeChange={setMode}
        onPrimaryAction={() => void actions.beginPrimaryAction()}
        onProgressAction={() => void actions.beginProgressAction()}
        onRefresh={() => void refresh()}
        onSecondaryAction={(kind) => void actions.beginSecondaryAction(kind)}
        review={actions.review}
        transactionBusy={actions.transactionBusy}
        txState={actions.txState}
        wallet={wallet}
        walletStatus={walletStatus}
        onWithdrawalSharesChange={setWithdrawalShares}
      />
      <FateFooter network={networkLabel()} programAddress={programAddress} />
      <FateToastStack
        error={error}
        transactionMessage={actions.txMessage}
        transactionState={actions.txState}
      />
    </main>
  );
}

function currentActivationThreshold(draw: DrawAccount, currentStakerTvl: bigint, now: number) {
  if (draw.phase === DrawPhase.Funding) {
    const stakerTvl = draw.firstPlayerAt > 0n ? draw.stakerTvlSnapshot : currentStakerTvl;
    if (stakerTvl === 0n) return 0n;
    const nowSeconds = BigInt(Math.floor(now / 1000));
    const elapsed =
      draw.firstPlayerAt > 0n && nowSeconds > draw.firstPlayerAt
        ? nowSeconds - draw.firstPlayerAt
        : 0n;
    return activationThreshold(stakerTvl, elapsed);
  }
  return draw.activationThresholdLamports;
}

function thresholdProgress(draw: DrawAccount, threshold: bigint) {
  if (threshold === 0n) return 0;
  return Math.min(100, Math.round(Number((draw.playerTvlLamports * 100n) / threshold)));
}

function networkLabel() {
  return fatePublicConfig.network || "localnet";
}
