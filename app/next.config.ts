import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

const repoEnvPath = resolve(import.meta.dirname, "../.env.local");
// Fate keeps its canonical local public/runtime variables in the repository-root
// `.env.local` because this Next app lives in `app/`. Next may also auto-load
// `app/.env.local`; reserve that file for app-only tooling variables. Vercel and CI
// inject public variables directly and do not depend on either local file.
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
