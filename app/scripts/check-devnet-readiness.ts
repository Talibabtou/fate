import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { address } from "@solana/kit";

const envPath = resolve(import.meta.dirname, "../../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const rpcUrl = required("FATE_DEVNET_RPC_HTTP_URL", "https://api.devnet.solana.com");
const programAddress = required("NEXT_PUBLIC_FATE_PROGRAM_ID");
const deployerPath = required("FATE_DEVNET_PAYER_KEYPAIR");
const treasuryAddress = required("FATE_DEVNET_TREASURY_ADDRESS");
const artifactPath = resolve("target/deploy/fate.so");
const programKeypairPath = resolve("target/deploy/fate-keypair.json");

validateAddress("NEXT_PUBLIC_FATE_PROGRAM_ID", programAddress);
validateAddress("FATE_DEVNET_TREASURY_ADDRESS", treasuryAddress);
validateHttps("FATE_DEVNET_RPC_HTTP_URL", rpcUrl);

const deployer = publicKey(deployerPath, "FATE_DEVNET_PAYER_KEYPAIR");
const programKey = publicKey(programKeypairPath, "target/deploy/fate-keypair.json");

if (programKey !== programAddress) {
  throw new Error(
    `program keypair does not match NEXT_PUBLIC_FATE_PROGRAM_ID: ${programKey} != ${programAddress}`,
  );
}
if (deployer === treasuryAddress) {
  throw new Error("deployer and fee treasury must be separate addresses");
}
const artifactHash = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
const balances = {
  deployer: balance(deployer),
  treasury: balance(treasuryAddress),
};

console.log(
  JSON.stringify(
    {
      FATE_DEVNET_PREFLIGHT_OK: true,
      cluster: "devnet",
      rpc: rpcUrl,
      program: programAddress,
      deployer,
      treasury: treasuryAddress,
      artifact: artifactPath,
      artifactSha256: artifactHash,
      balances,
      note: "read-only preflight; no transaction was signed or sent",
    },
    null,
    2,
  ),
);

function required(name: string, fallback?: string) {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function validateAddress(name: string, value: string) {
  try {
    address(value);
  } catch {
    throw new Error(`invalid ${name}: ${value}`);
  }
}

function validateHttps(name: string, value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || isLoopback(parsed.hostname)) {
    throw new Error(`${name} must be a non-loopback HTTPS URL`);
  }
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function publicKey(keypairPath: string, label: string) {
  const resolved = resolve(keypairPath);
  if (!existsSync(resolved)) throw new Error(`${label} does not exist: ${resolved}`);
  try {
    return execFileSync("solana-keygen", ["pubkey", resolved], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`${label} is not a readable Solana keypair: ${resolved}`);
  }
}

function balance(account: string) {
  try {
    return execFileSync("solana", ["balance", account, "--url", rpcUrl], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`could not read devnet balance for ${account}`);
  }
}
