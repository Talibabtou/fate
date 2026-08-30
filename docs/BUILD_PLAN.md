# Fate build plan

This file tracks implementation work for Fate's first devnet release. It is a work list, not a release approval. The public mechanism lives in `README.md`; account layout lives in `ACCOUNT_MODEL.md`; user-triggered progression lives in `LIFECYCLE.md`.

Status snapshot: 2026-08-27. The deterministic custody path exists. The app is still being built, and production randomness is not ready.

## Source order

When a task touches these areas, read the matching source first:

| Area                                       | Source                        |
| ------------------------------------------ | ----------------------------- |
| Product rules and disclosures              | `README.md`                   |
| Account layout and custody                 | `ACCOUNT_MODEL.md`            |
| Draw progression and user-paid fallbacks   | `LIFECYCLE.md`                |
| Executable economic assumptions            | `data-simulation/simulate.py` |
| Rust state, math, and instruction behavior | `api/`, `program/`, and tests |

If sources disagree, stop and name the conflict. An explicitly checked decision in this file temporarily outranks an unchecked proposal, but code changes must also update the affected documentation.

## Implemented foundation

- [x] Root Steel workspace with `api/`, `program/`, and SVM integration tests.
- [x] Native SOL custody with per-wallet Staker and Player accounts.
- [x] Authenticated eight-page radix-16 weighted indexes for Staker shares and Player positions.
- [x] Funding, refunds, Staker withdrawals, threshold decay, activation, countdown deposits, claims, cleanup, pause exits, and deterministic settlement custody.
- [x] Player deposits and Staker withdrawals activate a reachable draw in the same transaction.
- [x] Localnet and devnet deterministic settlement behind the `dev-randomness` feature; the production artifact rejects that instruction.
- [x] Integer math, weighted-path verification, account validation, direct-donation handling, custody checks, and one-time settlement/claim guards.
- [x] Basic Next.js, Privy, Kit, RPC fallback, client decoding, and browser state foundation.
- [x] Root commands for Rust, SBF, app, localnet, devnet configuration, and artifact checks.

The protocol and client use permissionless progression. No dedicated lifecycle worker or caller key is required.

## CI/CD hardening

The workflow now reaches a successful Vercel deployment for app changes. The remaining work makes those checks enforceable, keeps the program gate honest, and gives deployments a tested recovery path.

### Working baseline

- [x] Detect app and program changes separately, run their checks in parallel, and let the required-check job accept intentional skips.
- [x] Install JavaScript dependencies from the frozen pnpm lockfile and cache the pnpm and Rust toolchains.
- [x] Use Node 24-compatible GitHub Action releases.
- [x] Run `vercel pull`, `vercel build`, and `vercel deploy --prebuilt` in the same deploy job so Vercel sees one consistent workspace.
- [x] Keep fork pull requests away from Vercel secrets and deployment jobs.

### Ordered hardening work

- [ ] Protect `main` with a branch ruleset that requires `CI / Required checks`, blocks force-pushes, and requires pull requests before merge.
- [x] Run `pnpm app:build` in `app-checks` for every app change so the application build is part of the merge gate, not only a later deployment step.
- [x] Run `cargo fmt --all -- --check`, host Rust tests, and the SBF lifecycle tests in `program-checks`; include the production-feature test where its toolchain is available.
- [x] Include the root `package.json` and workflow files in change detection.
- [ ] Add a dedicated workflow syntax and action-reference validation step.
- [ ] Stop passing `VERCEL_TOKEN` through CLI arguments; let the Vercel CLI read it from the job environment and keep token values out of process arguments.
- [ ] Publish a concise job summary on failure with the failed gate, relevant command, and link to the run so failures can feed directly into the agent repair loop.

## Lifecycle migration

The protocol must keep working without a dedicated worker or privileged caller.

