import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import type { Address } from "@solana/kit";
import { BPS_DENOMINATOR, DrawPhase } from "../domain/fate";
import type { ReviewAction } from "../features/draw/types";
import type { FateTransactionPreview, FateTransactionState } from "../lib/transactions";
import {
  compactAddress,
  countdownLabel,
  formatSol,
  formatSolPrecise,
  transactionStateLabel,
} from "./fate-format";
import type { FateViewModel } from "./fate-view-model";

export function TransactionReview({
  network,
  programAddress,
  review,
  transactionBusy,
  txState,
  preview,
  unknownSignature,
  wallet,
  view,
  onCancel,
  onConfirm,
}: {
  network: string;
  programAddress: Address | null;
  review: ReviewAction;
  transactionBusy: boolean;
  txState: FateTransactionState | null;
  preview: FateTransactionPreview | null;
  unknownSignature: string | null;
  wallet: ConnectedStandardSolanaWallet | null;
  view: FateViewModel;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
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
        <span>Transfers</span>
        <strong>{reviewTransfers(review)}</strong>
      </div>
      <div className="transaction-review-row">
        <span>Expected post-action</span>
        <strong>{postActionState(review, view)}</strong>
      </div>
      <ReviewDisclosures review={review} view={view} />
      <div className="transaction-review-row">
        <span>Network / fee payer</span>
        <strong>
          {network} · {wallet ? compactAddress(wallet.address) : "—"}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Estimated network fee</span>
        <strong>
          {preview
            ? preview.estimatedFeeLamports === null
              ? "Unavailable from primary RPC"
              : `${formatSolPrecise(preview.estimatedFeeLamports)} SOL`
            : "Pending simulation"}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Transaction state</span>
        <strong>{txState ? transactionStateLabel(txState) : "Ready to simulate"}</strong>
      </div>
      <p className="terms-note">
        Fate program: {programAddress?.slice(0, 8) ?? "—"}… · Simulation and approval use the
        primary RPC.
      </p>
      {unknownSignature ? (
        <p className="terms-note">
          Submitted signature: {compactAddress(unknownSignature)}. Check its status before retrying.
        </p>
      ) : null}
      <div className="review-actions">
        <button className="quiet-button" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="primary-action review-confirm"
          disabled={transactionBusy}
          onClick={onConfirm}
          type="button"
        >
          {transactionBusy
            ? transactionStateLabel(txState)
            : unknownSignature
              ? "Check transaction status"
              : "Simulate & approve"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

function reviewTransfers(review: ReviewAction) {
  if (review.kind === "progress") return "No direct wallet transfer; lifecycle state changes";
  if (review.kind === "deposit") {
    return review.side === "player"
      ? "Fee payer → pending Player position"
      : "Fee payer → Staker vault; shares minted";
  }
  if (review.kind === "refund") return "Pending Player SOL → fee payer";
  if (review.kind === "withdraw") return "Staker shares → withdrawal liability";
  if (review.kind === "claim") return "Player claim balance → fee payer";
  return "Staker withdrawal liability → fee payer";
}

function postActionState(review: ReviewAction, view: FateViewModel) {
  if (review.kind === "progress") {
    return review.action === "activate"
      ? "Draw ACTIVATED; five-minute countdown starts"
      : "Draw SETTLED; next draw enters FUNDING";
  }
  if (review.kind === "deposit" && review.side === "player") {
    if (view.draw?.phase === DrawPhase.Activated) {
      return "Player position added at 1.00x weight; draw remains ACTIVATED";
    }
    const threshold = view.activationThresholdLamports ?? 0n;
    const reachesThreshold =
      view.draw !== undefined &&
      view.draw.phase === DrawPhase.Funding &&
      threshold > 0n &&
      view.draw.playerTvlLamports + review.amountLamports >= threshold;
    return reachesThreshold
      ? "Player position committed; draw ACTIVATED"
      : threshold > 0n
        ? "Player position updated; remains refundable during FUNDING"
        : "Player position updated; activation threshold is not available yet";
  }
  if (review.kind === "deposit") return "Staker shares added; draw remains in FUNDING";
  if (review.kind === "refund") return "Player funds returned; funding snapshot resets if empty";
  if (review.kind === "withdraw") return "Staker shares reduced; withdrawal becomes claimable";
  if (review.kind === "claim") return "Player claim balance closes; SOL returns";
  return "Staker withdrawal liability closes; SOL returns";
}

function ReviewDisclosures({ review, view }: { review: ReviewAction; view: FateViewModel }) {
  const draw = view.draw;
  const vault = view.vault;
  const isDeposit = review.kind === "deposit";
  const playerDeposit = isDeposit && review.side === "player" ? review.amountLamports : 0n;
  const playerTvl = (draw?.playerTvlLamports ?? 0n) + playerDeposit;
  const stakerTvl = view.stakerTvlLamports ?? draw?.stakerTvlSnapshot ?? 0n;
  const winnerDeposit =
    review.kind === "deposit" && review.side === "player"
      ? (view.playerPosition?.committedLamports ?? 0n) + review.amountLamports
      : (view.playerPosition?.committedLamports ?? 0n);
  const addedPlayerWeight =
    review.kind === "deposit" && review.side === "player"
      ? boostedPlayerWeight(review.amountLamports, draw)
      : 0n;
  const totalPlayerWeight = (draw?.totalPlayerWeight ?? 0n) + addedPlayerWeight;
  const addedStakerShares =
    review.kind === "deposit" && review.side === "staker"
      ? previewDepositShares(review.amountLamports, vault)
      : 0n;
  const totalStakerShares = (vault?.totalShares ?? 0n) + addedStakerShares;
  const effectiveStakerShares = (view.stakerPosition?.activeShares ?? 0n) + addedStakerShares;
  const playerSettlement = estimatePlayerSettlement(stakerTvl, playerTvl, winnerDeposit);
  const stakerPayout = estimateStakerPayout(playerTvl, effectiveStakerShares, totalStakerShares);
  const selectedSide = isDeposit ? review.side : null;
  const personalOdds =
    selectedSide === "player"
      ? ratioLabel((view.playerPosition?.weight ?? 0n) + addedPlayerWeight, totalPlayerWeight)
      : selectedSide === "staker"
        ? ratioLabel(effectiveStakerShares, totalStakerShares)
        : "—";
  const sideLabel =
    selectedSide === "player"
      ? "Player (90% side probability)"
      : selectedSide === "staker"
        ? "Staker (10% side probability)"
        : "No new draw entry";
  const recentDraws = view.recentDraws.slice(0, 10);

  return (
    <div className="review-disclosures">
      <div className="transaction-review-row">
        <span>Phase / threshold</span>
        <strong>
          {view.phase} ·{" "}
          {view.activationThresholdLamports === null
            ? "—"
            : `${formatSol(view.activationThresholdLamports)} SOL`}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Countdown / side</span>
        <strong>
          {countdownLabel(draw?.phase, draw?.locksAt, view.now)} · {sideLabel}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Personal odds</span>
        <strong>{personalOdds}</strong>
      </div>
      <div className="transaction-review-row">
        <span>Conditional payout</span>
        <strong>
          {selectedSide === "player"
            ? `${formatSol(playerSettlement.payout)} SOL if selected`
            : selectedSide === "staker"
              ? `${formatSol(stakerPayout)} SOL if selected`
              : review.kind === "claim"
                ? review.amountLabel
                : "—"}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Fee base / fee</span>
        <strong>
          {selectedSide === "player"
            ? `${formatSol(playerSettlement.grossProfit)} SOL · 5%`
            : selectedSide === "staker"
              ? `${formatSol(playerTvl)} SOL Player TVL · 5%`
              : "—"}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Maximum loss / erosion</span>
        <strong>
          {selectedSide === "player"
            ? formatSol(winnerDeposit) +
              " SOL · " +
              formatSol(playerSettlement.erosion) +
              " SOL erosion"
            : selectedSide === "staker"
              ? `${formatSol(playerSettlement.erosion)} SOL estimated pool erosion`
              : "—"}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Pending / liability</span>
        <strong>
          {draw ? `${draw.openPlayerPositions.toString()} open Players · ` : ""}
          {formatSol(draw?.outstandingPlayerClaimLamports ?? 0n)} SOL Player claims ·{" "}
          {formatSol(vault?.withdrawalLiabilityLamports ?? 0n)} SOL Staker withdrawals
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Claim state</span>
        <strong>{claimState(view)}</strong>
      </div>
      <div className="review-history">
        <span className="context-label">Ten recent results</span>
        {recentDraws.length ? (
          <ol>
            {recentDraws.map(({ draw: recent }) => (
              <li key={recent.id.toString()}>
                #{recent.id.toString()} · {recent.winnerSide === 1 ? "Player" : "Staker"} ·{" "}
                {formatSol(recent.winnerPayoutLamports)} SOL
              </li>
            ))}
          </ol>
        ) : (
          <p>No settled draws yet</p>
        )}
      </div>
    </div>
  );
}

function boostedPlayerWeight(amount: bigint, draw: FateViewModel["draw"]) {
  if (!draw || draw.phase !== DrawPhase.Funding || draw.initialThresholdLamports === 0n) {
    return amount;
  }
  const remaining =
    draw.initialThresholdLamports > draw.playerTvlLamports
      ? draw.initialThresholdLamports - draw.playerTvlLamports
      : 0n;
  const boostBps = BPS_DENOMINATOR + (remaining * 5_000n) / draw.initialThresholdLamports;
  return (amount * boostBps) / BPS_DENOMINATOR;
}

function previewDepositShares(amount: bigint, vault: FateViewModel["vault"]) {
  if (!vault || vault.totalShares === 0n) return amount;
  if (vault.activeAssetsLamports === 0n) return 0n;
  return (amount * vault.totalShares) / vault.activeAssetsLamports;
}

function estimatePlayerSettlement(stakerTvl: bigint, playerTvl: bigint, winnerDeposit: bigint) {
  const safeWinnerDeposit = winnerDeposit > playerTvl ? playerTvl : winnerDeposit;
  const losingPlayer = playerTvl - safeWinnerDeposit;
  const erosion = min((stakerTvl * 7n) / BPS_DENOMINATOR, (playerTvl * 700n) / BPS_DENOMINATOR);
  const grossProfit = losingPlayer + erosion;
  const winnerProfit = (grossProfit * 9_500n) / BPS_DENOMINATOR;
  return {
    erosion,
    grossProfit,
    payout: safeWinnerDeposit + winnerProfit,
  };
}

function estimateStakerPayout(playerTvl: bigint, shares: bigint, totalShares: bigint) {
  if (totalShares === 0n) return 0n;
  const jackpot = (playerTvl * 3_000n) / BPS_DENOMINATOR;
  const proRataPool = (playerTvl * 6_500n) / BPS_DENOMINATOR;
  return jackpot + (proRataPool * shares) / totalShares;
}

function ratioLabel(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) return "—";
  const basisPoints = (numerator * 10_000n) / denominator;
  return `${basisPoints / 100n}.${(basisPoints % 100n).toString().padStart(2, "0")}%`;
}

function claimState(view: FateViewModel) {
  if (view.playerPosition?.claimableLamports) {
    return `${formatSol(view.playerPosition.claimableLamports)} SOL Player claimable`;
  }
  if (view.playerPosition?.refundableLamports) {
    return `${formatSol(view.playerPosition.refundableLamports)} SOL refundable`;
  }
  if (view.stakerPosition?.claimableWithdrawalLamports) {
    return `${formatSol(view.stakerPosition.claimableWithdrawalLamports)} SOL Staker withdrawal`;
  }
  return "No pending claim";
}

function min(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function reviewLabel(kind: Exclude<ReviewAction["kind"], "progress">) {
  if (kind === "deposit") return "Deposit";
  if (kind === "refund") return "Refund Player position";
  if (kind === "withdraw") return "Request Staker withdrawal";
  if (kind === "claim") return "Claim Player winnings";
  return "Claim Staker withdrawal";
}
