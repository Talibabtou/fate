import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import { DrawPhase } from "../domain/fate/index.ts";
import { getLifecycleAction } from "./use-lifecycle-progress.ts";

const config = {
  feeTreasury: address("11111111111111111111111111111111"),
  version: 1n,
  paused: false,
  currentDrawId: 7n,
  recentDrawIds: [],
};

const draw = {
  rentPayer: address("11111111111111111111111111111111"),
  id: 7n,
  phase: DrawPhase.Activated,
  firstPlayerAt: 1_000n,
  locksAt: 2_000n,
  stakerTvlSnapshot: 100_000_000_000n,
  initialThresholdLamports: 1_000_000_000n,
  activationThresholdLamports: 1_000_000_000n,
  playerTvlLamports: 1_000_000_000n,
  totalPlayerWeight: 1_000_000_000n,
  winnerDepositLamports: 0n,
  winnerPayoutLamports: 0n,
  outstandingPlayerClaimLamports: 0n,
  protocolFeeLamports: 0n,
  stakerErosionLamports: 0n,
  nextPlayerIndex: 0n,
  openPlayerPositions: 0n,
  openWeightPages: 0n,
};

test("exposes due settlement only on supported deterministic networks", () => {
  assert.equal(getLifecycleAction(config, draw, "devnet", 2_000n), "settle");
  assert.equal(getLifecycleAction(config, draw, "mainnet-beta", 2_000n), null);
});

test("does not expose a transition before its chain condition is due", () => {
  assert.equal(getLifecycleAction(config, draw, "devnet", 1_999n), null);
});
