# Fate Build Plan

This checklist records the settled implementation choices and build order for the first devnet version of Fate's single-page Next.js dApp and Solana program.

## Product Decisions

- [x] Name the two sides **Staker** and **Player**.
- [x] Accept native SOL only.
- [x] Select the Player side 90% of the time and the Staker side 10% of the time.
- [x] Select a Staker jackpot winner in proportion to active vault shares.
- [x] Select a Player winner using deposited SOL multiplied by the boost active for each deposit.
- [x] Aggregate every deposit from the same wallet before winner settlement.
- [x] Split a Staker-side win into 30% jackpot, 65% proportional distribution, and 5% protocol fee.
- [x] Set erosion to `min(0.07% of Staker TVL, 7% of Player TVL)`.
- [x] Start activation at 1% of the Staker TVL snapshot.
- [x] Reduce the activation target by 10% every 10 minutes.
- [x] Set the activation floor to the larger of `0.1 SOL` and `0.1% of snapshot Staker TVL`.
- [x] Run a five-minute countdown after activation.
- [x] Set the minimum Player deposit to `0.01 SOL`.
- [x] Set the minimum Staker deposit to `0.1 SOL`.
- [x] Do not cap the SOL held by one wallet.
- [x] Allow a pending Player to refund their full position before activation.
- [x] Allow Staker withdrawals immediately during `FUNDING` and recalculate the snapshot and threshold.
- [x] Queue Staker withdrawals from `ACTIVATED` until settlement.
- [x] Queue new Staker deposits for the following draw after the first Player arrives.
- [x] Do not expire or cancel a funding draw based on elapsed time.
- [x] Charge the Player-side 5% fee on losing Player deposits and Staker erosion, excluding only the winner's deposit.
- [x] Give countdown deposits `1.00x` weight with no early-funding boost.
- [x] Automatically add all Staker winnings to Staker balances.
- [x] Credit the full Player payout to an on-chain claim balance.
- [x] Keep economic parameters constant in v1.
- [x] Launch interactive testing on devnet.
- [x] Omit notifications and analytics from v1.
- [x] Use the Entropy implementation in `repos/entropy` as the randomness dependency.



## Decisions To Close

These items must be resolved before the custody program is implemented.

- [x] Resolve the funding liveness conflict.
  Staker withdrawals execute immediately during `FUNDING`. Each withdrawal updates the Staker TVL snapshot, activation floor, and active threshold. Withdrawals queue only after `ACTIVATED` starts the five-minute countdown. Player deposits remain refundable throughout `FUNDING`.

- [x] Keep funding open without a maximum duration.

- [x] Confirm the Player-side fee formula:
  ```text
  gross_profit = losing_player_deposits + staker_erosion
  protocol_fee = 5% * gross_profit
  player_claim = winner_deposit + gross_profit - protocol_fee
  ```
  The winner's own deposit is the only amount excluded from the fee base.

- [x] Keep Player deposits open during the five-minute countdown at `1.00x` weight.

- [x] Confirm `repos/entropy` as the selected randomness repository.
  Devnet work must still verify its program ID, provider availability, cost, commit supply, timeout behavior, and recovery path. The repository labels itself work in progress, so source availability alone does not close those checks.



## Exact Economic Model

- [x] Convert every percentage to integer basis points or parts per million. Never calculate payouts with floating point on-chain.
- [x] Define a single rounding policy: all divisions round down, and remaining lamports go to the protocol treasury.
- [x] Calculate activation from the immutable Staker TVL snapshot and first-Player timestamp.
- [x] Calculate the threshold as:
  ```text
  initial = 1% * staker_tvl_snapshot
  steps = floor(elapsed_seconds / 600)
  decayed = initial * 90%^steps
  floor = max(0.1 SOL, 0.1% * staker_tvl_snapshot)
  active_threshold = max(floor, decayed)
  ```

- [x] Store each Player deposit's boosted weight at deposit time.
- [x] Use `u128` intermediates for weights, shares, fee calculations, and proportional payouts.
- [x] Define the early boost with integer math and cap it between `1.00x` and `1.50x`.
- [x] Define Player payout, Staker payout, erosion, fee, and dust formulas as executable test vectors.
- [x] Prove lamport conservation for both winner sides.
- [ ] Prove that Player principal cannot be committed before activation.
- [ ] Prove that Staker winnings and erosion are reflected by vault share value.



