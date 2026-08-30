import type { DrawAccount, PlayerPositionAccount, StakerPositionAccount } from "../../domain/fate";
import { DrawPhase } from "../../domain/fate";
import type { SecondaryActionKind } from "../use-fate-actions";
import { formatSol } from "./fate-format";

export function SecondaryActions({
  draw,
  isPlayer,
  playerPosition,
  stakerPosition,
  transactionBusy,
  withdrawalShares,
  onSecondaryAction,
  onWithdrawalSharesChange,
}: {
  draw: DrawAccount | undefined;
  isPlayer: boolean;
  playerPosition: PlayerPositionAccount | null;
  stakerPosition: StakerPositionAccount | null;
  transactionBusy: boolean;
  withdrawalShares: string;
  onSecondaryAction: (kind: SecondaryActionKind) => void;
  onWithdrawalSharesChange: (value: string) => void;
}) {
  return (
    <>
      {isPlayer && playerPosition?.refundableLamports && draw?.phase === DrawPhase.Funding ? (
        <button
          className="secondary-action"
          disabled={transactionBusy}
          onClick={() => onSecondaryAction("refund")}
          type="button"
        >
          Refund {formatSol(playerPosition.refundableLamports)} SOL
        </button>
      ) : null}
      {isPlayer && playerPosition?.claimableLamports ? (
        <button
          className="secondary-action"
          disabled={transactionBusy}
          onClick={() => onSecondaryAction("claim")}
          type="button"
        >
          Claim {formatSol(playerPosition.claimableLamports)} SOL
        </button>
      ) : null}
      {!isPlayer && stakerPosition?.activeShares && draw?.phase === DrawPhase.Funding ? (
        <>
          <label className="amount-field withdrawal-field">
            <span className="sr-only">Staker shares to withdraw</span>
            <input
              aria-label="Staker shares to withdraw"
              disabled={transactionBusy}
              inputMode="numeric"
              min="1"
              max={stakerPosition.activeShares.toString()}
              onChange={(event) => onWithdrawalSharesChange(event.target.value)}
              placeholder={stakerPosition.activeShares.toString()}
              value={withdrawalShares}
            />
            <span>shares</span>
          </label>
          <p className="minimum-note">
            Available: {stakerPosition.activeShares} shares. Leave blank to withdraw all.
          </p>
          <button
            className="secondary-action"
            disabled={transactionBusy}
            onClick={() => onSecondaryAction("withdraw")}
            type="button"
          >
            Withdraw selected shares
          </button>
        </>
      ) : null}
      {!isPlayer && stakerPosition?.claimableWithdrawalLamports ? (
        <button
          className="secondary-action"
          disabled={transactionBusy}
          onClick={() => onSecondaryAction("claim-withdrawal")}
          type="button"
        >
          Claim withdrawal
        </button>
      ) : null}
    </>
  );
}
