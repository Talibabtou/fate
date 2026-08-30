import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import type { Address } from "@solana/kit";
import type { FateTransactionState } from "../../lib/transactions";
import type { ReviewAction } from "../use-fate-actions";
import { compactAddress, transactionStateLabel } from "./fate-format";

export function TransactionReview({
  network,
  programAddress,
  review,
  transactionBusy,
  txState,
  wallet,
  onCancel,
  onConfirm,
}: {
  network: string;
  programAddress: Address | null;
  review: ReviewAction;
  transactionBusy: boolean;
  txState: FateTransactionState | null;
  wallet: ConnectedStandardSolanaWallet | null;
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
        <span>Account effects</span>
        <strong>{reviewEffects(review)}</strong>
      </div>
      <div className="transaction-review-row">
        <span>Network / fee payer</span>
        <strong>
          {network} · {wallet ? compactAddress(wallet.address) : "—"}
        </strong>
      </div>
      <div className="transaction-review-row">
        <span>Transaction state</span>
        <strong>{txState ? transactionStateLabel(txState) : "Ready to simulate"}</strong>
      </div>
      <p className="terms-note">
        Fate program: {programAddress?.slice(0, 8) ?? "—"}… · wallet fee shown next.
      </p>
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
          {transactionBusy ? transactionStateLabel(txState) : "Simulate & approve"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

function reviewEffects(review: ReviewAction) {
  if (review.kind === "progress") {
    return review.action === "activate"
      ? "Current draw moves to Activated"
      : "Current draw settles and opens the next draw";
  }
  if (review.kind === "deposit") {
    return review.side === "player"
      ? "Player position and draw pool increase"
      : "Staker position and vault shares increase";
  }
  if (review.kind === "refund") return "Player position closes; pending SOL returns";
  if (review.kind === "withdraw") return "Staker shares decrease; withdrawal becomes claimable";
  if (review.kind === "claim") return "Player claim balance closes; SOL returns";
  return "Staker withdrawal liability closes; SOL returns";
}

function reviewLabel(kind: Exclude<ReviewAction["kind"], "progress">) {
  if (kind === "deposit") return "Deposit";
  if (kind === "refund") return "Refund Player position";
  if (kind === "withdraw") return "Request Staker withdrawal";
  if (kind === "claim") return "Claim Player winnings";
  return "Claim Staker withdrawal";
}
