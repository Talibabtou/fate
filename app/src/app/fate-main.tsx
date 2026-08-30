"use client";

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import type { FateTransactionState } from "../lib/transactions";
import { DrawHeader } from "./fate/draw-header";
import { DrawProgress } from "./fate/draw-progress";
import { DrawTerms } from "./fate/draw-terms";
import type { FateViewModel } from "./fate/fate-view-model";
import { PositionActionForm } from "./fate/position-action-form";
import { RecentDraws } from "./fate/recent-draws";
import { TransactionReview } from "./fate/transaction-review";
import type { ReviewAction, SecondaryActionKind } from "./use-fate-actions";
import type { WalletStatus } from "./use-wallet-session";

export type { ReviewAction } from "./use-fate-actions";
export function FateMain({
  amount,
  view,
  review,
  transactionBusy,
  txMessage,
  txState,
  wallet,
  walletStatus,
  onAmountChange,
  onCancelReview,
  onConfirmReview,
  onModeChange,
  onPrimaryAction,
  onProgressAction,
  onRefresh,
  onSecondaryAction,
  onWithdrawalSharesChange,
}: {
  view: FateViewModel;
  amount: string;
  review: ReviewAction | null;
  transactionBusy: boolean;
  txMessage: string | null;
  txState: FateTransactionState | null;
  wallet: ConnectedStandardSolanaWallet | null;
  walletStatus: WalletStatus;
  onAmountChange: (value: string) => void;
  onCancelReview: () => void;
  onConfirmReview: () => void;
  onModeChange: (mode: "staker" | "player") => void;
  onPrimaryAction: () => void;
  onProgressAction: () => void;
  onRefresh: () => void;
  onSecondaryAction: (kind: SecondaryActionKind) => void;
  onWithdrawalSharesChange: (value: string) => void;
}) {
  const {
    activationThresholdLamports,
    config,
    draw,
    isPlayer,
    mode,
    network,
    now,
    phase,
    playerPosition,
    programAddress,
    progress,
    progressAction,
    refreshing,
    stakerPosition,
    stakerTvlLamports,
    withdrawalShares,
  } = view;

  return (
    <section className="fate-workspace" aria-label="Current Fate draw">
      <DrawHeader
        drawId={draw?.id}
        onProgressAction={onProgressAction}
        onRefresh={onRefresh}
        phase={phase}
        progressAction={progressAction}
        refreshing={refreshing}
        transactionBusy={transactionBusy}
        walletStatus={walletStatus}
      />

      <DrawProgress
        activationThresholdLamports={activationThresholdLamports}
        draw={draw}
        now={now}
        progress={progress}
        stakerTvlLamports={stakerTvlLamports}
      />

      <PositionActionForm
        amount={amount}
        draw={draw}
        isPlayer={isPlayer}
        mode={mode}
        onAmountChange={onAmountChange}
        onModeChange={onModeChange}
        onPrimaryAction={onPrimaryAction}
        onSecondaryAction={onSecondaryAction}
        onWithdrawalSharesChange={onWithdrawalSharesChange}
        playerPosition={playerPosition}
        stakerPosition={stakerPosition}
        transactionBusy={transactionBusy}
        txState={txState}
        walletStatus={walletStatus}
        withdrawalShares={withdrawalShares}
      >
        {review ? (
          <TransactionReview
            network={network}
            onCancel={onCancelReview}
            onConfirm={onConfirmReview}
            programAddress={programAddress}
            review={review}
            transactionBusy={transactionBusy}
            txState={txState}
            wallet={wallet}
          />
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
      </PositionActionForm>

      <div className="details-stack">
        <DrawTerms draw={draw} />
        <RecentDraws config={config} />
      </div>
    </section>
  );
}
