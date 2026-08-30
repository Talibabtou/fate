import type { ReactNode } from "react";
import type { DrawAccount, PlayerPositionAccount, StakerPositionAccount } from "../../domain/fate";
import type { FateTransactionState } from "../../lib/transactions";
import type { SecondaryActionKind } from "../use-fate-actions";
import type { WalletStatus } from "../use-wallet-session";
import { formatSol, transactionStateLabel } from "./fate-format";
import { SecondaryActions } from "./secondary-actions";

export function PositionActionForm({
  amount,
  children,
  draw,
  isPlayer,
  mode,
  playerPosition,
  stakerPosition,
  transactionBusy,
  txState,
  walletStatus,
  withdrawalShares,
  onAmountChange,
  onModeChange,
  onPrimaryAction,
  onSecondaryAction,
  onWithdrawalSharesChange,
}: {
  amount: string;
  children: ReactNode;
  draw: DrawAccount | undefined;
  isPlayer: boolean;
  mode: "staker" | "player";
  playerPosition: PlayerPositionAccount | null;
  stakerPosition: StakerPositionAccount | null;
  transactionBusy: boolean;
  txState: FateTransactionState | null;
  walletStatus: WalletStatus;
  withdrawalShares: string;
  onAmountChange: (value: string) => void;
  onModeChange: (mode: "staker" | "player") => void;
  onPrimaryAction: () => void;
  onSecondaryAction: (kind: SecondaryActionKind) => void;
  onWithdrawalSharesChange: (value: string) => void;
}) {
  const playerRefundable = playerPosition?.refundableLamports ?? 0n;
  const playerCommitted = playerPosition?.committedLamports ?? 0n;
  const playerClaimable = playerPosition?.claimableLamports ?? 0n;
  const stakerShares = stakerPosition?.activeShares ?? 0n;
  const stakerWithdrawal = stakerPosition?.claimableWithdrawalLamports ?? 0n;
  const positionValue = isPlayer
    ? playerRefundable > 0n
      ? `${formatSol(playerRefundable)} SOL`
      : playerCommitted > 0n
        ? `${formatSol(playerCommitted)} SOL`
        : playerClaimable > 0n
          ? `${formatSol(playerClaimable)} SOL`
          : "No active position"
    : stakerShares > 0n
      ? `${stakerShares} shares`
      : stakerWithdrawal > 0n
        ? `${formatSol(stakerWithdrawal)} SOL`
        : "No active position";
  const positionState = isPlayer
    ? playerRefundable > 0n
      ? "Refundable during Funding"
      : playerCommitted > 0n
        ? "Committed to this draw"
        : playerClaimable > 0n
          ? "Claim available"
          : "Deposit to enter this draw"
    : stakerShares > 0n
      ? stakerWithdrawal > 0n
        ? "Active · withdrawal claim available"
        : "Active in the vault"
      : stakerWithdrawal > 0n
        ? "Withdrawal claim available"
        : "Deposit to enter the vault";

  return (
    <div className="action-layout">
      <div className="action-intro">
        <p className="eyebrow">Your position</p>
        <h2 className="display-font action-title">{isPlayer ? "Player" : "Staker"}</h2>
        <div className="position-summary" aria-live="polite">
          <div className="position-summary-row">
            <span className="context-label">Current position</span>
            <strong>{positionValue}</strong>
          </div>
          <p>{positionState}</p>
        </div>
      </div>

      <div className="action-form">
        <fieldset className="mode-switch">
          <legend className="sr-only">Choose a side</legend>
          <ModeButton
            active={!isPlayer}
            disabled={transactionBusy}
            label="Staker"
            onClick={() => onModeChange("staker")}
          />
          <ModeButton
            active={isPlayer}
            disabled={transactionBusy}
            label="Player"
            onClick={() => onModeChange("player")}
          />
        </fieldset>

        <label className="amount-field">
          <span className="sr-only">{mode} amount in SOL</span>
          <input
            aria-label={`${mode} amount in SOL`}
            disabled={transactionBusy}
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

        <SecondaryActions
          draw={draw}
          isPlayer={isPlayer}
          onSecondaryAction={onSecondaryAction}
          onWithdrawalSharesChange={onWithdrawalSharesChange}
          playerPosition={playerPosition}
          stakerPosition={stakerPosition}
          transactionBusy={transactionBusy}
          withdrawalShares={withdrawalShares}
        />

        {children}

        <p className="minimum-note">
          Minimum {mode === "player" ? "Player" : "Staker"} deposit:{" "}
          {mode === "player" ? "0.01" : "0.10"} SOL
        </p>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "mode-button is-active" : "mode-button"}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
