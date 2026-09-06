export type FateTransactionState =
  | "simulating"
  | "awaiting-signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "rejected"
  | "failed"
  | "blockhash-expired"
  | "timed-out"
  | "reconciling"
  | "stale"
  | "wrong-network";

export type FateTransactionResult = {
  signature: string;
  state: "confirmed";
};

export type FateTransactionPreview = {
  estimatedFeeLamports: bigint | null;
  feePayer: string;
  blockhash: string;
  lastValidBlockHeight: bigint;
};
