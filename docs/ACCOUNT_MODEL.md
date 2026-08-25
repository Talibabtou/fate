# Fate Account Model

Build status and implementation order are tracked in [BUILD_PLAN.md](BUILD_PLAN.md).

Fate has no small protocol-level participant cap. It follows the scalable Solana pattern: global aggregate state, one PDA per wallet position, and lazy wallet updates. A verified weighted index replaces registry scans because Fate must select one weighted winner while still supporting Player refunds and Staker withdrawals.

## Accounts

| Account | Size | Approx. rent | Lifetime |
| --- | ---: | ---: | --- |
| `Config` | 256 bytes | 0.00267264 SOL | Persistent |
| `StakerVault` | 56 bytes | 0.00128064 SOL | Persistent custody and share totals |
| `StakerPosition` | 112 bytes | 0.00167040 SOL | One per Staker wallet |
| `Draw` | 344 bytes | 0.00328512 SOL | Per draw; also holds Player SOL |
| `PlayerPosition` | 144 bytes | 0.00189312 SOL | One per Player wallet and draw |
| `WeightPage` | 344 bytes | 0.00328512 SOL | Shared radix-16 index page |

Rent figures use the devnet schedule checked on 2026-08-17; query the target cluster again before deployment.

## Weighted Index

Each tree has eight radix-16 levels and therefore a `u32` leaf namespace: 4,294,967,296 possible positions. A deposit or withdrawal updates eight pages. Settlement receives and verifies the selected path rather than scanning participants. Every page is bound to its tree, level, prefix, canonical PDA, and recorded rent payer.

Sequential leaf allocation makes pages cheap to share: the first position creates the eight-page spine, while a new leaf-level page is needed only once per 16 positions. The root remains one writable hotspot; sharding is deferred until measured contention justifies it.

## Custody And Shares

- `StakerVault` holds Staker SOL, active-asset accounting, exact withdrawal liabilities, and total shares.
- `Draw` holds refundable/committed Player SOL and any outstanding Player winner claim.
- Position and weight accounts contain state and refundable rent only; they do not custody pooled principal.
- Every value-moving instruction preserves the account rent reserve and checks tracked liabilities against actual lamports.

Staker share math remains:

```text
deposit_shares = floor(deposit_lamports * total_shares / active_assets)
withdrawal_lamports = floor(shares * active_assets / total_shares)
```

Player losses raise share value without touching every Staker. Erosion lowers share value the same way. A Staker jackpot mints shares only to the verified winner; if the jackpot is smaller than one share, it becomes an exact claim liability.

## Timing Consequence

Player refunds and Staker withdrawals update the tree during `FUNDING`. New Staker deposits close after the first Player enters, and Staker positions freeze from activation through settlement. This removes the old settlement-time registry scan and queued-action scan. The bounded Staker lock is the five-minute countdown plus permissionless settlement time.

Funding-era Player amounts remain refundable in their position account; activation commits them logically by closing refunds. No per-Player rewrite is required. Countdown deposits are recorded as committed immediately.

## Cleanup

Cleanup is permissionless but rent always returns to the payer recorded in the account:

- `close_player_position` closes a settled position after any winner claim, or a fully refunded voided position.
- `close_weight_page` closes a draw-scoped Player tree page after settlement or voiding.
- `close_draw` requires zero Player positions, zero Player weight pages, zero claims, and expiry from the ten-result history.
- Persistent Staker positions and Staker tree pages remain reusable.

## PDA Domains

```text
config
staker-vault
staker-position + authority
draw + draw_id
player-position + draw_id + authority
weight-page + tree + level + prefix
entropy-authority
```
