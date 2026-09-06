import assert from "node:assert/strict";
import test from "node:test";
import { isWalletRejection, transactionErrorKind } from "./errors.ts";

test("classifies wallet rejection separately from transaction failure", () => {
  assert.equal(isWalletRejection(new Error("User rejected the request")), true);
  assert.equal(transactionErrorKind(new Error("User rejected the request")), "rejected");
  assert.equal(transactionErrorKind(new Error("custom program error")), "failed");
});

test("classifies blockhash expiry and timeout for retry guidance", () => {
  assert.equal(transactionErrorKind(new Error("blockhash not found")), "blockhash-expired");
  assert.equal(transactionErrorKind(new Error("confirmation timeout")), "timed-out");
});
