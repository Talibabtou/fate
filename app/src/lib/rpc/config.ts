import { type Address, address } from "@solana/kit";
import { browserPublicEnv, type PublicEnv } from "../public-config.ts";

export type RpcConfig = {
  primaryHttpUrl: string;
  fallbackHttpUrls: string[];
  primaryWssUrl: string | null;
};

export function rpcConfig(env: PublicEnv = browserPublicEnv): RpcConfig {
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

export function fateProgramAddress(env: PublicEnv = browserPublicEnv): Address | null {
  const value = env.NEXT_PUBLIC_FATE_PROGRAM_ID?.trim();
  return value ? address(value) : null;
}