## Simulation Gate

- [x] Rename the legacy side terminology to Player in `simulate.py`, `run_scenarios.py`, generated CSV columns, analysis files, and `../README.md`.
- [x] Add the new activation floor `max(0.1 SOL, 0.1% of Staker TVL)`.
- [x] Test the proposed `0.01 SOL` minimum Player deposit and measure stuck-funding frequency.
- [x] Charge 5% on `losing Player deposits + erosion` for Player-side wins.
- [x] Stop the early boost at activation.
- [x] Measure how often funding remains below its floor and how long it remains there without expiry.
- [x] Rerun small, medium, and large scenarios with several random seeds.
- [x] Record activation rate, funding duration, time spent at the activation floor, queued-withdrawal time, Player EV, Staker return, protocol revenue, and value conservation.
- [ ] Compare simulator test vectors against the Rust math implementation byte for byte.
- [x] Update `../README.md` only after the revised simulation passes.



## Repository Shape

Keep the code under `workspace/fate` without creating extra packages until they remove actual duplication.

```text
fate/
  app/                  Next.js application and keeper script (planned)
  api/                  Steel state, instructions, errors, events, and Rust SDK
  program/              Solana instruction handlers
  tests/                Program integration and invariant tests (planned)
  data-simulation/      Simulator, scenario runner, retained reports, and summaries
  docs/                 Build plan, account model, and randomness gate
  AGENTS.md             Required repository-scoped agent instructions
  README.md             Current product model
```

- [x] Initialize a root Cargo workspace containing `api` and `program`.
- [x] Follow the layout and account-validation patterns in `repos/steel` and `repos/steel-book`.
- [ ] Scaffold `app` with Next.js, TypeScript, Tailwind CSS, pnpm, and the App Router.
- [ ] Add Biome with format, lint, and import-order checks.
- [ ] Add root commands for program tests, app checks, and devnet configuration.
- [x] Document required tool versions and environment variables.
- [x] Keep RPC URLs, Privy app ID, program ID, Entropy addresses, and keeper keys out of source control.



## On-Chain Accounts

Start with fixed-size registries. This bounds account rent, transaction compute, and winner-selection work. Unlimited participants would require a sum tree, proofs, and more state-management code before the product has users.

- [x] Define `Config` with authority, fee treasury, pause state, current draw ID, and program version.
- [x] Define `StakerVault` with active assets, pending assets, total shares, and queued withdrawal shares.
- [x] Define a fixed `StakerRegistry` with at most 512 wallet entries.
- [x] Define one persistent Staker entry per wallet inside the registry with active shares, pending deposit, queued withdrawal, and status.
- [x] Define `Draw` with state, timestamps, snapshots, threshold data, Player totals, Entropy reference, result, fee, erosion, winner, and claim state.
- [x] Define a fixed Player registry with at most 128 wallets in each draw.
- [x] Store each Player wallet's refundable deposit, committed deposit, and summed boosted weight.
- [x] Store the ten latest settled draw IDs in a fixed ring buffer in `Config`.
- [x] Derive every PDA from fixed prefixes and explicit IDs.
- [x] Calculate account rent and publish it in the technical notes.
- [ ] Benchmark 512 Stakers and 128 Players against Solana account-size and compute limits.
- [ ] Lower capacities if the maximum settlement cannot complete with a safety margin.



## Program Instructions

