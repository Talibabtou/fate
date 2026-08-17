import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Address, address, createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signerFromFile } from "@solana/kit-plugin-signer";
import {
  decodeConfig,
  decodeDraw,
  dueAction,
  fateAddresses,
  type KeeperAction,
  keeperInstruction,
} from "./fate-client.ts";

const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

type KeeperConfig = {
  cluster: "localnet" | "devnet";
  rpcUrl: string;
  rpcSubscriptionsUrl?: string;
  keypairPath: string;
  programAddress: Address;
  pollMs: number;
  once: boolean;
  observeOnly: boolean;
  minimumBalanceLamports: bigint;
};

function loadLocalEnvironment() {
  const path = resolve(import.meta.dirname, "../../.env.local");
  if (existsSync(path)) process.loadEnvFile(path);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function parseConfig(): KeeperConfig {
  const cluster = process.env.KEEPER_CLUSTER?.trim() || "localnet";
  if (cluster !== "localnet" && cluster !== "devnet") {
    throw new Error(
      "KEEPER_CLUSTER must be localnet or devnet; mainnet is intentionally unsupported",
    );
  }
  const once = process.argv.includes("--once");
  const observeOnly = process.argv.includes("--observe-only");
  const knownFlags = new Set(["--once", "--observe-only"]);
  const unknownFlag = process.argv.slice(2).find((argument) => !knownFlags.has(argument));
  if (unknownFlag) throw new Error(`unknown argument ${unknownFlag}`);

  const rpcUrl = process.env.KEEPER_RPC_HTTP_URL?.trim() || "http://127.0.0.1:8899";
  if (cluster === "localnet" && !isLoopbackRpc(rpcUrl)) {
    throw new Error("localnet keeper RPC must use localhost or a loopback IP address");
  }

  const minimumBalanceLamports = BigInt(
    process.env.KEEPER_MIN_BALANCE_LAMPORTS?.trim() || "80000000",
  );
  if (minimumBalanceLamports < 0n) {
    throw new Error("KEEPER_MIN_BALANCE_LAMPORTS cannot be negative");
  }

  return {
    cluster,
    rpcUrl,
    rpcSubscriptionsUrl: process.env.KEEPER_RPC_WSS_URL?.trim() || undefined,
    keypairPath: required("KEEPER_KEYPAIR_PATH"),
    programAddress: address(required("NEXT_PUBLIC_FATE_PROGRAM_ID")),
    pollMs: positiveInteger(process.env.KEEPER_POLL_MS, 2_000, "KEEPER_POLL_MS"),
    once,
    observeOnly,
    minimumBalanceLamports,
  };
}

function isLoopbackRpc(rpcUrl: string) {
  const hostname = new URL(rpcUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function decodeRpcData(data: readonly [string, string]) {
  if (data[1] !== "base64") throw new Error(`unexpected account encoding ${data[1]}`);
  return new Uint8Array(Buffer.from(data[0], "base64"));
}

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function createKeeperClient(config: KeeperConfig) {
  return createClient()
    .use(signerFromFile(config.keypairPath))
    .use(
      solanaRpc({
        rpcUrl: config.rpcUrl,
        ...(config.rpcSubscriptionsUrl ? { rpcSubscriptionsUrl: config.rpcSubscriptionsUrl } : {}),
        skipPreflight: false,
        transactionConfig: { estimateResourceLimits: true, version: 0 },
        maxConcurrency: 1,
      }),
    );
}

type KeeperClient = Awaited<ReturnType<typeof createKeeperClient>>;

async function main() {
  loadLocalEnvironment();
  const config = parseConfig();
  const client = await createKeeperClient(config);

  const genesisHash = await client.rpc.getGenesisHash().send();
  if (config.cluster === "devnet" && genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(`RPC genesis hash is not devnet: ${genesisHash}`);
  }
  log("keeper_started", {
    cluster: config.cluster,
    rpcUrl: config.rpcUrl,
    genesisHash,
    programAddress: config.programAddress,
    payer: client.payer.address,
    observeOnly: config.observeOnly,
  });

  let failures = 0;
  while (true) {
    try {
      const addresses = await fateAddresses(config.programAddress, 0n);
      const configResponse = await client.rpc
        .getAccountInfo(addresses.config, { commitment: "confirmed", encoding: "base64" })
        .send();
      if (!configResponse.value) throw new Error("Fate config account does not exist");
      if (configResponse.value.owner !== config.programAddress) {
        throw new Error("Fate config has an unexpected owner");
      }
      const fateConfig = decodeConfig(decodeRpcData(configResponse.value.data));
      if (fateConfig.version !== 1n) throw new Error("Fate initialization is incomplete");

      const currentAddresses = await fateAddresses(config.programAddress, fateConfig.currentDrawId);
      const [drawResponse, slot] = await Promise.all([
        client.rpc
          .getAccountInfo(currentAddresses.draw, {
            commitment: "confirmed",
            encoding: "base64",
          })
          .send(),
        client.rpc.getSlot({ commitment: "confirmed" }).send(),
      ]);
      if (!drawResponse.value) throw new Error("current draw account does not exist");
      if (drawResponse.value.owner !== config.programAddress) {
        throw new Error("current draw has an unexpected owner");
      }
      const draw = decodeDraw(decodeRpcData(drawResponse.value.data));
      const blockTime = await client.rpc.getBlockTime(slot).send();
      if (blockTime === null) throw new Error(`block time unavailable for slot ${slot}`);
      const action = dueAction(fateConfig, draw, blockTime);

      if (!action) {
        if (config.once) {
          log("no_action_due", { drawId: draw.id.toString(), phase: draw.phase });
          return;
        }
      } else if (config.observeOnly) {
        log("action_due", { action, drawId: draw.id.toString(), phase: draw.phase });
        if (config.once) return;
      } else {
        if (action === "settle") {
          const balance = (await client.rpc.getBalance(client.payer.address).send()).value;
          if (balance < config.minimumBalanceLamports) {
            throw new Error(
              `keeper balance ${balance} is below safety floor ${config.minimumBalanceLamports}`,
            );
          }
        }
        const instruction = await keeperInstruction(
          action,
          config.programAddress,
          client.payer.address,
          fateConfig,
        );
        log("transition_submitting", { action, drawId: draw.id.toString() });
        try {
          // The RPC executor first simulates to estimate resource limits. A failed
          // simulation prevents submission; successful transactions are confirmed.
          const result = await client.sendTransaction([instruction]);
          log("transition_confirmed", {
            action,
            drawId: draw.id.toString(),
            signature: result.context.signature,
          });
        } catch (sendError) {
          if (!(await transitionAlreadyApplied(client, config.programAddress, draw.id, action))) {
            throw sendError;
          }
          log("transition_won_by_another_caller", {
            action,
            drawId: draw.id.toString(),
          });
        }
        if (config.once) return;
      }
      failures = 0;
      await delay(config.pollMs);
    } catch (error) {
      failures += 1;
      log("keeper_error", { error: errorText(error), consecutiveFailures: failures });
      if (config.once) throw error;
      await delay(Math.min(30_000, config.pollMs * 2 ** Math.min(failures, 4)));
    }
  }
}

async function transitionAlreadyApplied(
  client: KeeperClient,
  programAddress: Address,
  attemptedDrawId: bigint,
  action: KeeperAction,
) {
  const configAddress = (await fateAddresses(programAddress, 0n)).config;
  const response = await client.rpc
    .getAccountInfo(configAddress, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!response.value || response.value.owner !== programAddress) return false;
  const config = decodeConfig(decodeRpcData(response.value.data));
  if (action === "settle") return config.currentDrawId > attemptedDrawId;
  if (config.currentDrawId !== attemptedDrawId) return true;
  const drawAddress = (await fateAddresses(programAddress, attemptedDrawId)).draw;
  const drawResponse = await client.rpc
    .getAccountInfo(drawAddress, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!drawResponse.value || drawResponse.value.owner !== programAddress) return false;
  const draw = decodeDraw(decodeRpcData(drawResponse.value.data));
  return action === "activate" ? draw.phase >= 1 : draw.phase >= 2;
}

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "fatal",
      error: errorText(error),
    }),
  );
  process.exitCode = 1;
});
