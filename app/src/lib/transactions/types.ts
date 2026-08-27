export type FateTransactionState =
  | "simulating"
  | "awaiting-signature"
  | "submitted"
  | "confirmed"
  | "failed"
  | "stale";

export type FateTransactionResult = {
  signature: string;
  state: "confirmed";
};
