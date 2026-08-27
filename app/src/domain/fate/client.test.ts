import assert from "node:assert/strict";
import test from "node:test";
import { AccountRole, address, getAddressEncoder } from "@solana/kit";
import {
  activationThreshold,
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  cleanupInstruction,
  DRAW_DISCRIMINATOR,
  DRAW_SIZE,
  DrawPhase,
  decodeConfig,
  decodeDraw,
  decodePlayerPosition,
  dueAction,
  PLAYER_POSITION_DISCRIMINATOR,
  PLAYER_POSITION_SIZE,
  selectWeightedIndex,
} from "./index.ts";

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
  setU64(configData, 160, 2n);
  setU64(configData, 168, 2n);
  setU64(configData, 176, 5n);
  setU64(configData, 184, 6n);
  assert.deepEqual(decodeConfig(configData), {
    feeTreasury: treasury,
    version: 1n,
    paused: false,
    currentDrawId: 7n,
    recentDrawIds: [6n, 5n],
  });

  const drawData = new Uint8Array(DRAW_SIZE);
  drawData[0] = DRAW_DISCRIMINATOR;
  drawData.set(getAddressEncoder().encode(treasury), 72);
  setU64(drawData, 136, 7n);
  setU64(drawData, 144, BigInt(DrawPhase.Activated));
  setI64(drawData, 160, 100n);
  setI64(drawData, 176, 500n);
  setU64(drawData, 192, 1_000_000_000n);
  setU64(drawData, 200, 10_000_000n);
  setU64(drawData, 208, 10_000_000n);
  setU64(drawData, 216, 100_000_000n);
  setU64(drawData, 224, 100_000_000n);
  setU64(drawData, 280, 50_000_000n);
  assert.deepEqual(decodeDraw(drawData), {
    rentPayer: treasury,
    id: 7n,
    phase: DrawPhase.Activated,
    firstPlayerAt: 100n,
    locksAt: 500n,
    stakerTvlSnapshot: 1_000_000_000n,
    initialThresholdLamports: 10_000_000n,
    activationThresholdLamports: 10_000_000n,
    playerTvlLamports: 100_000_000n,
    totalPlayerWeight: 100_000_000n,
    winnerDepositLamports: 0n,
    winnerPayoutLamports: 0n,
    outstandingPlayerClaimLamports: 50_000_000n,
    protocolFeeLamports: 0n,
    stakerErosionLamports: 0n,
    nextPlayerIndex: 0n,
    openPlayerPositions: 0n,
    openWeightPages: 0n,
  });

  const positionData = new Uint8Array(PLAYER_POSITION_SIZE);
  positionData[0] = PLAYER_POSITION_DISCRIMINATOR;
  positionData.set(getAddressEncoder().encode(treasury), 8);
  setU64(positionData, 72, 42n);
  setU64(positionData, 88, 7n);
  setU64(positionData, 96, 10n);
  setU64(positionData, 128, 3n);
  assert.deepEqual(decodePlayerPosition(positionData), {
    authority: treasury,
    rentPayer: treasury,
    drawId: 7n,
    weight: 42n,
    refundableLamports: 10n,
    committedLamports: 0n,
    leafIndex: 3n,
    claimableLamports: 0n,
    claimed: false,
    status: 0n,
  });
});

test("rejects account cosplay and malformed lengths", () => {
  const data = new Uint8Array(CONFIG_SIZE);
  data[0] = DRAW_DISCRIMINATOR;
  assert.throws(() => decodeConfig(data), /discriminator/);
  assert.throws(() => decodeDraw(new Uint8Array(DRAW_SIZE - 1)), /size/);
});

test("progression chooses only due permissionless transitions", () => {
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
    phase: DrawPhase.Funding,
    firstPlayerAt: 1_000n,
    locksAt: 0n,
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
  assert.equal(dueAction(config, draw, 1_000n), "activate");
  assert.equal(dueAction({ ...config, paused: true }, draw, 1_000n), null);
  assert.equal(
    dueAction(
      { ...config, paused: true },
      { ...draw, phase: DrawPhase.Activated, locksAt: 2_000n },
      2_000n,
    ),
    "settle",
  );
  assert.equal(dueAction(config, { ...draw, phase: DrawPhase.Locked }, 2_000n), "settle");
});

test("cleanup instructions are permissionless and bind the draw ID", async () => {
  const programAddress = address("1111111QLbz7JHiBTspS962RLKV8GndWFwiEaqKM");
  const rentPayer = address("11111111111111111111111111111111");
  const instruction = await cleanupInstruction("close-draw", programAddress, rentPayer, 7n);
  const data = instruction.data;
  assert.ok(data);
  assert.equal(data[0], 14);
  assert.equal(new DataView(data.buffer).getBigUint64(1, true), 7n);
  assert.equal(
    instruction.accounts?.some((account) => account.role === AccountRole.WRITABLE_SIGNER),
    false,
  );
  assert.equal(instruction.accounts?.[2].address, rentPayer);
});

test("activation threshold matches the on-chain floor and decay", () => {
  assert.equal(activationThreshold(100_000_000_000n, 0n), 1_000_000_000n);
  assert.equal(activationThreshold(100_000_000_000n, 600n), 900_000_000n);
  assert.equal(activationThreshold(1_000_000_000n, 0n), 100_000_000n);
});

test("weighted-path selection returns the authenticated leaf", () => {
  const tree = address("11111111111111111111111111111111");
  const index = 0x1234_5678n;
  const pages = Array.from({ length: 8 }, (_, level) => {
    const branch = Number((index >> BigInt((7 - level) * 4)) & 0xfn);
    const weights = Array.from({ length: 16 }, () => 0n);
    weights[branch] = 7n;
    const remainingBits = BigInt((8 - level) * 4);
    return {
      tree,
      rentPayer: tree,
      level: BigInt(level),
      prefix: level === 0 ? 0n : (index >> remainingBits) << remainingBits,
      weights,
    };
  });
  assert.equal(selectWeightedIndex(pages, tree, 6n), index);
});
