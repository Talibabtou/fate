import { getAddressDecoder } from "@solana/kit";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  type ConfigAccount,
  DRAW_DISCRIMINATOR,
  DRAW_SIZE,
  type DrawAccount,
  DrawPhase,
  PLAYER_POSITION_DISCRIMINATOR,
  PLAYER_POSITION_SIZE,
  type PlayerPositionAccount,
  RECENT_DRAW_CAPACITY,
  STAKER_POSITION_DISCRIMINATOR,
  STAKER_POSITION_SIZE,
  STAKER_VAULT_DISCRIMINATOR,
  STAKER_VAULT_SIZE,
  type StakerPositionAccount,
  type StakerVaultAccount,
  WEIGHT_PAGE_DISCRIMINATOR,
  WEIGHT_PAGE_SIZE,
  type WeightPageAccount,
} from "./constants.ts";

function assertAccountData(data: Uint8Array, size: number, discriminator: number) {
  if (data.length !== size) {
    throw new Error(`invalid account size: expected ${size}, received ${data.length}`);
  }
  if (data[0] !== discriminator) {
    throw new Error(
      `invalid account discriminator: expected ${discriminator}, received ${data[0]}`,
    );
  }
}

function u64(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function i64(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}

function u128(data: Uint8Array, offset: number) {
  return u64(data, offset) | (u64(data, offset + 8) << 64n);
}

export function decodeConfig(data: Uint8Array): ConfigAccount {
  assertAccountData(data, CONFIG_SIZE, CONFIG_DISCRIMINATOR);
  const recentDrawCount = Number(u64(data, 160));
  const recentDrawCursor = Number(u64(data, 168));
  if (
    !Number.isSafeInteger(recentDrawCount) ||
    recentDrawCount < 0 ||
    recentDrawCount > Number(RECENT_DRAW_CAPACITY) ||
    !Number.isSafeInteger(recentDrawCursor) ||
    recentDrawCursor < 0 ||
    recentDrawCursor >= Number(RECENT_DRAW_CAPACITY)
  ) {
    throw new Error("invalid recent draw ring");
  }
  const recentDrawIds = Array.from({ length: recentDrawCount }, (_, outputIndex) => {
    const sourceIndex =
      (recentDrawCursor + Number(RECENT_DRAW_CAPACITY) - 1 - outputIndex) %
      Number(RECENT_DRAW_CAPACITY);
    return u64(data, 176 + sourceIndex * 8);
  });
  return {
    feeTreasury: getAddressDecoder().decode(data.slice(40, 72)),
    version: u64(data, 136),
    paused: u64(data, 144) !== 0n,
    currentDrawId: u64(data, 152),
    recentDrawIds,
  };
}

export function decodeDraw(data: Uint8Array): DrawAccount {
  assertAccountData(data, DRAW_SIZE, DRAW_DISCRIMINATOR);
  const phase = Number(u64(data, 144));
  if (!Number.isSafeInteger(phase) || phase < DrawPhase.Funding || phase > DrawPhase.Voided) {
    throw new Error(`invalid draw phase: ${phase}`);
  }
  return {
    rentPayer: getAddressDecoder().decode(data.slice(72, 104)),
    id: u64(data, 136),
    phase: phase as DrawPhase,
    firstPlayerAt: i64(data, 160),
    locksAt: i64(data, 176),
    stakerTvlSnapshot: u64(data, 192),
    initialThresholdLamports: u64(data, 200),
    activationThresholdLamports: u64(data, 208),
    playerTvlLamports: u64(data, 216),
    totalPlayerWeight: u128(data, 224),
    winnerDepositLamports: u64(data, 264),
    winnerPayoutLamports: u64(data, 272),
    outstandingPlayerClaimLamports: u64(data, 280),
    protocolFeeLamports: u64(data, 288),
    stakerErosionLamports: u64(data, 296),
    nextPlayerIndex: u64(data, 320),
    openPlayerPositions: u64(data, 328),
    openWeightPages: u64(data, 336),
  };
}

export function decodeStakerVault(data: Uint8Array): StakerVaultAccount {
  assertAccountData(data, STAKER_VAULT_SIZE, STAKER_VAULT_DISCRIMINATOR);
  return {
    activeAssetsLamports: u64(data, 8),
    withdrawalLiabilityLamports: u64(data, 16),
    totalShares: u64(data, 24),
    nextPositionIndex: u64(data, 48),
  };
}

export function decodePlayerPosition(data: Uint8Array): PlayerPositionAccount {
  assertAccountData(data, PLAYER_POSITION_SIZE, PLAYER_POSITION_DISCRIMINATOR);
  return {
    authority: getAddressDecoder().decode(data.slice(8, 40)),
    rentPayer: getAddressDecoder().decode(data.slice(40, 72)),
    weight: u64(data, 72) | (u64(data, 80) << 64n),
    drawId: u64(data, 88),
    refundableLamports: u64(data, 96),
    committedLamports: u64(data, 104),
    leafIndex: u64(data, 128),
    claimableLamports: u64(data, 112),
    claimed: u64(data, 120) !== 0n,
    status: u64(data, 136),
  };
}

export function decodeWeightPage(data: Uint8Array): WeightPageAccount {
  assertAccountData(data, WEIGHT_PAGE_SIZE, WEIGHT_PAGE_DISCRIMINATOR);
  return {
    tree: getAddressDecoder().decode(data.slice(8, 40)),
    rentPayer: getAddressDecoder().decode(data.slice(40, 72)),
    level: u64(data, 72),
    prefix: u64(data, 80),
    weights: Array.from({ length: 16 }, (_, branch) => u128(data, 88 + branch * 16)),
  };
}

export function decodeStakerPosition(data: Uint8Array): StakerPositionAccount {
  assertAccountData(data, STAKER_POSITION_SIZE, STAKER_POSITION_DISCRIMINATOR);
  return {
    authority: getAddressDecoder().decode(data.slice(8, 40)),
    activeShares: u64(data, 72),
    claimableWithdrawalLamports: u64(data, 80),
    leafIndex: u64(data, 96),
    status: u64(data, 104),
  };
}
