import { AccountRole, type Address, type Instruction } from "@solana/kit";
import {
  fateAddresses,
  participantAddresses,
  playerPositionAddress,
  stakerPositionAddress,
  weightPath,
} from "./addresses.ts";
import {
  type CleanupAction,
  type ConfigAccount,
  type ProgressAction,
  SYSTEM_PROGRAM,
} from "./constants.ts";

function u64InstructionData(tag: number, value: bigint) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn)
    throw new Error("instruction value out of range");
  const data = new Uint8Array(9);
  data[0] = tag;
  new DataView(data.buffer).setBigUint64(1, value, true);
  return data;
}

export async function depositStakeInstruction(
  programAddress: Address,
  staker: Address,
  drawId: bigint,
  leafIndex: bigint,
  amountLamports: bigint,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, drawId);
  const position = await stakerPositionAddress(programAddress, staker);
  const path = await weightPath(programAddress, accounts.vault, leafIndex);
  return {
    programAddress,
    accounts: [
      { address: staker, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.draw, role: AccountRole.READONLY },
      { address: accounts.vault, role: AccountRole.WRITABLE },
      { address: position, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ...path.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    data: u64InstructionData(1, amountLamports),
  };
}

export async function requestStakeWithdrawalInstruction(
  programAddress: Address,
  staker: Address,
  drawId: bigint,
  leafIndex: bigint,
  shares: bigint,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, drawId);
  const position = await stakerPositionAddress(programAddress, staker);
  const path = await weightPath(programAddress, accounts.vault, leafIndex);
  return {
    programAddress,
    accounts: [
      { address: staker, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.draw, role: AccountRole.WRITABLE },
      { address: accounts.vault, role: AccountRole.WRITABLE },
      { address: position, role: AccountRole.WRITABLE },
      ...path.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    data: u64InstructionData(2, shares),
  };
}

export async function depositPlayerInstruction(
  programAddress: Address,
  player: Address,
  drawId: bigint,
  leafIndex: bigint,
  amountLamports: bigint,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, drawId);
  const position = await playerPositionAddress(programAddress, drawId, player);
  const path = await weightPath(programAddress, accounts.draw, leafIndex);
  return {
    programAddress,
    accounts: [
      { address: player, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.draw, role: AccountRole.WRITABLE },
      { address: position, role: AccountRole.WRITABLE },
      { address: accounts.vault, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ...path.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    data: u64InstructionData(3, amountLamports),
  };
}

export async function refundPlayerInstruction(
  programAddress: Address,
  player: Address,
  drawId: bigint,
  leafIndex: bigint,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, drawId);
  const position = await playerPositionAddress(programAddress, drawId, player);
  const path = await weightPath(programAddress, accounts.draw, leafIndex);
  return {
    programAddress,
    accounts: [
      { address: player, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.draw, role: AccountRole.WRITABLE },
      { address: position, role: AccountRole.WRITABLE },
      ...path.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    data: new Uint8Array([4]),
  };
}

export async function claimPlayerInstruction(
  programAddress: Address,
  player: Address,
  drawId: bigint,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, drawId);
  const position = await playerPositionAddress(programAddress, drawId, player);
  return {
    programAddress,
    accounts: [
      { address: player, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.draw, role: AccountRole.WRITABLE },
      { address: position, role: AccountRole.WRITABLE },
    ],
    data: u64InstructionData(8, drawId),
  };
}

export async function claimStakeWithdrawalInstruction(
  programAddress: Address,
  staker: Address,
): Promise<Instruction> {
  const accounts = await fateAddresses(programAddress, 0n);
  const position = await stakerPositionAddress(programAddress, staker);
  return {
    programAddress,
    accounts: [
      { address: staker, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.vault, role: AccountRole.WRITABLE },
      { address: position, role: AccountRole.WRITABLE },
    ],
    data: new Uint8Array([9]),
  };
}

export async function permissionlessProgressInstruction(
  action: ProgressAction,
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
  if (action === "close-draw") {
    return {
      programAddress,
      accounts: [
        { address: accounts.config, role: AccountRole.READONLY },
        { address: accounts.draw, role: AccountRole.WRITABLE },
        { address: rentPayer, role: AccountRole.WRITABLE },
      ],
      data,
    };
  }
  if (!target) throw new Error(`${action} requires a target account`);
  return {
    programAddress,
    accounts: [
      { address: accounts.draw, role: AccountRole.WRITABLE },
      { address: target, role: AccountRole.WRITABLE },
      { address: rentPayer, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
