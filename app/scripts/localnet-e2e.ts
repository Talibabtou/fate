import {
  AccountRole,
  type Address,
  address,
  addSignersToInstruction,
  createClient,
  type Instruction,
} from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { identityFromFile, payerFromFile } from "@solana/kit-plugin-signer";
import {
  decodeConfig,
  decodeDraw,
  decodePlayerPosition,
  decodeStakerPosition,
  decodeWeightPage,
  devSettlementParticipants,
  fateAddresses,
  keeperInstruction,
  participantAddresses,
} from "./fate-client.ts";

const RPC_URL = process.env.FATE_LOCALNET_RPC_URL?.trim() || "http://127.0.0.1:8899";
const PROGRAM_ADDRESS = address(required("FATE_PROGRAM_ID"));
const PAYER_KEYPAIR = required("FATE_PAYER_KEYPAIR");
const STAKER_KEYPAIR = required("FATE_STAKER_KEYPAIR");
const PLAYER_KEYPAIR = required("FATE_PLAYER_KEYPAIR");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const SOL = 1_000_000_000n;

type FateClient = Awaited<ReturnType<typeof createFateClient>>;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function createFateClient(keypairPath: string) {
  return createClient()
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

async function createDualSignerClient(feePayerPath: string, authorityPath: string) {
  return createClient()
    .use(payerFromFile(feePayerPath))
    .use(identityFromFile(authorityPath))
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
  if (!response.value) throw new Error(`missing account ${account}`);
  if (response.value.owner !== PROGRAM_ADDRESS) {
    throw new Error(`unexpected owner for ${account}: ${response.value.owner}`);
  }
  return decodeRpcData(response.value.data);
}

async function accountExists(client: FateClient, account: Address) {
  const response = await client.rpc
    .getAccountInfo(account, { commitment: "confirmed", encoding: "base64" })
    .send();
  return response.value !== null;
}

async function balance(client: FateClient, account: Address) {
  const response = await client.rpc.getBalance(account, { commitment: "confirmed" }).send();
  return BigInt(response.value);
}

async function readConfig(client: FateClient) {
  const { config } = await fateAddresses(PROGRAM_ADDRESS, 0n);
  return decodeConfig(await accountData(client, config));
}

async function readDraw(client: FateClient, drawId: bigint) {
  const { draw } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const data = await accountData(client, draw);
  return { address: draw, data, decoded: decodeDraw(data) };
}

function drawWinnerSide(data: Uint8Array) {
  const value = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(256, true);
  if (value === 1n) return "Player";
  if (value === 2n) return "Staker";
  throw new Error(`unexpected winner side ${value}`);
}

function decodeVault(data: Uint8Array) {
  if (data.length !== 56 || data[0] !== 101) throw new Error("invalid vault account");
  return {
    activeAssets: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(8, true),
    withdrawalLiability: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(
      16,
      true,
    ),
    totalShares: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(24, true),
  };
}

async function readVault(client: FateClient) {
  const { vault } = await fateAddresses(PROGRAM_ADDRESS, 0n);
  return decodeVault(await accountData(client, vault));
}

async function assertCustody(client: FateClient, drawId: bigint) {
  const { draw, vault } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const drawBalance = await balance(client, draw);
  const vaultBalance = await balance(client, vault);
  const drawAccount = decodeDraw(await accountData(client, draw));
  const vaultAccount = decodeVault(await accountData(client, vault));
  const rentDraw = await client.rpc.getMinimumBalanceForRentExemption(344n).send();
  const rentVault = await client.rpc.getMinimumBalanceForRentExemption(56n).send();
  if (
    drawBalance - BigInt(rentDraw) <
    drawAccount.playerTvlLamports + drawAccount.outstandingPlayerClaimLamports
  ) {
    throw new Error(`draw custody invariant failed for draw ${drawId}`);
  }
  if (
    vaultBalance - BigInt(rentVault) <
    vaultAccount.activeAssets + vaultAccount.withdrawalLiability
  ) {
    throw new Error("vault custody invariant failed");
  }
}

async function send(client: FateClient, label: string, instruction: Instruction) {
  const result = await client.sendTransaction([instruction]);
  console.log(`${label}: ${result.context.signature}`);
}

async function expectFailure(client: FateClient, label: string, instruction: Instruction) {
  try {
    await client.sendTransaction([instruction]);
  } catch {
    console.log(`${label}: rejected as expected`);
    return;
  }
  throw new Error(`${label}: transaction unexpectedly succeeded`);
}

function systemTransferInstruction(
  source: Address,
  destination: Address,
  amount: bigint,
): Instruction {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, amount, true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: source, role: AccountRole.WRITABLE_SIGNER },
      { address: destination, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

async function initializeInstruction(payer: Address, feeTreasury: Address) {
  const { config, draw, vault } = await fateAddresses(PROGRAM_ADDRESS, 0n);
  return makeInstruction(
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
  );
}

async function depositStakeInstruction(
  staker: Address,
  player: Address,
  amount: bigint,
  drawId = 0n,
  stakerIndex = 0n,
) {
  const { config, draw, vault } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const { stakerPosition, stakerPath } = await participantAddresses(
    PROGRAM_ADDRESS,
    drawId,
    player,
    0n,
    staker,
    stakerIndex,
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

async function depositPlayerInstruction(
  player: Address,
  staker: Address,
  amount: bigint,
  drawId = 0n,
  playerIndex = 0n,
) {
  const { config, draw, vault } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const { playerPosition, playerPath } = await participantAddresses(
    PROGRAM_ADDRESS,
    drawId,
    player,
    playerIndex,
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
    instructionData(3, amount),
  );
}

async function phaseInstruction(drawId: bigint, tag: number) {
  const { config, draw } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  return makeInstruction(
    [
      { address: config, role: AccountRole.READONLY },
      { address: draw, role: AccountRole.WRITABLE },
    ],
    instructionData(tag),
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

async function refundPlayerInstruction(player: Address, drawId: bigint, playerIndex: bigint) {
  const { config, draw } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const { playerPosition, playerPath } = await participantAddresses(
    PROGRAM_ADDRESS,
    drawId,
    player,
    playerIndex,
    player,
    0n,
  );
  return makeInstruction(
    [
      { address: player, role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: draw, role: AccountRole.WRITABLE },
      { address: playerPosition, role: AccountRole.WRITABLE },
      ...playerPath.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    instructionData(4),
  );
}

async function closePlayerPositionInstruction(
  player: Address,
  drawId: bigint,
  draw: Address,
  playerPosition: Address,
) {
  return makeInstruction(
    [
      { address: draw, role: AccountRole.WRITABLE },
      { address: playerPosition, role: AccountRole.WRITABLE },
      { address: player, role: AccountRole.WRITABLE },
    ],
    instructionData(15, drawId),
  );
}

async function requestWithdrawalInstruction(
  staker: Address,
  player: Address,
  drawId: bigint,
  shares: bigint,
  stakerIndex: bigint,
) {
  const { config, draw, vault } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const { stakerPosition, stakerPath } = await participantAddresses(
    PROGRAM_ADDRESS,
    drawId,
    player,
    0n,
    staker,
    stakerIndex,
  );
  return makeInstruction(
    [
      { address: staker, role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: draw, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: stakerPosition, role: AccountRole.WRITABLE },
      ...stakerPath.map((page) => ({ address: page, role: AccountRole.WRITABLE })),
    ],
    instructionData(2, shares),
  );
}

async function waitForLock(client: FateClient, drawId: bigint) {
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    const draw = await readDraw(client, drawId);
    const slot = await client.rpc.getSlot({ commitment: "confirmed" }).send();
    const blockTime = await client.rpc.getBlockTime(slot).send();
    if (blockTime !== null && BigInt(blockTime) >= draw.decoded.locksAt) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`draw ${drawId} did not reach its lock deadline`);
}

async function settle(
  client: FateClient,
  drawId: bigint,
  payer: Address,
  participants: { player: Address; playerIndex: bigint; staker: Address; stakerIndex: bigint },
) {
  const config = await readConfig(client);
  const instruction = await keeperInstruction(
    "settle",
    PROGRAM_ADDRESS,
    payer,
    config,
    participants,
  );
  await send(client, `settle draw ${drawId}`, instruction);
}

async function cleanupPlayers(
  client: FateClient,
  drawId: bigint,
  players: { authority: Address; leafIndex: bigint }[],
) {
  const { draw } = await fateAddresses(PROGRAM_ADDRESS, drawId);
  const playerPages = new Set<Address>();
  for (const player of players) {
    const { playerPosition, playerPath } = await participantAddresses(
      PROGRAM_ADDRESS,
      drawId,
      player.authority,
      player.leafIndex,
      player.authority,
      0n,
    );
    await send(
      client,
      `close Player position ${player.authority} draw ${drawId}`,
      await closePlayerPositionInstruction(player.authority, drawId, draw, playerPosition),
    );
    for (const page of playerPath) playerPages.add(page);
  }
  for (const [index, page] of playerPages.entries()) {
    const pageAccount = decodeWeightPage(await accountData(client, page));
    const instruction = makeInstruction(
      [
        { address: draw, role: AccountRole.WRITABLE },
        { address: page, role: AccountRole.WRITABLE },
        { address: pageAccount.rentPayer, role: AccountRole.WRITABLE },
      ],
      instructionData(16, drawId),
    );
    await send(client, `close unique Player page ${index} draw ${drawId}`, instruction);
  }
  for (const player of players) {
    const { playerPosition } = await participantAddresses(
      PROGRAM_ADDRESS,
      drawId,
      player.authority,
      player.leafIndex,
      player.authority,
      0n,
    );
    if (await accountExists(client, playerPosition))
      throw new Error("Player position was not closed");
  }
  for (const page of playerPages.keys()) {
    if (await accountExists(client, page)) throw new Error(`Player page was not closed: ${page}`);
  }
}

async function run() {
  const payerClient = await createFateClient(PAYER_KEYPAIR);
  const stakerClient = await createFateClient(STAKER_KEYPAIR);
  const playerClient = await createFateClient(PLAYER_KEYPAIR);
  const payerAuthorityClient = await createDualSignerClient(STAKER_KEYPAIR, PAYER_KEYPAIR);
  const stakerAuthorityClient = await createDualSignerClient(PAYER_KEYPAIR, STAKER_KEYPAIR);
  const payer = payerClient.payer.address;
  const staker = stakerClient.payer.address;
  const player = playerClient.payer.address;

  console.log(JSON.stringify({ rpc: RPC_URL, program: PROGRAM_ADDRESS, payer, staker, player }));

  const pauseInstruction = (authority: Address, tag: number) => {
    return fateAddresses(PROGRAM_ADDRESS, 0n).then(({ config: configAddress }) =>
      makeInstruction(
        [
          { address: authority, role: AccountRole.READONLY_SIGNER },
          { address: configAddress, role: AccountRole.WRITABLE },
        ],
        instructionData(tag),
      ),
    );
  };

  await send(
    payerClient,
    "initialize with fake Entropy accounts",
    await initializeInstruction(payer, staker),
  );
  await expectFailure(payerClient, "reinitialize", await initializeInstruction(payer, staker));
  await send(
    payerAuthorityClient,
    "pause protocol",
    addSignersToInstruction(
      [payerAuthorityClient.payer, payerAuthorityClient.identity],
      await pauseInstruction(payer, 6),
    ),
  );
  await expectFailure(
    playerClient,
    "Player deposit while paused",
    await depositPlayerInstruction(player, staker, 10_000_000n),
  );
  await expectFailure(
    stakerAuthorityClient,
    "unauthorized pause",
    addSignersToInstruction(
      [stakerAuthorityClient.payer, stakerAuthorityClient.identity],
      await pauseInstruction(staker, 6),
    ),
  );
  await send(
    payerAuthorityClient,
    "unpause protocol",
    addSignersToInstruction(
      [payerAuthorityClient.payer, payerAuthorityClient.identity],
      await pauseInstruction(payer, 7),
    ),
  );

  await send(
    stakerClient,
    "deposit 1 SOL Staker leaf 0",
    await depositStakeInstruction(staker, player, SOL, 0n, 0n),
  );
  await send(
    payerClient,
    "deposit 1 SOL Staker leaf 1",
    await depositStakeInstruction(payer, player, SOL, 0n, 1n),
  );
  await assertCustody(payerClient, 0n);

  await send(
    playerClient,
    "deposit pending Player for refund reset",
    await depositPlayerInstruction(player, staker, 10_000_000n, 0n, 0n),
  );
  let draw = await readDraw(payerClient, 0n);
  if (draw.decoded.firstPlayerAt <= 0n || draw.decoded.playerTvlLamports !== 10_000_000n) {
    throw new Error("first Player funding snapshot was not created");
  }
  await send(playerClient, "refund pending Player", await refundPlayerInstruction(player, 0n, 0n));
  draw = await readDraw(payerClient, 0n);
  if (draw.decoded.firstPlayerAt !== 0n || draw.decoded.playerTvlLamports !== 0n) {
    throw new Error("funding reset did not clear the pending draw");
  }

  await send(
    playerClient,
    "deposit 0.1 SOL Player leaf 0",
    await depositPlayerInstruction(player, staker, 100_000_000n, 0n, 0n),
  );
  await send(
    payerClient,
    "deposit 0.05 SOL Player leaf 1",
    await depositPlayerInstruction(payer, staker, 50_000_000n, 0n, 1n),
  );
  draw = await readDraw(payerClient, 0n);
  if (
    draw.decoded.stakerTvlSnapshot !== 2n * SOL ||
    draw.decoded.playerTvlLamports !== 150_000_000n
  ) {
    throw new Error("multi-wallet funding state mismatch");
  }

  const payerStakerPosition = decodeStakerPosition(
    await accountData(
      payerClient,
      (await participantAddresses(PROGRAM_ADDRESS, 0n, player, 0n, payer, 1n)).stakerPosition,
    ),
  );
  await send(
    payerClient,
    "withdraw 0.5 SOL Staker during funding",
    await requestWithdrawalInstruction(
      payer,
      player,
      0n,
      payerStakerPosition.activeShares / 2n,
      1n,
    ),
  );
  draw = await readDraw(payerClient, 0n);
  if (draw.decoded.stakerTvlSnapshot !== 1_500_000_000n) {
    throw new Error("funding withdrawal did not recalculate the Staker snapshot");
  }

  const donationBefore = await readVault(payerClient);
  const { vault: vaultAddress } = await fateAddresses(PROGRAM_ADDRESS, 0n);
  await send(
    payerClient,
    "donate 1 lamport directly to vault",
    systemTransferInstruction(payer, vaultAddress, 1n),
  );
  const donationAfter = await readVault(payerClient);
  if (
    donationAfter.activeAssets !== donationBefore.activeAssets ||
    donationAfter.totalShares !== donationBefore.totalShares
  ) {
    throw new Error("direct donation changed tracked vault accounting");
  }
  await assertCustody(payerClient, 0n);

  await send(payerClient, "activate draw 0", await phaseInstruction(0n, 5));
  draw = await readDraw(payerClient, 0n);
  if (draw.decoded.phase !== 1) throw new Error("draw 0 did not activate");
  const player0Before = decodePlayerPosition(
    await accountData(
      playerClient,
      (await participantAddresses(PROGRAM_ADDRESS, 0n, player, 0n, staker, 0n)).playerPosition,
    ),
  );
  await send(
    playerClient,
    "deposit countdown Player at 1x",
    await depositPlayerInstruction(player, staker, 10_000_000n, 0n, 0n),
  );
  const player0After = decodePlayerPosition(
    await accountData(
      playerClient,
      (await participantAddresses(PROGRAM_ADDRESS, 0n, player, 0n, staker, 0n)).playerPosition,
    ),
  );
  if (player0After.weight - player0Before.weight !== 10_000_000n) {
    throw new Error("countdown Player deposit did not receive 1x weight");
  }
  await expectFailure(
    payerClient,
    "deposit Staker after activation",
    await depositStakeInstruction(staker, player, 100_000_000n, 0n, 0n),
  );
  await expectFailure(
    payerClient,
    "withdrawal after activation",
    await requestWithdrawalInstruction(payer, player, 0n, 1n, 1n),
  );
  await expectFailure(
    playerClient,
    "refund committed Player",
    await refundPlayerInstruction(player, 0n, 0n),
  );
  await expectFailure(
    payerClient,
    "lock before countdown deadline",
    await phaseInstruction(0n, 11),
  );
  const playerParticipants0 = [
    { authority: player, leafIndex: 0n },
    { authority: payer, leafIndex: 1n },
  ];
  const stakerParticipants0 = [
    { authority: staker, leafIndex: 0n },
    { authority: payer, leafIndex: 1n },
  ];
  const settlementParticipants0 = devSettlementParticipants(
    0n,
    await Promise.all(
      playerParticipants0.map(async ({ authority, leafIndex }) =>
        decodePlayerPosition(
          await accountData(
            payerClient,
            (await participantAddresses(PROGRAM_ADDRESS, 0n, authority, leafIndex, staker, 0n))
              .playerPosition,
          ),
        ),
      ),
    ),
    await Promise.all(
      stakerParticipants0.map(async ({ authority, leafIndex }) =>
        decodeStakerPosition(
          await accountData(
            payerClient,
            (await participantAddresses(PROGRAM_ADDRESS, 0n, player, 0n, authority, leafIndex))
              .stakerPosition,
          ),
        ),
      ),
    ),
  );
  await expectFailure(
    payerClient,
    "settle before lock",
    await keeperInstruction(
      "settle",
      PROGRAM_ADDRESS,
      payer,
      await readConfig(payerClient),
      settlementParticipants0,
    ),
  );
  await waitForLock(payerClient, 0n);
  await send(payerClient, "lock draw 0", await phaseInstruction(0n, 11));
  const staleSettlement0 = await keeperInstruction(
    "settle",
    PROGRAM_ADDRESS,
    payer,
    await readConfig(payerClient),
    settlementParticipants0,
  );
  await settle(payerClient, 0n, payer, settlementParticipants0);
  await expectFailure(payerClient, "double settlement draw 0", staleSettlement0);
  draw = await readDraw(payerClient, 0n);
  if (draw.decoded.phase !== 4 || drawWinnerSide(draw.data) !== "Player")
    throw new Error("draw 0 Player settlement failed");
  console.log(`draw 0 winner side: ${drawWinnerSide(draw.data)}`);
  await assertCustody(payerClient, 0n);
  const winner0 = settlementParticipants0.player;
  const winner0Position = decodePlayerPosition(
    await accountData(
      payerClient,
      (
        await participantAddresses(
          PROGRAM_ADDRESS,
          0n,
          winner0,
          settlementParticipants0.playerIndex,
          staker,
          0n,
        )
      ).playerPosition,
    ),
  );
  if (winner0Position.claimableLamports === 0n) throw new Error("Player claim was not credited");
  const winner0Client = winner0 === payer ? payerClient : playerClient;
  await send(winner0Client, "claim Player draw 0", await claimPlayerInstruction(winner0, 0n));
  await expectFailure(
    winner0Client,
    "double claim Player draw 0",
    await claimPlayerInstruction(winner0, 0n),
  );
  await cleanupPlayers(payerClient, 0n, playerParticipants0);
  await assertCustody(payerClient, 0n);

  await send(
    stakerClient,
    "deposit 0.1 SOL Staker draw 1",
    await depositStakeInstruction(staker, player, 100_000_000n, 1n, 0n),
  );
  await send(
    playerClient,
    "deposit 0.1 SOL Player draw 1",
    await depositPlayerInstruction(player, staker, 100_000_000n, 1n, 0n),
  );
  await send(
    payerClient,
    "deposit 0.05 SOL Player draw 1",
    await depositPlayerInstruction(payer, staker, 50_000_000n, 1n, 1n),
  );
  await send(payerClient, "activate draw 1", await phaseInstruction(1n, 5));
  await send(
    payerAuthorityClient,
    "pause during activated draw 1",
    addSignersToInstruction(
      [payerAuthorityClient.payer, payerAuthorityClient.identity],
      await pauseInstruction(payer, 6),
    ),
  );
  await waitForLock(payerClient, 1n);
  await send(payerClient, "lock paused draw 1", await phaseInstruction(1n, 11));
  const playerParticipants1 = [
    { authority: player, leafIndex: 0n },
    { authority: payer, leafIndex: 1n },
  ];
  const stakerParticipants1 = [
    { authority: staker, leafIndex: 0n },
    { authority: payer, leafIndex: 1n },
  ];
  const settlementParticipants1 = devSettlementParticipants(
    1n,
    await Promise.all(
      playerParticipants1.map(async ({ authority, leafIndex }) =>
        decodePlayerPosition(
          await accountData(
            payerClient,
            (await participantAddresses(PROGRAM_ADDRESS, 1n, authority, leafIndex, staker, 0n))
              .playerPosition,
          ),
        ),
      ),
    ),
    await Promise.all(
      stakerParticipants1.map(async ({ authority, leafIndex }) =>
        decodeStakerPosition(
          await accountData(
            payerClient,
            (await participantAddresses(PROGRAM_ADDRESS, 1n, player, 0n, authority, leafIndex))
              .stakerPosition,
          ),
        ),
      ),
    ),
  );
  await settle(payerClient, 1n, payer, settlementParticipants1);
  draw = await readDraw(payerClient, 1n);
  if (draw.decoded.phase !== 4 || drawWinnerSide(draw.data) !== "Staker")
    throw new Error("draw 1 Staker settlement failed");
  console.log(`draw 1 winner side: ${drawWinnerSide(draw.data)}`);
  await send(
    payerAuthorityClient,
    "unpause after settlement",
    addSignersToInstruction(
      [payerAuthorityClient.payer, payerAuthorityClient.identity],
      await pauseInstruction(payer, 7),
    ),
  );
  await cleanupPlayers(payerClient, 1n, playerParticipants1);
  await assertCustody(payerClient, 1n);

  const draw2Player = await participantAddresses(PROGRAM_ADDRESS, 2n, player, 0n, staker, 0n);
  await send(
    playerClient,
    "deposit pending Player draw 2",
    await depositPlayerInstruction(player, staker, 10_000_000n, 2n, 0n),
  );
  const staker0Draw2 = decodeStakerPosition(
    await accountData(stakerClient, draw2Player.stakerPosition),
  );
  const staker1Draw2 = decodeStakerPosition(
    await accountData(
      payerClient,
      (await participantAddresses(PROGRAM_ADDRESS, 2n, player, 0n, payer, 1n)).stakerPosition,
    ),
  );
  let remainingStaker: Address;
  let remainingIndex: bigint;
  if (staker0Draw2.activeShares !== 0n && staker1Draw2.activeShares !== 0n) {
    await send(
      stakerClient,
      "withdraw first Staker in draw 2 funding",
      await requestWithdrawalInstruction(staker, player, 2n, staker0Draw2.activeShares, 0n),
    );
    remainingStaker = payer;
    remainingIndex = 1n;
  } else if (staker0Draw2.activeShares !== 0n) {
    remainingStaker = staker;
    remainingIndex = 0n;
  } else {
    remainingStaker = payer;
    remainingIndex = 1n;
  }
  const remainingPositionAddress = (
    await participantAddresses(PROGRAM_ADDRESS, 2n, player, 0n, remainingStaker, remainingIndex)
  ).stakerPosition;
  const remainingPosition = decodeStakerPosition(
    await accountData(payerClient, remainingPositionAddress),
  );
  const remainingStakerClient = remainingStaker === payer ? payerClient : stakerClient;
  await expectFailure(
    remainingStakerClient,
    "last Staker exit while Player funds remain",
    await requestWithdrawalInstruction(
      remainingStaker,
      player,
      2n,
      remainingPosition.activeShares,
      remainingIndex,
    ),
  );
  await send(playerClient, "refund Player draw 2", await refundPlayerInstruction(player, 2n, 0n));
  await send(
    remainingStakerClient,
    "withdraw final Staker after refund",
    await requestWithdrawalInstruction(
      remainingStaker,
      player,
      2n,
      remainingPosition.activeShares,
      remainingIndex,
    ),
  );
  const finalPosition = decodeStakerPosition(
    await accountData(payerClient, remainingPositionAddress),
  );
  if (finalPosition.activeShares !== 0n)
    throw new Error("final funding withdrawal did not clear Staker shares");
  await assertCustody(payerClient, 2n);

  console.log("LOCALNET_AUDIT_PASS");
}

await run();
