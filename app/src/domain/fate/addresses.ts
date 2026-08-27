import { type Address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import {
  CONFIG_SEED,
  DRAW_SEED,
  drawIdSeed,
  PLAYER_POSITION_SEED,
  STAKER_POSITION_SEED,
  STAKER_VAULT_SEED,
  WEIGHT_PAGE_SEED,
  WEIGHT_TREE_DEPTH,
} from "./constants.ts";

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

export async function stakerPositionAddress(programAddress: Address, staker: Address) {
  const [position] = await getProgramDerivedAddress({
    programAddress,
    seeds: [STAKER_POSITION_SEED, getAddressEncoder().encode(staker)],
  });
  return position;
}

export async function playerPositionAddress(
  programAddress: Address,
  drawId: bigint,
  player: Address,
) {
  const [position] = await getProgramDerivedAddress({
    programAddress,
    seeds: [PLAYER_POSITION_SEED, drawIdSeed(drawId), getAddressEncoder().encode(player)],
  });
  return position;
}

export async function weightPageAddress(
  programAddress: Address,
  tree: Address,
  level: number,
  prefix: bigint,
) {
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

export async function weightPath(programAddress: Address, tree: Address, index: bigint) {
  return Promise.all(
    Array.from({ length: WEIGHT_TREE_DEPTH }, async (_, level) => {
      const remainingBits = BigInt((WEIGHT_TREE_DEPTH - level) * 4);
      const prefix = level === 0 ? 0n : (index >> remainingBits) << remainingBits;
      return weightPageAddress(programAddress, tree, level, prefix);
    }),
  );
}
