import type { Address } from "@solana/kit";
import type { SolanaRpc } from "../../../lib/rpc/client.ts";

export async function readAccount(
  rpc: SolanaRpc,
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
  const data = decodeBase64(encoded);
  if (data.length !== expectedSize || data[0] !== expectedDiscriminator) {
    throw new Error(`Invalid Fate account layout: ${account}`);
  }
  return data;
}

export async function readOptionalAccount(
  rpc: SolanaRpc,
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
  const data = decodeBase64(encoded);
  if (data.length !== expectedSize || data[0] !== expectedDiscriminator) {
    throw new Error(`Invalid Fate account layout: ${account}`);
  }
  return data;
}

export function decodeRpcData(data: readonly [string, string]) {
  if (data[1] !== "base64") throw new Error(`unexpected account encoding ${data[1]}`);
  return decodeBase64(data[0]);
}

function decodeBase64(encoded: string) {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}
