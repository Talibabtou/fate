"use client";

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { address, type Instruction } from "@solana/kit";
import { useEffect, useState } from "react";
import {
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
import { fatePublicConfig } from "../lib/public-config";
import { fateProgramAddress } from "../lib/rpc/config";
import { executeFateTransaction, type FateTransactionState } from "../lib/transactions";
import { FateFooter } from "./fate-footer";
import { FateMain, type ReviewAction } from "./fate-main";
import { FateNavbar } from "./fate-navbar";
import { useFateSnapshot } from "./use-fate-snapshot";
import type { WalletStatus } from "./wallet-controls";

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
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<ConnectedStandardSolanaWallet | null>(null);
  const { snapshot, error, refreshing, refresh } = useFateSnapshot(
    walletAddress ? address(walletAddress) : undefined,
  );
  const [mode, setMode] = useState<"staker" | "player">("player");
  const [amount, setAmount] = useState("0.10");
  const [now, setNow] = useState(() => Date.now());
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("unavailable");
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
  const progress = draw ? thresholdProgress(draw) : 0;
  const progressAction =
    config && draw ? availableProgressAction(config, draw, BigInt(Math.floor(now / 1000))) : null;
  const isPlayer = mode === "player";
  const hasPrivy = Boolean(fatePublicConfig.privyAppId);
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
      setReview({
        kind,
        amountLamports: snapshot.stakerPosition.activeShares,
        amountLabel: `${snapshot.stakerPosition.activeShares} shares`,
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
      setTxMessage("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured.");
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
          review.amountLamports,
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
      setTxMessage(`Confirmed ${result.signature.slice(0, 8)}…`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Transaction failed";
      setTxState(message.includes("timed out") ? "stale" : "failed");
      setTxMessage(message);
    }
  }

  return (
    <main className="fate-page">
      <FateNavbar
        hasPrivy={hasPrivy}
        network={networkLabel()}
        onAddressChange={setWalletAddress}
        onStatusChange={setWalletStatus}
        onWalletChange={setWallet}
      />
      <FateMain
        amount={amount}
        config={config}
        draw={draw}
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
        transactionBusy={transactionBusy}
        txMessage={txMessage}
        txState={txState}
        wallet={wallet}
        walletStatus={walletStatus}
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

function thresholdProgress(draw: DrawAccount) {
  if (draw.stakerTvlSnapshot === 0n || draw.activationThresholdLamports === 0n) return 0;
  return Math.min(
    100,
    Math.round(Number((draw.playerTvlLamports * 100n) / draw.activationThresholdLamports)),
  );
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

function networkLabel() {
  return fatePublicConfig.network || "localnet";
}
