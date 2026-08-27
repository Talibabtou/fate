import { type Address, address } from "@solana/kit";

export type RpcConfig = {
  primaryHttpUrl: string;
  fallbackHttpUrls: string[];
  primaryWssUrl: string | null;
};

type PublicEnv = {
  NEXT_PUBLIC_RPC_HTTP_URL?: string;
  NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS?: string;
  NEXT_PUBLIC_RPC_WSS_URL?: string;
  NEXT_PUBLIC_FATE_PROGRAM_ID?: string;
};

export function rpcConfig(env: PublicEnv = process.env as PublicEnv): RpcConfig {
  const primaryHttpUrl = env.NEXT_PUBLIC_RPC_HTTP_URL?.trim();
  if (!primaryHttpUrl) throw new Error("NEXT_PUBLIC_RPC_HTTP_URL is not configured");
  const fallbackHttpUrls = (env.NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => value !== primaryHttpUrl && values.indexOf(value) === index);
  const primaryWssUrl = env.NEXT_PUBLIC_RPC_WSS_URL?.trim() || null;

  return { primaryHttpUrl, fallbackHttpUrls, primaryWssUrl };
}

export function primaryRpcUrl(config = rpcConfig()) {
  return config.primaryHttpUrl;
}

export function rpcReadUrls(config = rpcConfig()) {
  return [config.primaryHttpUrl, ...config.fallbackHttpUrls];
}

export function rpcSubscriptionsUrl(config = rpcConfig()) {
  return config.primaryWssUrl;
}

export function fateProgramAddress(env: PublicEnv = process.env as PublicEnv): Address | null {
  const value = env.NEXT_PUBLIC_FATE_PROGRAM_ID?.trim();
  return value ? address(value) : null;
}
