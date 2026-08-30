import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicConfig, publicConfigIssues, readPublicConfig } from "./public-config.ts";

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

test("public config reports missing required runtime values", () => {
  assert.deepEqual(publicConfigIssues({}), [
    "NEXT_PUBLIC_SOLANA_NETWORK is not configured",
    "NEXT_PUBLIC_RPC_HTTP_URL is not configured",
    "NEXT_PUBLIC_FATE_PROGRAM_ID is not configured",
  ]);
});

test("public config reports invalid network, endpoints, and program address", () => {
  assert.deepEqual(
    publicConfigIssues({
      NEXT_PUBLIC_SOLANA_NETWORK: "preview",
      NEXT_PUBLIC_RPC_HTTP_URL: "ftp://rpc.example",
      NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS: "https://valid.example,not-a-url",
      NEXT_PUBLIC_RPC_WSS_URL: "https://rpc.example",
      NEXT_PUBLIC_FATE_PROGRAM_ID: "not-a-solana-address",
    }),
    [
      "NEXT_PUBLIC_SOLANA_NETWORK must be localnet, devnet, testnet, mainnet, or mainnet-beta",
      "NEXT_PUBLIC_RPC_HTTP_URL must be a valid http(s) URL",
      "RPC fallback URL must be a valid http(s) URL: not-a-url",
      "NEXT_PUBLIC_RPC_WSS_URL must be a valid ws(s) URL",
      "NEXT_PUBLIC_FATE_PROGRAM_ID must be a valid Solana address",
    ],
  );
});

test("public config assertion returns normalized values when valid", () => {
  assert.equal(
    assertPublicConfig({
      NEXT_PUBLIC_SOLANA_NETWORK: "devnet",
      NEXT_PUBLIC_RPC_HTTP_URL: "https://rpc.example",
      NEXT_PUBLIC_FATE_PROGRAM_ID: "11111111111111111111111111111111",
    }).fateProgramId,
    "11111111111111111111111111111111",
  );
});
