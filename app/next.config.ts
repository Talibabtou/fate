import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoEnvPath = resolve(import.meta.dirname, "../.env.local");
if (existsSync(repoEnvPath)) process.loadEnvFile(repoEnvPath);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
