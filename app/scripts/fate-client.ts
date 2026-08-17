import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  AccountRole,
  type Address,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Instruction,
} from "@solana/kit";

export const CONFIG_SIZE = 256;
export const DRAW_SIZE = 336;
export const PLAYER_POSITION_SIZE = 144;
export const STAKER_POSITION_SIZE = 112;
export const WEIGHT_PAGE_SIZE = 344;
export const CONFIG_DISCRIMINATOR = 100;
export const DRAW_DISCRIMINATOR = 103;
export const PLAYER_POSITION_DISCRIMINATOR = 104;
export const STAKER_POSITION_DISCRIMINATOR = 102;
export const WEIGHT_PAGE_DISCRIMINATOR = 105;
export const RECENT_DRAW_CAPACITY = 10n;

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const CONFIG_SEED = "config";
const STAKER_VAULT_SEED = "staker-vault";
const STAKER_POSITION_SEED = "staker-position";
const DRAW_SEED = "draw";
const PLAYER_POSITION_SEED = "player-position";
const WEIGHT_PAGE_SEED = "weight-page";
const WEIGHT_TREE_DEPTH = 8;

const BPS_DENOMINATOR = 10_000n;
const INITIAL_THRESHOLD_BPS = 100n;
const RELATIVE_ACTIVATION_FLOOR_BPS = 10n;
const THRESHOLD_DECAY_BPS = 9_000n;
const THRESHOLD_DECAY_INTERVAL_SECONDS = 10n * 60n;
const MINIMUM_DRAW_POOL_LAMPORTS = 100_000_000n;
const U128_MODULUS = 1n << 128n;
const DEV_ENTROPY_DOMAIN = new TextEncoder().encode("fate:dev-fixture:v1");
const SIDE_DOMAIN = new TextEncoder().encode("fate:side:v1");
const PLAYER_WINNER_DOMAIN = new TextEncoder().encode("fate:player-winner:v1");
const STAKER_WINNER_DOMAIN = new TextEncoder().encode("fate:staker-winner:v1");

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
  playerTvlLamports: bigint;
  outstandingPlayerClaimLamports: bigint;
  openPlayerPositions: bigint;
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
};

export type StakerPositionAccount = {
  authority: Address;
  activeShares: bigint;
  leafIndex: bigint;
};

export type WeightPageAccount = {
  tree: Address;
  rentPayer: Address;
  level: bigint;
  prefix: bigint;
};

export type SettlementParticipants = {
  player: Address;
  playerIndex: bigint;
  staker: Address;
  stakerIndex: bigint;
};

export type KeeperAction = "activate" | "lock" | "settle";
export type CleanupAction = "close-player-position" | "close-weight-page" | "close-draw";

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
    playerTvlLamports: u64(data, 216),
    outstandingPlayerClaimLamports: u64(data, 280),
    openPlayerPositions: u64(data, 328),
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
  };
}

export function decodeWeightPage(data: Uint8Array): WeightPageAccount {
  assertAccountData(data, WEIGHT_PAGE_SIZE, WEIGHT_PAGE_DISCRIMINATOR);
  return {
    tree: getAddressDecoder().decode(data.slice(8, 40)),
    rentPayer: getAddressDecoder().decode(data.slice(40, 72)),
    level: u64(data, 72),
    prefix: u64(data, 80),
  };
}

export function decodeStakerPosition(data: Uint8Array): StakerPositionAccount {
  assertAccountData(data, STAKER_POSITION_SIZE, STAKER_POSITION_DISCRIMINATOR);
  return {
    authority: getAddressDecoder().decode(data.slice(8, 40)),
    activeShares: u64(data, 72),
    leafIndex: u64(data, 96),
  };
}

function mulDivFloor(value: bigint, numerator: bigint, denominator: bigint) {
  if (denominator === 0n) throw new Error("division by zero");
  return (value * numerator) / denominator;
}

export function activationThreshold(stakerTvlLamports: bigint, elapsedSeconds: bigint) {
  const initial = mulDivFloor(stakerTvlLamports, INITIAL_THRESHOLD_BPS, BPS_DENOMINATOR);
  const relativeFloor = mulDivFloor(
    stakerTvlLamports,
    RELATIVE_ACTIVATION_FLOOR_BPS,
    BPS_DENOMINATOR,
  );
  const floor =
    relativeFloor > MINIMUM_DRAW_POOL_LAMPORTS ? relativeFloor : MINIMUM_DRAW_POOL_LAMPORTS;
  let threshold = initial > floor ? initial : floor;
  const steps = elapsedSeconds / THRESHOLD_DECAY_INTERVAL_SECONDS;
  for (let step = 0n; step < steps && threshold > floor; step += 1n) {
    threshold = mulDivFloor(threshold, THRESHOLD_DECAY_BPS, BPS_DENOMINATOR);
  }
  return threshold > floor ? threshold : floor;
}

