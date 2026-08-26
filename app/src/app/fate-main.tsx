"use client";

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import type { Address } from "@solana/kit";
import {
  type ConfigAccount,
  type DrawAccount,
  DrawPhase,
  type PlayerPositionAccount,
  type StakerPositionAccount,
} from "../../scripts/fate-client";
import type { FateTransactionState } from "../lib/fate-transactions";
import type { WalletStatus } from "./wallet-controls";

const SOL = 1_000_000_000n;

export type ReviewAction =
  | { kind: "deposit"; amountLamports: bigint; amountLabel: string }
  | { kind: "refund"; amountLamports: bigint; amountLabel: string }
  | { kind: "withdraw"; amountLamports: bigint; amountLabel: string }
  | { kind: "claim"; amountLamports: bigint; amountLabel: string }
  | { kind: "claim-withdrawal"; amountLamports: bigint; amountLabel: string }
  | { kind: "progress"; action: "activate" | "settle"; amountLabel: string };

type SecondaryActionKind = Exclude<ReviewAction["kind"], "deposit" | "progress">;

export function FateMain({
  amount,
  config,
  draw,
  isPlayer,
  mode,
  network,
  now,
  phase,
  playerPosition,
  programAddress,
  progressAction,
  progress,
  refreshing,
  review,
  transactionBusy,
  txMessage,
  txState,
  wallet,
  walletStatus,
  stakerPosition,
  onAmountChange,
  onCancelReview,
  onConfirmReview,
  onModeChange,
  onPrimaryAction,
  onProgressAction,
  onRefresh,
  onSecondaryAction,
}: {
  amount: string;
  config: ConfigAccount | undefined;
  draw: DrawAccount | undefined;
  isPlayer: boolean;
  mode: "staker" | "player";
  network: string;
  now: number;
  phase: string;
  playerPosition: PlayerPositionAccount | null;
  programAddress: Address | null;
  progressAction: "activate" | "settle" | null;
  progress: number;
  refreshing: boolean;
  review: ReviewAction | null;
  transactionBusy: boolean;
  txMessage: string | null;
  txState: FateTransactionState | null;
  wallet: ConnectedStandardSolanaWallet | null;
  walletStatus: WalletStatus;
  stakerPosition: StakerPositionAccount | null;
  onAmountChange: (value: string) => void;
  onCancelReview: () => void;
  onConfirmReview: () => void;
  onModeChange: (mode: "staker" | "player") => void;
  onPrimaryAction: () => void;
  onProgressAction: () => void;
  onRefresh: () => void;
  onSecondaryAction: (kind: SecondaryActionKind) => void;
}) {
  return (
    <section className="fate-workspace" aria-label="Current Fate draw">
      <div className="draw-heading">
        <div>
          <p className="eyebrow">Current draw</p>
          <h1 className="display-font draw-title">
            #{draw?.id.toString() ?? "—"} <span>{phase}</span>
          </h1>
        </div>
        <button className="quiet-button" onClick={onRefresh} type="button">
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
        {progressAction ? (
          <div className="transaction-review lifecycle-prompt">
            <div className="transaction-review-row">
              <span>Lifecycle</span>
              <strong>
                {progressAction === "activate" ? "Activation is ready" : "Settlement is due"}
              </strong>
            </div>
            <p className="terms-note">
              A connected wallet can submit this permissionless transition and pay its network fee.
              Fate will simulate it before asking for approval.
            </p>
            <button
              className="primary-action"
              disabled={transactionBusy || walletStatus !== "connected"}
              onClick={onProgressAction}
              type="button"
            >
              {progressAction === "activate" ? "Activate draw" : "Settle draw"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : null}

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
            <ModeButton active={!isPlayer} label="Staker" onClick={() => onModeChange("staker")} />
            <ModeButton active={isPlayer} label="Player" onClick={() => onModeChange("player")} />
          </fieldset>

          <label className="amount-field">
            <span className="sr-only">{mode} amount in SOL</span>
            <input
              aria-label={`${mode} amount in SOL`}
              inputMode="decimal"
              min="0"
              onChange={(event) => onAmountChange(event.target.value)}
              placeholder="0.10"
              value={amount}
            />
            <span>SOL</span>
          </label>

          <button
            className="primary-action"
            disabled={transactionBusy || walletStatus === "checking"}
            onClick={onPrimaryAction}
            type="button"
          >
            {transactionBusy
              ? transactionStateLabel(txState)
              : walletStatus === "connected"
                ? `Deposit as ${isPlayer ? "Player" : "Staker"}`
                : `Connect wallet to ${isPlayer ? "play" : "stake"}`}
            <span aria-hidden="true">→</span>
          </button>

          {isPlayer && playerPosition?.refundableLamports && draw?.phase === DrawPhase.Funding ? (
            <button
              className="secondary-action"
              onClick={() => onSecondaryAction("refund")}
              type="button"
            >
              Refund {formatSol(playerPosition.refundableLamports)} SOL
            </button>
          ) : null}
          {isPlayer && playerPosition?.claimableLamports ? (
            <button
              className="secondary-action"
              onClick={() => onSecondaryAction("claim")}
              type="button"
            >
              Claim {formatSol(playerPosition.claimableLamports)} SOL
            </button>
          ) : null}
          {!isPlayer && stakerPosition?.activeShares && draw?.phase === DrawPhase.Funding ? (
            <button
              className="secondary-action"
              onClick={() => onSecondaryAction("withdraw")}
              type="button"
            >
              Exit all shares
            </button>
          ) : null}
          {!isPlayer && stakerPosition?.claimableWithdrawalLamports ? (
            <button
              className="secondary-action"
              onClick={() => onSecondaryAction("claim-withdrawal")}
              type="button"
            >
              Claim withdrawal
            </button>
          ) : null}

          {review ? (
            <div className="transaction-review" role="dialog" aria-label="Review transaction">
              <div className="transaction-review-row">
                <span>Action</span>
                <strong>
                  {review.kind === "progress"
                    ? review.action === "activate"
                      ? "Activate draw"
                      : "Settle draw"
                    : reviewLabel(review.kind)}
                </strong>
              </div>
              <div className="transaction-review-row">
                <span>Amount</span>
                <strong>{review.amountLabel}</strong>
              </div>
              <div className="transaction-review-row">
                <span>Network / fee payer</span>
                <strong>
                  {network} · {wallet ? compactAddress(wallet.address) : "—"}
                </strong>
              </div>
              <p className="terms-note">
                Fate program: {programAddress?.slice(0, 8) ?? "—"}… · wallet fee shown next.
              </p>
              <div className="review-actions">
                <button className="quiet-button" onClick={onCancelReview} type="button">
                  Cancel
                </button>
                <button
                  className="primary-action review-confirm"
                  disabled={transactionBusy}
                  onClick={onConfirmReview}
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

function reviewLabel(kind: Exclude<ReviewAction["kind"], "progress">) {
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
