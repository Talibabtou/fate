import type { Signature } from "@solana/kit";
import type { SolanaRpc } from "../rpc/client.ts";
import { FateTransactionError, formatRpcError } from "./errors.ts";

const CONFIRMATION_TIMEOUT_MS = 45_000;
const CONFIRMATION_POLL_MS = 1_000;

export async function confirmSignature(
  rpc: SolanaRpc,
  signature: Signature,
  lastValidBlockHeight: bigint,
  onState?: () => void,
) {
  onState?.();
  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let statuses: Awaited<ReturnType<ReturnType<typeof rpc.getSignatureStatuses>["send"]>>["value"];
    let blockHeight: bigint;
    try {
      ({ value: statuses } = await rpc
        .getSignatureStatuses([signature], { searchTransactionHistory: true })
        .send());
      blockHeight = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    } catch (_error) {
      throw new FateTransactionError(
        "timed-out",
        `Unable to confirm the submitted transaction; check signature ${signature} before retrying`,
        signature,
        lastValidBlockHeight,
      );
    }
    const status = statuses[0];
    if (status?.err) {
      throw new FateTransactionError(
        "failed",
        `Transaction failed on-chain: ${formatRpcError(status.err)}`,
        signature,
        lastValidBlockHeight,
      );
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    if (!status && blockHeight > lastValidBlockHeight) {
      throw new FateTransactionError(
        "blockhash-expired",
        `Transaction blockhash expired; check signature ${signature} before retrying`,
        signature,
        lastValidBlockHeight,
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, CONFIRMATION_POLL_MS));
  }
  throw new FateTransactionError(
    "timed-out",
    `Transaction confirmation timed out; check signature ${signature} before retrying`,
    signature,
    lastValidBlockHeight,
  );
}

export async function reconcileSignature(
  rpc: SolanaRpc,
  signature: Signature,
  lastValidBlockHeight?: bigint | null,
) {
  const { value: statuses } = await rpc
    .getSignatureStatuses([signature], { searchTransactionHistory: true })
    .send();
  const status = statuses[0];
  if (status?.err) {
    throw new FateTransactionError(
      "failed",
      `Transaction failed on-chain: ${formatRpcError(status.err)}`,
      signature,
    );
  }
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    return "confirmed" as const;
  }
  if (status) return "unknown" as const;
  if (lastValidBlockHeight !== undefined && lastValidBlockHeight !== null) {
    const blockHeight = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (blockHeight > lastValidBlockHeight) return "expired" as const;
  }
  return "unknown" as const;
}
