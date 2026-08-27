# Fate agent instructions

These instructions apply to `workspace/fate`. Keep changes inside this repository unless the task explicitly requires reading an upstream reference. Fate is independent from ORE; ORE code and mechanics are reference material only.

## Before changing behavior

Read these files before changing protocol economics, simulation assumptions, account state, lifecycle behavior, or transaction UX:

1. `README.md` for the public product model and current simulation results.
2. `docs/BUILD_PLAN.md` for settled decisions, open work, and release gates.
3. `data-simulation/simulate.py` for executable economic behavior.

Treat the Rust program, tests, and simulator as implementation evidence. If they disagree with a document, do not guess which economic rule wins: report the mismatch, use an explicitly checked decision in `BUILD_PLAN.md` as the interim product authority, and update the affected docs when the code changes.

Before a non-trivial task, check the installed skills and read the skill that matches the work. Inspect status, map files with `rg`, read narrow ranges, keep a short evidence ledger, and run the smallest relevant check first.

## Product vocabulary

- The product is **Fate**.
- The persistent side is **Staker**.
- The at-risk side is **Player**.
- Public code, data, reports, UI, and docs must use Staker and Player. Existing simulator internals such as `safe_*` and `risk_*` may remain until a deliberate internal rename; do not expose them as product terminology.

## Settled protocol model

- Native SOL only.
- Each draw chooses Player with 90% probability or Staker with 10% probability, then chooses exactly one wallet on the selected side.
- Deposits from one wallet aggregate before odds and settlement.
- Staker winner weight is active vault shares. Player winner weight is the sum of each deposit multiplied by its boost at deposit time.
- A Staker-side win pays 30% of Player TVL to one weighted Staker, 65% to active Stakers through vault value, and 5% to the protocol.
- A Player-side win erodes `min(0.07% * Staker TVL, 7% * Player TVL)`. The fee base is losing Player deposits plus erosion; the winner's own deposit is excluded. The winner claims its deposit plus 95% of that fee base.
- Minimum deposits are `0.01 SOL` for Players and `0.1 SOL` for Stakers.
- Player winnings use an on-chain claim balance. Staker winnings roll into vault value, with an exact liability when a jackpot is too small to represent safely as shares.
- Staker SOL remains inert. Never describe it as yield-bearing, risk-free, guaranteed principal, or fixed APY.
- Economic math is integer-only on-chain, uses `u128` intermediates, rounds down, and assigns every remainder to the protocol treasury.

## Lifecycle and liveness

The normal lifecycle is:

```text
FUNDING -> ACTIVATED -> deadline -> settlement -> next FUNDING
```

`LOCKED`, `AWAITING_RANDOMNESS`, and `VOIDED` remain valid states where the selected randomness and recovery design needs them.

- The first Player deposit starts `FUNDING` and snapshots active Staker TVL. The initial target is 1% of that snapshot, decaying by 10% every 10 minutes, with a floor of `max(0.1 SOL, 0.1% of the snapshot)`.
- Funding has no expiry or automatic cancellation. The UI must not imply that activation is guaranteed at a particular time.
- Player deposits are refundable until activation. If all Players refund, reset the funding timestamp and snapshot. Stakers can withdraw during `FUNDING`; recalculate the snapshot and threshold, and prevent the final active Staker from leaving while Player funds remain.
- New Staker deposits close after the first Player enters and reopen with the next draw.
- A Player deposit that reaches the live threshold, or a Staker withdrawal that lowers the threshold to current Player TVL, should activate the draw in that same user transaction. The existing program already follows this rule.
- At activation, freeze Staker positions, commit pending Players, start the five-minute countdown, and accept countdown Player deposits at 1.00x weight. Early funding deposits may receive up to 1.50x Player-side winner weight.
- After the deadline, any signer must be able to settle the draw once. No administrator, fee payer, RPC provider, or caller may choose, discard, or reroll a valid result.
- Do not make a dedicated worker a product dependency. Prefer user activity as the normal trigger for due lifecycle work, including atomic activation where the user action changes eligibility. Keep explicit permissionless fallback instructions for time-only activation, deadline settlement, randomness recovery, and cleanup so inactivity cannot trap funds. Fallbacks must be idempotent and safe when another caller wins a race.
- Do not silently make a user's wallet pay for unrelated work. If an app composes lifecycle work with a user action, show the phase change, accounts, fee payer, and possible outcome before signature; use a separate permissionless transaction when account requirements or risk make composition unclear.
- Permissionless callers are fee payers only; do not add caller authority, custody, rewards, or production dependencies without an explicit decision.
- Pause may stop deposits and activation only. It must never block refunds, Staker withdrawals, claims, locked-draw settlement, or a tested terminal recovery path.

See `docs/LIFECYCLE.md` for the user-triggered progression and caller-paid fallback flow.

## Solana program rules

