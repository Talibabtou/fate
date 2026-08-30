import {
  type Address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_HEADER_FORBIDDEN,
} from "@solana/kit";
import { rpcReadUrls, rpcSubscriptionsUrl } from "./config.ts";

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export class NonRetryableRpcReadError extends Error {}

export class RpcUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcUnavailableError";
  }
}

export function isRetryableRpcError(error: unknown) {
  if (error instanceof NonRetryableRpcReadError) return false;
  if (
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) ||
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_HEADER_FORBIDDEN) ||
    isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY) ||
    isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED)
  ) {
    return true;
  }
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  return /connection|econn|fetch|network|timed out|timeout|temporarily unavailable/i.test(
    error.message,
  );
}

export async function readWithRpcFallback<T>(
  urls: readonly string[],
  read: (rpc: SolanaRpc, url: string) => Promise<T>,
) {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      return await read(createSolanaRpc(url), url);
    } catch (error) {
      if (!isRetryableRpcError(error)) throw error;
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new RpcUnavailableError(
    `Fate RPC read failed on all configured endpoints: ${failures.join("; ")}`,
  );
}

export async function readSolBalance(walletAddress: Address) {
  return readWithRpcFallback(rpcReadUrls(), async (rpc) => {
    const response = await rpc.getBalance(walletAddress, { commitment: "confirmed" }).send();
    return response.value;
  });
}

export async function subscribeToAccounts(
  accounts: readonly Address[],
  onNotification: () => void,
  signal: AbortSignal,
) {
  const wssUrl = rpcSubscriptionsUrl();
  if (!wssUrl || accounts.length === 0) return false;

  const subscriptions = createSolanaRpcSubscriptions(wssUrl);
  const streams = await Promise.all(
    accounts.map((account) =>
      subscriptions
        .accountNotifications(account, { commitment: "confirmed", encoding: "base64" })
        .subscribe({ abortSignal: signal }),
    ),
  );

  await Promise.race(
    streams.map(async (stream) => {
      for await (const _notification of stream) {
        onNotification();
      }
    }),
  );

  if (!signal.aborted) throw new Error("Fate RPC subscription ended");
  return false;
}
