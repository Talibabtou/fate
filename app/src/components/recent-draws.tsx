import { WinnerSide } from "../domain/fate";
import type { RecentDrawSnapshot } from "../features/draw/snapshot";
import { formatSol } from "./fate-format";

export function RecentDraws({
  onClaim,
  recentDraws,
}: {
  onClaim: (drawId: bigint) => void;
  recentDraws: RecentDrawSnapshot[];
}) {
  return (
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
          {recentDraws.length ? (
            recentDraws.slice(0, 10).map(({ draw, playerPosition }) => (
              <div className="history-row" key={draw.id.toString()}>
                <div>
                  <p>
                    #{draw.id.toString()} · {winnerSideLabel(draw.winnerSide)} won
                  </p>
                  <p>Winner payout: {formatSol(draw.winnerPayoutLamports)} SOL</p>
                </div>
                {playerPosition?.claimableLamports ? (
                  <button
                    className="secondary-action"
                    onClick={() => onClaim(draw.id)}
                    type="button"
                  >
                    Claim {formatSol(playerPosition.claimableLamports)} SOL
                  </button>
                ) : null}
              </div>
            ))
          ) : (
            <p>No settled draws yet</p>
          )}
        </div>
        <p className="terms-note">Native SOL only. Fate is not a guaranteed-principal product.</p>
      </div>
    </details>
  );
}

function winnerSideLabel(side: number) {
  if (side === WinnerSide.Player) return "Player side";
  if (side === WinnerSide.Staker) return "Staker side";
  return "Unknown side";
}
