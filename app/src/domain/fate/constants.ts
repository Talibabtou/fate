import { type Address, address } from "@solana/kit";

export const CONFIG_SIZE = 256;
export const DRAW_SIZE = 344;
export const PLAYER_POSITION_SIZE = 144;
export const STAKER_VAULT_SIZE = 56;
export const STAKER_POSITION_SIZE = 112;
export const WEIGHT_PAGE_SIZE = 344;
export const CONFIG_DISCRIMINATOR = 100;
export const DRAW_DISCRIMINATOR = 103;
export const PLAYER_POSITION_DISCRIMINATOR = 104;
export const STAKER_VAULT_DISCRIMINATOR = 101;
export const STAKER_POSITION_DISCRIMINATOR = 102;
export const WEIGHT_PAGE_DISCRIMINATOR = 105;
export const RECENT_DRAW_CAPACITY = 10n;

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
export const CONFIG_SEED = "config";
export const STAKER_VAULT_SEED = "staker-vault";
export const STAKER_POSITION_SEED = "staker-position";
export const DRAW_SEED = "draw";
export const PLAYER_POSITION_SEED = "player-position";
export const WEIGHT_PAGE_SEED = "weight-page";
export const WEIGHT_TREE_DEPTH = 8;

export const BPS_DENOMINATOR = 10_000n;
export const INITIAL_THRESHOLD_BPS = 100n;
export const RELATIVE_ACTIVATION_FLOOR_BPS = 10n;
export const THRESHOLD_DECAY_BPS = 9_000n;
export const THRESHOLD_DECAY_INTERVAL_SECONDS = 10n * 60n;
export const MINIMUM_DRAW_POOL_LAMPORTS = 100_000_000n;
export const U128_MODULUS = 1n << 128n;
export const DEV_ENTROPY_DOMAIN = new TextEncoder().encode("fate:dev-fixture:v1");
export const SIDE_DOMAIN = new TextEncoder().encode("fate:side:v1");
export const PLAYER_WINNER_DOMAIN = new TextEncoder().encode("fate:player-winner:v1");
export const STAKER_WINNER_DOMAIN = new TextEncoder().encode("fate:staker-winner:v1");

export const DrawPhase = {
  Funding: 0,
  Activated: 1,
  Locked: 2,
  AwaitingRandomness: 3,
  Settled: 4,
  Voided: 5,
} as const;

export type DrawPhase = (typeof DrawPhase)[keyof typeof DrawPhase];

export type ConfigAccount = {
  feeTreasury: Address;
  version: bigint;
  paused: boolean;
  currentDrawId: bigint;
  recentDrawIds: bigint[];
};

export type DrawAccount = {
  rentPayer: Address;
  id: bigint;
  phase: DrawPhase;
  firstPlayerAt: bigint;
  locksAt: bigint;
  stakerTvlSnapshot: bigint;
  initialThresholdLamports: bigint;
  activationThresholdLamports: bigint;
  playerTvlLamports: bigint;
  totalPlayerWeight: bigint;
  winnerDepositLamports: bigint;
  winnerPayoutLamports: bigint;
  outstandingPlayerClaimLamports: bigint;
  protocolFeeLamports: bigint;
  stakerErosionLamports: bigint;
  nextPlayerIndex: bigint;
  openPlayerPositions: bigint;
  openWeightPages: bigint;
};

export type StakerVaultAccount = {
  activeAssetsLamports: bigint;
  withdrawalLiabilityLamports: bigint;
  totalShares: bigint;
  nextPositionIndex: bigint;
};

export type PlayerPositionAccount = {
  authority: Address;
  rentPayer: Address;
  drawId: bigint;
  weight: bigint;
  refundableLamports: bigint;
  committedLamports: bigint;
  leafIndex: bigint;
  claimableLamports: bigint;
  claimed: boolean;
  status: bigint;
};

export type StakerPositionAccount = {
  authority: Address;
  activeShares: bigint;
  claimableWithdrawalLamports: bigint;
  leafIndex: bigint;
  status: bigint;
};

export type WeightPageAccount = {
  tree: Address;
  rentPayer: Address;
  level: bigint;
  prefix: bigint;
  weights: bigint[];
};

export type SettlementParticipants = {
  player: Address;
  playerIndex: bigint;
  staker: Address;
  stakerIndex: bigint;
};

export type ProgressAction = "activate" | "lock" | "settle";
export type CleanupAction = "close-player-position" | "close-weight-page" | "close-draw";

export function drawIdSeed(drawId: bigint) {
  if (drawId < 0n || drawId > 0xffff_ffff_ffff_ffffn) throw new Error("draw ID out of range");
  const seed = new Uint8Array(8);
  new DataView(seed.buffer).setBigUint64(0, drawId, true);
  return seed;
}
