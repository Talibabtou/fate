import { keccak_256 } from "@noble/hashes/sha3.js";
import type { Address } from "@solana/kit";
import {
  BPS_DENOMINATOR,
  type ConfigAccount,
  DEV_ENTROPY_DOMAIN,
  type DrawAccount,
  DrawPhase,
  drawIdSeed,
  INITIAL_THRESHOLD_BPS,
  MINIMUM_DRAW_POOL_LAMPORTS,
  PLAYER_WINNER_DOMAIN,
  type PlayerPositionAccount,
  type ProgressAction,
  RELATIVE_ACTIVATION_FLOOR_BPS,
  type SettlementParticipants,
  SIDE_DOMAIN,
  STAKER_WINNER_DOMAIN,
  type StakerPositionAccount,
  THRESHOLD_DECAY_BPS,
  THRESHOLD_DECAY_INTERVAL_SECONDS,
  U128_MODULUS,
  WEIGHT_TREE_DEPTH,
  type WeightPageAccount,
} from "./constants.ts";

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
): ProgressAction | null {
  if (config.version !== 1n || draw.id !== config.currentDrawId) return null;
  if (draw.phase === DrawPhase.Funding) {
    if (config.paused || draw.firstPlayerAt <= 0n || draw.stakerTvlSnapshot === 0n) return null;
    const elapsed = now > draw.firstPlayerAt ? now - draw.firstPlayerAt : 0n;
    return draw.playerTvlLamports >= activationThreshold(draw.stakerTvlSnapshot, elapsed)
      ? "activate"
      : null;
  }
  if (draw.phase === DrawPhase.Activated) {
    return draw.locksAt > 0n && now >= draw.locksAt ? "settle" : null;
  }
  return draw.phase === DrawPhase.Locked ? "settle" : null;
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
  const selection = devSettlementSelection(
    drawId,
    activePlayers.reduce((sum, position) => sum + position.weight, 0n),
    activeStakers.reduce((sum, position) => sum + position.activeShares, 0n),
  );
  const player =
    selection.side === "player"
      ? selectPosition(activePlayers, selection.target, (position) => position.weight)
      : activePlayers[0];
  const staker =
    selection.side === "staker"
      ? selectPosition(activeStakers, selection.target, (position) => position.activeShares)
      : activeStakers[0];
  return {
    player: player.authority,
    playerIndex: player.leafIndex,
    staker: staker.authority,
    stakerIndex: staker.leafIndex,
  };
}

export function devSettlementSelection(
  drawId: bigint,
  totalPlayerWeight: bigint,
  totalStakerWeight: bigint,
) {
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
  const totalWeight = desiredSide === "player" ? totalPlayerWeight : totalStakerWeight;
  const domain = desiredSide === "player" ? PLAYER_WINNER_DOMAIN : STAKER_WINNER_DOMAIN;
  return {
    side: desiredSide,
    target: winnerTarget(entropy, drawId, domain, totalWeight),
  } as const;
}

export function selectWeightBranch(weights: bigint[], target: bigint) {
  let skipped = 0n;
  for (const [branch, weight] of weights.entries()) {
    const end = skipped + weight;
    if (target < end) return { branch, remainder: target - skipped };
    skipped = end;
  }
  throw new Error("selection outside weight page");
}

export function selectWeightedIndex(pages: WeightPageAccount[], tree: Address, target: bigint) {
  if (pages.length !== WEIGHT_TREE_DEPTH) throw new Error("invalid weight path length");
  if (target < 0n) throw new Error("invalid weighted selection");
  let index = 0n;
  for (const [level, page] of pages.entries()) {
    const expectedPrefix =
      level === 0
        ? 0n
        : (index >> BigInt((WEIGHT_TREE_DEPTH - level) * 4)) <<
          BigInt((WEIGHT_TREE_DEPTH - level) * 4);
    if (page.tree !== tree || page.level !== BigInt(level) || page.prefix !== expectedPrefix) {
      throw new Error("invalid weight page relationship");
    }
    const selected = selectWeightBranch(page.weights, target);
    index |= BigInt(selected.branch) << BigInt((WEIGHT_TREE_DEPTH - 1 - level) * 4);
    target = selected.remainder;
    if (level < WEIGHT_TREE_DEPTH - 1) {
      const child = pages[level + 1];
      const childTotal = child.weights.reduce((sum, weight) => sum + weight, 0n);
      if (page.weights[selected.branch] !== childTotal) {
        throw new Error("weight page parent total mismatch");
      }
    }
  }
  return index;
}

function selectedSide(entropy: Uint8Array, drawId: bigint) {
  return unbiasedRoll(entropy, drawId, SIDE_DOMAIN, 10_000n) < 9_000n ? "player" : "staker";
}

function winnerTarget(
  entropy: Uint8Array,
  drawId: bigint,
  domain: Uint8Array,
  totalWeight: bigint,
) {
  return unbiasedRoll(entropy, drawId, domain, totalWeight);
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
