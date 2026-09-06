import type { FateSnapshot } from "./snapshot.ts";

export type LifecycleAction = "activate" | "settle";

export type LifecycleCheck = {
  snapshot: FateSnapshot | null;
  dueAction: LifecycleAction | null;
};

export type ReviewAction =
  | { kind: "deposit"; side: "player" | "staker"; amountLamports: bigint; amountLabel: string }
  | { kind: "refund"; amountLamports: bigint; amountLabel: string }
  | { kind: "withdraw"; shares: bigint; amountLabel: string }
  | { kind: "claim"; drawId: bigint; amountLamports: bigint; amountLabel: string }
  | { kind: "claim-withdrawal"; amountLamports: bigint; amountLabel: string }
  | { kind: "progress"; action: LifecycleAction; drawId: bigint; amountLabel: string };

export type SecondaryActionKind = Exclude<ReviewAction["kind"], "deposit" | "progress">;
