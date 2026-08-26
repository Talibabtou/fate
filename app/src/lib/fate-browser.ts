import {
  type Address,
  address,
  type Base58EncodedBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getBase58Decoder,
} from "@solana/kit";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  type ConfigAccount,
  DRAW_DISCRIMINATOR,
  DRAW_SIZE,
  type DrawAccount,
  decodeConfig,
  decodeDraw,
  decodePlayerPosition,
  decodeStakerPosition,
  decodeStakerVault,
  decodeWeightPage,
  devSettlementSelection,
  fateAddresses,
  PLAYER_POSITION_DISCRIMINATOR,
  PLAYER_POSITION_SIZE,
  type PlayerPositionAccount,
  playerPositionAddress,
  type SettlementParticipants,
  STAKER_POSITION_DISCRIMINATOR,
  STAKER_POSITION_SIZE,
  STAKER_VAULT_DISCRIMINATOR,
  STAKER_VAULT_SIZE,
  type StakerPositionAccount,
  type StakerVaultAccount,
  selectWeightBranch,
  selectWeightedIndex,
  stakerPositionAddress,
  WEIGHT_PAGE_DISCRIMINATOR,
  WEIGHT_PAGE_SIZE,
  WEIGHT_TREE_DEPTH,
  weightPageAddress,
} from "../../scripts/fate-client.ts";

export type BrowserRpcConfig = {
  primaryHttpUrl: string;
  fallbackHttpUrls: string[];
  primaryWssUrl: string | null;
};

type BrowserEnv = {
  NEXT_PUBLIC_RPC_HTTP_URL?: string;
  NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS?: string;
  NEXT_PUBLIC_RPC_WSS_URL?: string;
};

export type FateSnapshot = {
  config: ConfigAccount;
  draw: DrawAccount;
  vault: StakerVaultAccount;
  stakerPosition: StakerPositionAccount | null;
  playerPosition: PlayerPositionAccount | null;
  addresses: {
    config: Address;
    draw: Address;
    vault: Address;
    stakerPosition: Address | null;
    playerPosition: Address | null;
  };
};

export function browserRpcConfig(env: BrowserEnv = process.env as BrowserEnv): BrowserRpcConfig {
  const primaryHttpUrl = env.NEXT_PUBLIC_RPC_HTTP_URL?.trim();
  if (!primaryHttpUrl) throw new Error("NEXT_PUBLIC_RPC_HTTP_URL is not configured");
  const fallbackHttpUrls = (env.NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => value !== primaryHttpUrl && values.indexOf(value) === index);
  const primaryWssUrl = env.NEXT_PUBLIC_RPC_WSS_URL?.trim() || null;

  return { primaryHttpUrl, fallbackHttpUrls, primaryWssUrl };
}

export function browserRpcUrl() {
  return browserRpcConfig().primaryHttpUrl;
}

export function browserRpcReadUrls(config = browserRpcConfig()) {
  return [config.primaryHttpUrl, ...config.fallbackHttpUrls];
}

export function browserRpcSubscriptionsUrl() {
  return browserRpcConfig().primaryWssUrl;
}

export function browserProgramAddress() {
  const value = process.env.NEXT_PUBLIC_FATE_PROGRAM_ID?.trim();
  return value ? address(value) : null;
}

