"use client";

import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import type { FateTransactionState } from "../lib/transactions";
import { DrawHeader } from "./draw-header";
import { DrawProgress } from "./draw-progress";
import { DrawTerms } from "./draw-terms";
import type { FateViewModel } from "./fate-view-model";
import { PositionActionForm } from "./position-action-form";
import { RecentDraws } from "./recent-draws";
import { TransactionReview } from "./transaction-review";
import type { ReviewAction, SecondaryActionKind } from "../features/draw/types";
import type { WalletStatus } from "../hooks/use-wallet-session";

export type { ReviewAction } from "../features/draw/types";
export function FateMain({
  amount,
  view,
  review,
  transactionBusy,
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
  onSecondaryAction: (kind: SecondaryActionKind, historicalDrawId?: bigint) => void;
  onWithdrawalSharesChange: (value: string) => void;
}) {
  const {
    activationThresholdLamports,
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
    recentDraws,
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
      </PositionActionForm>

      <div className="details-stack">
        <DrawTerms draw={draw} />
        <RecentDraws
          onClaim={(drawId) => onSecondaryAction("claim", drawId)}
          recentDraws={recentDraws}
        />
      </div>
    </section>
  );
}
