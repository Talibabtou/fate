# Agent Notes for Fate

These instructions apply to `workspace/fate`. Fate is independent from ORE. Do not import ORE product mechanics or mention ORE in Fate product copy.

## Read First

Before changing protocol behavior, simulation assumptions, program state, or transaction UX, read:

1. `README.md` for the public product model and latest simulation results.
2. `docs/BUILD_PLAN.md` for settled implementation choices, open tasks, and release gates.
3. `data-simulation/simulate.py` for executable economic behavior.

When these files disagree, checked decisions in `docs/BUILD_PLAN.md` take precedence until the simulator and README are updated. Do not silently resolve an economic conflict in code.

For Solana program, client, RPC, testing, or deployment work, use the globally installed `solana-dev` skill and the references it routes to. Read its `references/security.md` before implementing or reviewing an instruction, and use the configured Solana Developer MCP to verify version-sensitive guidance. Fate's explicit Steel direction overrides the skill's default Anchor or Pinocchio framework recommendation.

## Terminology

- The product is **Fate**.
- The persistent side is **Staker**.
- The at-risk side is **Player**.
- Never reintroduce the legacy risk-side terminology in code, data, or copy.
- Legacy internal simulator names such as `safe_*` and `risk_*` may remain until a deliberate internal refactor. Public fields, filenames, reports, and UI must say Staker and Player.

## Settled Mechanism

- Native SOL only.
- One draw selects the Player side with 90% probability or the Staker side with 10% probability.
- Every settled draw has exactly one selected wallet.
- Deposits from one wallet aggregate before odds and settlement are calculated.
- Staker winner odds are proportional to active vault shares.
- Player winner odds use the sum of each deposit multiplied by its boost at deposit time.
- Staker-side payout: 30% to one weighted Staker, 65% to all active Stakers through vault share value, and 5% to the protocol.
- Player-side erosion: `min(0.07% * Staker TVL, 7% * Player TVL)`.
- Player-side fee base: losing Player deposits plus Staker erosion. The winner's own deposit is excluded.
- Player claim: winner deposit plus 95% of losing Player deposits and erosion.
- Player winnings are credited to an on-chain claim balance.
- Staker winnings roll automatically into Staker vault value.
- Staker SOL is inert. Fate does not stake it with validators or deploy it into DeFi.
- Do not claim fixed APY or guaranteed principal. Staker balances can fall through erosion.

## Funding And Timing

- The first Player deposit begins `FUNDING` and snapshots active Staker TVL.
- Initial activation target: 1% of the current Staker TVL snapshot.
- The target falls by 10% every 10 minutes.
- Activation floor: the larger of `0.1 SOL` and `0.1% of the current Staker TVL snapshot`.
- Minimum Player deposit: `0.01 SOL`.
- Minimum Staker deposit: `0.1 SOL`.
- Funding has no expiry.
- A pending Player may refund their entire position during `FUNDING`.
- If every Player refunds, reset the funding clock and snapshot.
- Stakers may withdraw immediately during `FUNDING`. Each withdrawal must recalculate the Staker snapshot, floor, and live activation threshold.
- New Staker deposits made after the first Player enters are queued for the next draw.
- Once the target is met, enter `ACTIVATED` and start a five-minute countdown.
- Staker withdrawals requested from `ACTIVATED` through settlement are queued and execute after settlement.
- Player deposits remain open during the countdown, commit immediately, and receive `1.00x` weight.
- Early funding deposits can receive up to `1.50x` Player winner weight. The boost affects only the winner within the Player side, never the fixed 90% side probability.
- At countdown end, lock deposits, obtain randomness, settle once, process queued Staker actions, and open the next draw.

The `0.01 SOL` minimum can remain below the activation floor because no capital is trapped during `FUNDING`: Stakers can withdraw and Players can refund. The UI must not imply that activation is guaranteed at a particular time.

## Program Direction

- Use Steel, following `repos/steel` and `repos/steel-book`. Do not default to Anchor.
- Follow the Steel workspace shape: root Cargo workspace, `api/`, `program/`, and integration tests.
- Use `repos/entropy` for randomness and study ORE's existing Entropy integration as code reference only.
- Entropy calls itself work in progress. Fate does not depend on it on localnet or devnet. Before mainnet, verify the deployed program and pinned source, provider/API availability, commit supply, cost, slot timing, timeout, and recovery.
- Use one Fate-owned Entropy variable. Do not share ORE's variable.
- Derive separate side and winner samples with domain-separated hashes containing the draw ID.
- Use unbiased integer selection. Do not use unchecked modulo selection when it introduces bias.
- Economic math is integer-only with `u128` intermediates. Round division down and account for every remaining lamport.
- Parameters are constants in v1. Changing them requires a reviewed program upgrade.
- Development authority and treasury begin under one securely stored owner wallet.
- Use a different low-balance hot key for the keeper.
- Every timed transition is permissionless. The keeper is only a backup caller.
- A narrow pause may stop deposits and activation, but never refunds, withdrawals, claims, or settlement of a locked draw.

