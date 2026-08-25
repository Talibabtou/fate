# Website Shower Report

Date: 2026-08-25  
Mode: read-only repository audit

## Verdict

The repository shape is coherent for Fate: a root Cargo workspace for `api/` and
`program/`, plus one pnpm workspace package under `app/`. No package-boundary
violation or accidental cross-package import was found.

The app source itself currently type-checks and the direct Next.js production
build succeeds. The repository is not cleanly green through its canonical
commands, however: pnpm's install preflight stops on unresolved dependency build
permissions, and Biome reports five current findings. The items below are the
remaining technical-debt and release-gate tasks.

## Open tasks

- [x] **WS-001 — Resolve pnpm build-script policy placeholders**

  - Evidence: `pnpm-workspace.yaml:3-8` now contains explicit `true` approvals for `@reown/appkit`, `bufferutil`, `esbuild`, `keccak`, and `utf-8-validate`.
  - Result: the frozen install passed pnpm's supply-chain policy and ran the approved native/postinstall scripts successfully. `pnpm run check` now reaches Biome instead of failing in pnpm's install preflight.
  - Validate: `CI=1 pnpm install --frozen-lockfile` passed; remaining `pnpm run check` failures are the separate Biome findings listed under WS-005.
  - Risk/boundary: medium; dependency-install policy and supply-chain boundary.

- [ ] **WS-002 — Remove or restore the stale `hrr:bind` command**

  - Evidence: `app/package.json:11` invokes `scripts/hrr-bind.ts`, but that file is absent from `app/scripts/`.
  - Impact: the advertised command is guaranteed to fail and leaves unclear ownership of the old HRR workflow.
  - Safe action: remove the script if it is obsolete, or restore a deliberately scoped implementation with an owner and test. Do not add a replacement based on guessed legacy behavior.
  - Validate: `pnpm --dir app run hrr:bind` if retained, plus `pnpm run check`.
  - Risk/boundary: low runtime risk, medium repository-hygiene risk; developer tooling boundary.

- [x] **WS-003 — Reconcile package-manager lockfiles**

  - Evidence: `package.json:4` declares pnpm; `pnpm-lock.yaml` is now the only tracked JavaScript lockfile. The root `package-lock.json` and `app/package-lock.json` were removed.
  - Result: npm and pnpm can no longer silently resolve separate lockfile graphs for this workspace.
  - Validate: `CI=1 pnpm install --frozen-lockfile` passed with the pnpm lockfile unchanged.
  - Risk/boundary: medium; package boundary and dependency reproducibility.

- [ ] **WS-004 — Make the SBF and production-artifact gate explicit in CI**

  - Evidence: `package.json:12` runs host Cargo tests but does not run `program:build:localnet`, `program:build:production`, or a `cargo test-sbf` script. The release checklist still requires SBF and clean-checkout coverage in `docs/BUILD_PLAN.md:209-210` and `docs/BUILD_PLAN.md:346`.
  - Impact: the default CI command can pass without exercising the deployed SBF artifacts or the SBF runtime test path.
  - Safe action: add a deterministic SBF test command and decide whether artifact builds belong in CI or a separately named release gate. Keep the serial test-thread setting if required by the local validator harness.
  - Validate: run the new gate from a clean checkout and retain the existing host Rust, app, keeper, and build checks.
  - Risk/boundary: medium; release/build boundary.

- [ ] **WS-005 — Clear the current Biome gate**

  - Evidence: direct `biome check app` reports formatting/import-order changes in `app/src/app/globals.css:158` and `app/src/app/page-client.tsx:3-13` plus formatting findings later in `page-client.tsx`. It also reports an unsupported `aria-label` on the progress `<div>` at `page-client.tsx:107` and recommends a semantic `<fieldset>` instead of `role="group"` at `page-client.tsx:124`.
  - Impact: the root `check` command cannot be a clean quality gate even after the pnpm install policy is fixed.
  - Safe action: apply Biome's safe formatting/import fixes, then change the progress indicator and Staker/Player selector to valid accessible semantics without changing transaction behavior.
  - Validate: `pnpm biome:check`, keyboard/screen-reader smoke check, and the direct app type-check.
  - Risk/boundary: low to medium; UI accessibility and formatting boundary.

- [ ] **WS-006 — Triage the Privy optional-module build warning**

  - Evidence: the direct Next build succeeds but warns that `@privy-io/react-auth` cannot resolve optional module `@farcaster/mini-app-solana`, reached through `app/src/app/providers.tsx:3-4`.
  - Impact: the build is successful today, but warnings from the wallet dependency can become a hard failure after a dependency or bundler update.
  - Safe action: check Privy's supported optional-peer configuration; install it only if the selected wallet path needs it, otherwise document or configure the intended optional resolution rather than blindly adding a dependency.
  - Validate: `./node_modules/.bin/next build --webpack` from `app/` with the configured Privy path.
  - Risk/boundary: low current runtime risk, medium upgrade risk; wallet-provider boundary.

