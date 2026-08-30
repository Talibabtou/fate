import { type Address, address } from "@solana/kit";
import { browserPublicEnv, type PublicEnv, readPublicConfig } from "../public-config.ts";

export type RpcConfig = {
  primaryHttpUrl: string;
  fallbackHttpUrls: string[];
  primaryWssUrl: string | null;
};

export function rpcConfig(env: PublicEnv = browserPublicEnv): RpcConfig {
  const publicConfig = readPublicConfig(env);
  const primaryHttpUrl = publicConfig.rpcHttpUrl;
  if (!primaryHttpUrl) throw new Error("NEXT_PUBLIC_RPC_HTTP_URL is not configured");
  if (!isUrl(primaryHttpUrl, ["http:", "https:"])) {
    throw new Error("NEXT_PUBLIC_RPC_HTTP_URL must be a valid http(s) URL");
  }
  const fallbackHttpUrls = publicConfig.rpcFallbackHttpUrls
    .filter(Boolean)
    .filter((value, index, values) => value !== primaryHttpUrl && values.indexOf(value) === index)
    .map((value) => {
      if (!isUrl(value, ["http:", "https:"])) {
        throw new Error(`RPC fallback URL must be a valid http(s) URL: ${value}`);
      }
      return value;
    });
  const primaryWssUrl = publicConfig.rpcWssUrl;
  if (primaryWssUrl && !isUrl(primaryWssUrl, ["ws:", "wss:"])) {
    throw new Error("NEXT_PUBLIC_RPC_WSS_URL must be a valid ws(s) URL");
  }

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
  const value = readPublicConfig(env).fateProgramId;
  if (!value) return null;
  try {
    return address(value);
  } catch {
    return null;
  }
}

function isUrl(value: string, protocols: readonly string[]) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
