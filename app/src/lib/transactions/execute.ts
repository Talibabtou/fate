import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { signKitTransaction } from "../../lib/privy-wallet.ts";
import { primaryRpcUrl } from "../rpc/config.ts";
import { confirmSignature } from "./confirm.ts";
import { formatRpcError } from "./errors.ts";
import type { FateTransactionResult, FateTransactionState } from "./types.ts";
import { toBase64WireTransaction } from "./wire.ts";

const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");
const FATE_COMPUTE_UNIT_LIMIT = 400_000;

function setComputeUnitLimitInstruction(): Instruction {
  const data = new Uint8Array(5);
  // Compute Budget's SetComputeUnitLimit discriminator is 2, followed by LE u32 units.
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, FATE_COMPUTE_UNIT_LIMIT, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
}

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
  const rpc = createSolanaRpc(primaryRpcUrl());
  const feePayer = address(wallet.address);
  onState?.("simulating");

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const transaction = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(feePayer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
    (message) =>
      appendTransactionMessageInstructions(
        [setComputeUnitLimitInstruction(), instruction],
        message,
      ),
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
