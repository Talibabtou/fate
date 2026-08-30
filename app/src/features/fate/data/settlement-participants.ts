import { type Address, type Base58EncodedBytes, getBase58Decoder } from "@solana/kit";
import {
  type DrawAccount,
  decodePlayerPosition,
  decodeStakerPosition,
  decodeStakerVault,
  decodeWeightPage,
  devSettlementSelection,
  fateAddresses,
  PLAYER_POSITION_SIZE,
  type SettlementParticipants,
  STAKER_POSITION_SIZE,
  STAKER_VAULT_DISCRIMINATOR,
  STAKER_VAULT_SIZE,
  selectWeightBranch,
  selectWeightedIndex,
  WEIGHT_PAGE_DISCRIMINATOR,
  WEIGHT_PAGE_SIZE,
  WEIGHT_TREE_DEPTH,
  weightPageAddress,
} from "../../../domain/fate/index.ts";
import { publicConfigIssues } from "../../../lib/public-config.ts";
import { readWithRpcFallback, type SolanaRpc } from "../../../lib/rpc/client.ts";
import { fateProgramAddress, rpcReadUrls } from "../../../lib/rpc/config.ts";
import { decodeRpcData, readAccount } from "./account-reader.ts";

export async function readDevSettlementParticipants(
  draw: DrawAccount,
): Promise<SettlementParticipants> {
  const configIssues = publicConfigIssues();
  if (configIssues.length > 0) {
    throw new Error(configIssues.join("; "));
  }
  const programAddress = fateProgramAddress();
  if (!programAddress) throw new Error("Fate program ID is invalid");

  return readWithRpcFallback(rpcReadUrls(), async (rpc) => {
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
async function selectLeaf(rpc: SolanaRpc, programAddress: Address, tree: Address, target: bigint) {
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
  rpc: SolanaRpc,
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
