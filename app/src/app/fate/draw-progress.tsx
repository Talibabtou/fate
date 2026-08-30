import type { DrawAccount } from "../../domain/fate";
import { countdownLabel, formatSol } from "./fate-format";

export function DrawProgress({
  activationThresholdLamports,
  draw,
  now,
  progress,
  stakerTvlLamports,
}: {
  activationThresholdLamports: bigint | null;
  draw: DrawAccount | undefined;
  now: number;
  progress: number;
  stakerTvlLamports: bigint | null;
}) {
  return (
    <div className="draw-context">
      <div className="context-topline">
        <div>
          <p className="context-label">Player threshold</p>
          <p className="context-value">
            {draw && activationThresholdLamports !== null
              ? `${formatSol(draw.playerTvlLamports)} / ${formatSol(activationThresholdLamports)} SOL`
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
        <span>{countdownLabel(draw?.phase, draw?.locksAt, now)}</span>
        <span>
          {stakerTvlLamports !== null
            ? `Staker TVL ${formatSol(stakerTvlLamports)} SOL`
            : "Staker TVL —"}
        </span>
      </div>
    </div>
  );
}
