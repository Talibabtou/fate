"use client";

import { useCallback, useEffect, useState } from "react";
import { type DrawAccount, DrawPhase } from "../../scripts/fate-client";
import {
  browserProgramAddress,
  browserRpcUrl,
  type FateSnapshot,
  readFateSnapshot,
} from "../lib/fate-browser";

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
  const [snapshot, setSnapshot] = useState<FateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<"staker" | "player">("player");
  const [amount, setAmount] = useState("0.10");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setSnapshot(await readFateSnapshot());
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to read Fate state");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const draw = snapshot?.draw;
  const config = snapshot?.config;
  const phase = draw ? (phaseLabels[draw.phase] ?? "Unknown") : "Connecting";
  const progress = draw ? thresholdProgress(draw) : 0;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-5 sm:px-8 lg:px-12">
      <header className="flex items-center justify-between border-b hairline pb-5">
        <div className="flex items-center gap-3">
          <span className="display-font text-2xl font-semibold tracking-tight">Fate</span>
          <span className="hidden text-xs text-[var(--dim)] sm:inline">one draw at a time</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border hairline px-3 py-1.5 text-xs text-[var(--muted)]">
            {networkLabel()}
          </span>
          <button
            className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
            type="button"
            disabled
            title="Wallet connection is the next integration step"
          >
            Connect wallet
          </button>
        </div>
      </header>

      <section className="grid gap-10 pb-16 pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:pt-20">
        <div>
          <p className="eyebrow">A visible-risk SOL draw</p>
          <h1 className="display-font mt-4 max-w-3xl text-5xl leading-[0.95] sm:text-7xl">
            The pool is open. <span className="text-[var(--accent)]">Know the terms.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[var(--muted)] sm:text-lg">
            One Player can win the other Player deposits. Stakers share the pool’s exposure. Every
            threshold, fee, payout, and maximum loss stays visible before a wallet signs.
          </p>
        </div>
        <div className="flex gap-8 border-l hairline pl-6 lg:justify-self-end">
          <Metric label="Player side" value="90%" detail="fixed chance" />
          <Metric label="Staker side" value="10%" detail="fixed chance" />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="panel rounded-[2rem] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Current draw</p>
              <div className="mt-2 flex items-center gap-3">
                <h2 className="display-font text-4xl">#{draw?.id.toString() ?? "—"}</h2>
                <span className="flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                  {phase}
                </span>
              </div>
            </div>
            <button
              className="text-xs text-[var(--muted)] underline decoration-[var(--dim)] underline-offset-4 hover:text-[var(--ink)]"
              onClick={() => void refresh()}
              type="button"
            >
              {refreshing ? "Refreshing…" : "Refresh state"}
            </button>
          </div>

          <div className="mt-9 rounded-2xl border hairline bg-black/10 p-4 sm:p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-[var(--muted)]">Player threshold</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  {draw
                    ? `${formatSol(draw.playerTvlLamports)} / ${formatSol(draw.activationThresholdLamports)} SOL`
                    : "—"}
                </p>
              </div>
              <p className="mono text-xs text-[var(--dim)]">
                {draw ? `${progress}% filled` : "awaiting RPC"}
              </p>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-4 flex justify-between text-xs text-[var(--dim)]">
              <span>Funding starts at 1% of Staker TVL</span>
              <span>{countdownLabel(draw)}</span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <DataPoint
              label="Staker TVL snapshot"
              value={draw ? `${formatSol(draw.stakerTvlSnapshot)} SOL` : "—"}
            />
            <DataPoint
              label="Player deposits"
              value={draw ? `${formatSol(draw.playerTvlLamports)} SOL` : "—"}
            />
            <DataPoint
              label="Max Player loss"
              value={draw ? `${formatSol(draw.playerTvlLamports)} SOL` : "—"}
            />
          </div>
        </div>

        <div className="panel rounded-[2rem] p-5 sm:p-7">
          <div className="flex rounded-xl border hairline p-1">
            <ModeButton
              active={mode === "staker"}
              label="Staker"
              onClick={() => setMode("staker")}
            />
            <ModeButton
              active={mode === "player"}
              label="Player"
              onClick={() => setMode("player")}
            />
          </div>
          <p className="mt-7 text-sm text-[var(--muted)]">
            {mode === "player" ? "Enter the draw" : "Add to the vault"}
          </p>
          <div className="mt-2 flex items-center gap-2 border-b hairline pb-3">
            <input
              aria-label={`${mode} amount in SOL`}
              className="w-full bg-transparent text-4xl font-semibold tracking-tight outline-none placeholder:text-[var(--dim)]"
              inputMode="decimal"
              min="0"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.10"
              value={amount}
            />
            <span className="text-sm text-[var(--muted)]">SOL</span>
          </div>
          <button
            className="mt-5 w-full rounded-xl bg-[var(--accent)] px-4 py-3.5 text-sm font-bold text-[#142014] opacity-60"
            disabled
            type="button"
          >
            Connect wallet to continue
          </button>
          <p className="mt-4 text-xs leading-5 text-[var(--dim)]">
            {mode === "player"
              ? "Minimum Player deposit: 0.01 SOL. Pending deposits can be refunded during funding."
              : "Minimum Staker deposit: 0.1 SOL. Staker SOL stays inert and can erode through Player wins."}
          </p>
        </div>
      </section>

      <section className="grid gap-4 py-4 sm:grid-cols-2">
        <InfoPanel
          eyebrow="The split"
          title="One side wins. One wallet wins."
          copy="Every draw first selects Player or Staker, then selects exactly one wallet from that side by its stored weight."
          rows={["Player: 90%", "Staker: 10%", "Protocol fee: 5% of profit"]}
        />
        <InfoPanel
          eyebrow="Recent draws"
          title="History stays compact."
          copy="The program keeps the latest ten settled draw IDs on-chain. Detailed settlement receipts will follow wallet integration."
          rows={
            config?.recentDrawIds.length
              ? config.recentDrawIds.slice(0, 3).map((id) => `Draw #${id}`)
              : ["No settled draws yet"]
          }
        />
      </section>

      <footer className="flex flex-col gap-3 border-t hairline py-7 text-xs leading-5 text-[var(--dim)] sm:flex-row sm:items-center sm:justify-between">
        <span>Native SOL only · Fate is not a guaranteed-principal product.</span>
        <span className="mono">
          {browserProgramAddress()?.slice(0, 8) ?? "program not configured"} · {browserRpcUrl()}
        </span>
      </footer>

      {error ? (
        <div className="fixed bottom-4 left-4 right-4 mx-auto max-w-xl rounded-xl border border-[var(--warm)]/30 bg-[#261d18] px-4 py-3 text-xs text-[var(--warm)] shadow-2xl">
          Read-only preview: {error}. Configure the browser RPC and program ID to show live state.
        </div>
      ) : null}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--dim)]">{label}</p>
      <p className="display-font mt-1 text-3xl">{value}</p>
      <p className="mt-1 text-xs text-[var(--dim)]">{detail}</p>
    </div>
  );
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border hairline px-4 py-3">
      <p className="text-xs text-[var(--dim)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}

function InfoPanel({
  eyebrow,
  title,
  copy,
  rows,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  rows: string[];
}) {
  return (
    <div className="border-t hairline py-6">
      <p className="eyebrow">{eyebrow}</p>
      <h3 className="display-font mt-2 text-3xl">{title}</h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{copy}</p>
      <div className="mt-5 space-y-2 text-xs text-[var(--dim)]">
        {rows.map((row) => (
          <p className="border-b hairline pb-2" key={row}>
            {row}
          </p>
        ))}
      </div>
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
      className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-white/10 text-[var(--ink)]" : "text-[var(--dim)] hover:text-[var(--muted)]"}`}
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
  if (draw.stakerTvlSnapshot === 0n) return 0;
  const threshold = draw.activationThresholdLamports;
  if (threshold === 0n) return 0;
  return Math.min(100, Math.round(Number((draw.playerTvlLamports * 100n) / threshold)));
}

function countdownLabel(draw: DrawAccount | undefined) {
  if (!draw || draw.phase !== DrawPhase.Activated || draw.locksAt <= 0n) return "No countdown";
  const remaining = Number(draw.locksAt) - Math.floor(Date.now() / 1000);
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
