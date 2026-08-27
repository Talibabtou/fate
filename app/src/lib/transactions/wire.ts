import type { Base64EncodedWireTransaction } from "@solana/kit";

export function toBase64WireTransaction(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary) as Base64EncodedWireTransaction;
}
