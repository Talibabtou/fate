# Fate Randomness Gate

Build status and implementation order are tracked in [BUILD_PLAN.md](BUILD_PLAN.md).

Status: **deterministic dev path implemented; mainnet gate pending**
Checked: 2026-08-17

Fate does not depend on Entropy on localnet or devnet. Those deployments use the compile-time `dev-randomness` fixture to exercise the full custody loop, alternating Player and Staker outcomes. The normal production artifact rejects the fixture instruction. Mainnet deployment remains gated on replacing that fixture entry point with the official Entropy account/CPI validation described below.

## Selected Build Path

Fate will build and exercise the complete custody loop on localnet and devnet with the deterministic fixture. Mainnet will use a separate Fate deployment compiled without `dev-randomness` and integrated with the official Entropy program.

Build the dev artifact with `NO_DNA=1 cargo build-sbf --features dev-randomness`. Its `initialize` call accepts placeholder Entropy accounts because they are never read; the System Program ID may be supplied for both fields. `NO_DNA=1 steel build` produces the production artifact and restores strict executable-program, owner, and account-data checks. Both commands write `target/deploy/fate.so`, so always rebuild for the intended cluster immediately before deployment.

The devnet copy should change only environment identity and provisioning behavior. Fate itself must reject predictable missed-slot fallback values so the same protection remains active when the official mainnet Entropy program is used.

## Live Findings

- Entropy program ID: `3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X`.
- The program account does not exist on Solana devnet.
- The program exists on mainnet and is upgradeable.
- Mainnet upgrade authority: `J5K5tWj3nKfxuSkAJ25WTMf4u5EsxJRfUoRKKxgrfFGV`.
- Solana Verify reports the mainnet binary verified at commit `f26ae03cccab6188effb0a170b8123cf4bb54c94`.
- The local `repos/entropy` checkout is at the same commit.
- The provider endpoint at `https://entropy-api.onrender.com` is alive. A request for ORE's current variable returned a valid not-yet-revealed response with the target slot.
- The observed mainnet variable is 240 bytes and holds `0.00256128 SOL` rent. This is evidence for account rent only, not a provider price.
- No provider fee, service guarantee, devnet provisioning flow, or alternate-provider flow is documented in the repository.

## Source Lifecycle

1. `Open` creates one variable with an authority, provider, hash-chain commit, sample count, and future `end_at` slot.
2. At or after `end_at`, any signer may call `Sample` to store the target slot hash.
3. Once sampled, the provider exposes the matching seed.
4. Any signer may call `Reveal`; the program verifies `keccak(seed) == commit` and derives the final value from the slot hash, seed, and remaining sample count.
5. Only the variable authority may call `Next`. It replaces the commit with the revealed seed, clears the result, decrements the sample count, and sets a new future slot.

Fate can make the variable authority a program PDA and expose permissionless wrapper instructions. The keeper would then be a backup caller rather than a trusted randomness operator.

## Blocking Safety Issue

`Sample` reads the hash for `end_at` from the recent slot-hash sysvar. If that slot is no longer present, the program stores:

```text
keccak(end_at)
```

That value is predictable before Player deposits close. Fate must never use an Entropy result produced from this fallback.

The fallback also makes recovery multi-step. The variable cannot call `Next` until the fallback is sampled, its seed is revealed, and the predictable result is finalized. Fate must mark that result unusable, advance the variable to a fresh future slot, and wait again. A provider outage can still prevent reveal indefinitely.

## Required Fate Lifecycle

The intended safe sequence is:

1. Bootstrap and finalize the Fate-owned variable before Player deposits are enabled.
2. Keep the finalized variable idle while the next draw funds and counts down.
3. At `lock_draw`, stop deposits first, then call `Next` with a short future target slot.
4. Store the expected Entropy variable address, `end_at`, and sample generation on the locked draw.
5. Permit anyone to sample while the target slot remains in the recent slot-hash sysvar.
6. Accept a revealed value only when the stored slot hash equals the actual target-slot hash supplied by the slot-hash sysvar path.
7. Derive side and wallet samples with separate domain tags and the draw ID.
8. Use rejection sampling for the 90/10 side roll and weighted-wallet roll.
9. Reject reuse of a variable generation or finalized value.

The exact target-slot offset must be measured on devnet. It should leave enough time for normal keeper delay while remaining well inside the recent slot-hash window.

## Recovery Rule Still Needed

Before custody code is written, choose and test one terminal recovery policy:

- retry fresh Entropy generations permissionlessly while the provider is available, then void and refund the locked draw after a long provider outage; or
- operate a reviewed Fate deployment/provider setup with an explicit availability and recovery design.

Retry logic must never settle from `keccak(end_at)`, allow an authority to replace a valid result, or leave funds locked forever.

## Work Needed To Pass

- Deploy a reviewed Entropy build to devnet under a recorded program ID.
- Establish how the Fate variable's initial commit chain is provisioned.
- Record provider identity, API availability, fees, commit supply, and operating assumptions.
- Add a way for Fate to prove that the actual target slot hash was sampled.
- Implement and test missed-slot, missing-seed, provider-outage, duplicate-reveal, and retry behavior.
- Run an end-to-end devnet cycle: bootstrap, next, sample, reveal, consume, advance.
- Freeze the accepted Entropy source commit or document how upgrades are monitored and approved.

## Evidence Commands

```bash
solana program show 3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X --url devnet
solana program show 3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X --url mainnet-beta
curl -fsS https://verify.osec.io/status/3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X
```

Source references:

- `repos/entropy/program/src/open.rs`
- `repos/entropy/program/src/sample.rs`
- `repos/entropy/program/src/reveal.rs`
- `repos/entropy/program/src/next.rs`
- `repos/entropy/api/src/state/var.rs`
- `repos/ore/program/src/new_var.rs`
- `repos/ore/program/src/reset.rs`
