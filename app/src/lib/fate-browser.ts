import { type Address, address, createSolanaRpc } from "@solana/kit";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  type ConfigAccount,
  DRAW_DISCRIMINATOR,
  DRAW_SIZE,
  type DrawAccount,
  decodeConfig,
  decodeDraw,
  fateAddresses,
} from "../../scripts/fate-client";

export type FateSnapshot = {
  config: ConfigAccount;
  draw: DrawAccount;
  addresses: {
    config: Address;
    draw: Address;
  };
};

export function browserRpcUrl() {
  return process.env.NEXT_PUBLIC_RPC_HTTP_URL?.trim() || "http://127.0.0.1:8899";
}

export function browserProgramAddress() {
  const value = process.env.NEXT_PUBLIC_FATE_PROGRAM_ID?.trim();
  return value ? address(value) : null;
}

export async function readSolBalance(walletAddress: Address) {
  const rpc = createSolanaRpc(browserRpcUrl());
  const response = await rpc.getBalance(walletAddress, { commitment: "confirmed" }).send();
  return response.value;
}

export async function readFateSnapshot(): Promise<FateSnapshot> {
  const programAddress = browserProgramAddress();
  if (!programAddress) throw new Error("NEXT_PUBLIC_FATE_PROGRAM_ID is not configured");

  const rpc = createSolanaRpc(browserRpcUrl());
  const { config: configAddress } = await fateAddresses(programAddress, 0n);
  const configData = await readAccount(rpc, configAddress, CONFIG_SIZE, CONFIG_DISCRIMINATOR);
  const config = decodeConfig(configData);
  const { draw: currentDrawAddress } = await fateAddresses(programAddress, config.currentDrawId);
  const drawData = await readAccount(rpc, currentDrawAddress, DRAW_SIZE, DRAW_DISCRIMINATOR);

  return {
    config,
    draw: decodeDraw(drawData),
    addresses: { config: configAddress, draw: currentDrawAddress },
  };
}

async function readAccount(
  rpc: ReturnType<typeof createSolanaRpc>,
  account: Address,
  expectedSize: number,
  expectedDiscriminator: number,
) {
  const response = await rpc
    .getAccountInfo(account, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (!response.value || response.value.owner !== browserProgramAddress()) {
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
