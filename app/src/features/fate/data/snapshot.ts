import type { Address } from "@solana/kit";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  type ConfigAccount,
  DRAW_DISCRIMINATOR,
  DRAW_SIZE,
  type DrawAccount,
  decodeConfig,
  decodeDraw,
  decodePlayerPosition,
  decodeStakerPosition,
  decodeStakerVault,
  fateAddresses,
  PLAYER_POSITION_DISCRIMINATOR,
  PLAYER_POSITION_SIZE,
  type PlayerPositionAccount,
  playerPositionAddress,
  STAKER_POSITION_DISCRIMINATOR,
  STAKER_POSITION_SIZE,
  STAKER_VAULT_DISCRIMINATOR,
  STAKER_VAULT_SIZE,
  type StakerPositionAccount,
  type StakerVaultAccount,
  stakerPositionAddress,
} from "../../../domain/fate/index.ts";
import { readWithRpcFallback } from "../../../lib/rpc/client.ts";
import { fateProgramAddress, rpcReadUrls } from "../../../lib/rpc/config.ts";
import { readAccount, readOptionalAccount } from "./account-reader.ts";

export type FateSnapshot = {
  config: ConfigAccount;
  draw: DrawAccount;
  vault: StakerVaultAccount;
  stakerPosition: StakerPositionAccount | null;
  playerPosition: PlayerPositionAccount | null;
  addresses: {
    config: Address;
    draw: Address;
    vault: Address;
    stakerPosition: Address | null;
    playerPosition: Address | null;
  };
};

export async function readFateSnapshot(walletAddress?: Address): Promise<FateSnapshot> {
  const programAddress = fateProgramAddress();
  if (!programAddress) throw new Error("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured");

  return readWithRpcFallback(rpcReadUrls(), async (rpc) => {
    const { config: configAddress } = await fateAddresses(programAddress, 0n);
    const configData = await readAccount(
      rpc,
      configAddress,
      programAddress,
      CONFIG_SIZE,
      CONFIG_DISCRIMINATOR,
    );
    const config = decodeConfig(configData);
    const { draw: currentDrawAddress, vault: vaultAddress } = await fateAddresses(
      programAddress,
      config.currentDrawId,
    );
    const drawData = await readAccount(
      rpc,
      currentDrawAddress,
      programAddress,
      DRAW_SIZE,
      DRAW_DISCRIMINATOR,
    );

    const [vaultData, stakerPositionAddressValue, playerPositionAddressValue] = await Promise.all([
      readAccount(rpc, vaultAddress, programAddress, STAKER_VAULT_SIZE, STAKER_VAULT_DISCRIMINATOR),
      walletAddress ? stakerPositionAddress(programAddress, walletAddress) : Promise.resolve(null),
      walletAddress
        ? playerPositionAddress(programAddress, config.currentDrawId, walletAddress)
        : Promise.resolve(null),
    ]);
    const [stakerPositionData, playerPositionData] = await Promise.all([
      stakerPositionAddressValue
        ? readOptionalAccount(
            rpc,
            stakerPositionAddressValue,
            programAddress,
            STAKER_POSITION_SIZE,
            STAKER_POSITION_DISCRIMINATOR,
          )
        : Promise.resolve(null),
      playerPositionAddressValue
        ? readOptionalAccount(
            rpc,
            playerPositionAddressValue,
            programAddress,
            PLAYER_POSITION_SIZE,
            PLAYER_POSITION_DISCRIMINATOR,
          )
        : Promise.resolve(null),
    ]);

    return {
      config,
      draw: decodeDraw(drawData),
      vault: decodeStakerVault(vaultData),
      stakerPosition: stakerPositionData ? decodeStakerPosition(stakerPositionData) : null,
      playerPosition: playerPositionData ? decodePlayerPosition(playerPositionData) : null,
      addresses: {
        config: configAddress,
        draw: currentDrawAddress,
        vault: vaultAddress,
        stakerPosition: stakerPositionAddressValue,
        playerPosition: playerPositionAddressValue,
      },
    };
  });
}
