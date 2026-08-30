import { address } from "@solana/kit";

export type PublicEnv = {
  NEXT_PUBLIC_RPC_HTTP_URL?: string;
  NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS?: string;
  NEXT_PUBLIC_RPC_WSS_URL?: string;
  NEXT_PUBLIC_PRIVY_APP_ID?: string;
  NEXT_PUBLIC_SOLANA_NETWORK?: string;
  NEXT_PUBLIC_FATE_PROGRAM_ID?: string;
};

export type FatePublicConfig = {
  rpcHttpUrl: string | null;
  rpcFallbackHttpUrls: string[];
  rpcWssUrl: string | null;
  privyAppId: string | null;
  network: string | null;
  fateProgramId: string | null;
};

const supportedNetworks = new Set(["localnet", "devnet", "testnet", "mainnet", "mainnet-beta"]);

// Keep these as direct process.env references. Next.js replaces public env values
// in the browser bundle only when it can statically identify each reference.
export const browserPublicEnv: PublicEnv = {
  NEXT_PUBLIC_RPC_HTTP_URL: process.env.NEXT_PUBLIC_RPC_HTTP_URL,
  NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS: process.env.NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS,
  NEXT_PUBLIC_RPC_WSS_URL: process.env.NEXT_PUBLIC_RPC_WSS_URL,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
  NEXT_PUBLIC_FATE_PROGRAM_ID: process.env.NEXT_PUBLIC_FATE_PROGRAM_ID,
};

function optionalValue(value: string | undefined) {
  return value?.trim() || null;
}

function isUrl(value: string, protocols: readonly string[]) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function readPublicConfig(env: PublicEnv = browserPublicEnv): FatePublicConfig {
  return {
    rpcHttpUrl: optionalValue(env.NEXT_PUBLIC_RPC_HTTP_URL),
    rpcFallbackHttpUrls: (env.NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    rpcWssUrl: optionalValue(env.NEXT_PUBLIC_RPC_WSS_URL),
    privyAppId: optionalValue(env.NEXT_PUBLIC_PRIVY_APP_ID),
    network: optionalValue(env.NEXT_PUBLIC_SOLANA_NETWORK),
    fateProgramId: optionalValue(env.NEXT_PUBLIC_FATE_PROGRAM_ID),
  };
}

export function publicConfigIssues(env: PublicEnv = browserPublicEnv): string[] {
  const config = readPublicConfig(env);
  const issues: string[] = [];

  if (!config.network) {
    issues.push("NEXT_PUBLIC_SOLANA_NETWORK is not configured");
  } else if (!supportedNetworks.has(config.network.toLowerCase())) {
    issues.push(
      "NEXT_PUBLIC_SOLANA_NETWORK must be localnet, devnet, testnet, mainnet, or mainnet-beta",
    );
  }

  if (!config.rpcHttpUrl) {
    issues.push("NEXT_PUBLIC_RPC_HTTP_URL is not configured");
  } else if (!isUrl(config.rpcHttpUrl, ["http:", "https:"])) {
    issues.push("NEXT_PUBLIC_RPC_HTTP_URL must be a valid http(s) URL");
  }

  for (const fallbackUrl of config.rpcFallbackHttpUrls) {
    if (!isUrl(fallbackUrl, ["http:", "https:"])) {
      issues.push(`RPC fallback URL must be a valid http(s) URL: ${fallbackUrl}`);
    }
  }

  if (config.rpcWssUrl && !isUrl(config.rpcWssUrl, ["ws:", "wss:"])) {
    issues.push("NEXT_PUBLIC_RPC_WSS_URL must be a valid ws(s) URL");
  }

  if (!config.fateProgramId) {
    issues.push("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured");
  } else {
    try {
      address(config.fateProgramId);
    } catch {
      issues.push("NEXT_PUBLIC_FATE_PROGRAM_ID must be a valid Solana address");
    }
  }

  return issues;
}

export function assertPublicConfig(env: PublicEnv = browserPublicEnv): FatePublicConfig {
  const issues = publicConfigIssues(env);
  if (issues.length > 0) {
    throw new Error(`Fate public configuration is invalid: ${issues.join("; ")}`);
  }
  return readPublicConfig(env);
}

export const fatePublicConfig = readPublicConfig();
