import { DrawPhase } from "../domain/fate/index.ts";
import type { FateSnapshot } from "../features/fate/data/snapshot.ts";
import type { LifecycleAction } from "./use-lifecycle-progress.ts";

const SOL = 1_000_000_000n;

export function isLifecycleAlreadyAdvanced(
  review: { kind: string; action?: LifecycleAction; drawId?: bigint },
  snapshot: FateSnapshot,
) {
  if (review.kind !== "progress" || review.action === undefined || review.drawId === undefined) {
    return false;
  }
  if (snapshot.draw.id !== review.drawId) return true;
  return review.action === "activate"
    ? snapshot.draw.phase !== DrawPhase.Funding
    : snapshot.draw.phase !== DrawPhase.Activated && snapshot.draw.phase !== DrawPhase.Locked;
}

export function parseSolAmount(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
    throw new Error("Enter a SOL amount with up to 9 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const lamports = BigInt(whole) * SOL + BigInt(fraction.padEnd(9, "0"));
  if (lamports <= 0n) throw new Error("Enter an amount greater than zero.");
  return lamports;
}

export function parseShares(value: string, maximum: bigint) {
  const normalized = value.trim();
  if (!normalized) return maximum;
  if (!/^\d+$/.test(normalized)) throw new Error("Enter a whole number of shares.");
  const shares = BigInt(normalized);
  if (shares <= 0n) throw new Error("Enter at least one share.");
  if (shares > maximum) throw new Error(`You can withdraw at most ${maximum} shares.`);
  return shares;
}
