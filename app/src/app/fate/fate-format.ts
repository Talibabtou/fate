import { DrawPhase } from "../../domain/fate";
import type { FateTransactionState } from "../../lib/transactions";

const SOL = 1_000_000_000n;

export function formatSol(lamports: bigint) {
  const whole = lamports / SOL;
  const cents = ((lamports % SOL) * 100n) / SOL;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

export function countdownLabel(
  phase: DrawPhase | undefined,
  locksAt: bigint | undefined,
  now: number,
) {
  if (phase !== DrawPhase.Activated || locksAt === undefined || locksAt <= 0n) {
    return "Funding open";
  }
  const remaining = Number(locksAt) - Math.floor(now / 1000);
  return remaining > 0 ? `${formatDuration(remaining)} remaining` : "Lock due";
}

export function transactionStateLabel(state: FateTransactionState | null) {
  if (state === "simulating") return "Simulating…";
  if (state === "awaiting-signature") return "Approve in wallet…";
  if (state === "submitted") return "Confirming…";
  if (state === "confirmed") return "Confirmed";
  if (state === "failed") return "Failed";
  if (state === "stale") return "Refresh required";
  return "Working…";
}

export function compactAddress(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}
