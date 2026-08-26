import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AccountRole, address, createClient, type Instruction } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { payerFromFile } from "@solana/kit-plugin-signer";
import { fateAddresses } from "./fate-client.ts";

const envPath = resolve(import.meta.dirname, "../../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const rpcUrl = process.env.FATE_DEVNET_RPC_HTTP_URL?.trim() || "https://api.devnet.solana.com";
const programAddress = address(required("NEXT_PUBLIC_FATE_PROGRAM_ID"));
const payerPath = required("FATE_DEVNET_PAYER_KEYPAIR");
const systemProgram = address("11111111111111111111111111111111");

const client = await createClient()
  .use(payerFromFile(payerPath))
  .use(
    solanaRpc({
      rpcUrl,
      skipPreflight: false,
      transactionConfig: { estimateResourceLimits: true, version: 0 },
      maxConcurrency: 1,
    }),
  );

const payer = client.payer.address;
const { config, vault, draw } = await fateAddresses(programAddress, 0n);

for (const [name, account] of [
  ["config", config],
  ["vault", vault],
  ["draw", draw],
] as const) {
  const response = await client.rpc
    .getAccountInfo(account, { commitment: "confirmed", encoding: "base64" })
    .send();
  if (response.value) throw new Error(`${name} account already exists: ${account}`);
}

const instruction: Instruction = {
  programAddress,
  accounts: [
    { address: payer, role: AccountRole.WRITABLE_SIGNER },
    { address: payer, role: AccountRole.READONLY_SIGNER },
    { address: payer, role: AccountRole.READONLY },
    { address: systemProgram, role: AccountRole.READONLY },
    { address: systemProgram, role: AccountRole.READONLY },
    { address: config, role: AccountRole.WRITABLE },
    { address: vault, role: AccountRole.WRITABLE },
    { address: draw, role: AccountRole.WRITABLE },
    { address: systemProgram, role: AccountRole.READONLY },
  ],
  data: new Uint8Array([0]),
};

const plan = {
  cluster: "devnet",
  rpcUrl,
  program: programAddress,
  feePayer: payer,
  feeTreasury: payer,
  accountsCreated: { config, vault, draw },
  randomness: "deterministic dev-randomness",
};

if (!process.argv.includes("--send")) {
  console.log(JSON.stringify({ ...plan, mode: "plan-only", note: "no transaction sent" }, null, 2));
  process.exit(0);
}

const result = await client.sendTransaction([instruction]);
console.log(
  JSON.stringify({ ...plan, mode: "sent", signature: result.context.signature }, null, 2),
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
