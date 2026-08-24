# Fate Build Plan

This checklist records the settled implementation choices and build order for the first devnet version of Fate's single-page Next.js dApp and Solana program.

Last fully reconciled with the product model, simulator, program, keeper, and current frontend integration guidance: 2026-08-24.

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
- [x] Freeze Staker withdrawals from `ACTIVATED` through settlement.
- [x] Queue new Staker deposits for the following draw after the first Player arrives.
- [x] Do not expire or cancel a funding draw based on elapsed time.
- [x] Charge the Player-side 5% fee on losing Player deposits and Staker erosion, excluding only the winner's deposit.
- [x] Give countdown deposits `1.00x` weight with no early-funding boost.
- [x] Automatically credit Staker winnings on-chain through vault value and jackpot shares, using an exact claimable liability only when a jackpot is too small to represent safely as one share.
- [x] Credit the full Player payout to an on-chain claim balance.
- [x] Keep economic parameters constant in v1.
- [x] Use devnet for interactive testing before any mainnet release.
- [x] Omit notifications and analytics from v1.
- [x] Use the Entropy implementation in `repos/entropy` as the mainnet randomness dependency; localnet and devnet use the feature-gated deterministic fixture.

## Closed Protocol Decisions

These decisions were resolved before custody implementation and remain protocol source of truth.

- [x] Resolve the funding liveness conflict.
  Staker withdrawals execute immediately during `FUNDING`. Each withdrawal updates the Staker TVL snapshot, activation floor, and active threshold. Withdrawals are rejected after `ACTIVATED` starts the five-minute countdown, keeping Staker winner weights fixed through settlement. Player deposits remain refundable throughout `FUNDING`.

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
  Mainnet readiness must still verify the deployed program, pinned source, provider availability, cost, commit supply, timeout behavior, and recovery path. Fate does not deploy or depend on Entropy on localnet or devnet.

## Exact Economic Model

- [x] Convert every percentage to integer basis points or parts per million. Never calculate payouts with floating point on-chain.
- [x] Define a single rounding policy: all divisions round down, and remaining lamports go to the protocol treasury.
- [x] Calculate activation from the first-Player timestamp and the funding Staker TVL snapshot: queued deposits cannot raise it, while immediate Staker withdrawals reduce it.
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
- [x] Prove that Player principal cannot be committed before activation.
- [x] Prove that Staker winnings and erosion are reflected by vault share value.

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
  app/                  Keeper script and planned Next.js application
  api/                  Steel state, instructions, errors, events, and Rust SDK
  program/              Solana instruction handlers
  program/tests/        SVM and SBF program integration tests
  data-simulation/      Simulator, scenario runner, retained reports, and summaries
  docs/                 Build plan, account model, and randomness gate
  AGENTS.md             Required repository-scoped agent instructions
  README.md             Current product model
