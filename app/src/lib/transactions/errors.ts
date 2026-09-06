import type { FateTransactionState } from "./types.ts";

export type FateTransactionErrorKind = Extract<
  FateTransactionState,
  "rejected" | "failed" | "blockhash-expired" | "timed-out" | "stale"
>;

export class FateTransactionError extends Error {
  readonly kind: FateTransactionErrorKind;
  readonly signature: string | null;
  readonly lastValidBlockHeight: bigint | null;

  constructor(
    kind: FateTransactionErrorKind,
    message: string,
    signature?: string | null,
    lastValidBlockHeight?: bigint | null,
  ) {
    super(message);
    this.name = "FateTransactionError";
    this.kind = kind;
    this.signature = signature ?? null;
    this.lastValidBlockHeight = lastValidBlockHeight ?? null;
  }
}

export function formatRpcError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
    try {
      return JSON.stringify(error);
    } catch {
      return "RPC transaction error";
    }
  }
  return "RPC transaction error";
}

export function isWalletRejection(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /reject|denied|declined|cancelled|canceled|user abort|user closed/i.test(message);
}

export function transactionErrorKind(error: unknown): FateTransactionErrorKind {
  if (isWalletRejection(error)) return "rejected";
  const message = error instanceof Error ? error.message : String(error);
  if (/blockhash|block height|expired/i.test(message)) return "blockhash-expired";
  if (/timed out|timeout/i.test(message)) return "timed-out";
  return "failed";
}
