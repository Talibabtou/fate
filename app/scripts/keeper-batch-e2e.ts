import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { AccountRole, type Address, address, createClient, type Instruction } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { payerFromFile } from "@solana/kit-plugin-signer";
import {
  type ConfigAccount,
  type DrawAccount,
  decodeConfig,
  decodeDraw,
  fateAddresses,
  participantAddresses,
} from "./fate-client.ts";

const envPath = resolve(import.meta.dirname, "../../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const RPC_URL = process.env.FATE_LOCALNET_RPC_URL?.trim() || "http://127.0.0.1:8899";
const PROGRAM_ADDRESS = address(required("FATE_PROGRAM_ID"));
const PAYER_KEYPAIR = required("FATE_PAYER_KEYPAIR");
const STAKER_KEYPAIR = required("FATE_STAKER_KEYPAIR");
const PLAYER_KEYPAIR = required("FATE_PLAYER_KEYPAIR");
const KEEPER_KEYPAIR = required("KEEPER_KEYPAIR_PATH");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const SOL = 1_000_000_000n;
const PLAYER_DEPOSIT = 100_000_000n;

type FateClient = Awaited<ReturnType<typeof createFateClient>>;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function createFateClient(keypairPath: string) {
  return await createClient()
    .use(payerFromFile(keypairPath))
    .use(
      solanaRpc({
        rpcUrl: RPC_URL,
        skipPreflight: false,
        transactionConfig: { estimateResourceLimits: true, version: 0 },
        maxConcurrency: 1,
      }),
    );
}

function u64Bytes(value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function instructionData(tag: number, value?: bigint) {
  const data = new Uint8Array(value === undefined ? 1 : 9);
  data[0] = tag;
  if (value !== undefined) data.set(u64Bytes(value), 1);
  return data;
}

function makeInstruction(accounts: Instruction["accounts"], data: Uint8Array): Instruction {
  return { programAddress: PROGRAM_ADDRESS, accounts, data };
}

function decodeRpcData(data: readonly [string, string]) {
  if (data[1] !== "base64") throw new Error(`unexpected account encoding ${data[1]}`);
  return new Uint8Array(Buffer.from(data[0], "base64"));
}

async function accountData(client: FateClient, account: Address) {
  const response = await client.rpc
    .getAccountInfo(account, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!response.value || response.value.owner !== PROGRAM_ADDRESS) {
    throw new Error(`invalid Fate account ${account}`);
  }
  return decodeRpcData(response.value.data);
}

async function readConfig(client: FateClient): Promise<ConfigAccount> {
  const { config } = await fateAddresses(PROGRAM_ADDRESS, 0n);
  return decodeConfig(await accountData(client, config));
}

async function readDraw(client: FateClient, drawId: bigint): Promise<DrawAccount> {
  const { draw } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  return decodeDraw(await accountData(client, draw));
}

function initializeInstruction(payer: Address, feeTreasury: Address) {
  return fateAddresses(PROGRAM_ADDRESS, 0n).then(({ config, draw, vault }) =>
    makeInstruction(
      [
        { address: payer, role: AccountRole.WRITABLE_SIGNER },
        { address: payer, role: AccountRole.READONLY_SIGNER },
        { address: feeTreasury, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        { address: config, role: AccountRole.WRITABLE },
        { address: vault, role: AccountRole.WRITABLE },
        { address: draw, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ],
      instructionData(0),
    ),
  );
}

async function depositStakeInstruction(staker: Address, player: Address, amount: bigint) {
  const { config, draw, vault } = await fateAddresses(PROGRAM_ADDRESS, 0n);
  const { stakerPosition, stakerPath } = await participantAddresses(
    PROGRAM_ADDRESS,
    0n,
    player,
    0n,
    staker,
    0n,
  );
  return makeInstruction(
    [
      { address: staker, role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: draw, role: AccountRole.READONLY },
      { address: vault, role: AccountRole.WRITABLE },
      { address: stakerPosition, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ...stakerPath.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    instructionData(1, amount),
  );
}

async function depositPlayerInstruction(player: Address, staker: Address, drawId: bigint) {
  const { config, draw, vault } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const { playerPosition, playerPath } = await participantAddresses(
    PROGRAM_ADDRESS,
    drawId,
    player,
    0n,
    staker,
    0n,
  );
  return makeInstruction(
    [
      { address: player, role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: draw, role: AccountRole.WRITABLE },
      { address: playerPosition, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ...playerPath.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    instructionData(3, PLAYER_DEPOSIT),
  );
}

async function claimPlayerInstruction(player: Address, drawId: bigint) {
  const { draw } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const { playerPosition } = await participantAddresses(
    PROGRAM_ADDRESS,
    drawId,
    player,
    0n,
    player,
    0n,
  );
  return makeInstruction(
    [
      { address: player, role: AccountRole.WRITABLE_SIGNER },
      { address: draw, role: AccountRole.WRITABLE },
      { address: playerPosition, role: AccountRole.WRITABLE },
    ],
    instructionData(8, drawId),
  );
}

async function send(client: FateClient, instruction: Instruction) {
  return client.sendTransaction([instruction]);
}

async function waitForLock(client: FateClient, drawId: bigint) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const draw = await readDraw(client, drawId);
    const slot = await client.rpc.getSlot({ commitment: "confirmed" }).send();
    const blockTime = await client.rpc.getBlockTime(slot).send();
    if (blockTime !== null && BigInt(blockTime) >= draw.locksAt) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`draw ${drawId} did not reach its lock deadline`);
}

async function runKeeperOnce(observeOnly = false) {
  const args = ["--experimental-strip-types", "app/scripts/keeper.ts", "--once"];
  if (observeOnly) args.push("--observe-only");
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KEEPER_CLUSTER: "localnet",
      KEEPER_RPC_HTTP_URL: RPC_URL,
      NEXT_PUBLIC_FATE_PROGRAM_ID: PROGRAM_ADDRESS,
      KEEPER_KEYPAIR_PATH: KEEPER_KEYPAIR,
      KEEPER_MIN_BALANCE_LAMPORTS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`keeper failed: ${stderr || stdout}`);
  if (!stdout.includes("transition_confirmed") && !stdout.includes("action_due")) {
    throw new Error(`keeper made no observable progress: ${stdout}`);
  }
  return stdout;
}

async function drainCleanup() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const output = await runKeeperOnce();
    if (output.includes("no_action_due")) return;
  }
  throw new Error("keeper cleanup did not converge");
}

async function run() {
  const payerClient = await createFateClient(PAYER_KEYPAIR);
  const stakerClient = await createFateClient(STAKER_KEYPAIR);
  const playerClient = await createFateClient(PLAYER_KEYPAIR);
  const payer = payerClient.payer.address;
  const staker = stakerClient.payer.address;
  const player = playerClient.payer.address;

  await send(payerClient, await initializeInstruction(payer, staker));
  await send(stakerClient, await depositStakeInstruction(staker, player, SOL));

  const observed: string[] = [];
  for (let expectedDraw = 0n; expectedDraw < 12n; expectedDraw += 1n) {
    const config = await readConfig(payerClient);
    if (config.currentDrawId !== expectedDraw) {
      throw new Error(`expected draw ${expectedDraw}, got ${config.currentDrawId}`);
    }
    await send(playerClient, await depositPlayerInstruction(player, staker, expectedDraw));
    observed.push(await runKeeperOnce(true));
    observed.push(await runKeeperOnce());
    await waitForLock(payerClient, expectedDraw);
    observed.push(await runKeeperOnce());
    observed.push(await runKeeperOnce());

    const settled = await readDraw(payerClient, expectedDraw);
    if (settled.phase !== 4) throw new Error(`draw ${expectedDraw} was not settled`);
    if (expectedDraw % 2n === 0n) {
      await send(playerClient, await claimPlayerInstruction(player, expectedDraw));
    }
  }

  const config = await readConfig(payerClient);
  if (config.currentDrawId !== 12n || config.recentDrawIds.length !== 10) {
    throw new Error("recent draw rollover did not retain the latest ten draws");
  }
  await drainCleanup();
  if (observed.length < 48) throw new Error("keeper restart coverage was incomplete");
  console.log(
    JSON.stringify({
      KEEPER_BATCH_PASS: true,
      draws: 12,
      keeperRestarts: observed.length,
      recentDraws: config.recentDrawIds.map((drawId) => drawId.toString()),
    }),
  );
}

await run();