- [x] Activate atomically when a Player deposit reaches the live threshold.
- [x] Recalculate the snapshot and activate atomically when a Staker withdrawal makes the threshold reachable.
- [ ] Make the web client detect an expired current draw before every new user action and offer the required permissionless transition first.
- [x] Make settlement callable by any fee payer with the selected weighted paths; keep caller choice out of the result.
- [ ] Decide whether settlement and the following user action can share one transaction. If not, confirm the first transaction, reread state, then ask for the user action.
- [ ] Keep time-only activation, deadline settlement, randomness recovery, and cleanup permissionless and idempotent.
- [ ] Test the first user after a countdown, two callers racing, stale blockhash retry, RPC failure, paused exits, and a draw with no activity after its deadline.
- [x] Remove dedicated-caller environment checks and release steps; progression uses the connected wallet or any permissionless caller.

The client must show any extra fee payer, account creation, settlement effect, and transaction before the user signs. No user action should silently pay for unrelated cleanup or lifecycle work.

## Program and account work

- [x] Validate account owner, exact length, discriminator, signer, writability, PDA seeds, canonical bump, stored relationships, and expected program IDs.
- [x] Reject duplicate mutable accounts, reinitialization, substituted accounts, stale phases, unchecked narrowing casts, double settlement, and double claim.
- [x] Keep participant work bounded by one wallet and an eight-page tree path. Never add a shared participant array or settlement-time registry scan.
- [x] Track Player liabilities, Staker withdrawal liabilities, rent reserves, protocol fees, and rounding dust explicitly.
- [x] Compare simulator vectors with Rust math byte for byte.
- [x] Run capacity, contention, packet-size, compute, and rent measurements for deposit, refund, withdrawal, activation, settlement, claims, and cleanup.
- [x] Use an explicit transaction compute limit for first-account initialization and retain a separate measured usage ceiling for SBF regressions.
- [x] Expand substituted-account and weighted-tree fuzzing beyond the current deterministic matrix.
- [x] Rerun the full host Rust, SBF, production-feature, and app test matrix after lifecycle changes.

## Randomness gate

Localnet and devnet use the deterministic fixture only. It proves custody and state transitions; it does not prove fairness. See [RANDOMNESS_GATE.md](RANDOMNESS_GATE.md) for the reviewed Entropy findings and production requirements.

- [ ] Create and verify a Fate-owned Entropy variable; never share ORE's variable.
- [ ] Decide how a variable generation advances so no usable random value exists before Player deposits close.
- [ ] Reconcile the five-minute timestamp countdown with Entropy's slot-based target.
- [ ] Require the expected Entropy program, variable, owner, generation, target slot, finalized value, and commit/reveal relationship.
- [x] Keep side and wallet samples domain-separated by draw ID and use rejection sampling.
- [ ] Reject Entropy's predictable missed-slot fallback and prevent reuse across draws.
- [ ] Add a bounded permissionless retry or void-and-refund path for missed slots, missing seeds, and provider outages.
- [ ] Add controlled or forked production-path tests without requiring an Entropy devnet deployment.
- [ ] Recheck the deployed Entropy binary, pinned source, provider availability, cost, commit supply, timing, and recovery before mainnet.

## Web app

The current page is a working prototype. The first extraction into a navbar, main section, and footer created a useful route shell, but the client page still owns protocol decisions, data reads, wallet state, and transaction actions. Complete the work below in order.

### 1. Clean the module boundaries

- [x] Keep the App Router entry point thin and preserve the initial navbar/main/footer route shell.
- [x] Create `src/domain/fate/` for account types, decoders, address derivation, instruction builders, and protocol-side rules.
- [x] Keep Fate account, instruction, and rule modules in the domain boundary; keep `scripts/` for CLI and integration tools only.
- [x] Create `src/lib/rpc/` for validated public configuration, RPC construction, read fallback, and subscriptions.
- [x] Split `src/lib/fate-browser.ts` into RPC adapters, Fate snapshot queries, and deterministic devnet settlement participant lookup.
- [x] Split `src/lib/fate-transactions.ts` into transaction planning, execution, confirmation, and structured error handling.
- [x] Keep all protocol behavior in testable domain/data modules rather than in page components.

