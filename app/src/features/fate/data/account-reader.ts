import type { Address } from "@solana/kit";
import { NonRetryableRpcReadError, type SolanaRpc } from "../../../lib/rpc/client.ts";

export type AccountExpectation = {
  account: Address;
  expectedSize: number;
  expectedDiscriminator: number;
  optional?: boolean;
};

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
    throw new NonRetryableRpcReadError(`Account is missing or not owned by Fate: ${account}`);
  }
  const [encoded, encoding] = response.value.data;
  if (encoding !== "base64") throw new NonRetryableRpcReadError("Unexpected account encoding");
  const data = decodeBase64(encoded);
  if (data.length !== expectedSize || data[0] !== expectedDiscriminator) {
    throw new NonRetryableRpcReadError(`Invalid Fate account layout: ${account}`);
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
    throw new NonRetryableRpcReadError(`Account is not owned by Fate: ${account}`);
  }
  const [encoded, encoding] = response.value.data;
  if (encoding !== "base64") throw new NonRetryableRpcReadError("Unexpected account encoding");
  const data = decodeBase64(encoded);
  if (data.length !== expectedSize || data[0] !== expectedDiscriminator) {
    throw new NonRetryableRpcReadError(`Invalid Fate account layout: ${account}`);
  }
  return data;
}

export async function readAccountsAtConfirmedSlot(
  rpc: SolanaRpc,
  expectations: readonly AccountExpectation[],
  programAddress: Address,
  minContextSlot?: bigint,
) {
  const response = await rpc
    .getMultipleAccounts(
      expectations.map(({ account }) => account),
      {
        commitment: "confirmed",
        encoding: "base64",
        ...(minContextSlot === undefined ? {} : { minContextSlot }),
      },
    )
    .send();

  if (response.value.length !== expectations.length) {
    throw new NonRetryableRpcReadError("Fate RPC returned an incomplete account batch");
  }

  return {
    slot: response.context.slot,
    data: response.value.map((value, index) => {
      const expectation = expectations[index];
      if (!value) {
        if (expectation.optional) return null;
        throw new NonRetryableRpcReadError(
          `Account is missing or not owned by Fate: ${expectation.account}`,
        );
      }
      if (value.owner !== programAddress) {
        throw new NonRetryableRpcReadError(`Account is not owned by Fate: ${expectation.account}`);
      }
      const [encoded, encoding] = value.data;
      if (encoding !== "base64") {
        throw new NonRetryableRpcReadError("Unexpected account encoding");
      }
      const accountData = decodeBase64(encoded);
      if (
        accountData.length !== expectation.expectedSize ||
        accountData[0] !== expectation.expectedDiscriminator
      ) {
        throw new NonRetryableRpcReadError(`Invalid Fate account layout: ${expectation.account}`);
      }
      return accountData;
    }),
  };
}

export function decodeRpcData(data: readonly [string, string]) {
  if (data[1] !== "base64") {
    throw new NonRetryableRpcReadError(`unexpected account encoding ${data[1]}`);
  }
  return decodeBase64(data[0]);
}

function decodeBase64(encoded: string) {
  try {
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    throw new NonRetryableRpcReadError("Invalid base64 account data");
  }
}