- [ ] **WS-007 — Complete the browser RPC reliability boundary before transactions**

  - Evidence: `app/src/lib/fate-browser.ts:23-53` reads one HTTP RPC URL and creates a new client per read. `app/.env.example:5` exposes a WSS variable, but the browser code does not use it or provide ordered read fallbacks. The settled app requirements remain open in `docs/BUILD_PLAN.md:239-248`.
  - Impact: the read-only preview works against one endpoint, but it is not yet resilient to RPC failure and has no subscription-to-polling lifecycle for live draw state.
  - Safe action: centralize an environment-selected primary HTTP/WSS pair and ordered read fallbacks; keep one endpoint fixed for each transaction's submission and confirmation; add bounded polling when subscriptions drop.
  - Validate: unit tests for endpoint failover, dropped-WSS recovery, confirmed-state refresh, and a devnet smoke run.
  - Risk/boundary: medium; external RPC and transaction-consistency boundary.

- [ ] **WS-008 — Split client orchestration and add browser-flow coverage**

  - Evidence: `app/src/app/page-client.tsx:28-242` combines RPC polling, timer display, wallet status/balance, mode/amount state, and page rendering in one client module. The only discovered test file is `app/scripts/fate-client.test.ts`; the browser test work is still open in `docs/BUILD_PLAN.md:293-303`.
  - Impact: adding deposits, exits, claims, pending/confirmed/failed states, and refetches here will make transaction UX and accessibility regressions difficult to isolate.
  - Safe action: keep the page as the client orchestration boundary, but extract wallet controls, draw status, action form, terms/history, and typed transaction state into focused modules. Add a browser smoke suite after wallet actions exist.
  - Validate: mobile-width smoke coverage, wallet connection coverage, transaction-state tests, and `pnpm run app:build`.
  - Risk/boundary: medium; client/server, wallet-session, and UI component boundaries.

- [ ] **WS-009 — Remove the narrow cleanup-account cast**

  - Evidence: `app/scripts/fate-client.ts:564-576` checks that `target` exists and then uses `target as Address` in the non-draw branch.
  - Impact: the runtime guard is sound, but the cast hides the branch relationship from TypeScript.
  - Safe action: narrow the non-draw branch before constructing its account list, preserving the existing runtime error.
  - Validate: `pnpm --dir app check` and `pnpm --dir app test`.
  - Risk/boundary: low; typed instruction-construction boundary.

## Confirmed healthy or intentionally deferred

- `app/tsconfig.json:7-23` has strict TypeScript enabled with consistent module and casing checks; no JavaScript source, `any`, or suppression-heavy pattern was found.
- The root/app package split is intentional and matches `AGENTS.md`; Rust crates are not incorrectly modeled as npm packages.
- Next App Router boundaries are sensible: `page.tsx` is thin, while `providers.tsx` and `page-client.tsx` explicitly own client behavior.
- `app/src/lib/fate-browser.ts` validates account owner, exact size, encoding, and discriminator before decoding state.
- No API route, fetch/JSON contract, global state store, unbounded participant list, raw image tag, or heavy UI dependency problem was found in this scaffold.
- `lib/` is not yet an overgrown junk drawer: its two files have distinct browser-RPC and wallet responsibilities.
- `.next/`, `node_modules/`, `target/`, simulator outputs, `.env`, and `.DS_Store` are ignored generated/local artifacts. They were inspected as scanner noise, not treated as cleanup tasks.
- The `metadata` export in `app/src/app/layout.tsx` is framework-consumed, not unused code.
- The semantic CSS token layer and inline progress width in the current page are intentional; no Tailwind cleanup task is warranted before the dApp interaction work settles.

## Verification performed

- Ran Website Shower's global scanner against `.` and its app scan against `app/`.
- Inspected repository map, file-tree hygiene, package ownership, TypeScript, React/Next, Tailwind/CSS, component, API/data-fetching, state, naming, dependency, performance, placement, and unused-code signals.
- `./node_modules/.bin/tsc --noEmit` from `app/`: passed.
- `./node_modules/.bin/next build --webpack` from `app/`: passed with the Privy optional-module warning recorded above.
- `./node_modules/.bin/biome check app`: failed with the five findings recorded above.
- `pnpm run check`: passed the pnpm install preflight and reached the separate Biome findings recorded under WS-005.
- Verified the stale `hrr:bind` target is absent and confirmed pnpm is the only tracked JavaScript lockfile.

## Audit boundary

This report is read-only audit output. No source, configuration, lockfile, or documentation task was changed. The dApp transaction flow, Entropy production gate, devnet batch, and full browser coverage remain product/release work rather than monorepo-shape findings.
