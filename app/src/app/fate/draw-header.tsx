import type { LifecycleAction } from "../use-lifecycle-progress";
import type { WalletStatus } from "../use-wallet-session";
import { LifecyclePrompt } from "./lifecycle-prompt";

export function DrawHeader({
  drawId,
  phase,
  progressAction,
  refreshing,
  transactionBusy,
  walletStatus,
  onProgressAction,
  onRefresh,
}: {
  drawId: bigint | undefined;
  phase: string;
  progressAction: LifecycleAction | null;
  refreshing: boolean;
  transactionBusy: boolean;
  walletStatus: WalletStatus;
  onProgressAction: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="draw-heading">
      <div>
        <p className="eyebrow">Current draw</p>
        <h1 className="display-font draw-title">
          #{drawId?.toString() ?? "—"} <span>{phase}</span>
        </h1>
      </div>
      <div className="draw-actions">
        {progressAction ? (
          <LifecyclePrompt
            action={progressAction}
            disabled={transactionBusy || walletStatus !== "connected"}
            onAction={onProgressAction}
          />
        ) : null}
        <button
          aria-label={refreshing ? "Refreshing live state" : "Refresh live state"}
          className="quick-action refresh-action"
          disabled={refreshing}
          onClick={onRefresh}
          title={refreshing ? "Refreshing…" : "Refresh live state"}
          type="button"
        >
          <span className={refreshing ? "refresh-mark is-spinning" : "refresh-mark"}>↻</span>
        </button>
      </div>
    </div>
  );
}