### 2. Centralize configuration and wallet state

- [x] Add one typed public configuration module for network, program ID, primary RPC, fallback RPCs, WSS RPC, and Privy app ID.
- [x] Fail clearly when required devnet configuration is missing or invalid; don't scatter direct `process.env` reads through the page.
- [x] Keep wallet-only Privy access for external Solana wallets; don't create embedded wallets in v1.
- [x] Add a `useWalletSession` boundary that owns the selected wallet, address, network status, balance, connect, and disconnect state.
- [x] Handle multiple available wallets deliberately instead of assuming `wallets[0]` is always the user's active wallet.
- [x] Remove or document the custom `.env.local` loading in `next.config.ts` so build-time configuration has one predictable source.

### 3. Make reads and lifecycle state dependable

- [ ] Add an explicit snapshot state model: loading, ready, refreshing, stale, disconnected, and error.
- [ ] Prevent overlapping snapshot reads from allowing an older RPC response to overwrite newer state.
- [ ] Keep config, draw, vault, and position reads coherent at one confirmed slot, or detect and discard an inconsistent snapshot.
- [ ] Retry only transport or endpoint-availability failures. Surface malformed accounts, wrong owners, discriminator failures, and inconsistent state directly.
- [ ] Use `@solana/kit` for reads, subscriptions, addresses, and transaction construction wherever the required integration supports it.
- [ ] Keep one primary HTTP/WSS RPC pair for each transaction lifecycle; use ordered fallbacks only for reads.
- [ ] Derive phase and balances from confirmed chain state. Browser timers may display expected deadlines, but must not decide protocol state.

### 4. Replace the large page controller with feature hooks

- [ ] Reduce `page-client.tsx` to route composition and feature coordination.
- [ ] Add a `useFateActions` hook for deposit, refund, withdrawal, claim, validation, review state, and transaction execution.
- [ ] Add a `useLifecycleProgress` hook that detects due activation or settlement after account notifications, page focus, tab visibility, refreshes, and user actions.
- [ ] Surface a due permissionless transition before the next user action, as specified in `LIFECYCLE.md`.
- [ ] Never silently sign or submit a lifecycle transaction because of passive activity; show the action, fee payer, account effects, and transaction state before wallet approval.
- [ ] Make the lifecycle flow handle two callers racing, stale state, provider failure, and the choice between separate or combined transactions.

### 5. Break `FateMain` into focused Fate components

- [ ] Extract `DrawHeader` and `DrawProgress`.
- [ ] Extract `LifecyclePrompt`.
- [ ] Extract `PositionActionForm` and secondary actions.
- [ ] Extract `TransactionReview`.
- [ ] Extract `DrawTerms` and `RecentDraws`.
- [ ] Keep component props small and use a Fate view model where several components need the same derived values.
- [ ] Keep Fate-specific components local; don't introduce a generic design system until a second real page needs it.

### 6. Finish the transaction UX before shared devnet testing

- [ ] Keep simulation before signing and confirmation on the same primary RPC endpoint.
- [ ] Add clear states for simulation, wallet approval, submission, confirmation, rejection, on-chain failure, blockhash expiry, timeout, and wrong network.
- [ ] Reconcile a timed-out signature before allowing the user to retry, so an unknown transaction cannot be submitted twice accidentally.
- [ ] Show estimated network fee, fee payer, transfers, claim or liability changes, and the exact post-action state in the review.
- [ ] Show phase, threshold, countdown, side choice, personal odds, exact payout, fee base, pending status, maximum loss, erosion, claim state, and ten recent results before signature.
- [ ] Keep the page mobile-first, dark, calm, and minimal. Avoid casino imagery, marketing sections, decorative gradients, notifications, analytics, and a card-grid dashboard.

