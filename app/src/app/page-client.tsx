"use client";

import { useEffect, useState } from "react";
import { type DrawAccount, DrawPhase } from "../../scripts/fate-client";
import { browserProgramAddress } from "../lib/fate-browser";
import { useFateSnapshot } from "./use-fate-snapshot";
import { StaticWalletControls, WalletControls, type WalletStatus } from "./wallet-controls";

const SOL = 1_000_000_000n;
const phaseLabels: Record<number, string> = {
  [DrawPhase.Funding]: "Funding",
  [DrawPhase.Activated]: "Countdown",
  [DrawPhase.Locked]: "Locked",
  [DrawPhase.AwaitingRandomness]: "Settling",
  [DrawPhase.Settled]: "Settled",
  [DrawPhase.Voided]: "Voided",
};

export function FatePage() {
  const { snapshot, error, refreshing, refresh } = useFateSnapshot();
  const [mode, setMode] = useState<"staker" | "player">("player");
  const [amount, setAmount] = useState("0.10");
  const [now, setNow] = useState(() => Date.now());
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("unavailable");

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const draw = snapshot?.draw;
  const config = snapshot?.config;
  const phase = draw ? (phaseLabels[draw.phase] ?? "Unknown") : "Connecting";
  const progress = draw ? thresholdProgress(draw) : 0;
  const isPlayer = mode === "player";
  const hasPrivy = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());

  return (
    <main className="fate-page">
      <header className="fate-header">
        <div className="brand-lockup">
          <span className="display-font brand-name">Fate</span>
          <span className="brand-note">one draw at a time</span>
        </div>
        <div className="header-actions">
          <span className="network-mark">{networkLabel()}</span>
          {hasPrivy ? (
            <WalletControls onStatusChange={setWalletStatus} />
          ) : (
            <StaticWalletControls />
          )}
        </div>
      </header>

      <section className="fate-workspace" aria-label="Current Fate draw">
        <div className="draw-heading">
          <div>
            <p className="eyebrow">Current draw</p>
            <h1 className="display-font draw-title">
              #{draw?.id.toString() ?? "—"} <span>{phase}</span>
            </h1>
          </div>
          <button className="quiet-button" onClick={() => void refresh()} type="button">
            <span className={refreshing ? "refresh-mark is-spinning" : "refresh-mark"}>↻</span>
            {refreshing ? "Reading" : "Refresh"}
          </button>
        </div>

        <div className="draw-context">
          <div className="context-topline">
            <div>
              <p className="context-label">Player threshold</p>
              <p className="context-value">
                {draw
                  ? `${formatSol(draw.playerTvlLamports)} / ${formatSol(draw.activationThresholdLamports)} SOL`
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
            <span>{countdownLabel(draw, now)}</span>
            <span>
              {draw ? `Staker TVL ${formatSol(draw.stakerTvlSnapshot)} SOL` : "Staker TVL —"}
            </span>
          </div>
        </div>

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
              <ModeButton active={!isPlayer} label="Staker" onClick={() => setMode("staker")} />
              <ModeButton active={isPlayer} label="Player" onClick={() => setMode("player")} />
            </fieldset>

            <label className="amount-field">
              <span className="sr-only">{mode} amount in SOL</span>
              <input
                aria-label={`${mode} amount in SOL`}
                inputMode="decimal"
                min="0"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.10"
                value={amount}
              />
              <span>SOL</span>
            </label>

            <button className="primary-action" disabled type="button">
              {walletStatus === "connected"
                ? "Deposit flow next"
                : `Connect wallet to ${isPlayer ? "play" : "stake"}`}
              <span aria-hidden="true">→</span>
            </button>

            <p className="minimum-note">
              Minimum {mode === "player" ? "Player" : "Staker"} deposit:{" "}
              {mode === "player" ? "0.01" : "0.10"} SOL
            </p>
          </div>
        </div>

        <div className="details-stack">
          <details className="info-toggle">
            <summary>
              <span>View draw terms</span>
              <span className="toggle-icon" aria-hidden="true">
                +
              </span>
            </summary>
            <div className="terms-grid">
              <Term label="Side odds" value="Player 90% · Staker 10%" />
              <Term
                label="Player max loss"
                value={draw ? `${formatSol(draw.playerTvlLamports)} SOL` : "—"}
              />
              <Term label="Player fee" value="5% of profit" />
              <Term label="Staker exposure" value="Principal can erode" />
              <p className="terms-note">
                The selected side is fixed first, then one wallet wins by its stored weight. Pending
                Player deposits can be refunded only during funding.
              </p>
            </div>
          </details>

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
                <p>
                  {config?.recentDrawIds.length
                    ? config.recentDrawIds
                        .slice(0, 5)
                        .map((id) => `#${id}`)
                        .join(" · ")
                    : "No settled draws yet"}
                </p>
              </div>
              <p className="terms-note">
                Native SOL only. Fate is not a guaranteed-principal product.
              </p>
            </div>
          </details>
        </div>
      </section>

      <footer className="fate-footer">
        <span>Devnet preview · read-only until wallet access is connected</span>
        <span className="mono">
          {browserProgramAddress()?.slice(0, 8) ?? "program not configured"}
        </span>
      </footer>

      {error ? (
        <div className="error-toast">
          Read-only preview: {error}. Configure the browser RPC and program ID to show live state.
        </div>
      ) : null}
    </main>
  );
}
function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="term-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "mode-button is-active" : "mode-button"}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function formatSol(lamports: bigint) {
  return (Number(lamports) / Number(SOL)).toFixed(2);
}

function thresholdProgress(draw: DrawAccount) {
  if (draw.stakerTvlSnapshot === 0n || draw.activationThresholdLamports === 0n) return 0;
  return Math.min(
    100,
    Math.round(Number((draw.playerTvlLamports * 100n) / draw.activationThresholdLamports)),
  );
}

function countdownLabel(draw: DrawAccount | undefined, now: number) {
  if (!draw || draw.phase !== DrawPhase.Activated || draw.locksAt <= 0n) return "Funding open";
  const remaining = Number(draw.locksAt) - Math.floor(now / 1000);
  return remaining > 0 ? `${formatDuration(remaining)} remaining` : "Lock due";
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function networkLabel() {
  return process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() || "localnet";
}
