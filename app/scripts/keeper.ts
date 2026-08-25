import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Address,
  address,
  type Base58EncodedBytes,
  createClient,
  getBase58Decoder,
  type Instruction,
} from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { payerFromFile } from "@solana/kit-plugin-signer";
import {
  type CleanupAction,
  cleanupInstruction,
  DRAW_SIZE,
  DrawPhase,
  decodeConfig,
  decodeDraw,
  decodePlayerPosition,
  decodeStakerPosition,
  decodeStakerVault,
  decodeWeightPage,
  devSettlementSelection,
  dueAction,
  fateAddresses,
  type KeeperAction,
  keeperInstruction,
  PLAYER_POSITION_SIZE,
  RECENT_DRAW_CAPACITY,
  STAKER_POSITION_SIZE,
  selectWeightBranch,
  selectWeightedIndex,
  WEIGHT_PAGE_SIZE,
  weightPageAddress,
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
    .use(payerFromFile(config.keypairPath))
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

type CleanupCandidate = {
  action: CleanupAction;
  drawId: bigint;
  rentPayer: Address;
  target?: Address;
};

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
      const cleanup = action
        ? null
        : await findCleanupCandidate(client, config.programAddress, fateConfig);

      if (!action && !cleanup) {
        if (config.once) {
          log("no_action_due", { drawId: draw.id.toString(), phase: draw.phase });
          return;
        }
      } else if (config.observeOnly) {
        log("action_due", {
          action: action ?? cleanup?.action,
          drawId: (action ? draw.id : cleanup?.drawId)?.toString(),
          phase: action ? draw.phase : undefined,
        });
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
        const submittedAction = action ?? cleanup?.action;
        const submittedDrawId = action ? draw.id : cleanup?.drawId;
        if (!submittedAction || submittedDrawId === undefined) {
          throw new Error("keeper selected an invalid action");
        }
        let instruction: Instruction;
        if (action) {
          const participants =
            action === "settle"
              ? await findSettlementParticipants(client, config.programAddress, draw.id, draw)
              : undefined;
          instruction = await keeperInstruction(
            action,
            config.programAddress,
            client.payer.address,
            fateConfig,
            participants,
          );
        } else {
          if (!cleanup) throw new Error("keeper cleanup selection disappeared");
          instruction = await cleanupInstruction(
            cleanup.action,
            config.programAddress,
            cleanup.rentPayer,
            cleanup.drawId,
            cleanup.target,
          );
        }
        log("transition_submitting", {
          action: submittedAction,
          drawId: submittedDrawId.toString(),
        });
        try {
          // The RPC executor first simulates to estimate resource limits. A failed
          // simulation prevents submission; successful transactions are confirmed.
          const result = await client.sendTransaction([instruction]);
          log("transition_confirmed", {
            action: submittedAction,
            drawId: submittedDrawId.toString(),
            signature: result.context.signature,
          });
        } catch (sendError) {
          let alreadyApplied: boolean;
          if (action) {
            alreadyApplied = await transitionAlreadyApplied(
              client,
              config.programAddress,
              draw.id,
              action,
            );
          } else {
            if (!cleanup) throw new Error("keeper cleanup selection disappeared");
            alreadyApplied = await cleanupAlreadyApplied(
              client,
              config.programAddress,
              cleanup.drawId,
              cleanup.action,
              cleanup.target,
            );
          }
          if (!alreadyApplied) {
            throw sendError;
          }
          log("transition_won_by_another_caller", {
            action: submittedAction,
            drawId: submittedDrawId.toString(),
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

async function findCleanupCandidate(
  client: KeeperClient,
  programAddress: Address,
  config: ReturnType<typeof decodeConfig>,
): Promise<CleanupCandidate | null> {
  const positions = await client.rpc
    .getProgramAccounts(programAddress, {
      commitment: "confirmed",
      encoding: "base64",
      filters: [{ dataSize: BigInt(PLAYER_POSITION_SIZE) }],
    })
    .send();
  for (const account of positions) {
    let position: ReturnType<typeof decodePlayerPosition>;
    try {
      position = decodePlayerPosition(decodeRpcData(account.account.data));
    } catch {
      continue;
    }
    const drawAddress = (await fateAddresses(programAddress, position.drawId)).draw;
    const response = await client.rpc
      .getAccountInfo(drawAddress, { commitment: "confirmed", encoding: "base64" })
      .send();
    if (!response.value || response.value.owner !== programAddress) continue;
    const draw = decodeDraw(decodeRpcData(response.value.data));
    const settled = draw.phase === DrawPhase.Settled;
    const voidRefunded =
      draw.phase === DrawPhase.Voided &&
      position.refundableLamports === 0n &&
      position.committedLamports === 0n;
    if ((settled || voidRefunded) && position.claimableLamports === 0n) {
      return {
        action: "close-player-position",
        drawId: position.drawId,
        rentPayer: position.rentPayer,
        target: account.pubkey,
      };
    }
  }

  const pages = await client.rpc
    .getProgramAccounts(programAddress, {
      commitment: "confirmed",
      encoding: "base64",
      filters: [{ dataSize: BigInt(WEIGHT_PAGE_SIZE) }],
    })
    .send();
  for (const account of pages) {
    let page: ReturnType<typeof decodeWeightPage>;
    try {
      page = decodeWeightPage(decodeRpcData(account.account.data));
    } catch {
      continue;
    }
    const response = await client.rpc
      .getAccountInfo(page.tree, { commitment: "confirmed", encoding: "base64" })
      .send();
    if (!response.value || response.value.owner !== programAddress) continue;
    let draw: ReturnType<typeof decodeDraw>;
    try {
      draw = decodeDraw(decodeRpcData(response.value.data));
    } catch {
      continue;
    }
    if (draw.phase === DrawPhase.Settled || draw.phase === DrawPhase.Voided) {
      return {
        action: "close-weight-page",
        drawId: draw.id,
        rentPayer: page.rentPayer,
        target: account.pubkey,
      };
    }
  }

  const draws = await client.rpc
    .getProgramAccounts(programAddress, {
      commitment: "confirmed",
      encoding: "base64",
      filters: [{ dataSize: BigInt(DRAW_SIZE) }],
    })
    .send();
  const recent = new Set(config.recentDrawIds);
  const expired = draws
    .flatMap((account) => {
      try {
        return [decodeDraw(decodeRpcData(account.account.data))];
      } catch {
        return [];
      }
    })
    .filter(
      (candidate) =>
        (candidate.phase === DrawPhase.Settled || candidate.phase === DrawPhase.Voided) &&
        candidate.playerTvlLamports === 0n &&
        candidate.outstandingPlayerClaimLamports === 0n &&
        candidate.openPlayerPositions === 0n &&
        config.currentDrawId - candidate.id > RECENT_DRAW_CAPACITY &&
        !recent.has(candidate.id),
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const draw = expired[0];
  return draw ? { action: "close-draw", drawId: draw.id, rentPayer: draw.rentPayer } : null;
}

async function findSettlementParticipants(
  client: KeeperClient,
  programAddress: Address,
  drawId: bigint,
  draw: ReturnType<typeof decodeDraw>,
) {
  const { draw: drawTree, vault: stakerTree } = await fateAddresses(programAddress, drawId);
  const vaultResponse = await client.rpc
    .getAccountInfo(stakerTree, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!vaultResponse.value || vaultResponse.value.owner !== programAddress) {
    throw new Error("Fate vault has an unexpected owner");
  }
  const vault = decodeStakerVault(decodeRpcData(vaultResponse.value.data));
  const selection = devSettlementSelection(drawId, draw.totalPlayerWeight, vault.totalShares);
  const [playerIndex, stakerIndex] = await Promise.all([
    selectLeaf(
      client,
      programAddress,
      drawTree,
      selection.side === "player" ? selection.target : 0n,
    ),
    selectLeaf(
      client,
      programAddress,
      stakerTree,
      selection.side === "staker" ? selection.target : 0n,
    ),
  ]);
  const [player, staker] = await Promise.all([
    findPositionByLeaf(client, programAddress, "player", drawId, playerIndex),
    findPositionByLeaf(client, programAddress, "staker", drawId, stakerIndex),
  ]);
  return {
    player: player.authority,
    playerIndex: player.leafIndex,
    staker: staker.authority,
    stakerIndex: staker.leafIndex,
  };
}

async function selectLeaf(
  client: KeeperClient,
  programAddress: Address,
  tree: Address,
  target: bigint,
) {
  const originalTarget = target;
  let index = 0n;
  const pages: ReturnType<typeof decodeWeightPage>[] = [];
  for (let level = 0; level < 8; level += 1) {
    const remainingBits = BigInt((8 - level) * 4);
    const prefix = level === 0 ? 0n : (index >> remainingBits) << remainingBits;
    const pageAddress = await weightPageAddress(programAddress, tree, level, prefix);
    const response = await client.rpc
      .getAccountInfo(pageAddress, { commitment: "confirmed", encoding: "base64" })
      .send();
    if (!response.value || response.value.owner !== programAddress) {
      throw new Error(`weight page is missing or has an unexpected owner: ${pageAddress}`);
    }
    const page = decodeWeightPage(decodeRpcData(response.value.data));
    pages.push(page);
    const selected = selectWeightBranch(page.weights, target);
    index |= BigInt(selected.branch) << BigInt((7 - level) * 4);
    target = selected.remainder;
  }
  const selectedIndex = selectWeightedIndex(pages, tree, originalTarget);
  if (selectedIndex !== index) throw new Error("weight path selection was not stable");
  return index;
}

async function findPositionByLeaf(
  client: KeeperClient,
  programAddress: Address,
  side: "player" | "staker",
  drawId: bigint,
  leafIndex: bigint,
) {
  const leafBytes = u64Bytes(leafIndex);
  const filters = [
    { dataSize: BigInt(side === "player" ? PLAYER_POSITION_SIZE : STAKER_POSITION_SIZE) },
    ...(side === "player"
      ? [
          {
            memcmp: {
              offset: 88n,
              bytes: getBase58Decoder().decode(u64Bytes(drawId)) as Base58EncodedBytes,
              encoding: "base58" as const,
            },
          },
        ]
      : []),
    {
      memcmp: {
        offset: BigInt(side === "player" ? 128 : 96),
        bytes: getBase58Decoder().decode(leafBytes) as Base58EncodedBytes,
        encoding: "base58" as const,
      },
    },
  ];
  const accounts = await client.rpc
    .getProgramAccounts(programAddress, {
      commitment: "confirmed",
      encoding: "base64",
      filters,
    })
    .send();
  if (accounts.length !== 1) {
    throw new Error(
      `expected one ${side} position at leaf ${leafIndex}, received ${accounts.length}`,
    );
  }
  const account = accounts[0];
  if (account.account.owner !== programAddress) {
    throw new Error(`${side} position has an unexpected owner`);
  }
  if (side === "player") {
    const position = decodePlayerPosition(decodeRpcData(account.account.data));
    if (position.leafIndex !== leafIndex || position.drawId !== drawId || position.weight === 0n) {
      throw new Error("Player position failed leaf validation");
    }
    return position;
  }
  const position = decodeStakerPosition(decodeRpcData(account.account.data));
  if (position.leafIndex !== leafIndex || position.activeShares === 0n) {
    throw new Error("Staker position failed leaf validation");
  }
  return position;
}

function u64Bytes(value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
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

async function cleanupAlreadyApplied(
  client: KeeperClient,
  programAddress: Address,
  drawId: bigint,
  _action: CleanupAction,
  target?: Address,
) {
  const addresses = await fateAddresses(programAddress, drawId);
  const response = await client.rpc
    .getAccountInfo(target ?? addresses.draw, { commitment: "confirmed", encoding: "base64" })
    .send();
  return response.value === null;
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
