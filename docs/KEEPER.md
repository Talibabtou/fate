# Keeper

The keeper is an unprivileged transaction payer, not an administrator. It cannot choose a winner, redirect custody, pause the protocol, or change economics. Anyone may submit the same due transition.

## Loop

On every iteration, read `Config`, derive the current `Draw`, and act only when one transition is due:

1. `Funding`: submit `activate_draw` when the live threshold is met.
2. `Activated`: submit `lock_draw` once cluster time reaches `locks_at`.
3. `Locked` on localnet/devnet: submit `settle_draw_dev` and pay rent for the next `Draw` and `PlayerRegistry`.
4. `Locked` on mainnet: use the future Entropy request/consume sequence, then submit production settlement.
5. `Settled`: do nothing; successful settlement already creates the next funding draw and advances `Config.current_draw_id` atomically.

Before sending, simulate the transaction. After sending, confirm it, reread state, and treat “another keeper already advanced the draw” as success. Refresh the blockhash on every retry and use bounded exponential backoff for RPC failures.

The keeper key should hold only enough SOL for fees and new-draw rent. At current rent settings that is about `0.07522368 SOL` per draw plus transaction fees. Monitor and refill it, but never make it the program authority or fee treasury.

That recurring rent is a temporary limitation of the current per-draw account layout, not the intended final operating cost. The program must recycle or close obsolete draw storage before this is acceptable for mainnet.

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

The keeper validates the RPC genesis hash on devnet, account owner, exact account size, and Steel discriminator before decoding state. It simulates, signs with the dedicated fee payer, submits, confirms, and rereads state only when a transition is due.

## Deployment

Do not run the primary keeper inside Next.js request handlers. Vercel functions are short-lived and request-driven; they do not provide a persistent polling or WebSocket process. Keep the UI and user-signed transactions on Vercel, and run `app/scripts/keeper.ts` from the same repository as a separate worker on a small container service such as Railway, Fly.io, Render, Cloud Run, or a VPS.

Vercel Cron can invoke an authenticated route periodically as a devnet fallback. It is acceptable for demos, but the transition cadence and hot-key handling make a dedicated worker the safer mainnet design. Multiple independent keepers are safe because transitions are permissionless and phase-checked on-chain.

Required worker secrets:

- RPC HTTPS and WebSocket URLs
- cluster-specific Fate program ID
- keeper fee-payer key
- network (`localnet` or `devnet`; mainnet remains disabled)

Never expose the keeper key through `NEXT_PUBLIC_*` variables or import it into a client bundle.