- Use Steel and follow the local patterns in `repos/steel` and `repos/steel-book`; do not introduce Anchor for Fate. Do not modify upstream repositories.
- Keep participant state in one PDA per Staker wallet and one PDA per Player wallet/draw. Use the authenticated radix-16 weighted index; never store a shared participant array or scan every participant during activation or settlement.
- Preserve the `u32` leaf namespace and eight-page path assumptions unless measured limits and the build plan change.
- Derive PDAs from fixed prefixes, explicit IDs, and canonical bumps. Validate every account's owner, exact data length, discriminator, signer and writable role, PDA seeds, stored relationships, and expected program IDs. Reject duplicate mutable accounts, reinitialization, substituted CPI programs, stale randomness, fake account types, and unchecked narrowing casts.
- Treat accounts, instruction bytes, RPC data, sysvars, and logs as hostile input. Use runtime sysvars rather than caller-supplied fake sysvar accounts when the instruction has no such account surface.
- Check custody solvency and expected lamport deltas at the end of every value-moving instruction. Account for rent, direct lamport donations, liabilities, rounding dust, refunds, withdrawals, claims, and all cleanup recipients.
- Never commit Player funds before activation, spend Staker principal outside explicit erosion or withdrawal, settle twice, or claim twice.
- Every timed transition is permissionless. A caller is only a fee payer and transaction submitter; it is never an authority or source of truth.

## Randomness

- Localnet and devnet use the explicitly feature-gated deterministic fixture. The normal production artifact must reject it.
- Before mainnet, replace only the fixture source and account/CPI gate with the reviewed Fate-owned Entropy integration. Do not share ORE's variable, rely on Entropy's predictable missed-slot fallback, or redeploy Entropy to devnet.
- Bind randomness to the draw ID and domain-separate side and winner samples. Use unbiased integer selection with rejection sampling.
- Validate expected ownership, variable address, generation, target slot, finality, freshness, commit/reveal relationship, and one-time consumption. Define a bounded permissionless retry or void/refund path before any mainnet funds are accepted.

## Web app

- Build one mobile-first Next.js App Router page in `app/` with TypeScript, Tailwind CSS, pnpm, Biome, Privy for Solana-only external wallets, and `@solana/kit` by default. Add `@solana/web3.js` only when a required Privy or Entropy path cannot accept Kit transactions.
- Use an environment-selected primary HTTP/WSS RPC pair with ordered read fallbacks. Submit and confirm a transaction on the same endpoint; never rotate endpoints mid-lifecycle.
- Derive phases and balances from confirmed on-chain state. Browser timers only display expected deadlines. Refetch affected accounts after confirmation and handle submitted, confirmed, failed, stale, dropped-subscription, wrong-network, and rejected-signature states.
- The page must show the active phase, threshold and countdown, Staker/Player action, odds, exact payout estimate, fee base, pending/commitment status, maximum loss, erosion, claim state, ten recent results, and compact devnet disclosures before signature.
- Keep the visual direction calm, dark, serious, and minimal. Use a text Fate wordmark and one accent. Mobile puts the primary action first and keeps advanced detail collapsed. Do not add casino imagery, decorative gradients, a marketing landing page, notifications, analytics, or a card-grid dashboard.

## Testing and release

- Add a negative test for every authorization, phase, account, arithmetic, custody, replay, and one-time-use failure, not only happy paths. Include randomized math/tree invariants, capacity and packet/compute measurements, pause-safe exits, provider failure, cleanup, and concurrent caller races.
- Compare simulator vectors with Rust math byte for byte. Run focused tests first, then the relevant Rust/SBF, app, localnet, and devnet checks. Do not call a deterministic fixture a fairness test.
- Keep mainnet blocked until economic validation, observed devnet comparison, program security review, Entropy review, legal review, production recovery, and authority migration to a multisig are complete.
- Update `docs/BUILD_PLAN.md` checkboxes and status notes when work actually completes; do not rewrite history to make a check pass.

## Working rules

- Preserve unrelated user changes. Start with `git status --short`; leave unrelated dirty files alone.
- Use `rg` or `rg --files` for search. Prefer a small, focused patch over speculative abstractions or new packages.
- Keep only `README.md` and `AGENTS.md` as authored Markdown files in the repository root. Put other authored Markdown in `docs/`.
- Never sign, send, deploy, publish, or contact an external service without explicit user approval. For a transaction, show cluster, fee payer, transfers, recipients, and simulation result first.
- Never run `git add`, create commits, or push branches. Leave changes unstaged and include one short suggested commit message in the handoff.
- Prefix supported Solana development CLIs with `NO_DNA=1`.

## Useful checks

From `workspace/fate`:

```bash
PYTHONPYCACHEPREFIX=/tmp/fate-pycache python3 -m py_compile \
  data-simulation/simulate.py data-simulation/run_scenarios.py

PYTHONPYCACHEPREFIX=/tmp/fate-pycache python3 \
  data-simulation/run_scenarios.py --data-dir data-simulation
```

Use the commands documented in `package.json` and `docs/BUILD_PLAN.md` for Rust, app, localnet, and devnet checks; do not invent a deployment command when the documented one exists.
