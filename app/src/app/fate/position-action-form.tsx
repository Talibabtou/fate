import type { ReactNode } from "react";
import type { DrawAccount, PlayerPositionAccount, StakerPositionAccount } from "../../domain/fate";
import type { FateTransactionState } from "../../lib/transactions";
import type { SecondaryActionKind } from "../use-fate-actions";
import type { WalletStatus } from "../use-wallet-session";
import { transactionStateLabel } from "./fate-format";
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
  return (
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
