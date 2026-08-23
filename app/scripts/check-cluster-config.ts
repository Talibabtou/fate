import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { address } from "@solana/kit";

const cluster = process.argv[2]?.trim() || "devnet";

if (cluster !== "localnet" && cluster !== "devnet") {
  throw new Error("usage: check-cluster-config.ts localnet|devnet");
}

const envPath = resolve(import.meta.dirname, "../../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const requiredNames =
  cluster === "localnet"
    ? ["FATE_PROGRAM_ID", "FATE_LOCALNET_RPC_URL"]
    : ["NEXT_PUBLIC_FATE_PROGRAM_ID", "NEXT_PUBLIC_RPC_HTTP_URL", "NEXT_PUBLIC_RPC_WSS_URL"];

const missing = requiredNames.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(`missing ${cluster} configuration: ${missing.join(", ")}`);
}

const programName = cluster === "localnet" ? "FATE_PROGRAM_ID" : "NEXT_PUBLIC_FATE_PROGRAM_ID";
const httpName = cluster === "localnet" ? "FATE_LOCALNET_RPC_URL" : "NEXT_PUBLIC_RPC_HTTP_URL";
const program = requiredValue(programName);
const httpUrl = requiredValue(httpName);
const wssUrl = cluster === "devnet" ? requiredValue("NEXT_PUBLIC_RPC_WSS_URL") : undefined;

try {
  address(program);
} catch {
  throw new Error(`invalid Fate program address: ${program}`);
}

validateUrl(httpUrl, cluster === "localnet" ? ["http:"] : ["https:"]);
if (wssUrl) validateUrl(wssUrl, ["wss:"]);

const hostname = new URL(httpUrl).hostname;
if (cluster === "localnet" && !isLoopback(hostname)) {
  throw new Error("localnet RPC must use localhost or a loopback IP address");
}
if (cluster === "devnet" && isLoopback(hostname)) {
  throw new Error("devnet RPC must not point to localhost or a loopback IP address");
}

console.log(
  JSON.stringify({
    FATE_CLUSTER_CONFIG_OK: true,
    cluster,
    program,
    http: httpUrl,
    ...(wssUrl ? { wss: wssUrl } : {}),
  }),
);

function validateUrl(value: string, protocols: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`invalid RPC URL: ${value}`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`RPC URL must use ${protocols.join(" or ")}: ${value}`);
  }
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "[::1]" || hostname === "127.0.0.1";
}

function requiredValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
