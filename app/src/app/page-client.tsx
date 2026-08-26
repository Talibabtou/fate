"use client";

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { address, type Instruction } from "@solana/kit";
import { useEffect, useState } from "react";
import {
  claimPlayerInstruction,
  claimStakeWithdrawalInstruction,
  type DrawAccount,
  DrawPhase,
  depositPlayerInstruction,
  depositStakeInstruction,
  refundPlayerInstruction,
  requestStakeWithdrawalInstruction,
} from "../../scripts/fate-client";
import { browserProgramAddress } from "../lib/fate-browser";
import { executeFateTransaction, type FateTransactionState } from "../lib/fate-transactions";
import { useFateSnapshot } from "./use-fate-snapshot";
import { StaticWalletControls, WalletControls, type WalletStatus } from "./wallet-controls";

const SOL = 1_000_000_000n;
const phaseLabels: Record<number, string> = {
  [DrawPhase.Funding]: "Funding",
  [DrawPhase.Activated]: "Countdown",
  [DrawPhase.Locked]: "Locked",
  [DrawPhase.AwaitingRandomness]: "Settling",
  [DrawPhase.Settled]: "Settled",
  [DrawPhase.Voided]: "Voided",
};

type ReviewAction =
  | { kind: "deposit"; amountLamports: bigint; amountLabel: string }
  | { kind: "refund"; amountLamports: bigint; amountLabel: string }
  | { kind: "withdraw"; amountLamports: bigint; amountLabel: string }
  | { kind: "claim"; amountLamports: bigint; amountLabel: string }
  | { kind: "claim-withdrawal"; amountLamports: bigint; amountLabel: string };

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
  const isPlayer = mode === "player";
  const hasPrivy = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());
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

  function beginSecondaryAction(kind: Exclude<ReviewAction["kind"], "deposit">) {
    if (!snapshot || !draw || !wallet || walletStatus !== "connected") {
      setTxMessage("Connect a Solana wallet and wait for live Fate state.");
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

  async function confirmReview() {
    if (!review || !wallet || !snapshot || !draw) return;
    const programAddress = browserProgramAddress();
    if (!programAddress) {
      setTxState("failed");
      setTxMessage("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured.");
      return;
    }
    try {
      const walletAddressValue = address(wallet.address);
      let instruction: Instruction;
      if (review.kind === "deposit") {
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
      <header className="fate-header">
        <div className="brand-lockup">
          <span className="display-font brand-name">Fate</span>
          <span className="brand-note">one draw at a time</span>
        </div>
        <div className="header-actions">
          <span className="network-mark">{networkLabel()}</span>
          {hasPrivy ? (
            <WalletControls
              onAddressChange={setWalletAddress}
              onStatusChange={setWalletStatus}
              onWalletChange={setWallet}
            />
          ) : (
            <StaticWalletControls />
          )}
        </div>
      </header>

      <section className="fate-workspace" aria-label="Current Fate draw">
        <div className="draw-heading">
          <div>
            <p className="eyebrow">Current draw</p>
            <h1 className="display-font draw-title">
              #{draw?.id.toString() ?? "—"} <span>{phase}</span>
            </h1>
          </div>
          <button className="quiet-button" onClick={() => void refresh()} type="button">
            <span className={refreshing ? "refresh-mark is-spinning" : "refresh-mark"}>↻</span>
            {refreshing ? "Reading" : "Refresh"}
          </button>
        </div>

        <div className="draw-context">
          <div className="context-topline">
            <div>
              <p className="context-label">Player threshold</p>
              <p className="context-value">
                {draw
                  ? `${formatSol(draw.playerTvlLamports)} / ${formatSol(draw.activationThresholdLamports)} SOL`
                  : "—"}
              </p>
            </div>
            <div className="context-state">
              <span className="live-dot" />
              <span>{draw ? `${progress}% filled` : "Awaiting RPC"}</span>
            </div>
          </div>
          <div
            aria-label="Player threshold progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress}
            className="progress-track"
            role="progressbar"
          >
            <div className="progress-value" style={{ width: `${progress}%` }} />
          </div>
          <div className="context-meta">
            <span>{countdownLabel(draw, now)}</span>
            <span>
              {draw ? `Staker TVL ${formatSol(draw.stakerTvlSnapshot)} SOL` : "Staker TVL —"}
            </span>
          </div>
        </div>

        <div className="action-layout">
          <div className="action-intro">
            <p className="eyebrow">Your move</p>
            <h2 className="display-font action-title">Choose a side.</h2>
            <p className="action-copy">
              One deposit enters the current draw. The terms stay visible before signing.
            </p>
          </div>

          <div className="action-form">
            <fieldset className="mode-switch">
              <legend className="sr-only">Choose a side</legend>
              <ModeButton active={!isPlayer} label="Staker" onClick={() => setMode("staker")} />
              <ModeButton active={isPlayer} label="Player" onClick={() => setMode("player")} />
            </fieldset>

            <label className="amount-field">
              <span className="sr-only">{mode} amount in SOL</span>
              <input
                aria-label={`${mode} amount in SOL`}
                inputMode="decimal"
                min="0"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.10"
                value={amount}
              />
              <span>SOL</span>
            </label>

            <button
              className="primary-action"
              disabled={transactionBusy || walletStatus === "checking"}
              onClick={beginPrimaryAction}
              type="button"
            >
              {transactionBusy
                ? transactionStateLabel(txState)
                : walletStatus === "connected"
                  ? `Deposit as ${isPlayer ? "Player" : "Staker"}`
                  : `Connect wallet to ${isPlayer ? "play" : "stake"}`}
              <span aria-hidden="true">→</span>
            </button>

            {isPlayer &&
            snapshot?.playerPosition?.refundableLamports &&
            draw?.phase === DrawPhase.Funding ? (
              <button
                className="secondary-action"
                onClick={() => beginSecondaryAction("refund")}
                type="button"
              >
                Refund {formatSol(snapshot.playerPosition.refundableLamports)} SOL
              </button>
            ) : null}
            {isPlayer && snapshot?.playerPosition?.claimableLamports ? (
              <button
                className="secondary-action"
                onClick={() => beginSecondaryAction("claim")}
                type="button"
              >
                Claim {formatSol(snapshot.playerPosition.claimableLamports)} SOL
              </button>
            ) : null}
            {!isPlayer &&
            snapshot?.stakerPosition?.activeShares &&
            draw?.phase === DrawPhase.Funding ? (
              <button
                className="secondary-action"
                onClick={() => beginSecondaryAction("withdraw")}
                type="button"
              >
                Exit all shares
              </button>
            ) : null}
            {!isPlayer && snapshot?.stakerPosition?.claimableWithdrawalLamports ? (
              <button
                className="secondary-action"
                onClick={() => beginSecondaryAction("claim-withdrawal")}
                type="button"
              >
                Claim withdrawal
              </button>
            ) : null}

            {review ? (
              <div className="transaction-review" role="dialog" aria-label="Review transaction">
                <div className="transaction-review-row">
                  <span>Action</span>
                  <strong>{reviewLabel(review.kind)}</strong>
                </div>
                <div className="transaction-review-row">
                  <span>Amount</span>
                  <strong>{review.amountLabel}</strong>
                </div>
                <div className="transaction-review-row">
                  <span>Network / fee payer</span>
                  <strong>
                    {networkLabel()} · {wallet ? compactAddress(wallet.address) : "—"}
                  </strong>
                </div>
                <p className="terms-note">
                  Fate program: {browserProgramAddress()?.slice(0, 8) ?? "—"}… · wallet fee shown
                  next.
                </p>
                <div className="review-actions">
                  <button className="quiet-button" onClick={() => setReview(null)} type="button">
                    Cancel
                  </button>
                  <button
                    className="primary-action review-confirm"
                    disabled={transactionBusy}
                    onClick={() => void confirmReview()}
                    type="button"
                  >
                    {transactionBusy ? transactionStateLabel(txState) : "Simulate & approve"}
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            ) : null}

            {txMessage ? (
              <p
                className={
                  txState === "failed" || txState === "stale"
                    ? "transaction-message is-error"
                    : "transaction-message"
                }
              >
                {txMessage}
              </p>
            ) : null}

            <p className="minimum-note">
              Minimum {mode === "player" ? "Player" : "Staker"} deposit:{" "}
              {mode === "player" ? "0.01" : "0.10"} SOL
            </p>
          </div>
        </div>

        <div className="details-stack">
          <details className="info-toggle">
            <summary>
              <span>View draw terms</span>
              <span className="toggle-icon" aria-hidden="true">
                +
              </span>
            </summary>
            <div className="terms-grid">
              <Term label="Side odds" value="Player 90% · Staker 10%" />
              <Term
                label="Player max loss"
                value={draw ? `${formatSol(draw.playerTvlLamports)} SOL` : "—"}
              />
              <Term label="Player fee" value="5% of profit" />
              <Term label="Staker exposure" value="Principal can erode" />
              <p className="terms-note">
                The selected side is fixed first, then one wallet wins by its stored weight. Pending
                Player deposits can be refunded only during funding.
              </p>
            </div>
          </details>

          <details className="info-toggle">
            <summary>
              <span>Recent draws & disclosures</span>
              <span className="toggle-icon" aria-hidden="true">
                +
              </span>
            </summary>
            <div className="history-row">
              <div>
                <span className="context-label">Recent settled draws</span>
                <p>
                  {config?.recentDrawIds.length
                    ? config.recentDrawIds
                        .slice(0, 5)
                        .map((id) => `#${id}`)
                        .join(" · ")
                    : "No settled draws yet"}
                </p>
              </div>
              <p className="terms-note">
                Native SOL only. Fate is not a guaranteed-principal product.
              </p>
            </div>
          </details>
        </div>
      </section>

      <footer className="fate-footer">
        <span>{networkLabel()} preview · confirm every transaction in your wallet</span>
        <span className="mono">
          {browserProgramAddress()?.slice(0, 8) ?? "program not configured"}
        </span>
      </footer>

      {error ? (
        <div className="error-toast">
          Live state unavailable: {error}. Check the configured RPC and deployed program ID.
        </div>
      ) : null}
    </main>
  );
}
function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="term-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "mode-button is-active" : "mode-button"}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
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

function countdownLabel(draw: DrawAccount | undefined, now: number) {
  if (!draw || draw.phase !== DrawPhase.Activated || draw.locksAt <= 0n) return "Funding open";
  const remaining = Number(draw.locksAt) - Math.floor(now / 1000);
  return remaining > 0 ? `${formatDuration(remaining)} remaining` : "Lock due";
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
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

function reviewLabel(kind: ReviewAction["kind"]) {
  if (kind === "deposit") return "Deposit";
  if (kind === "refund") return "Refund Player position";
  if (kind === "withdraw") return "Request Staker withdrawal";
  if (kind === "claim") return "Claim Player winnings";
  return "Claim Staker withdrawal";
}

function transactionStateLabel(state: FateTransactionState | null) {
  if (state === "simulating") return "Simulating…";
  if (state === "awaiting-signature") return "Approve in wallet…";
  if (state === "submitted") return "Confirming…";
  return "Working…";
}

function compactAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function networkLabel() {
  return process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() || "localnet";
}
