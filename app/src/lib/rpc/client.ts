import { type Address, createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { rpcReadUrls, rpcSubscriptionsUrl } from "./config.ts";

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export async function readWithRpcFallback<T>(
  urls: readonly string[],
  read: (rpc: SolanaRpc, url: string) => Promise<T>,
) {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      return await read(createSolanaRpc(url), url);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Fate RPC read failed on all configured endpoints: ${failures.join("; ")}`);
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
  if (!wssUrl || accounts.length === 0) return;

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
}
