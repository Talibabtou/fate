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

export const fatePublicConfig = readPublicConfig();
