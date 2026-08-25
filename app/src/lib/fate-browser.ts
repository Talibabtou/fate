import { type Address, address, createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  type ConfigAccount,
  DRAW_DISCRIMINATOR,
  DRAW_SIZE,
  type DrawAccount,
  decodeConfig,
  decodeDraw,
  fateAddresses,
} from "../../scripts/fate-client.ts";

const DEFAULT_LOCALNET_RPC = "http://127.0.0.1:8899";

export type BrowserRpcConfig = {
  primaryHttpUrl: string;
  fallbackHttpUrls: string[];
  primaryWssUrl: string | null;
};

type BrowserEnv = {
  NEXT_PUBLIC_RPC_HTTP_URL?: string;
  NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS?: string;
  NEXT_PUBLIC_RPC_WSS_URL?: string;
};

export type FateSnapshot = {
  config: ConfigAccount;
  draw: DrawAccount;
  addresses: {
    config: Address;
    draw: Address;
  };
};

export function browserRpcConfig(env: BrowserEnv = process.env as BrowserEnv): BrowserRpcConfig {
  const primaryHttpUrl = env.NEXT_PUBLIC_RPC_HTTP_URL?.trim() || DEFAULT_LOCALNET_RPC;
  const fallbackHttpUrls = (env.NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => value !== primaryHttpUrl && values.indexOf(value) === index);
  const primaryWssUrl = env.NEXT_PUBLIC_RPC_WSS_URL?.trim() || null;

  return { primaryHttpUrl, fallbackHttpUrls, primaryWssUrl };
}

export function browserRpcUrl() {
  return browserRpcConfig().primaryHttpUrl;
}

export function browserRpcReadUrls(config = browserRpcConfig()) {
  return [config.primaryHttpUrl, ...config.fallbackHttpUrls];
}

export function browserRpcSubscriptionsUrl() {
  return browserRpcConfig().primaryWssUrl;
}

export function browserProgramAddress() {
  const value = process.env.NEXT_PUBLIC_FATE_PROGRAM_ID?.trim();
  return value ? address(value) : null;
}

export async function readWithRpcFallback<T>(
  urls: readonly string[],
  read: (rpc: ReturnType<typeof createSolanaRpc>, url: string) => Promise<T>,
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
  return readWithRpcFallback(browserRpcReadUrls(), async (rpc) => {
    const response = await rpc.getBalance(walletAddress, { commitment: "confirmed" }).send();
    return response.value;
  });
}

export async function readFateSnapshot(): Promise<FateSnapshot> {
  const programAddress = browserProgramAddress();
  if (!programAddress) throw new Error("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured");

  return readWithRpcFallback(browserRpcReadUrls(), async (rpc) => {
    const { config: configAddress } = await fateAddresses(programAddress, 0n);
    const configData = await readAccount(
      rpc,
      configAddress,
      programAddress,
      CONFIG_SIZE,
      CONFIG_DISCRIMINATOR,
    );
    const config = decodeConfig(configData);
    const { draw: currentDrawAddress } = await fateAddresses(programAddress, config.currentDrawId);
    const drawData = await readAccount(
      rpc,
      currentDrawAddress,
      programAddress,
      DRAW_SIZE,
      DRAW_DISCRIMINATOR,
    );

    return {
      config,
      draw: decodeDraw(drawData),
      addresses: { config: configAddress, draw: currentDrawAddress },
    };
  });
}

export async function subscribeToFateAccounts(
  accounts: readonly Address[],
  onNotification: () => void,
  signal: AbortSignal,
) {
  const wssUrl = browserRpcSubscriptionsUrl();
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

async function readAccount(
  rpc: ReturnType<typeof createSolanaRpc>,
  account: Address,
  programAddress: Address,
  expectedSize: number,
  expectedDiscriminator: number,
) {
  const response = await rpc
    .getAccountInfo(account, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!response.value || response.value.owner !== programAddress) {
    throw new Error(`Account is missing or not owned by Fate: ${account}`);
  }
  const [encoded, encoding] = response.value.data;
  if (encoding !== "base64") throw new Error("Unexpected account encoding");
  const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (data.length !== expectedSize || data[0] !== expectedDiscriminator) {
    throw new Error(`Invalid Fate account layout: ${account}`);
  }
  return data;
}
