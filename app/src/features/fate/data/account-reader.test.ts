import assert from "node:assert/strict";
import test from "node:test";
import { type Address, address } from "@solana/kit";
import { readAccountsAtConfirmedSlot } from "./account-reader.ts";

const fateProgram = address("11111111111111111111111111111111");

test("account batches preserve one confirmed context slot and minimum slot", async () => {
  const requested: { addresses: readonly Address[]; minContextSlot?: bigint } = { addresses: [] };
  const rpc = {
    getMultipleAccounts(addresses: readonly Address[], config: { minContextSlot?: bigint }) {
      requested.addresses = addresses;
      requested.minContextSlot = config.minContextSlot;
      return {
        send: async () => ({
          context: { slot: 42n },
          value: [{ owner: fateProgram, data: ["AQID", "base64"] }],
        }),
      };
    },
  };

  const result = await readAccountsAtConfirmedSlot(
    rpc as never,
    [{ account: fateProgram, expectedSize: 3, expectedDiscriminator: 1 }],
    fateProgram,
    40n,
  );

  assert.deepEqual(requested, { addresses: [fateProgram], minContextSlot: 40n });
  assert.equal(result.slot, 42n);
  assert.deepEqual(result.data[0], Uint8Array.from([1, 2, 3]));
});
