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
} from "../../domain/fate/index.ts";
import { publicConfigIssues } from "../../lib/public-config.ts";
import { NonRetryableRpcReadError, readWithRpcFallback } from "../../lib/rpc/client.ts";
import { fateProgramAddress, rpcReadUrls } from "../../lib/rpc/config.ts";
import { readAccountsAtConfirmedSlot } from "./account-reader.ts";

export type FateSnapshot = {
  slot: bigint;
  config: ConfigAccount;
  draw: DrawAccount;
  vault: StakerVaultAccount;
  stakerPosition: StakerPositionAccount | null;
  playerPosition: PlayerPositionAccount | null;
  recentDraws: RecentDrawSnapshot[];
  addresses: {
    config: Address;
    draw: Address;
    vault: Address;
    stakerPosition: Address | null;
    playerPosition: Address | null;
  };
};

export type RecentDrawSnapshot = {
  draw: DrawAccount;
  playerPosition: PlayerPositionAccount | null;
};

export async function readFateSnapshot(walletAddress?: Address): Promise<FateSnapshot> {
  const configIssues = publicConfigIssues();
  if (configIssues.length > 0) {
    throw new Error(configIssues.join("; "));
  }
  const programAddress = fateProgramAddress();
  if (!programAddress) throw new Error("Fate program ID is invalid");

  const { config: configAddress } = await fateAddresses(programAddress, 0n);

  return readWithRpcFallback(rpcReadUrls(), async (rpc) => {
    const initialConfigRead = await readAccountsAtConfirmedSlot(
      rpc,
      [
        {
          account: configAddress,
          expectedSize: CONFIG_SIZE,
          expectedDiscriminator: CONFIG_DISCRIMINATOR,
        },
      ],
      programAddress,
    );
    const initialConfigData = initialConfigRead.data[0];
    if (!initialConfigData) throw new NonRetryableRpcReadError("Fate config account is missing");
    const initialConfig = decodeAccount("config", decodeConfig, initialConfigData);
    const { draw: currentDrawAddress, vault: vaultAddress } = await fateAddresses(
      programAddress,
      initialConfig.currentDrawId,
    );
    const stakerPositionAddressValue = walletAddress
      ? await stakerPositionAddress(programAddress, walletAddress)
      : null;
    const playerPositionAddressValue = walletAddress
      ? await playerPositionAddress(programAddress, initialConfig.currentDrawId, walletAddress)
      : null;
    const recentDrawAddresses = await Promise.all(
      initialConfig.recentDrawIds.map(async (drawId) => ({
        drawId,
        drawAddress: (await fateAddresses(programAddress, drawId)).draw,
        playerPositionAddress: walletAddress
          ? await playerPositionAddress(programAddress, drawId, walletAddress)
          : null,
      })),
    );
    const recentDrawExpectations = recentDrawAddresses.map(({ drawAddress }) => ({
      account: drawAddress,
      expectedSize: DRAW_SIZE,
      expectedDiscriminator: DRAW_DISCRIMINATOR,
    }));
    const recentPlayerExpectations = recentDrawAddresses
      .map(({ playerPositionAddress: historicalPlayerPositionAddress }) =>
        historicalPlayerPositionAddress
          ? {
              account: historicalPlayerPositionAddress,
              expectedSize: PLAYER_POSITION_SIZE,
              expectedDiscriminator: PLAYER_POSITION_DISCRIMINATOR,
              optional: true,
            }
          : null,
      )
      .filter(
        (expectation): expectation is NonNullable<typeof expectation> => expectation !== null,
      );
    const finalRead = await readAccountsAtConfirmedSlot(
      rpc,
      [
        {
          account: configAddress,
          expectedSize: CONFIG_SIZE,
          expectedDiscriminator: CONFIG_DISCRIMINATOR,
        },
        {
          account: currentDrawAddress,
          expectedSize: DRAW_SIZE,
          expectedDiscriminator: DRAW_DISCRIMINATOR,
        },
        {
          account: vaultAddress,
          expectedSize: STAKER_VAULT_SIZE,
          expectedDiscriminator: STAKER_VAULT_DISCRIMINATOR,
        },
        ...(stakerPositionAddressValue
          ? [
              {
                account: stakerPositionAddressValue,
                expectedSize: STAKER_POSITION_SIZE,
                expectedDiscriminator: STAKER_POSITION_DISCRIMINATOR,
                optional: true,
              },
            ]
          : []),
        ...(playerPositionAddressValue
          ? [
              {
                account: playerPositionAddressValue,
                expectedSize: PLAYER_POSITION_SIZE,
                expectedDiscriminator: PLAYER_POSITION_DISCRIMINATOR,
                optional: true,
              },
            ]
          : []),
        ...recentDrawExpectations,
        ...recentPlayerExpectations,
      ],
      programAddress,
      initialConfigRead.slot,
    );
    const configData = finalRead.data[0];
    const drawData = finalRead.data[1];
    const vaultData = finalRead.data[2];
    const stakerPositionData = stakerPositionAddressValue ? finalRead.data[3] : null;
    const playerPositionData = playerPositionAddressValue ? finalRead.data[4] : null;
    if (!configData || !drawData || !vaultData) {
      throw new NonRetryableRpcReadError("Fate snapshot is missing a required account");
    }
    const config = decodeAccount("config", decodeConfig, configData);
    if (
      config.currentDrawId !== initialConfig.currentDrawId ||
      config.recentDrawIds.length !== initialConfig.recentDrawIds.length ||
      config.recentDrawIds.some((drawId, index) => drawId !== initialConfig.recentDrawIds[index])
    ) {
      throw new NonRetryableRpcReadError(
        "Fate snapshot changed while it was being read; retrying is required",
      );
    }
    const recentDataStart =
      3 + Number(stakerPositionAddressValue !== null) + Number(playerPositionAddressValue !== null);
    const recentDrawData = finalRead.data.slice(
      recentDataStart,
      recentDataStart + recentDrawExpectations.length,
    );
    const recentPlayerData = finalRead.data.slice(
      recentDataStart + recentDrawExpectations.length,
      recentDataStart + recentDrawExpectations.length + recentPlayerExpectations.length,
    );
    const recentDraws = recentDrawAddresses.map((entry, index) => {
      const historicalDrawData = recentDrawData[index];
      if (!historicalDrawData) {
        throw new NonRetryableRpcReadError(`Recent draw account is missing: ${entry.drawId}`);
      }
      const historicalPlayerData = walletAddress ? recentPlayerData[index] : null;
      return {
        draw: decodeAccount("recent draw", decodeDraw, historicalDrawData),
        playerPosition: historicalPlayerData
          ? decodeAccount("historical Player position", decodePlayerPosition, historicalPlayerData)
          : null,
      };
    });

    return {
      slot: finalRead.slot,
      config,
      draw: decodeAccount("draw", decodeDraw, drawData),
      vault: decodeAccount("Staker vault", decodeStakerVault, vaultData),
      stakerPosition: stakerPositionData
        ? decodeAccount("Staker position", decodeStakerPosition, stakerPositionData)
        : null,
      playerPosition: playerPositionData
        ? decodeAccount("Player position", decodePlayerPosition, playerPositionData)
        : null,
      recentDraws,
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

function decodeAccount<T>(label: string, decoder: (data: Uint8Array) => T, data: Uint8Array) {
  try {
    return decoder(data);
  } catch (error) {
    throw new NonRetryableRpcReadError(
      `Invalid ${label} account data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
