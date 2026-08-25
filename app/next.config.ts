import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

const repoEnvPath = resolve(import.meta.dirname, "../.env.local");
if (existsSync(repoEnvPath)) process.loadEnvFile(repoEnvPath);

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  turbopack: {},
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve ??= {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        // Privy probes this optional integration, but Fate uses Solana wallets directly.
        "@farcaster/mini-app-solana": false,
      };
    }
    return config;
  },
};

export default nextConfig;