export function dueAction(
  config: ConfigAccount,
  draw: DrawAccount,
  now: bigint,
): KeeperAction | null {
  if (config.version !== 1n || draw.id !== config.currentDrawId) return null;
  if (draw.phase === DrawPhase.Funding) {
    if (config.paused || draw.firstPlayerAt <= 0n || draw.stakerTvlSnapshot === 0n) return null;
    const elapsed = now > draw.firstPlayerAt ? now - draw.firstPlayerAt : 0n;
    return draw.playerTvlLamports >= activationThreshold(draw.stakerTvlSnapshot, elapsed)
      ? "activate"
      : null;
  }
  if (draw.phase === DrawPhase.Activated) {
    return draw.locksAt > 0n && now >= draw.locksAt ? "lock" : null;
  }
  return draw.phase === DrawPhase.Locked ? "settle" : null;
}

function drawIdSeed(drawId: bigint) {
  if (drawId < 0n || drawId > 0xffff_ffff_ffff_ffffn) throw new Error("draw ID out of range");
  const seed = new Uint8Array(8);
  new DataView(seed.buffer).setBigUint64(0, drawId, true);
  return seed;
}

export function devSettlementParticipants(
  drawId: bigint,
  players: PlayerPositionAccount[],
  stakers: StakerPositionAccount[],
): SettlementParticipants {
  const activePlayers = players
    .filter((position) => position.drawId === drawId && position.weight > 0n)
    .sort((left, right) => (left.leafIndex < right.leafIndex ? -1 : 1));
  const activeStakers = stakers
    .filter((position) => position.activeShares > 0n)
    .sort((left, right) => (left.leafIndex < right.leafIndex ? -1 : 1));
  if (activePlayers.length === 0 || activeStakers.length === 0) {
    throw new Error("settlement requires active Player and Staker positions");
  }
  const desiredSide = drawId % 2n === 0n ? "player" : "staker";
  let entropy: Uint8Array | undefined;
  for (let nonce = 0n; nonce < 256n; nonce += 1n) {
    const candidate = keccak_256(concat(DEV_ENTROPY_DOMAIN, drawIdSeed(drawId), drawIdSeed(nonce)));
    if (selectedSide(candidate, drawId) === desiredSide) {
      entropy = candidate;
      break;
    }
  }
  if (!entropy) throw new Error("dev entropy search exhausted");
  const player =
    desiredSide === "player"
      ? selectPosition(
          activePlayers,
          winnerTarget(
            entropy,
            drawId,
            PLAYER_WINNER_DOMAIN,
            activePlayers.map((position) => position.weight),
          ),
          (position) => position.weight,
        )
      : activePlayers[0];
  const staker =
    desiredSide === "staker"
      ? selectPosition(
          activeStakers,
          winnerTarget(
            entropy,
            drawId,
            STAKER_WINNER_DOMAIN,
            activeStakers.map((position) => position.activeShares),
          ),
          (position) => position.activeShares,
        )
      : activeStakers[0];
  return {
    player: player.authority,
    playerIndex: player.leafIndex,
    staker: staker.authority,
    stakerIndex: staker.leafIndex,
  };
}

function selectedSide(entropy: Uint8Array, drawId: bigint) {
  return unbiasedRoll(entropy, drawId, SIDE_DOMAIN, 10_000n) < 9_000n ? "player" : "staker";
}

function winnerTarget(entropy: Uint8Array, drawId: bigint, domain: Uint8Array, weights: bigint[]) {
  return unbiasedRoll(
    entropy,
    drawId,
    domain,
    weights.reduce((sum, weight) => sum + weight, 0n),
  );
}

function unbiasedRoll(entropy: Uint8Array, drawId: bigint, domain: Uint8Array, bound: bigint) {
  if (bound === 0n) throw new Error("zero selection weight");
  const threshold = U128_MODULUS % bound;
  for (let attempt = 0n; attempt < 16n; attempt += 1n) {
    const digest = keccak_256(concat(domain, drawIdSeed(drawId), entropy, drawIdSeed(attempt)));
    const candidate =
      new DataView(digest.buffer, digest.byteOffset, 16).getBigUint64(0, true) |
      (new DataView(digest.buffer, digest.byteOffset, 16).getBigUint64(8, true) << 64n);
    if (candidate >= threshold) return candidate % bound;
  }
  throw new Error("selection retries exhausted");
}

function selectPosition<T>(positions: T[], target: bigint, weight: (position: T) => bigint) {
  let cumulative = 0n;
  for (const position of positions) {
    cumulative += weight(position);
    if (target < cumulative) return position;
  }
  throw new Error("selection outside positions");
}

