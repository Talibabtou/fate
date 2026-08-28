import assert from "node:assert/strict";
import test from "node:test";
import { readPublicConfig } from "./public-config.ts";

test("public config normalizes all browser environment variables", () => {
  assert.deepEqual(
    readPublicConfig({
      NEXT_PUBLIC_RPC_HTTP_URL: " https://primary.example ",
      NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS: " https://backup.example,https://second.example ",
      NEXT_PUBLIC_RPC_WSS_URL: " wss://primary.example ",
      NEXT_PUBLIC_PRIVY_APP_ID: " privy-app-id ",
      NEXT_PUBLIC_SOLANA_NETWORK: " devnet ",
      NEXT_PUBLIC_FATE_PROGRAM_ID: " FateProgram11111111111111111111111111111111111 ",
    }),
    {
      rpcHttpUrl: "https://primary.example",
      rpcFallbackHttpUrls: ["https://backup.example", "https://second.example"],
      rpcWssUrl: "wss://primary.example",
      privyAppId: "privy-app-id",
      network: "devnet",
      fateProgramId: "FateProgram11111111111111111111111111111111111",
    },
  );
});

test("public config represents blank optional values as null", () => {
  assert.deepEqual(
    readPublicConfig({
      NEXT_PUBLIC_RPC_HTTP_URL: "",
      NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS: "",
      NEXT_PUBLIC_RPC_WSS_URL: "  ",
      NEXT_PUBLIC_PRIVY_APP_ID: undefined,
      NEXT_PUBLIC_SOLANA_NETWORK: undefined,
      NEXT_PUBLIC_FATE_PROGRAM_ID: undefined,
    }),
    {
      rpcHttpUrl: null,
      rpcFallbackHttpUrls: [],
      rpcWssUrl: null,
      privyAppId: null,
      network: null,
      fateProgramId: null,
    },
  );
});