- [x] `initialize`: create configuration, vault, Staker registry, first draw, and treasury references.
- [x] `deposit_stake`: transfer SOL, mint shares immediately when no funding snapshot exists, or queue SOL for the next draw.
- [x] `request_stake_withdrawal`: execute during `FUNDING`, update the snapshot and threshold, or queue the request from `ACTIVATED` until settlement.
- [x] `deposit_player`: create or update one wallet entry, transfer refundable SOL, record boosted weight, and create the first-Player snapshot when needed.
- [x] `refund_player`: return the wallet's full pending position before activation and clear its Player entry.
- [x] Reset the funding clock and snapshot if every Player refunds before activation.
- [x] `activate_draw`: verify the live decayed threshold and start the five-minute countdown.
- [x] Treat every Player deposit during countdown as committed immediately.
- [ ] `lock_draw`: close deposits after countdown and bind the draw to its Entropy request.
- [ ] `settle_draw`: consume finalized Entropy, select one side, select exactly one wallet, calculate payouts, and make the result immutable.
- [ ] On a Player win, move the full payout into the winner's claimable balance.
- [ ] On a Staker win, add the 65% distribution to vault assets and mint jackpot value to the selected Staker without changing other Stakers' ownership fraction.
- [ ] After settlement, price and execute queued Staker withdrawals.
- [ ] After settlement, mint shares for queued Staker deposits at the post-settlement share price.
- [ ] `claim_player`: transfer the full recorded claim once and mark it claimed.
- [ ] `pause`: stop new deposits and activation.
- [ ] `unpause`: reopen new deposits and activation.
- [ ] Ensure pause never blocks pending Player refunds, Staker exits, locked-draw settlement, or claims.
- [ ] Emit compact events for deposits, refunds, activation, lock, settlement, queued Staker actions, claims, and pause changes.



## Randomness

Build order decision: implement the deterministic program and app against fixtures first, then deploy the verified Entropy source under a Fate-controlled devnet ID with a dev-only provider. Custody testing remains blocked until that deployment passes the lifecycle and recovery tests. Mainnet uses the official Entropy ID only after output parity is demonstrated.

- [x] Read `repos/entropy` and ORE's `new_var`, `deploy`, and `reset` handlers as the integration references.
- [ ] Create a Fate-owned Entropy variable rather than sharing ORE's variable.
- [ ] Decide when the Entropy variable advances so no random value is knowable before Player deposits close.
- [ ] Reconcile the five-minute Unix timestamp countdown with Entropy's slot-based `end_at` value.
- [ ] Require a finalized Entropy value owned by the expected Entropy program and Fate authority.
- [ ] Derive separate side and winner samples with domain-separated Keccak hashes containing the draw ID.
- [ ] Use rejection sampling to prevent modulo bias in side and weighted-wallet selection.
- [ ] Prevent reuse of one Entropy result across draw IDs.
- [ ] Define a permissionless two-minute retry path that is compatible with Entropy's commit chain.
- [ ] Never permit the authority or keeper to replace a valid finalized result.
- [ ] Add a devnet integration test that opens, samples, reveals, consumes, and advances the Entropy variable.

Live verification on 2026-08-17 found no Entropy program at its declared ID on devnet. The same ID is verified and active on mainnet at Entropy commit `f26ae03cccab6188effb0a170b8123cf4bb54c94`, and the provider seed endpoint is responding. The current source substitutes predictable `keccak(end_at)` data when the target slot has aged out of the recent slot-hash sysvar. Fate must reject that fallback and define a bounded retry or refund path before custody implementation. See `RANDOMNESS_GATE.md`.

## Program Tests

- [ ] Test all state transitions and reject transitions from the wrong phase.
- [ ] Test every instruction's owner, data-length, discriminator, signer, writable/read-only, PDA seed, canonical bump, and stored-relationship validation.
- [ ] Test reinitialization, pre-funded PDA initialization, duplicate mutable accounts, fake sysvars, substituted CPI programs, and account type cosplay.
- [ ] Test direct lamport donations cannot change tracked assets, liabilities, shares, thresholds, payouts, or solvency.
- [ ] Assert tracked custody assets plus rent always cover refunds, withdrawals, and claims after every value-moving instruction.
- [ ] Test threshold decay at every 10-minute boundary.
- [ ] Test activation at, below, and above the exact threshold.
- [ ] Test the larger-of-two activation floor at several Staker TVLs.
- [ ] Test deposits immediately before and after snapshot, activation, countdown end, and settlement.
- [ ] Test one Player, many Players, one Staker, maximum wallets, and repeat deposits from one wallet.
- [ ] Test wallet aggregation so one wallet can win only once.
- [ ] Test early-boost boundaries and deposits made during countdown.
- [ ] Test Staker share-price gains, erosion, jackpot share minting, deposits, and withdrawals.
- [ ] Test zero losing-Player deposits so a solo Player's own principal is never charged as profit.
- [ ] Test the 5% fee on erosion.
- [ ] Test every rounding remainder and overflow boundary.
- [ ] Test malformed, substituted, duplicate, non-writable, and incorrectly owned accounts.
- [ ] Test unauthorized administration and false Entropy accounts.
- [ ] Test double settlement, double claim, replay, stale draw IDs, and stale randomness.
- [ ] Test paused-state exits and locked-draw settlement.
- [ ] Run randomized invariant tests for lamport conservation and share ownership.
- [ ] Run `steel test`, `steel build`, and `cargo test-sbf` before devnet deployment.



