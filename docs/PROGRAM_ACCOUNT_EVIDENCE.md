# Program and account evidence

Local validation completed 2026-08-28. This evidence covers the deterministic localnet/devnet artifact and host-side production feature checks. It does not approve a mainnet release or the Entropy integration.

## Exact math parity

`data-simulation/math_vectors.csv` is consumed by both `data-simulation/test_simulate.py` and the Rust API tests. The fixture covers activation floors and decay, Player boosts and weights, erosion caps, both settlement branches, and rounding dust. The Python suite passed 7 tests; the Rust API suite passed 44 tests, including the cross-language vector test.

## Lifecycle resource measurements

The permissionless lifecycle integration benchmark exercises both deterministic winner sides and cleanup. Values are `compute units / serialized transaction bytes`:

| Operation | Measurement |
| --- | ---: |
| Staker deposit | 2,671 / 704 |
| Player deposit | 2,811 / 704 |
| Player refund | 118 / 630 |
| Staker withdrawal | 398 / 671 |
| Atomic activation via Player deposit | 408 / 704 |
| Lock | 141 / 236 |
| Player-side settlement | 525 / 963 |
| Player claim | 258 / 341 |
| Staker-side settlement | 665 / 963 |
| Player-position cleanup | 1 / 277 |
| Weight-page cleanup | 1 / 277 |
| Archived draw cleanup | 1 / 245 |

Every measured packet was below the 1,232-byte packet budget and every measured path was below the integration test's 1.4M compute ceiling. Rent-exemption minima checked by the benchmark are: Config 2,672,640; Draw 3,285,120; Staker vault 1,280,640; Staker position 1,670,400; Player position 1,893,120; and Weight page 3,285,120 lamports.

Capacity covered 117 independent Player positions, each using the eight-page radix-16 path. Contention covered two conflicting Staker withdrawals, with one successful state transition and one rejection.

## Adversarial coverage

The account contract test now runs 128 seeded substituted-account mutations across the Player deposit account list, in addition to signer, writability, owner, length, discriminator, PDA, duplicate-account, and reinitialization cases. The weighted-tree property test runs 2,048 seeded indices and weights, checks endpoint selection, and mutates tree, level, and prefix metadata.

## Matrix

- Host deterministic: `NO_DNA=1 cargo test --workspace --features dev-randomness,fast-localnet` — passed.
- Host production features: `NO_DNA=1 cargo test --workspace --no-default-features` — passed.
- Deterministic SBF build and lifecycle tests: `NO_DNA=1 cargo build-sbf --features dev-randomness,fast-localnet -- --package fate-program` passed, and all 10 lifecycle tests passed when invoked individually with `NO_DNA=1 cargo test-sbf --features dev-randomness,fast-localnet --package fate-program --test lifecycle <test-name>`. The Solana test wrapper launches Tokio integration tests concurrently even when the serialized test argument is supplied; combined runs can therefore hit the SBF 200k-CU meter. No individual lifecycle instruction exceeded that meter.
- Production SBF build and lifecycle tests: `NO_DNA=1 cargo build-sbf --no-default-features -- --package fate-program` and `NO_DNA=1 cargo test-sbf --no-default-features --package fate-program --test lifecycle` — passed.
- App Biome, TypeScript, direct Node tests, and production Next build — passed; 10 app tests passed.
- `cargo fmt --all -- --check`, `git diff --check`, and simulator `py_compile` — passed.
