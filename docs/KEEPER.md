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

## Deployment

Do not run the primary keeper inside Next.js request handlers. Vercel functions are short-lived and request-driven; they do not provide a persistent polling or WebSocket process. Keep the UI and user-signed transactions on Vercel, and run `app/scripts/keeper.ts` from the same repository as a separate worker on a small container service such as Railway, Fly.io, Render, Cloud Run, or a VPS.

Vercel Cron can invoke an authenticated route periodically as a devnet fallback. It is acceptable for demos, but the transition cadence and hot-key handling make a dedicated worker the safer mainnet design. Multiple independent keepers are safe because transitions are permissionless and phase-checked on-chain.

Required worker secrets:

- RPC HTTPS and WebSocket URLs
- cluster-specific Fate program ID
- keeper fee-payer key
- fee treasury public key
- network mode (`dev-fixture` or, later, `mainnet-entropy`)

Never expose the keeper key through `NEXT_PUBLIC_*` variables or import it into a client bundle.
