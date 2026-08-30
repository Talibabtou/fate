import assert from "node:assert/strict";
import test from "node:test";
import { DrawPhase } from "../domain/fate/index.ts";
import type { FateSnapshot } from "../features/fate/data/snapshot.ts";
import { isLifecycleAlreadyAdvanced, parseShares, parseSolAmount } from "./fate-action-rules.ts";

function snapshot(id: bigint, phase: DrawPhase) {
  return { draw: { id, phase } } as FateSnapshot;
}

test("recognizes a lifecycle transition already completed by another caller", () => {
  const activation = {
    kind: "progress" as const,
    action: "activate" as const,
    drawId: 7n,
    amountLabel: "No pool funds transferred",
  };
  const settlement = {
    kind: "progress" as const,
    action: "settle" as const,
    drawId: 7n,
    amountLabel: "No pool funds transferred",
  };

  assert.equal(isLifecycleAlreadyAdvanced(activation, snapshot(7n, DrawPhase.Activated)), true);
  assert.equal(isLifecycleAlreadyAdvanced(settlement, snapshot(8n, DrawPhase.Funding)), true);
  assert.equal(isLifecycleAlreadyAdvanced(settlement, snapshot(7n, DrawPhase.Activated)), false);
});

test("parses user amounts into exact lamports and shares", () => {
  assert.equal(parseSolAmount("0.01"), 10_000_000n);
  assert.equal(parseSolAmount(" 1.23456789 "), 1_234_567_890n);
  assert.equal(parseShares("", 12n), 12n);
  assert.equal(parseShares("5", 12n), 5n);
  assert.throws(() => parseSolAmount("0.0000000001"), /up to 9 decimal places/);
  assert.throws(() => parseShares("13", 12n), /at most 12 shares/);
});