## Keeper

The keeper is a small script, not a service platform. State transitions remain callable by anyone.

- [ ] Add one Node script under `app/scripts` that reads the current draw and submits only a transition that is due.
- [ ] Handle activation, locking, Entropy sampling and reveal, timeout recovery, and settlement.
- [ ] Use a dedicated hot fee-payer key with a limited SOL balance.
- [ ] Keep the authority and fee treasury wallet out of the keeper process.
- [ ] Fund keeper transaction fees from protocol revenue by manual treasury transfer in v1.
- [ ] Do not add an on-chain caller reward in v1.
- [ ] Make every keeper action idempotent and harmless when another caller wins the race.
- [ ] Log transaction signature, draw ID, attempted transition, and error locally without user tracking.



## Next.js Foundation

- [ ] Configure Privy for Solana-only external wallets and auto-connect using `@privy-io/react-auth/solana`.
- [ ] Use `@solana/kit` for RPC, subscriptions, addresses, and transaction construction where Privy supports it.
- [ ] Add `@solana/web3.js` only if a required Privy or Entropy transaction path cannot accept Kit transactions.
- [ ] Support one environment-selected primary RPC and ordered read fallbacks.
- [ ] Keep transaction submission and confirmation on the same RPC endpoint.
- [ ] Add a typed Fate client for account decoding, PDA derivation, instructions, simulation, submission, and confirmation.
- [ ] Subscribe to current draw, vault, connected Staker entry, and connected Player entry.
- [ ] Fall back to bounded polling when a WebSocket subscription drops.
- [ ] Derive phase changes from confirmed on-chain state. Browser timers are display aids, not authority.
- [ ] Show pending, submitted, confirmed, failed, and stale transaction states.
- [ ] Refetch affected accounts after every confirmed transaction.

