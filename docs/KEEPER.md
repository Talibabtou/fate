# Keeper

The keeper is an unprivileged transaction payer, not an administrator. It cannot choose a winner, redirect custody, pause the protocol, or change economics. Anyone may submit the same due transition.

## What runs where

`pnpm dev` starts only the Next.js browser app. The scripts under `app/scripts` do different jobs:

- `keeper.ts` is the only long-lived worker. It reads confirmed Fate state, submits a due permissionless transition, and pays transaction fees with the dedicated hot key.
- `fate-client.ts` is shared Kit code for account decoding, PDA derivation, instruction construction, and the deterministic devnet settlement calculation. It has no private-key handling.
- `check-cluster-config.ts` is a one-shot configuration guard.
- `localnet-e2e.ts` and `keeper-batch-e2e.ts` are development/release-gate harnesses. They create test transactions and restart the keeper; they are not production services.
- `fate-client.test.ts` contains fast offline client and keeper tests.

The web app belongs on Vercel. The keeper does not: Vercel request functions are short-lived, so run `pnpm keeper` as a separate process on a small container/VPS worker. For localnet it runs from a terminal beside the validator. For devnet it can run on Railway, Fly.io, Render, Cloud Run, or a small VPS with the RPC URLs, program ID, and keeper key injected as secrets. The worker may be duplicated because the program resolves races on-chain.

## Loop

On every iteration, read `Config`, derive the current `Draw`, and act only when one transition is due:

1. `Funding`: submit `activate_draw` when the live threshold is met.
2. `Activated`: submit `lock_draw` once cluster time reaches `locks_at`.
3. `Locked` on localnet/devnet: reproduce the deterministic fixture only to walk each eight-page weighted tree and locate one position per side, then supply both verified paths and pay rent for the next `Draw`.
4. `Locked` on mainnet: use the future Entropy request/consume sequence, then submit production settlement.
5. When no draw transition is due, close one settled Player position, one draw-scoped weight page, or one expired draw header and refund its recorded rent payer.

Before sending, simulate the transaction. After sending, confirm it, reread state, and treat “another keeper already advanced the draw” as success. Refresh the blockhash on every retry and use bounded exponential backoff for RPC failures.

The keeper key should hold only enough SOL for fees and the next `Draw` rent (approximately `0.00328512 SOL` at the checked schedule), plus a conservative fee reserve. Participant wallets fund their own position and newly required shared tree pages; cleanup returns that rent to the recorded payer. Recheck cluster rent and measure the exact localnet peak before funding devnet. Never make the keeper the program authority or fee treasury.

Cleanup is permissionless, but recovered lamports can only go to the payer recorded when the draw was created. A competing keeper therefore cannot capture rent.

## Run Locally

Install dependencies once with `pnpm install`, then copy `.env.example` to `.env.local` and set:

```text
KEEPER_CLUSTER=localnet
KEEPER_RPC_HTTP_URL=http://127.0.0.1:8899
KEEPER_KEYPAIR_PATH=/absolute/path/to/keeper-keypair.json
NEXT_PUBLIC_FATE_PROGRAM_ID=<deployed-program-address>
```

Create a dedicated key if needed with `NO_DNA=1 solana-keygen new --no-bip39-passphrase --outfile keeper-keypair.json`. Keep that ignored key outside the repository for devnet, and fund only its public address. The localnet mode refuses non-loopback RPC URLs; devnet mode verifies the cluster genesis hash.

Start with the read-only mode. It reports due actions but cannot sign or submit them:

```bash
pnpm keeper -- --observe-only
```

Run one read/transition cycle with `pnpm keeper:once`, or keep the normal worker running with `pnpm keeper`. Local/dev settlement requires the program binary built with `dev-randomness`. Use `KEEPER_CLUSTER=devnet` and a devnet RPC pair for the devnet phase. Mainnet is rejected intentionally until the Entropy settlement path exists.

The keeper validates the RPC genesis hash on devnet, account owner, exact account size, and Steel discriminator before decoding state. It reproduces the feature-gated Keccak selection locally only to locate candidate accounts; the program independently verifies the entropy-derived tree path. It walks the weighted pages instead of scanning all participant positions during settlement, then uses indexed RPC filters to fetch the selected leaf. It simulates, submits, confirms, and rereads state only when a transition or cleanup action is due. Cleanup discovery scans only exact account sizes, and the program repeats every eligibility, PDA, relationship, and refund-recipient check on-chain.

For the localnet release gate, `app/scripts/keeper-batch-e2e.ts` starts a fresh `keeper.ts --once` process for every observed, activation, lock, and settlement transition. With the `dev-randomness,fast-localnet` artifact and four funded local wallets, run it with the same `FATE_*` variables as `localnet-e2e.ts` plus `KEEPER_KEYPAIR_PATH`; it should end with `KEEPER_BATCH_PASS` after twelve draws. The harness also claims deterministic Player wins, drains cleanup accounts, and verifies the ten-draw recent-history ring.

## Deployment

Do not run the primary keeper inside Next.js request handlers. Vercel functions are short-lived and request-driven; they do not provide a persistent polling or WebSocket process. Keep the UI and user-signed transactions on Vercel, and run `app/scripts/keeper.ts` from the same repository as a separate worker on a small container service such as Railway, Fly.io, Render, Cloud Run, or a VPS.

Vercel Cron can invoke an authenticated route periodically as a devnet fallback. It is acceptable for demos, but the transition cadence and hot-key handling make a dedicated worker the safer mainnet design. Multiple independent keepers are safe because transitions are permissionless and phase-checked on-chain.

Required worker secrets:

- RPC HTTPS and WebSocket URLs
- cluster-specific Fate program ID
- keeper fee-payer key
- network (`localnet` or `devnet`; mainnet remains disabled)

Never expose the keeper key through `NEXT_PUBLIC_*` variables or import it into a client bundle.