function concat(...arrays: Uint8Array[]) {
  const output = new Uint8Array(arrays.reduce((length, array) => length + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

export async function fateAddresses(programAddress: Address, drawId: bigint) {
  const nextDrawId = drawId + 1n;
  const [[config], [draw], [vault], [nextDraw]] = await Promise.all([
    getProgramDerivedAddress({ programAddress, seeds: [CONFIG_SEED] }),
    getProgramDerivedAddress({ programAddress, seeds: [DRAW_SEED, drawIdSeed(drawId)] }),
    getProgramDerivedAddress({ programAddress, seeds: [STAKER_VAULT_SEED] }),
    getProgramDerivedAddress({ programAddress, seeds: [DRAW_SEED, drawIdSeed(nextDrawId)] }),
  ]);
  return { config, draw, vault, nextDraw };
}

export async function participantAddresses(
  programAddress: Address,
  drawId: bigint,
  player: Address,
  playerIndex: bigint,
  staker: Address,
  stakerIndex: bigint,
) {
  const { draw, vault } = await fateAddresses(programAddress, drawId);
  const [[playerPosition], [stakerPosition], playerPath, stakerPath] = await Promise.all([
    getProgramDerivedAddress({
      programAddress,
      seeds: [PLAYER_POSITION_SEED, drawIdSeed(drawId), getAddressEncoder().encode(player)],
    }),
    getProgramDerivedAddress({
      programAddress,
      seeds: [STAKER_POSITION_SEED, getAddressEncoder().encode(staker)],
    }),
    weightPath(programAddress, draw, playerIndex),
    weightPath(programAddress, vault, stakerIndex),
  ]);
  return { playerPosition, stakerPosition, playerPath, stakerPath };
}

async function weightPath(programAddress: Address, tree: Address, index: bigint) {
  return Promise.all(
    Array.from({ length: WEIGHT_TREE_DEPTH }, async (_, level) => {
      const remainingBits = BigInt((WEIGHT_TREE_DEPTH - level) * 4);
      const prefix = level === 0 ? 0n : (index >> remainingBits) << remainingBits;
      const [page] = await getProgramDerivedAddress({
        programAddress,
        seeds: [
          WEIGHT_PAGE_SEED,
          getAddressEncoder().encode(tree),
          drawIdSeed(BigInt(level)),
          drawIdSeed(prefix),
        ],
      });
      return page;
    }),
  );
}

export async function keeperInstruction(
  action: KeeperAction,
  programAddress: Address,
  payerAddress: Address,
  config: ConfigAccount,
  participants?: {
    player: Address;
    playerIndex: bigint;
    staker: Address;
    stakerIndex: bigint;
  },
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, config.currentDrawId);
  if (action === "activate") {
    return {
      programAddress,
      accounts: [
        { address: accounts.config, role: AccountRole.READONLY },
        { address: accounts.draw, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([5]),
    };
  }
  if (action === "lock") {
    return {
      programAddress,
      accounts: [
        { address: accounts.config, role: AccountRole.READONLY },
        { address: accounts.draw, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([11]),
    };
  }
  if (!participants) throw new Error("settlement participants are required");
  const participantAccounts = await participantAddresses(
    programAddress,
    config.currentDrawId,
    participants.player,
    participants.playerIndex,
    participants.staker,
    participants.stakerIndex,
  );
  return {
    programAddress,
    accounts: [
      { address: payerAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.WRITABLE },
      { address: accounts.draw, role: AccountRole.WRITABLE },
      { address: participantAccounts.playerPosition, role: AccountRole.WRITABLE },
      { address: accounts.vault, role: AccountRole.WRITABLE },
      { address: participantAccounts.stakerPosition, role: AccountRole.WRITABLE },
      { address: config.feeTreasury, role: AccountRole.WRITABLE },
      { address: accounts.nextDraw, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ...participantAccounts.playerPath.map((address) => ({ address, role: AccountRole.WRITABLE })),
      ...participantAccounts.stakerPath.map((address) => ({ address, role: AccountRole.WRITABLE })),
    ],
    data: new Uint8Array([12]),
  };
}

export async function cleanupInstruction(
  action: CleanupAction,
  programAddress: Address,
  rentPayer: Address,
  drawId: bigint,
  target?: Address,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, drawId);
  const data = new Uint8Array(9);
  data[0] = action === "close-draw" ? 14 : action === "close-player-position" ? 15 : 16;
  new DataView(data.buffer).setBigUint64(1, drawId, true);
  if (action !== "close-draw" && !target) throw new Error(`${action} requires a target account`);
  return {
    programAddress,
    accounts:
      action === "close-draw"
        ? [
            { address: accounts.config, role: AccountRole.READONLY },
            { address: accounts.draw, role: AccountRole.WRITABLE },
            { address: rentPayer, role: AccountRole.WRITABLE },
          ]
        : [
            { address: accounts.draw, role: AccountRole.WRITABLE },
            { address: target as Address, role: AccountRole.WRITABLE },
            { address: rentPayer, role: AccountRole.WRITABLE },
          ],
    data,
  };
}
