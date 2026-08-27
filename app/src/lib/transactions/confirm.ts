import type { Signature } from "@solana/kit";
import type { SolanaRpc } from "../rpc/client.ts";
import { formatRpcError } from "./errors.ts";

const CONFIRMATION_TIMEOUT_MS = 45_000;
const CONFIRMATION_POLL_MS = 1_000;

export async function confirmSignature(rpc: SolanaRpc, signature: Signature) {
  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value: statuses } = await rpc
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .send();
    const status = statuses[0];
    if (status?.err) throw new Error(`Transaction failed on-chain: ${formatRpcError(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, CONFIRMATION_POLL_MS));
  }
  throw new Error("Transaction confirmation timed out; check the signature before retrying");
}
