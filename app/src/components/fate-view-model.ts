import type { Address } from "@solana/kit";
import type {
  ConfigAccount,
  DrawAccount,
  PlayerPositionAccount,
  StakerPositionAccount,
  StakerVaultAccount,
} from "../domain/fate";
import type { RecentDrawSnapshot } from "../features/draw/snapshot";
import type { LifecycleAction } from "../features/draw/types";

export type FateViewModel = {
  activationThresholdLamports: bigint | null;
  config: ConfigAccount | undefined;
  draw: DrawAccount | undefined;
  isPlayer: boolean;
  mode: "staker" | "player";
  network: string;
  now: number;
  phase: string;
  playerPosition: PlayerPositionAccount | null;
  recentDraws: RecentDrawSnapshot[];
  programAddress: Address | null;
  progress: number;
  progressAction: LifecycleAction | null;
  refreshing: boolean;
  stakerPosition: StakerPositionAccount | null;
  stakerTvlLamports: bigint | null;
  vault: StakerVaultAccount | undefined;
  withdrawalShares: string;
};