```

- [x] Initialize a root Cargo workspace containing `api` and `program`.
- [x] Follow the layout and account-validation patterns in `repos/steel` and `repos/steel-book`.
- [x] Scaffold `app` with Next.js, TypeScript, Tailwind CSS, pnpm, and the App Router. The first page is a read-only Kit-backed Fate state surface; wallet connection and transaction actions remain the next frontend gate.
- [x] Add Biome with format, lint, and import-order checks for the keeper and app TypeScript.
- [x] Add root commands for program tests, production-feature tests, SBF builds, app checks/tests, localnet and devnet configuration validation, localnet e2e, and the keeper batch. Devnet deployment remains a guarded manual step.
- [x] Document required tool versions and environment variables.
- [x] Keep RPC URLs, Privy app ID, program ID, Entropy addresses, and keeper keys out of source control.

## On-Chain Accounts

Use per-wallet PDAs and an authenticated weighted tree. Never make activation or settlement scan all participants.

- [x] Define `Config` with authority, fee treasury, pause state, current draw ID, and program version.
- [x] Define `StakerVault` with active assets, exact withdrawal liabilities, total shares, lifetime accounting, and sequential position indexes.
- [x] Define one persistent `StakerPosition` PDA per wallet.
- [x] Store active shares, exact claim liability, lifetime deposits, and weighted-tree leaf index in each Staker position.
- [x] Define `Draw` with state, timestamps, snapshots, threshold data, Player totals, Entropy reference, result, fee, erosion, winner, and claim state.
- [x] Define one `PlayerPosition` PDA per wallet and draw with no small participant-count cap.
- [x] Store each Player wallet's refundable deposit, committed deposit, summed boosted weight, claim, and leaf index.
- [x] Add an eight-level radix-16 weighted index that updates and verifies winner paths in logarithmic work.
- [x] Store the ten latest settled draw IDs in a fixed ring buffer in `Config`.
- [x] Derive every PDA from fixed prefixes and explicit IDs.
- [x] Calculate account rent and publish it in the technical notes.
- [x] Bound long-term rent by closing settled Player positions, draw-scoped weight pages, and expired Draw accounts; return rent only to each recorded payer.
- [x] Benchmark weighted-path transaction compute and packet size. The eight-page SVM paths measured: deposit `2,811 CU / 704 bytes`, refund `118 / 630`, Staker withdrawal `258 / 671`, repeat Player deposit `408 / 704`, activation `141 / 236`, lock `141 / 236`, Player settlement `525 / 963`, Player claim `258 / 341`, and Staker settlement `525 / 963`.
- [x] Prove the old 116-Player boundary is gone with a 117-wallet runtime test.

## Program Instructions

- [x] `initialize`: create configuration, vault, first draw, and treasury/randomness references in one transaction.
- [x] Reserve the removed `grow_program_accounts` discriminator and reject it.
- [x] `deposit_stake`: create/reuse one wallet PDA, update its verified tree path, transfer SOL, and mint shares before Player funding begins.
- [x] `request_stake_withdrawal`: execute during `FUNDING`, update the verified tree path, and recalculate the snapshot and threshold when Players are present.
- [x] `deposit_player`: create/update one wallet PDA and its verified draw tree path, transfer SOL, record boosted weight, and create the first-Player snapshot.
- [x] `refund_player`: return the wallet's full pending position and remove its weight before activation.
- [x] Reset the funding clock and snapshot if every Player refunds before activation.
- [x] `activate_draw`: verify the live decayed threshold and start the five-minute countdown.
- [x] Treat every Player deposit during countdown as committed immediately.
- [x] `lock_draw`: permissionlessly close deposits at the exact countdown boundary.
- [x] `settle_draw_dev`: in an explicitly feature-gated localnet/devnet build, alternate deterministic Player and Staker fixtures, select exactly one wallet, settle custody, and atomically create the next draw.
- [ ] `settle_draw`: replace only the dev fixture source with a verified mainnet Entropy CPI/account gate before production deployment.
- [x] On a Player win, move the full payout into the winner's claimable balance.
- [x] On a Staker win, add the 65% distribution to vault assets and mint jackpot shares without reducing other Stakers' ownership value; use an exact withdrawal liability for a sub-share jackpot.
- [x] `claim_stake_withdrawal`: pay a Staker's frozen post-settlement withdrawal liability without depending on pause or the current draw.
- [x] `claim_player`: transfer the full recorded claim once and mark it claimed.
- [x] `pause`: stop new deposits and activation.
- [x] `unpause`: reopen new deposits and activation.
- [x] Ensure pause never blocks pending Player refunds, Staker exits, locked-draw settlement, or claims.
- [x] Add permissionless cleanup for settled Player positions, draw weight pages, and expired Draw headers, returning rent to recorded payers.
- [x] Emit compact fixed-binary events for deposits, refunds, activation, lock, settlement, claims, pause changes, and withdrawal requests. Event tags and payload sizes are covered by API tests.

## Randomness

Build order decision: localnet and devnet use a deterministic settlement fixture compiled only with `dev-randomness`. Even draw IDs exercise Player settlement and odd draw IDs exercise Staker settlement. The normal production build rejects that instruction. Before mainnet, replace the fixture gate with the official mainnet Entropy call and retain the same audited selection and settlement core.

- [x] Read `repos/entropy` and ORE's `new_var`, `deploy`, and `reset` handlers as the integration references.
- [ ] Create a Fate-owned Entropy variable rather than sharing ORE's variable.
- [ ] Decide when the Entropy variable advances so no random value is knowable before Player deposits close.
- [ ] Reconcile the five-minute Unix timestamp countdown with Entropy's slot-based `end_at` value.
- [ ] Require a finalized Entropy value owned by the expected Entropy program and Fate authority.
- [x] Derive separate side and winner samples with domain-separated Keccak hashes containing the draw ID.
- [x] Use rejection sampling to prevent modulo bias in side and weighted-wallet selection.
- [ ] Prevent reuse of one Entropy result across draw IDs.
- [ ] Define a bounded permissionless retry or void-and-refund path whose timing is derived from Entropy's slot window and provider behavior.
- [ ] Never permit the authority or keeper to replace a valid finalized result.
- [ ] Add production-path integration tests for Fate's Entropy account/CPI validation and result consumption using controlled or forked account states, without requiring an Entropy devnet deployment.

Verification on 2026-08-17 found no Entropy program at its declared ID on devnet. The same ID was verified and active on mainnet at Entropy commit `f26ae03cccab6188effb0a170b8123cf4bb54c94`, and the provider seed endpoint responded. The reviewed source substitutes predictable `keccak(end_at)` data when the target slot has aged out of the recent slot-hash sysvar. Fate must reject that fallback and define a bounded retry or refund path before mainnet deployment. See `RANDOMNESS_GATE.md`.

## Program Tests

The SVM lifecycle runs through the real Solana runtime and proves that 117 distinct Player wallets can enter one draw. It separately covers initialization, Staker/Player deposits, activation, countdown locking, weighted-path settlement, Player claim, position/page rent cleanup, and creation of the following draw. The localnet audit harness now covers adversarial phase and authority checks, funding refunds and withdrawals, direct donations, custody checks, both deterministic settlement sides, double-settlement and double-claim rejection, pause-safe settlement, draw cleanup, next-draw creation, and the final-Staker exit guard. Deterministic math now has randomized lamport-conservation and overflow-boundary coverage, and program dispatch has malformed wire/account-list tests; broad substituted-account fuzzing and mainnet Entropy validation remain pending.

- [ ] Test all state transitions and reject transitions from the wrong phase.
- [ ] Test every instruction's owner, data-length, discriminator, signer, writable/read-only, PDA seed, canonical bump, and stored-relationship validation.
- [ ] Test reinitialization, pre-funded PDA initialization, duplicate mutable accounts, fake sysvars, substituted CPI programs, and account type cosplay.
- [x] Test direct lamport donations cannot change tracked assets, liabilities, or shares.
- [x] Assert tracked custody assets plus rent cover the tested refunds, withdrawals, and claims after each audited value-moving path.
- [ ] Test threshold decay at every 10-minute boundary.
- [x] Test activation at, below, and above the exact threshold.
- [x] Test the larger-of-two activation floor at several Staker TVLs.
- [x] Test deposits immediately before and after snapshot, activation, countdown start, and settlement.
- [x] Test one Player, multiple Player positions, multiple Staker positions, and repeat wallet participation.
- [x] Test wallet aggregation so one wallet can win only once.
- [x] Test early-boost boundaries and deposits made during countdown.
- [x] Test Staker share-price gains, erosion, jackpot share minting, deposits, and withdrawals.
- [x] Test zero losing-Player deposits so a solo Player's own principal is never charged as profit.
- [x] Test the 5% fee on erosion.
- [x] Test every covered rounding remainder and arithmetic overflow boundary; retain a broader fuzz campaign as a separate security gate.
- [ ] Test malformed, substituted, duplicate, non-writable, and incorrectly owned accounts.
- [x] Test unauthorized administration and false Entropy accounts.
- [x] Test double settlement, double claim, replay rejection, and stale phase transitions. Production Entropy freshness remains pending.
- [x] Test expired-account closure cannot strand refunds or claims, close a recent draw, redirect rent, or close twice.
- [x] Test paused-state exits and locked-draw settlement.
- [x] Run 10,000 randomized settlement invariant cases for lamport conservation, exact fee remainder assignment, and Staker split conservation. Randomized tree/share ownership invariants remain part of the security review.
- [x] Run `steel test`, `steel build`, and `cargo test-sbf` for the deterministic devnet baseline.
- [ ] Rerun the full Rust, SBF, and production-artifact test matrix after the mainnet Entropy-gated instructions are complete.

## Keeper

The keeper is a small script, not a service platform. State transitions remain callable by anyone.

- [x] Add one Node script under `app/scripts` that reads the current draw and submits only a transition that is due. Run it as a separate long-lived worker; see `KEEPER.md`.
- [ ] Handle activation, locking, Entropy sampling and reveal, timeout recovery, and settlement. Activation, locking, and feature-gated dev settlement are implemented; mainnet Entropy remains.
- [ ] Use a dedicated hot fee-payer key with a limited SOL balance.
- [x] Keep the authority and fee treasury wallet out of the keeper process.
- [ ] Fund keeper transaction fees from protocol revenue by manual treasury transfer in v1.
- [x] Do not add an on-chain caller reward in v1.
- [x] Make every keeper action idempotent and harmless when another caller wins the race.
- [x] Log transaction signature, draw ID, attempted transition, and error locally without user tracking.
- [x] Close eligible position/page storage and confirm the draw cleanup counters reach zero.

## Localnet Gate

- [x] Build and deploy the `dev-randomness,fast-localnet` artifact to a clean local validator, then initialize and exercise the complete minimal account path, including weighted-tree pages. The fast fixture uses a 30-second countdown; the normal artifact remains five minutes.
- [x] Run the keeper through at least twelve consecutive draws to cover both deterministic sides, recent-history rollover, and storage cleanup. The 2026-08-24 localnet batch passed 12 draws, alternated deterministic sides, rolled the recent ring to draw IDs 11 through 2, and converged cleanup.
- [x] Exercise deposits, refunds, activation, locking, both settlements, Player claims, Staker withdrawals, frozen activated exits, pause-safe settlement, and account closure through local RPC transactions.
- [x] Stop and restart the keeper during each actionable phase and confirm it resumes safely without privileged state or duplicate transitions. The batch launched a fresh `keeper.ts --once` process for each observed, activation, lock, and settlement transition: 48 keeper restarts, ending in `KEEPER_BATCH_PASS`.
- [x] Reconcile every localnet balance delta, fee, claim, liability, and rent refund with the Rust economic model before devnet deployment. The 2026-08-24 audit asserted both deterministic settlement sides, exact protocol-fee deltas, vault assets/liabilities, draw claims, direct donations, and post-cleanup custody invariants.

The verified localnet audit on 2026-08-24 deployed program `BRBMYpjn9hCw9h5T7efxm1qAeHFi8JaGuubioTBQ13zU` with placeholder Entropy accounts and ended with `LOCALNET_AUDIT_PASS`. The fast-localnet artifact used a 30-second countdown and covered reinitialization rejection, pause authorization, paused deposits, funding refund/reset, funding withdrawal and threshold recalculation, direct vault donation, activation boundaries, frozen Staker exits, both deterministic settlement sides, double settlement rejection, Player claim and double-claim rejection, position/page cleanup, paused settlement, the last-Staker exit guard, final refund, final withdrawal, exact settlement accounting, and custody solvency. The 2026-08-24 keeper batch ended with `KEEPER_BATCH_PASS` after 12 draws and 48 fresh keeper processes, including recent-history rollover and cleanup convergence.

## Next.js Foundation

- [ ] Configure wallet-only Privy access for Solana external wallets with `toSolanaWalletConnectors({ shouldAutoConnect: true })`; do not create embedded wallets in v1.
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
- [ ] Build the Staker mode with deposit availability, Funding withdrawal, frozen countdown state, current shares, and current SOL value.
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
- [ ] Verify the deployed devnet artifact has `dev-randomness` enabled and has no live Entropy dependency.
- [ ] Deploy the Fate program with the single development authority.
- [ ] Initialize configuration, vault, treasury, and first draw on devnet.
- [ ] Fund the keeper fee payer with a small capped balance.
- [ ] Run at least 1,000 automated devnet draw transitions with scripted wallets.
- [ ] Compare devnet outcomes and balances with simulator predictions.
- [ ] Record compute use, account rent and recovery, RPC failure rate, transaction cost, funding time, and keeper transition latency.
- [ ] Run a manual mobile-wallet test with at least two wallet providers.
- [ ] Fix every fund-custody, liveness, fairness, or misleading-copy issue before shared testing.
- [ ] Deploy the checked Next.js build to Vercel.
- [ ] Keep the site labeled as devnet and test-only.

## Mainnet Gates

- [ ] Replace synthetic arrival assumptions with observed devnet behavior.
- [ ] Benchmark weighted-path refund, withdrawal, settlement, contention, and rent under observed demand. Deposit-path compute and packet measurements are recorded above.
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
- [ ] A Staker can deposit, see shares and current SOL value, withdraw during `FUNDING`, and remain locked from `ACTIVATED` through settlement.
- [ ] A Player can deposit, see exact risk and probability, refund before activation, and claim after winning.
- [ ] A draw activates from the decayed threshold, counts down, locks, uses the deterministic fixture on devnet or verified Entropy on mainnet, selects one wallet, and settles once or follows the audited terminal recovery path.
- [ ] Every lamport is accounted for across vaults, claims, refunds, fees, and rounding dust.
- [ ] No administrator or keeper can choose, discard, or reroll a valid result.
- [ ] A provider or keeper outage has a tested recovery path that does not seize user funds.
- [ ] Maximum-capacity settlement fits within measured Solana limits.
- [ ] Program, app, keeper, and devnet flow tests pass from a clean checkout.
- [ ] The page states loss, erosion, pending, commitment, fee, and claim conditions before signature.
