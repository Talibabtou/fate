import type { Address } from "@solana/kit";
import type {
  ConfigAccount,
  DrawAccount,
  PlayerPositionAccount,
  StakerPositionAccount,
} from "../../domain/fate";
import type { LifecycleAction } from "../use-lifecycle-progress";

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
  programAddress: Address | null;
  progress: number;
  progressAction: LifecycleAction | null;
  refreshing: boolean;
  stakerPosition: StakerPositionAccount | null;
  stakerTvlLamports: bigint | null;
  withdrawalShares: string;
};
