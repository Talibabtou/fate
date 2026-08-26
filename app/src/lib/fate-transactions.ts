import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import {
  address,
  appendTransactionMessageInstructions,
  type Base64EncodedWireTransaction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  type Instruction,
  pipe,
  type Signature,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { browserRpcUrl } from "./fate-browser";
import { signKitTransaction } from "./privy-wallet";

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

const CONFIRMATION_TIMEOUT_MS = 45_000;
const CONFIRMATION_POLL_MS = 1_000;

/**
 * Simulate on, submit to, and confirm against the configured primary RPC only.
 * Read fallbacks are deliberately excluded from this lifecycle so a blockhash and
 * its confirmation cannot come from different endpoints.
 */
export async function executeFateTransaction({
  instruction,
  wallet,
  onState,
}: {
  instruction: Instruction;
  wallet: ConnectedStandardSolanaWallet;
  onState?: (state: FateTransactionState) => void;
}): Promise<FateTransactionResult> {
  const rpc = createSolanaRpc(browserRpcUrl());
  const feePayer = address(wallet.address);
  onState?.("simulating");

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const transaction = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(feePayer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
    (message) => appendTransactionMessageInstructions([instruction], message),
    (message) => compileTransaction(message),
  );
  const unsignedBytes = new Uint8Array(getTransactionEncoder().encode(transaction));
  const unsignedWire = toBase64WireTransaction(unsignedBytes);
  const simulation = await rpc
    .simulateTransaction(unsignedWire, {
      commitment: "confirmed",
      encoding: "base64",
      sigVerify: false,
    })
    .send();
  if (simulation.value.err) {
    const logs = simulation.value.logs?.slice(-3).join(" | ");
    throw new Error(
      logs
        ? `${formatRpcError(simulation.value.err)} (${logs})`
        : formatRpcError(simulation.value.err),
    );
  }

  onState?.("awaiting-signature");
  const signedBytes = await signKitTransaction(wallet, unsignedBytes);
  const signature = await rpc
    .sendTransaction(toBase64WireTransaction(signedBytes), {
      encoding: "base64",
      maxRetries: 3n,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    })
    .send();
  onState?.("submitted");
  await confirmSignature(rpc, signature);
  onState?.("confirmed");
  return { signature, state: "confirmed" };
}

async function confirmSignature(rpc: ReturnType<typeof createSolanaRpc>, signature: Signature) {
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

function toBase64WireTransaction(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary) as Base64EncodedWireTransaction;
}

function formatRpcError(error: unknown) {
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