## Capacity

The v1 plan starts with fixed registries of at most 512 active Staker wallets and 116 Player wallets per draw. These are engineering limits, not economic caps. They bound account storage and winner-selection compute in one Solana transaction.

Benchmark maximum-capacity settlement before fixing these values. Lower them if settlement lacks compute margin. Do not add a sum tree or proof system until measured usage requires more capacity.

## Web App

- Build one mobile-first page under `app/` using Next.js App Router, TypeScript, Tailwind CSS, pnpm, and Biome.
- Use Privy for Solana-only external wallet connection.
- Use `@solana/kit` by default. Add `@solana/web3.js` only when a required Privy or Entropy path cannot accept Kit transactions.
- Use an environment-selected primary HTTP/WSS RPC pair with ordered read fallbacks.
- Keep transaction submission and confirmation on the same RPC endpoint.
- Derive authoritative phases from confirmed on-chain state. Browser timers only display expected time.
- No notifications or analytics in v1.
- The page needs wallet/network controls, live phase, threshold, countdown, Staker/Player mode, deposit and exit actions, odds, exact payout estimate, fee, maximum loss, claim state, ten recent results, and compact disclosures.
- Keep the visual direction calm, serious, dark, and minimal. Use a text Fate wordmark initially, one accent distinct from ORE, and limited phase-change motion.
- Mobile shows the primary Staker/Player action first. Desktop may expose more pool details. Advanced details stay collapsed by default on mobile.
- Do not build a marketing landing page, casino imagery, decorative gradients, or a card-grid dashboard.
- Devnet disclosures belong in a compact footer, but risk, fee, pending, commitment, payout, and maximum-loss information must appear before transaction confirmation.

## Release Direction

- Develop the page on localhost against a devnet program.
- Use the owner's available RPC providers through environment configuration. Do not rotate RPC endpoints in the middle of a transaction lifecycle.
- Deploy the checked page to Vercel when shared devnet testing begins.
- Buy and configure a production domain later.
- No mainnet release before economic validation, program security review, Entropy review, legal review, and authority migration to a multisig.

## Immediate Work Order

1. Finish adversarial tests, invariant coverage, maximum-capacity benchmarks, and bounded rent recovery for the deterministic Steel program.
2. Run the keeper and complete custody loop on localnet, then deploy the feature-gated deterministic artifact to devnet.
3. Build the Next.js app against confirmed localnet/devnet state and exercise the full wallet flow.
4. Run long devnet batches and compare balances and outcomes with the simulator.
5. Before mainnet only, replace the deterministic settlement entry point with the verified Entropy account/CPI gate.
6. Verify Fate's Entropy validation, missed-slot rejection, retry or void/refund recovery, and production artifact before deployment; do not redeploy Entropy to devnet.

## Simulation Commands

From `workspace/fate`:

```bash
PYTHONPYCACHEPREFIX=/tmp/fate-pycache python3 -m py_compile \
  data-simulation/simulate.py data-simulation/run_scenarios.py

PYTHONPYCACHEPREFIX=/tmp/fate-pycache python3 \
  data-simulation/run_scenarios.py --data-dir data-simulation
```

The cache prefix avoids the protected macOS system Python cache path in this workspace.

## Build Guardrails

- Keep only `README.md` and this required `AGENTS.md` control file in the repository root. Put all other authored Markdown documentation in `docs/`.
- Never run `git add`, create commits, or push branches. Leave changes unstaged and give the user a short suggested commit message at handoff.
- Prefix supported Solana development CLIs with `NO_DNA=1` to disable interactive agent-hostile behavior.
- Never sign or send a transaction without explicit user approval. Default to localnet or devnet, show cluster, fee payer, transfers, and recipients, and simulate before requesting approval.
- Treat every account, instruction argument, RPC response, and log as hostile input. Validate account owner, data length, discriminator, signer, writability, PDA seeds and canonical bump, and stored account relationships before use.
- Reject duplicate mutable accounts, reinitialization, substituted CPI programs, fake sysvars, stale randomness, and unchecked narrowing casts. Handle pre-funded PDAs and direct lamport donations without corrupting internal accounting.
- Assert custody solvency and expected balance deltas at the end of every value-moving instruction. Add a negative test for each validation and authorization failure, not only happy-path coverage.
- Keep edits scoped to `workspace/fate` unless reading upstream references.
- Do not modify `repos/steel`, `repos/steel-book`, `repos/entropy`, or ORE repositories for Fate-specific behavior.
- Do not spend Staker principal anywhere except explicit protocol erosion and user withdrawal.
- Do not commit Player funds before activation.
- Do not let an authority or keeper choose, discard, or reroll a valid result.
- Do not settle more than once or allow a claim more than once.
- Do not use floating-point protocol math.
- Do not hide negative Player EV, Staker erosion, protocol fees, pending status, or full-loss risk.
- Preserve a tested exit path through pause and provider failure.
- Update `docs/BUILD_PLAN.md` checkboxes as work completes.
