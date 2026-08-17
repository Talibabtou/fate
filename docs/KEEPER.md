# Keeper

The keeper is an unprivileged transaction payer, not an administrator. It cannot choose a winner, redirect custody, pause the protocol, or change economics. Anyone may submit the same due transition.

## Loop

On every iteration, read `Config`, derive the current `Draw`, and act only when one transition is due:

1. `Funding`: submit `activate_draw` when the live threshold is met.
2. `Activated`: submit `lock_draw` once cluster time reaches `locks_at`.
3. `Locked` on localnet/devnet: submit `settle_draw_dev` and pay rent for the next `Draw` and `PlayerRegistry`.
4. `Locked` on mainnet: use the future Entropy request/consume sequence, then submit production settlement.
5. When no draw transition is due, close one eligible empty Player registry or one expired draw header and refund its recorded rent payer.

Before sending, simulate the transaction. After sending, confirm it, reread state, and treat “another keeper already advanced the draw” as success. Refresh the blockhash on every retry and use bounded exponential backoff for RPC failures.

The keeper key should hold only enough SOL for fees and the bounded rent float. At current rent settings each new draw pair temporarily needs about `0.07522368 SOL`. Because draw headers remain for ten results, a fresh keeper needs roughly `0.83 SOL` plus fees to bridge the initial history window; eligible registry rent returns sooner, and expired draw rent then recycles continuously. Recheck cluster rent and measure the exact localnet peak before funding devnet. Never make this key the program authority or fee treasury.

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

The keeper validates the RPC genesis hash on devnet, account owner, exact account size, and Steel discriminator before decoding state. It simulates, signs with the dedicated fee payer, submits, confirms, and rereads state only when a transition or cleanup action is due. Cleanup discovery scans only program-owned accounts of the exact Draw and PlayerRegistry sizes; the program repeats every eligibility and refund-recipient check on-chain.

## Deployment

Do not run the primary keeper inside Next.js request handlers. Vercel functions are short-lived and request-driven; they do not provide a persistent polling or WebSocket process. Keep the UI and user-signed transactions on Vercel, and run `app/scripts/keeper.ts` from the same repository as a separate worker on a small container service such as Railway, Fly.io, Render, Cloud Run, or a VPS.

Vercel Cron can invoke an authenticated route periodically as a devnet fallback. It is acceptable for demos, but the transition cadence and hot-key handling make a dedicated worker the safer mainnet design. Multiple independent keepers are safe because transitions are permissionless and phase-checked on-chain.

Required worker secrets:

- RPC HTTPS and WebSocket URLs
- cluster-specific Fate program ID
- keeper fee-payer key
- network (`localnet` or `devnet`; mainnet remains disabled)

Never expose the keeper key through `NEXT_PUBLIC_*` variables or import it into a client bundle.