### 7. Make the UI resilient and accessible

- [ ] Add route-level `loading.tsx` and `error.tsx` states for RPC and render failures.
- [ ] Add live-region announcements for wallet, lifecycle, transaction, and read-status changes.
- [ ] Make the transaction review a real modal interaction if it remains a dialog: focus management, escape handling, focus return, and an explicit cancel path.
- [ ] Make the wallet menu keyboard-accessible, including focus movement and escape behavior, or use button/popover semantics that match its actual behavior.
- [ ] Test 320px width, keyboard access, reduced motion, contrast, labels, and screen-reader status updates.
- [ ] Keep global CSS for reset, tokens, and shared typography; move Fate feature styles into namespaced styles or CSS Modules.
- [ ] Use integer-safe SOL formatting helpers. Don't convert lamports to `Number` for displayed financial values.

### 8. Add application-level verification

- [ ] Test domain validation, action availability, amount parsing, formatting, and transaction instruction plans.
- [ ] Test snapshot cancellation, stale-response protection, slot consistency, fallback classification, and subscription recovery.
- [ ] Test wallet connection, wrong-network handling, disconnect failure, and balance loading states.
- [ ] Test the transaction state machine, including wallet rejection, simulation failure, blockhash expiry, timeout reconciliation, and duplicate-submit protection.
- [ ] Add a browser flow with mocked wallet and RPC: connect, read state, choose a side, review, simulate, approve, confirm, and refresh.
- [ ] Add automated accessibility checks for the primary page and transaction review.

The first implementation pass should stop after section 1 and keep behavior unchanged. Each later section should leave TypeScript, Biome, tests, and the production build passing before the next section starts.

## Devnet validation

- [x] Deploy the deterministic five-minute artifact to devnet and keep its program ID and authority records outside the source of truth for product behavior.
- [x] Run manual Staker and Player flows from external wallets.
- [ ] Run long scripted draw batches using ordinary permissionless callers and user-triggered progression.
- [ ] Compare devnet outcomes, balances, fees, claims, withdrawals, rent, funding time, and RPC failures with the simulator.
- [ ] Record artifact hash, program commit, cluster, draw IDs, signatures, and test conditions in dated test evidence, not in this plan's decision sections.
- [x] Deploy the checked app to Vercel for shared devnet testing and keep the site labeled test-only.

## Mainnet gates

- [ ] Replace synthetic simulator arrivals with observed devnet behavior before freezing parameters.
- [ ] Complete an independent Solana program security review.
- [ ] Complete the Entropy review and terminal recovery rehearsal.
- [ ] Move upgrade and treasury authority to a multisig; separate pause authority if required.
- [ ] Obtain legal advice for gambling, age, geofencing, disclosures, and permitted jurisdictions.
- [ ] Publish program IDs, authorities, fee address, constants, account model, randomness flow, and source commit.
- [ ] Confirm incident actions preserve refunds, withdrawals, claims, and settlement.
- [ ] Buy and configure the production domain only after the earlier gates pass.

## V1 definition of done

- [ ] A wallet connects through Privy on mobile and desktop.
- [ ] Stakers can deposit, see current value, withdraw during `FUNDING`, and understand the activation-to-settlement lock.
- [ ] Players can deposit, see personal odds and full-loss risk, refund before activation, and claim after winning.
- [ ] User activity advances due lifecycle work without a dedicated worker; permissionless fallback callers remain available.
- [ ] Every lamport is accounted for across vaults, claims, refunds, withdrawals, fees, rent, and rounding dust.
- [ ] No authority, provider, or caller can choose, discard, or reroll a valid result.
- [ ] Provider failure has a tested recovery path that cannot strand user funds.
- [ ] Maximum-capacity settlement fits measured Solana limits.
- [ ] Program, app, simulator, and devnet flow checks pass from a clean checkout.
