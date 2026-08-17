import assert from "node:assert/strict";
import test from "node:test";
import { address, getAddressEncoder } from "@solana/kit";
import {
  activationThreshold,
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  DRAW_DISCRIMINATOR,
  DRAW_SIZE,
  DrawPhase,
  decodeConfig,
  decodeDraw,
  dueAction,
} from "./fate-client.ts";

function setU64(data: Uint8Array, offset: number, value: bigint) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}

function setI64(data: Uint8Array, offset: number, value: bigint) {
  new DataView(data.buffer).setBigInt64(offset, value, true);
}

test("decodes validated Steel config and draw layouts", () => {
  const treasury = address("11111111111111111111111111111111");
  const configData = new Uint8Array(CONFIG_SIZE);
  configData[0] = CONFIG_DISCRIMINATOR;
  configData.set(getAddressEncoder().encode(treasury), 40);
  setU64(configData, 136, 1n);
  setU64(configData, 152, 7n);
  assert.deepEqual(decodeConfig(configData), {
    feeTreasury: treasury,
    version: 1n,
    paused: false,
    currentDrawId: 7n,
  });

  const drawData = new Uint8Array(DRAW_SIZE);
  drawData[0] = DRAW_DISCRIMINATOR;
  setU64(drawData, 136, 7n);
  setU64(drawData, 144, BigInt(DrawPhase.Activated));
  setI64(drawData, 160, 100n);
  setI64(drawData, 176, 500n);
  setU64(drawData, 192, 1_000_000_000n);
  setU64(drawData, 216, 100_000_000n);
  assert.deepEqual(decodeDraw(drawData), {
    id: 7n,
    phase: DrawPhase.Activated,
    firstPlayerAt: 100n,
    locksAt: 500n,
    stakerTvlSnapshot: 1_000_000_000n,
    playerTvlLamports: 100_000_000n,
  });
});

test("rejects account cosplay and malformed lengths", () => {
  const data = new Uint8Array(CONFIG_SIZE);
  data[0] = DRAW_DISCRIMINATOR;
  assert.throws(() => decodeConfig(data), /discriminator/);
  assert.throws(() => decodeDraw(new Uint8Array(DRAW_SIZE - 1)), /size/);
});

test("keeper chooses only due permissionless transitions", () => {
  const config = {
    feeTreasury: address("11111111111111111111111111111111"),
    version: 1n,
    paused: false,
    currentDrawId: 7n,
  };
  const draw = {
    id: 7n,
    phase: DrawPhase.Funding,
    firstPlayerAt: 1_000n,
    locksAt: 0n,
    stakerTvlSnapshot: 100_000_000_000n,
    playerTvlLamports: 1_000_000_000n,
  };
  assert.equal(dueAction(config, draw, 1_000n), "activate");
  assert.equal(dueAction({ ...config, paused: true }, draw, 1_000n), null);
  assert.equal(
    dueAction(
      { ...config, paused: true },
      { ...draw, phase: DrawPhase.Activated, locksAt: 2_000n },
      2_000n,
    ),
    "lock",
  );
  assert.equal(dueAction(config, { ...draw, phase: DrawPhase.Locked }, 2_000n), "settle");
});

test("activation threshold matches the on-chain floor and decay", () => {
  assert.equal(activationThreshold(100_000_000_000n, 0n), 1_000_000_000n);
  assert.equal(activationThreshold(100_000_000_000n, 600n), 900_000_000n);
  assert.equal(activationThreshold(1_000_000_000n, 0n), 100_000_000n);
});
