import assert from "node:assert/strict";
import test from "node:test";
import { readWithRpcFallback } from "./client.ts";
import { rpcConfig, rpcReadUrls } from "./config.ts";

test("browser RPC config keeps the primary first and removes duplicate fallbacks", () => {
  const config = rpcConfig({
    NEXT_PUBLIC_RPC_HTTP_URL: "https://primary.example",
    NEXT_PUBLIC_RPC_WSS_URL: "wss://primary.example",
    NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS:
      "https://primary.example, https://backup.example, https://backup.example",
  });

  assert.deepEqual(config, {
    primaryHttpUrl: "https://primary.example",
    fallbackHttpUrls: ["https://backup.example"],
    primaryWssUrl: "wss://primary.example",
  });
  assert.deepEqual(rpcReadUrls(config), ["https://primary.example", "https://backup.example"]);
});

test("browser RPC config requires an environment-provided primary endpoint", () => {
  assert.throws(() => rpcConfig({}), /NEXT_PUBLIC_RPC_HTTP_URL is not configured/);
});

test("browser RPC reads fail over in order and stop after the first success", async () => {
  const attempted: string[] = [];
  const value = await readWithRpcFallback(
    ["https://down.example", "https://up.example"],
    async (_, url) => {
      attempted.push(url);
      if (url === "https://down.example") throw new Error("connection refused");
      return "confirmed state";
    },
  );

  assert.equal(value, "confirmed state");
  assert.deepEqual(attempted, ["https://down.example", "https://up.example"]);
});

test("browser RPC reads report every failed endpoint", async () => {
  await assert.rejects(
    readWithRpcFallback(["https://first.example", "https://second.example"], async (_, url) => {
      throw new TypeError(`${url} unavailable`);
    }),
    /first\.example: https:\/\/first\.example unavailable; https:\/\/second\.example: https:\/\/second\.example unavailable/,
  );
});

test("browser RPC reads surface non-transport failures without trying fallbacks", async () => {
  const attempted: string[] = [];
  await assert.rejects(
    readWithRpcFallback(["https://invalid.example", "https://backup.example"], async (_, url) => {
      attempted.push(url);
      throw new Error("Account is not owned by Fate");
    }),
    /Account is not owned by Fate/,
  );
  assert.deepEqual(attempted, ["https://invalid.example"]);
});
