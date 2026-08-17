import {
  AccountRole,
  type Address,
  address,
  getAddressDecoder,
  getProgramDerivedAddress,
  type Instruction,
} from "@solana/kit";

export const CONFIG_SIZE = 256;
export const DRAW_SIZE = 320;
export const CONFIG_DISCRIMINATOR = 100;
export const DRAW_DISCRIMINATOR = 103;

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const CONFIG_SEED = "config";
const STAKER_VAULT_SEED = "staker-vault";
const STAKER_REGISTRY_SEED = "staker-registry";
const DRAW_SEED = "draw";
const PLAYER_REGISTRY_SEED = "player-registry";

const BPS_DENOMINATOR = 10_000n;
const INITIAL_THRESHOLD_BPS = 100n;
const RELATIVE_ACTIVATION_FLOOR_BPS = 10n;
const THRESHOLD_DECAY_BPS = 9_000n;
const THRESHOLD_DECAY_INTERVAL_SECONDS = 10n * 60n;
const MINIMUM_DRAW_POOL_LAMPORTS = 100_000_000n;

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
};

export type DrawAccount = {
  id: bigint;
  phase: DrawPhase;
  firstPlayerAt: bigint;
  locksAt: bigint;
  stakerTvlSnapshot: bigint;
  playerTvlLamports: bigint;
};

export type KeeperAction = "activate" | "lock" | "settle";

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
  return {
    feeTreasury: getAddressDecoder().decode(data.slice(40, 72)),
    version: u64(data, 136),
    paused: u64(data, 144) !== 0n,
    currentDrawId: u64(data, 152),
  };
}

export function decodeDraw(data: Uint8Array): DrawAccount {
  assertAccountData(data, DRAW_SIZE, DRAW_DISCRIMINATOR);
  const phase = Number(u64(data, 144));
  if (!Number.isSafeInteger(phase) || phase < DrawPhase.Funding || phase > DrawPhase.Voided) {
    throw new Error(`invalid draw phase: ${phase}`);
  }
  return {
    id: u64(data, 136),
    phase: phase as DrawPhase,
    firstPlayerAt: i64(data, 160),
    locksAt: i64(data, 176),
    stakerTvlSnapshot: u64(data, 192),
    playerTvlLamports: u64(data, 216),
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

export async function fateAddresses(programAddress: Address, drawId: bigint) {
  const nextDrawId = drawId + 1n;
  const [[config], [draw], [players], [vault], [stakers], [nextDraw], [nextPlayers]] =
    await Promise.all([
      getProgramDerivedAddress({ programAddress, seeds: [CONFIG_SEED] }),
      getProgramDerivedAddress({ programAddress, seeds: [DRAW_SEED, drawIdSeed(drawId)] }),
      getProgramDerivedAddress({
        programAddress,
        seeds: [PLAYER_REGISTRY_SEED, drawIdSeed(drawId)],
      }),
      getProgramDerivedAddress({ programAddress, seeds: [STAKER_VAULT_SEED] }),
      getProgramDerivedAddress({ programAddress, seeds: [STAKER_REGISTRY_SEED] }),
      getProgramDerivedAddress({ programAddress, seeds: [DRAW_SEED, drawIdSeed(nextDrawId)] }),
      getProgramDerivedAddress({
        programAddress,
        seeds: [PLAYER_REGISTRY_SEED, drawIdSeed(nextDrawId)],
      }),
    ]);
  return { config, draw, players, vault, stakers, nextDraw, nextPlayers };
}

export async function keeperInstruction(
  action: KeeperAction,
  programAddress: Address,
  payerAddress: Address,
  config: ConfigAccount,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, config.currentDrawId);
  if (action === "activate") {
    return {
      programAddress,
      accounts: [
        { address: accounts.config, role: AccountRole.READONLY },
        { address: accounts.draw, role: AccountRole.WRITABLE },
        { address: accounts.players, role: AccountRole.WRITABLE },
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
  return {
    programAddress,
    accounts: [
      { address: payerAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.WRITABLE },
      { address: accounts.draw, role: AccountRole.WRITABLE },
      { address: accounts.players, role: AccountRole.WRITABLE },
      { address: accounts.vault, role: AccountRole.WRITABLE },
      { address: accounts.stakers, role: AccountRole.WRITABLE },
      { address: config.feeTreasury, role: AccountRole.WRITABLE },
      { address: accounts.nextDraw, role: AccountRole.WRITABLE },
      { address: accounts.nextPlayers, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([12]),
  };
}
