"use client";

import { address, type Instruction } from "@solana/kit";
import { useEffect, useState } from "react";
import {
  activationThreshold,
  type ConfigAccount,
  claimPlayerInstruction,
  claimStakeWithdrawalInstruction,
  type DrawAccount,
  DrawPhase,
  depositPlayerInstruction,
  depositStakeInstruction,
  dueAction,
  permissionlessProgressInstruction,
  refundPlayerInstruction,
  requestStakeWithdrawalInstruction,
} from "../domain/fate";
import { readDevSettlementParticipants } from "../features/fate/data/settlement-participants";
import { fatePublicConfig, publicConfigIssues } from "../lib/public-config";
import { fateProgramAddress } from "../lib/rpc/config";
import { executeFateTransaction, type FateTransactionState } from "../lib/transactions";
import { FateFooter } from "./fate-footer";
import { FateMain, type ReviewAction } from "./fate-main";
import { FateNavbar } from "./fate-navbar";
import { useFateSnapshot } from "./use-fate-snapshot";
import { useWalletSession, WalletSessionProvider } from "./use-wallet-session";

const SOL = 1_000_000_000n;
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
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [txState, setTxState] = useState<FateTransactionState | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);

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
  const progressAction =
    config && draw ? availableProgressAction(config, draw, BigInt(Math.floor(now / 1000))) : null;
  const isPlayer = mode === "player";
  const programAddress = fateProgramAddress();
  const transactionBusy =
    txState === "simulating" || txState === "awaiting-signature" || txState === "submitted";

  function beginPrimaryAction() {
    setTxMessage(null);
    setTxState(null);
    if (!wallet || walletStatus !== "connected") {
      setTxMessage("Connect a Solana wallet on the configured network first.");
      return;
    }
    if (!snapshot || !draw) {
      setTxMessage("Live Fate state is not available yet.");
      return;
    }
    if (progressAction) {
      setReview({
        kind: "progress",
        action: progressAction,
        amountLabel: "No pool funds transferred",
      });
      setTxMessage("Advance the due draw transition before starting another action.");
      return;
    }
    let amountLamports: bigint;
    try {
      amountLamports = parseSolAmount(amount);
    } catch (nextError) {
      setTxMessage(nextError instanceof Error ? nextError.message : "Enter a valid SOL amount.");
      return;
    }
    const minimum = isPlayer ? 10_000_000n : 100_000_000n;
    if (amountLamports < minimum) {
      setTxMessage(
        `Minimum ${isPlayer ? "Player" : "Staker"} deposit is ${isPlayer ? "0.01" : "0.10"} SOL.`,
      );
      return;
    }
    if (isPlayer) {
      if (draw.phase !== DrawPhase.Funding && draw.phase !== DrawPhase.Activated) {
        setTxMessage("Player deposits are closed for this draw.");
        return;
      }
      if (
        draw.phase === DrawPhase.Activated &&
        draw.locksAt > 0n &&
        BigInt(Math.floor(now / 1000)) >= draw.locksAt
      ) {
        setTxMessage("The countdown has reached its lock time.");
        return;
      }
    } else if (
      draw.phase !== DrawPhase.Funding ||
      draw.firstPlayerAt > 0n ||
      snapshot.config.paused
    ) {
      setTxMessage("New Staker deposits are open only during unfunded Funding.");
      return;
    }
    setReview({ kind: "deposit", amountLamports, amountLabel: `${formatSol(amountLamports)} SOL` });
  }

  function beginSecondaryAction(kind: Exclude<ReviewAction["kind"], "deposit" | "progress">) {
    if (!snapshot || !draw || !wallet || walletStatus !== "connected") {
      setTxMessage("Connect a Solana wallet and wait for live Fate state.");
      return;
    }
    if (progressAction) {
      setReview({
        kind: "progress",
        action: progressAction,
        amountLabel: "No pool funds transferred",
      });
      setTxMessage("Advance the due draw transition before starting another action.");
      return;
    }
    if (kind === "refund" && snapshot.playerPosition?.refundableLamports) {
      setReview({
        kind,
        amountLamports: snapshot.playerPosition.refundableLamports,
        amountLabel: `${formatSol(snapshot.playerPosition.refundableLamports)} SOL`,
      });
    } else if (kind === "claim" && snapshot.playerPosition?.claimableLamports) {
      setReview({
        kind,
        amountLamports: snapshot.playerPosition.claimableLamports,
        amountLabel: `${formatSol(snapshot.playerPosition.claimableLamports)} SOL`,
      });
    } else if (kind === "withdraw" && snapshot.stakerPosition?.activeShares) {
      let shares: bigint;
      try {
        shares = parseShares(withdrawalShares, snapshot.stakerPosition.activeShares);
      } catch (nextError) {
        setTxMessage(nextError instanceof Error ? nextError.message : "Enter valid shares.");
        return;
      }
      setReview({
        kind,
        shares,
        amountLabel: `${shares} shares`,
      });
    } else if (
      kind === "claim-withdrawal" &&
      snapshot.stakerPosition?.claimableWithdrawalLamports
    ) {
      setReview({
        kind,
        amountLamports: snapshot.stakerPosition.claimableWithdrawalLamports,
        amountLabel: `${formatSol(snapshot.stakerPosition.claimableWithdrawalLamports)} SOL`,
      });
    }
  }

  function beginProgressAction() {
    setTxMessage(null);
    setTxState(null);
    if (!wallet || walletStatus !== "connected" || !snapshot || !draw || !config) {
      setTxMessage("Connect a Solana wallet and wait for live Fate state.");
      return;
    }
    const action = availableProgressAction(config, draw, BigInt(Math.floor(Date.now() / 1000)));
    if (action !== "activate" && action !== "settle") {
      setTxMessage("This draw does not need a lifecycle transition yet.");
      return;
    }
    setReview({
      kind: "progress",
      action,
      amountLabel: "No pool funds transferred",
    });
  }

  async function confirmReview() {
    if (!review || !wallet || !snapshot || !draw) return;
    if (!programAddress) {
      setTxState("failed");
      setTxMessage(publicConfigIssues()[0] ?? "Fate public configuration is invalid.");
      return;
    }
    try {
      const walletAddressValue = address(wallet.address);
      let instruction: Instruction;
      if (review.kind === "progress") {
        const participants =
          review.action === "settle" ? await readDevSettlementParticipants(draw) : undefined;
        instruction = await permissionlessProgressInstruction(
          review.action,
          programAddress,
          walletAddressValue,
          snapshot.config,
          participants,
        );
      } else if (review.kind === "deposit") {
        instruction = isPlayer
          ? await depositPlayerInstruction(
              programAddress,
              walletAddressValue,
              draw.id,
              snapshot.playerPosition?.leafIndex ?? draw.nextPlayerIndex,
              review.amountLamports,
            )
          : await depositStakeInstruction(
              programAddress,
              walletAddressValue,
              draw.id,
              snapshot.stakerPosition?.leafIndex ?? snapshot.vault.nextPositionIndex,
              review.amountLamports,
            );
      } else if (review.kind === "refund") {
        instruction = await refundPlayerInstruction(
          programAddress,
          walletAddressValue,
          draw.id,
          snapshot.playerPosition?.leafIndex ?? 0n,
        );
      } else if (review.kind === "withdraw") {
        instruction = await requestStakeWithdrawalInstruction(
          programAddress,
          walletAddressValue,
          draw.id,
          snapshot.stakerPosition?.leafIndex ?? 0n,
          review.shares,
        );
      } else if (review.kind === "claim") {
        instruction = await claimPlayerInstruction(programAddress, walletAddressValue, draw.id);
      } else {
        instruction = await claimStakeWithdrawalInstruction(programAddress, walletAddressValue);
      }
      const result = await executeFateTransaction({
        instruction,
        wallet,
        onState: setTxState,
      });
      await refresh();
      setReview(null);
      if (review.kind === "withdraw") setWithdrawalShares("");
      setTxMessage(`Confirmed ${result.signature.slice(0, 8)}…`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Transaction failed";
      setTxState(message.includes("timed out") ? "stale" : "failed");
      setTxMessage(message);
    }
  }

  return (
    <main className="fate-page">
      <FateNavbar hasPrivy={hasPrivy} network={networkLabel()} walletSession={walletSession} />
      <FateMain
        amount={amount}
        config={config}
        draw={draw}
        activationThresholdLamports={activationThresholdLamports}
        isPlayer={isPlayer}
        mode={mode}
        network={networkLabel()}
        now={now}
        onAmountChange={setAmount}
        onCancelReview={() => setReview(null)}
        onConfirmReview={() => void confirmReview()}
        onModeChange={setMode}
        onPrimaryAction={beginPrimaryAction}
        onProgressAction={beginProgressAction}
        onRefresh={() => void refresh()}
        onSecondaryAction={beginSecondaryAction}
        phase={phase}
        playerPosition={snapshot?.playerPosition ?? null}
        programAddress={programAddress}
        progress={progress}
        progressAction={progressAction}
        refreshing={refreshing}
        review={review}
        stakerPosition={snapshot?.stakerPosition ?? null}
        stakerTvlLamports={stakerTvlLamports}
        transactionBusy={transactionBusy}
        txMessage={txMessage}
        txState={txState}
        wallet={wallet}
        walletStatus={walletStatus}
        withdrawalShares={withdrawalShares}
        onWithdrawalSharesChange={setWithdrawalShares}
      />
      <FateFooter network={networkLabel()} programAddress={programAddress} />
      {error ? (
        <div className="error-toast">
          Live state unavailable: {error}. Check the configured RPC and deployed program ID.
        </div>
      ) : null}
    </main>
  );
}

function formatSol(lamports: bigint) {
  return (Number(lamports) / Number(SOL)).toFixed(2);
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

function availableProgressAction(config: ConfigAccount, draw: DrawAccount, now: bigint) {
  const action = dueAction(config, draw, now);
  if (action === "settle" && !["localnet", "devnet"].includes(networkLabel().toLowerCase())) {
    return null;
  }
  return action === "activate" || action === "settle" ? action : null;
}

function parseSolAmount(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
    throw new Error("Enter a SOL amount with up to 9 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const lamports = BigInt(whole) * SOL + BigInt(fraction.padEnd(9, "0"));
  if (lamports <= 0n) throw new Error("Enter an amount greater than zero.");
  return lamports;
}

function parseShares(value: string, maximum: bigint) {
  const normalized = value.trim();
  if (!normalized) return maximum;
  if (!/^\d+$/.test(normalized)) throw new Error("Enter a whole number of shares.");
  const shares = BigInt(normalized);
  if (shares <= 0n) throw new Error("Enter at least one share.");
  if (shares > maximum) throw new Error(`You can withdraw at most ${maximum} shares.`);
  return shares;
}

function networkLabel() {
  return fatePublicConfig.network || "localnet";
}
