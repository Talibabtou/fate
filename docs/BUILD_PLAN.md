# Fate build plan

This file tracks implementation work for Fate's first devnet release. It is a work list, not a release approval. The public mechanism lives in `README.md`; account layout lives in `ACCOUNT_MODEL.md`; user-triggered progression lives in `LIFECYCLE.md`.

Status snapshot: 2026-08-26. The deterministic custody path exists. The app is still being built, and production randomness is not ready.

## Source order

When a task touches these areas, read the matching source first:

| Area | Source |
| --- | --- |
| Product rules and disclosures | `README.md` |
| Account layout and custody | `ACCOUNT_MODEL.md` |
| Draw progression and user-paid fallbacks | `LIFECYCLE.md` |
| Executable economic assumptions | `data-simulation/simulate.py` |
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

The existing `app/scripts/keeper.ts` and keeper batch harness remain development compatibility tools. They are not part of Fate's required operating model.

## Lifecycle migration

The protocol must keep working without a dedicated worker or privileged caller.

- [x] Activate atomically when a Player deposit reaches the live threshold.
- [x] Recalculate the snapshot and activate atomically when a Staker withdrawal makes the threshold reachable.
- [ ] Make the web client detect an expired current draw before every new user action and offer the required permissionless transition first.
- [ ] Make settlement callable by any fee payer with the selected weighted paths; keep caller choice out of the result.
- [ ] Decide whether settlement and the following user action can share one transaction. If not, confirm the first transaction, reread state, then ask for the user action.
- [ ] Keep time-only activation, deadline settlement, randomness recovery, and cleanup permissionless and idempotent.
- [ ] Test the first user after a countdown, two callers racing, stale blockhash retry, RPC failure, paused exits, and a draw with no activity after its deadline.
- [ ] Remove keeper-only environment checks and release steps after the user-driven flow replaces them.

The client must show any extra fee payer, account creation, settlement effect, and transaction before the user signs. No user action should silently pay for unrelated cleanup or lifecycle work.

## Program and account work

- [x] Validate account owner, exact length, discriminator, signer, writability, PDA seeds, canonical bump, stored relationships, and expected program IDs.
- [x] Reject duplicate mutable accounts, reinitialization, substituted accounts, stale phases, unchecked narrowing casts, double settlement, and double claim.
- [x] Keep participant work bounded by one wallet and an eight-page tree path. Never add a shared participant array or settlement-time registry scan.
- [x] Track Player liabilities, Staker withdrawal liabilities, rent reserves, protocol fees, and rounding dust explicitly.
- [ ] Compare simulator vectors with Rust math byte for byte.
- [ ] Run capacity, contention, packet-size, compute, and rent measurements for deposit, refund, withdrawal, activation, settlement, claims, and cleanup.
- [ ] Expand substituted-account and weighted-tree fuzzing beyond the current deterministic matrix.
- [ ] Rerun the full host Rust, SBF, production-feature, and app test matrix after lifecycle changes.

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

- [ ] Configure wallet-only Privy access for Solana external wallets; do not create embedded wallets in v1.
- [ ] Use `@solana/kit` for reads, subscriptions, addresses, and transaction construction where supported.
- [ ] Keep a primary HTTP/WSS RPC pair for each transaction lifecycle and use fallbacks only for reads.
- [ ] Derive phase and balances from confirmed chain state. Browser timers only display expected deadlines.
- [ ] Implement the user-triggered progression in `LIFECYCLE.md`, including clear submitted, confirmed, failed, stale, rejected-signature, and wrong-network states.
- [ ] Show phase, threshold, countdown, side choice, personal odds, exact payout, fee base, pending status, maximum loss, erosion, claim state, and ten recent results before signature.
- [ ] Keep the page mobile-first, dark, calm, and minimal. Avoid casino imagery, marketing sections, decorative gradients, notifications, analytics, and a card-grid dashboard.
- [ ] Test 320px width, keyboard access, reduced motion, contrast, labels, and screen-reader status updates.

## Devnet validation

- [x] Deploy the deterministic five-minute artifact to devnet and keep its program ID and authority records outside the source of truth for product behavior.
- [ ] Run manual Staker and Player flows from external wallets.
- [ ] Run long scripted draw batches using ordinary permissionless callers and user-triggered progression; keeper batches may remain compatibility evidence only.
- [ ] Compare devnet outcomes, balances, fees, claims, withdrawals, rent, funding time, and RPC failures with the simulator.
- [ ] Record artifact hash, program commit, cluster, draw IDs, signatures, and test conditions in dated test evidence, not in this plan's decision sections.
- [ ] Deploy the checked app to Vercel for shared devnet testing and keep the site labeled test-only.

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
- [ ] User activity advances due lifecycle work without a dedicated keeper; permissionless fallback callers remain available.
- [ ] Every lamport is accounted for across vaults, claims, refunds, withdrawals, fees, rent, and rounding dust.
- [ ] No authority, provider, or caller can choose, discard, or reroll a valid result.
- [ ] Provider failure has a tested recovery path that cannot strand user funds.
- [ ] Maximum-capacity settlement fits measured Solana limits.
- [ ] Program, app, simulator, and devnet flow checks pass from a clean checkout.
