# Fate Account Model

Build status and implementation order are tracked in [BUILD_PLAN.md](BUILD_PLAN.md).

Checked against Solana devnet: 2026-08-17

Fate uses fixed Steel accounts and one Player custody account per draw. All tracked asset fields exclude rent lamports.

## Accounts

| Account | Data size | Devnet rent-exempt minimum | Lifetime |
|---|---:|---:|---|
| `Config` | 256 bytes | 0.00267264 SOL | Persistent |
| `StakerVault` | 56 bytes | 0.00128064 SOL | Persistent |
| `StakerRegistry` | 36,880 bytes | 0.25757568 SOL | Persistent |
| `Draw` | 320 bytes | 0.00311808 SOL | Retain for recent results, then close |
| `PlayerRegistry` | 11,288 bytes | 0.07945536 SOL | One per draw; retain while refunds or a claim remain |

Initial configuration plus the first draw costs approximately `0.34410240 SOL` in refundable account rent. Each additional live `Draw` and `PlayerRegistry` pair costs approximately `0.08257344 SOL`. Query rent again before deployment because cluster economics can change.

## Custody

- `StakerVault` holds Staker SOL plus its own rent reserve. `active_assets_lamports` and `pending_assets_lamports` never include rent.
- Each `PlayerRegistry` holds that draw's refundable deposits, committed deposits, or winner claim plus its rent reserve.
- `Config`, `StakerRegistry`, and `Draw` hold only their rent reserves.
- Protocol fees leave custody accounts during settlement and go to the configured fee treasury.
- A transaction must never transfer an account below its rent reserve or below its tracked user liabilities.

On a Player win, erosion moves from `StakerVault` to the draw's `PlayerRegistry`; the fee moves to the treasury; the remaining payout stays claimable in the registry. On a Staker win, the Player registry transfers the jackpot and pro-rata amounts into `StakerVault` and the fee into the treasury.

## Fixed Registries

- `StakerRegistry` contains 512 entries of 72 bytes.
- `PlayerRegistry` contains 128 entries of 88 bytes.
- One wallet occupies at most one entry in each registry.
- Repeat deposits aggregate into the existing wallet entry.
- Empty entries can be reused.
- Player boosted weight is stored as two little-endian `u64` words representing one `u128`.
- Unknown phases and invalid enum values fail closed.

These capacities are storage limits for the first devnet build. Maximum-capacity settlement still needs a compute benchmark before they become final deployment limits.

## Share Accounting

The Staker vault stores assets and shares as `u64`, with multiplication performed through `u128` intermediates:

```text
deposit_shares = floor(deposit_lamports * total_shares / active_assets)
withdrawal_lamports = floor(shares * active_assets / total_shares)
```

The first deposit mints one share per lamport. Player losses increase `active_assets_lamports` without minting shares. Erosion decreases assets without burning shares. Both therefore change the SOL value of every existing share automatically.

## Closure

- A Staker entry may be reused only when active shares, pending deposits, and queued withdrawals are all zero.
- A Player entry may be reused only when refundable deposits, committed deposits, and claims are all zero.
- A Staker-side settlement can close its Player registry after settlement because no Player claim remains.
- A Player-side settlement retains its Player registry until the winner claims.
- A voided draw retains its Player registry until all refunds finish.
- Account rent returns only to the recorded rent payer, never to a keeper or settlement caller.
- Claims and refunds do not expire.

## PDA Domains

```text
config
staker-vault
staker-registry
draw + draw_id
player-registry + draw_id
entropy-authority
```

PDA helpers accept an explicit Fate program ID. This permits separate devnet and mainnet Fate deployments without allowing an initialized program to switch dependencies dynamically.
