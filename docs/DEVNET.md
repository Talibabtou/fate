# Devnet runbook

Devnet uses the deterministic `dev-randomness` artifact so the full custody
loop can be tested before the mainnet Entropy integration exists. That fixture
is not a fairness claim and must never be deployed as the mainnet artifact.

## Accounts

Keep these roles separate when possible:

- deployer and upgrade authority;
- fee treasury;
- keeper fee payer;
- Staker and Player test wallets.

The Solana CLI wallet at `~/.config/solana/id.json` is suitable as a devnet
deployer only after its public address, balance, and intended upgrade authority
have been reviewed. Never copy its JSON into the repository or a `.env` file.

Set the devnet values in the ignored root `.env.local`:

```text
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_PRIVY_APP_ID=<Privy app ID>
NEXT_PUBLIC_FATE_PROGRAM_ID=<program keypair public address>
NEXT_PUBLIC_RPC_HTTP_URL=https://api.devnet.solana.com
NEXT_PUBLIC_RPC_WSS_URL=wss://api.devnet.solana.com
NEXT_PUBLIC_RPC_FALLBACK_HTTP_URLS=<optional comma-separated HTTPS RPCs>

FATE_DEVNET_RPC_HTTP_URL=https://api.devnet.solana.com
FATE_DEVNET_RPC_WSS_URL=wss://api.devnet.solana.com
FATE_DEVNET_PAYER_KEYPAIR=/Users/<you>/.config/solana/id.json
FATE_DEVNET_TREASURY_ADDRESS=<separate treasury public address>

# Keeper uses these existing names. Keep its key separate from every other role.
KEEPER_CLUSTER=devnet
KEEPER_RPC_HTTP_URL=https://api.devnet.solana.com
KEEPER_RPC_WSS_URL=wss://api.devnet.solana.com
KEEPER_KEYPAIR_PATH=/absolute/path/to/devnet-keeper-keypair.json
KEEPER_MIN_BALANCE_LAMPORTS=80000000
```

`pnpm devnet:config` checks the browser RPC pair and fallback URLs. It does
not sign, deploy, initialize, or fund anything.

## Build and deploy

Build the normal five-minute deterministic devnet artifact immediately before
deployment:

```bash
pnpm program:build:devnet
NO_DNA=1 solana-keygen pubkey target/deploy/fate-keypair.json
shasum -a 256 target/deploy/fate.so
pnpm devnet:preflight
```

The preflight is read-only. It verifies the deployer and keeper keypair files
without printing private material, checks role separation and program-ID
alignment, reads devnet balances, and prints the artifact hash.

Review the cluster, program address, deployer address, upgrade authority,
binary hash, and estimated fee before running the deployment command. The
command below signs and sends a real devnet transaction, so it requires an
explicit operator approval:

```bash
NO_DNA=1 solana program deploy target/deploy/fate.so \
  --program-id target/deploy/fate-keypair.json \
  --keypair "$FATE_DEVNET_PAYER_KEYPAIR" \
  --url "$FATE_DEVNET_RPC_HTTP_URL"
```

After deployment, verify the program account and upgrade authority with
`solana program show`. Do not run `steel build` afterward until the devnet
artifact has been copied or deployment is complete, because it overwrites the
shared `target/deploy/fate.so` path with the production artifact.

Initialize the first draw with the deployer as fee treasury. The command is
plan-only unless `--send` is provided; sending uses normal RPC preflight before
submission:

```bash
node --experimental-strip-types app/scripts/devnet-initialize.ts
node --experimental-strip-types app/scripts/devnet-initialize.ts --send
```

## Initialize and test

Initialization must use a separate fee treasury address and the configured
devnet payer. Before sending it, simulate the exact initialize transaction and
confirm that it creates only Fate's config, vault, treasury reference, and
first draw accounts. Then fund the dedicated keeper with a small capped balance
and run it as a separate process:

```bash
KEEPER_CLUSTER=devnet pnpm keeper -- --observe-only
KEEPER_CLUSTER=devnet pnpm keeper
```

The keeper refuses mainnet by design. It must use its own keypair and must not
load the deployer, treasury, Staker, or Player key.

Record every devnet test with the program commit, artifact hash, RPC endpoint,
draw ID, transaction signatures, balances, cleanup counters, and observed
keeper latency. Keep the site labeled devnet/test-only while these runs are in
progress.