Privy reference: [Getting started with Privy and Solana](https://docs.privy.io/recipes/solana/getting-started-with-privy-and-solana).

## Page Design



### Visual Thesis

Fate should feel like a quiet financial instrument with a visible element of chance. Use near-black surfaces, neutral text, one non-ORE accent color, tabular figures, restrained borders, and motion only when a draw changes phase. Avoid casino imagery, marketing sections, decorative gradients, and a grid of dashboard cards.

### Content Order

```text
Fate wordmark, network, wallet
live phase, countdown, activation threshold, pool totals
Staker / Player segmented control
one focused deposit or position action
personal odds, exact possible payout, fee, and maximum loss
current position and claim or withdrawal state
ten recent draw results
compact testnet and risk footer
```



### Main Interaction

One segmented control changes the central action between Staker and Player. The amount field, outcome preview, and primary action update in place. Advanced pool composition and formulas remain collapsed on mobile and visible beside the action on desktop.

- [ ] Create a text Fate wordmark and a small initial color/type specimen before component work.
- [ ] Choose one accent that is distinct from ORE's brand.
- [ ] Build the live draw shell before adding historical results.
- [ ] Build the Staker mode with deposit, queued deposit, withdrawal, queued withdrawal, current shares, and current SOL value.
- [ ] Build the Player mode with amount, early boost, personal winner probability, maximum loss, exact payout estimate, deposit, and refund.
- [ ] Disable Staker deposit only during the short settlement transaction window; explain next-draw queuing during funding and countdown.
- [ ] Display funding threshold, elapsed wait, next decay, estimated activation, and five-minute countdown.
- [ ] Display the fee base and Staker erosion before a Player confirms.
- [ ] Display remaining Staker and Player wallet capacity.
- [ ] Build Player claim and transaction status flows.
- [ ] Build ten compact recent-result rows from on-chain state.
- [ ] Put testnet status, age statement, terms placeholder, principal-erosion warning, and program-risk notice in a compact footer.
- [ ] Keep all money figures readable in lamports, SOL, and localized display strings without rounding the transaction amount.
- [ ] Use Lucide icons only where a familiar icon replaces text clearly.
- [ ] Add keyboard focus, labels, contrast, error text, reduced motion, and screen-reader status updates.
- [ ] Verify that no content overlaps at 320px mobile width or common desktop sizes.
- [ ] Do not add browser notifications, email, chat integrations, or analytics in v1.



## App Tests

- [ ] Unit-test threshold, boost, odds, fee, erosion, payout, and share-preview formatting against Rust vectors.
- [ ] Test disconnected, connecting, connected, wrong-network, rejected-signature, submitted, confirmed, and failed states.
- [ ] Test every program phase with fixture accounts.
- [ ] Test that the page never presents a pending Player deposit as committed.
- [ ] Test that the page never describes Staker principal as guaranteed.
- [ ] Test RPC read failover without switching endpoints during transaction confirmation.
- [ ] Test timer resynchronization after sleep, backgrounding, clock drift, and dropped WebSocket connections.
- [ ] Test mobile wallet connection and transaction signing through Privy.
- [ ] Run Biome checks, TypeScript checks, unit tests, and the Next.js production build.
- [ ] Run Playwright against mobile and desktop viewports for deposit, refund, activation, settlement, and claim flows.



## Devnet Release

- [ ] Create separate development authority, protocol treasury, and keeper fee-payer keypairs.
- [ ] Store the authority wallet offline when it is not changing configuration or deploying.
- [ ] Configure a primary devnet HTTP/WSS RPC pair and at least one read fallback.
- [ ] Deploy Entropy dependencies or record the verified existing devnet addresses.
- [ ] Deploy the Fate program with the single development authority.
- [ ] Initialize configuration, vault, registries, treasury, and first draw.
- [ ] Fund the keeper fee payer with a small capped balance.
- [ ] Run at least 1,000 automated devnet draw transitions with scripted wallets.
- [ ] Compare devnet outcomes and balances with simulator predictions.
- [ ] Record compute use, account rent, RPC failure rate, transaction cost, funding time, and Entropy latency.
- [ ] Run a manual mobile-wallet test with at least two wallet providers.
- [ ] Fix every fund-custody, liveness, fairness, or misleading-copy issue before shared testing.
- [ ] Deploy the checked Next.js build to Vercel.
- [ ] Keep the site labeled as devnet and test-only.



## Mainnet Gates

- [ ] Replace synthetic arrival assumptions with observed devnet behavior.
- [ ] Review whether the 512 Staker and 128 Player limits match observed demand and compute use.
- [ ] Complete an independent Solana program security review.
- [ ] Review Entropy's production status, operator assumptions, outage behavior, and economic security.
- [ ] Move upgrade and treasury authority to a multisig.
- [ ] Separate pause authority from treasury authority if operational use warrants it.
- [ ] Obtain legal advice for gambling, age, geofencing, disclosures, and permitted jurisdictions.
- [ ] Publish program IDs, authority addresses, fee address, constants, account model, randomness flow, and source commit.
- [ ] Prepare incident steps that preserve refunds, withdrawals, claims, and locked settlement.
- [ ] Buy and configure the production domain only after these gates pass.



## Definition Of Done For V1

- [ ] A wallet can connect through Privy on mobile and desktop.
- [ ] A Staker can deposit, see shares and current SOL value, withdraw during `FUNDING`, and queue an exit from `ACTIVATED` until settlement.
- [ ] A Player can deposit, see exact risk and probability, refund before activation, and claim after winning.
- [ ] A draw activates from the decayed threshold, counts down, locks, obtains Entropy, selects one wallet, and settles once.
- [ ] Every lamport is accounted for across vaults, claims, refunds, fees, and rounding dust.
- [ ] No administrator or keeper can choose, discard, or reroll a valid result.
- [ ] A provider or keeper outage has a tested recovery path that does not seize user funds.
- [ ] Maximum-capacity settlement fits within measured Solana limits.
- [ ] Program, app, keeper, and devnet flow tests pass from a clean checkout.
- [ ] The page states loss, erosion, pending, commitment, fee, and claim conditions before signature.