export async function readWithRpcFallback<T>(
  urls: readonly string[],
  read: (rpc: ReturnType<typeof createSolanaRpc>, url: string) => Promise<T>,
) {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      return await read(createSolanaRpc(url), url);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Fate RPC read failed on all configured endpoints: ${failures.join("; ")}`);
}

export async function readSolBalance(walletAddress: Address) {
  return readWithRpcFallback(browserRpcReadUrls(), async (rpc) => {
    const response = await rpc.getBalance(walletAddress, { commitment: "confirmed" }).send();
    return response.value;
  });
}

/**
 * Resolve the deterministic devnet settlement participants from the weighted
 * trees. The RPC lookup is indexed by the selected leaf; settlement never
 * requires downloading every participant position.
 */
export async function readDevSettlementParticipants(
  draw: DrawAccount,
): Promise<SettlementParticipants> {
  const programAddress = browserProgramAddress();
  if (!programAddress) throw new Error("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured");

  return readWithRpcFallback(browserRpcReadUrls(), async (rpc) => {
    const { draw: drawTree, vault: vaultAddress } = await fateAddresses(programAddress, draw.id);
    const vault = decodeStakerVault(
      await readAccount(
        rpc,
        vaultAddress,
        programAddress,
        STAKER_VAULT_SIZE,
        STAKER_VAULT_DISCRIMINATOR,
      ),
    );
    const selection = devSettlementSelection(draw.id, draw.totalPlayerWeight, vault.totalShares);
    const [playerIndex, stakerIndex] = await Promise.all([
      selectLeaf(
        rpc,
        programAddress,
        drawTree,
        selection.side === "player" ? selection.target : 0n,
      ),
      selectLeaf(
        rpc,
        programAddress,
        vaultAddress,
        selection.side === "staker" ? selection.target : 0n,
      ),
    ]);
    const [player, staker] = await Promise.all([
      findPositionByLeaf(rpc, programAddress, "player", draw.id, playerIndex),
      findPositionByLeaf(rpc, programAddress, "staker", draw.id, stakerIndex),
    ]);
    return {
      player: player.authority,
      playerIndex: player.leafIndex,
      staker: staker.authority,
      stakerIndex: staker.leafIndex,
    };
  });
}

export async function readFateSnapshot(walletAddress?: Address): Promise<FateSnapshot> {
  const programAddress = browserProgramAddress();
  if (!programAddress) throw new Error("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured");

  return readWithRpcFallback(browserRpcReadUrls(), async (rpc) => {
    const { config: configAddress } = await fateAddresses(programAddress, 0n);
    const configData = await readAccount(
      rpc,
      configAddress,
      programAddress,
      CONFIG_SIZE,
      CONFIG_DISCRIMINATOR,
    );
    const config = decodeConfig(configData);
    const { draw: currentDrawAddress, vault: vaultAddress } = await fateAddresses(
      programAddress,
      config.currentDrawId,
    );
    const drawData = await readAccount(
      rpc,
      currentDrawAddress,
      programAddress,
      DRAW_SIZE,
      DRAW_DISCRIMINATOR,
    );

    const [vaultData, stakerPositionAddressValue, playerPositionAddressValue] = await Promise.all([
      readAccount(rpc, vaultAddress, programAddress, STAKER_VAULT_SIZE, STAKER_VAULT_DISCRIMINATOR),
      walletAddress ? stakerPositionAddress(programAddress, walletAddress) : Promise.resolve(null),
      walletAddress
        ? playerPositionAddress(programAddress, config.currentDrawId, walletAddress)
        : Promise.resolve(null),
    ]);
    const [stakerPositionData, playerPositionData] = await Promise.all([
      stakerPositionAddressValue
        ? readOptionalAccount(
            rpc,
            stakerPositionAddressValue,
            programAddress,
            STAKER_POSITION_SIZE,
            STAKER_POSITION_DISCRIMINATOR,
          )
        : Promise.resolve(null),
      playerPositionAddressValue
        ? readOptionalAccount(
            rpc,
            playerPositionAddressValue,
            programAddress,
            PLAYER_POSITION_SIZE,
            PLAYER_POSITION_DISCRIMINATOR,
          )
        : Promise.resolve(null),
    ]);

    return {
      config,
      draw: decodeDraw(drawData),
      vault: decodeStakerVault(vaultData),
      stakerPosition: stakerPositionData ? decodeStakerPosition(stakerPositionData) : null,
      playerPosition: playerPositionData ? decodePlayerPosition(playerPositionData) : null,
      addresses: {
        config: configAddress,
        draw: currentDrawAddress,
        vault: vaultAddress,
        stakerPosition: stakerPositionAddressValue,
        playerPosition: playerPositionAddressValue,
      },
    };
  });
}

export async function subscribeToFateAccounts(
  accounts: readonly Address[],
  onNotification: () => void,
  signal: AbortSignal,
) {
  const wssUrl = browserRpcSubscriptionsUrl();
  if (!wssUrl || accounts.length === 0) return;

  const subscriptions = createSolanaRpcSubscriptions(wssUrl);
  const streams = await Promise.all(
    accounts.map((account) =>
      subscriptions
        .accountNotifications(account, { commitment: "confirmed", encoding: "base64" })
        .subscribe({ abortSignal: signal }),
    ),
  );

  await Promise.race(
    streams.map(async (stream) => {
      for await (const _notification of stream) {
        onNotification();
      }
    }),
  );

  if (!signal.aborted) throw new Error("Fate RPC subscription ended");
}

async function readAccount(
  rpc: ReturnType<typeof createSolanaRpc>,
  account: Address,
  programAddress: Address,
  expectedSize: number,
  expectedDiscriminator: number,
) {
  const response = await rpc
    .getAccountInfo(account, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!response.value || response.value.owner !== programAddress) {
    throw new Error(`Account is missing or not owned by Fate: ${account}`);
  }
  const [encoded, encoding] = response.value.data;
  if (encoding !== "base64") throw new Error("Unexpected account encoding");
  const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (data.length !== expectedSize || data[0] !== expectedDiscriminator) {
    throw new Error(`Invalid Fate account layout: ${account}`);
  }
  return data;
}

async function readOptionalAccount(
  rpc: ReturnType<typeof createSolanaRpc>,
  account: Address,
  programAddress: Address,
  expectedSize: number,
  expectedDiscriminator: number,
) {
  const response = await rpc
    .getAccountInfo(account, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!response.value) return null;
  if (response.value.owner !== programAddress) {
    throw new Error(`Account is not owned by Fate: ${account}`);
  }
  const [encoded, encoding] = response.value.data;
  if (encoding !== "base64") throw new Error("Unexpected account encoding");
  const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (data.length !== expectedSize || data[0] !== expectedDiscriminator) {
    throw new Error(`Invalid Fate account layout: ${account}`);
  }
  return data;
}

async function selectLeaf(
  rpc: ReturnType<typeof createSolanaRpc>,
  programAddress: Address,
  tree: Address,
  target: bigint,
) {
  const originalTarget = target;
  let index = 0n;
  const pages: ReturnType<typeof decodeWeightPage>[] = [];
  for (let level = 0; level < WEIGHT_TREE_DEPTH; level += 1) {
    const remainingBits = BigInt((WEIGHT_TREE_DEPTH - level) * 4);
    const prefix = level === 0 ? 0n : (index >> remainingBits) << remainingBits;
    const pageAddress = await weightPageAddress(programAddress, tree, level, prefix);
    const page = decodeWeightPage(
      await readAccount(
        rpc,
        pageAddress,
        programAddress,
        WEIGHT_PAGE_SIZE,
        WEIGHT_PAGE_DISCRIMINATOR,
      ),
    );
    pages.push(page);
    const selected = selectWeightBranch(page.weights, target);
    index |= BigInt(selected.branch) << BigInt((WEIGHT_TREE_DEPTH - 1 - level) * 4);
    target = selected.remainder;
  }
  const selectedIndex = selectWeightedIndex(pages, tree, originalTarget);
  if (selectedIndex !== index) throw new Error("weight path selection was not stable");
  return index;
}

async function findPositionByLeaf(
  rpc: ReturnType<typeof createSolanaRpc>,
  programAddress: Address,
  side: "player" | "staker",
  drawId: bigint,
  leafIndex: bigint,
) {
  const filters = [
    { dataSize: BigInt(side === "player" ? PLAYER_POSITION_SIZE : STAKER_POSITION_SIZE) },
    ...(side === "player"
      ? [
          {
            memcmp: {
              offset: 88n,
              bytes: encodeU64ForMemcmp(drawId),
              encoding: "base58" as const,
            },
          },
        ]
      : []),
    {
      memcmp: {
        offset: BigInt(side === "player" ? 128 : 96),
        bytes: encodeU64ForMemcmp(leafIndex),
        encoding: "base58" as const,
      },
    },
  ];
  const accounts = await rpc
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

function encodeU64ForMemcmp(value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return getBase58Decoder().decode(bytes) as Base58EncodedBytes;
}

function decodeRpcData(data: readonly [string, string]) {
  if (data[1] !== "base64") throw new Error(`unexpected account encoding ${data[1]}`);
  return Uint8Array.from(atob(data[0]), (character) => character.charCodeAt(0));
}
