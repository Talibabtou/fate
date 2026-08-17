# Fate Account Model

Build status and implementation order are tracked in [BUILD_PLAN.md](BUILD_PLAN.md).

Checked against Solana devnet: 2026-08-17

Fate uses fixed Steel accounts and one Player custody account per draw. All tracked asset fields exclude rent lamports.

## Accounts

| Account | Data size | Devnet rent-exempt minimum | Lifetime |
|---|---:|---:|---|
| `Config` | 256 bytes | 0.00267264 SOL | Persistent |
| `StakerVault` | 64 bytes | 0.00133632 SOL | Persistent |
| `StakerRegistry` | 40,976 bytes | 0.28608384 SOL | Persistent |
| `Draw` | 320 bytes | 0.00311808 SOL | Retain for recent results, then close |
| `PlayerRegistry` | 10,232 bytes | 0.07210560 SOL | One per draw; retain while refunds or a claim remain |

Initial configuration plus the first draw costs approximately `0.36531648 SOL` in refundable account rent. Each additional live `Draw` and `PlayerRegistry` pair costs approximately `0.07522368 SOL`. Query rent again before deployment because cluster economics can change.

The persistent Staker registry exceeds Solana's 10,240-byte per-instruction account-growth limit. Genesis creates it as an 8-byte, program-owned bootstrap account, then the authority runs five ordered `grow_program_accounts` steps. Each step grows by at most 10,240 bytes and funds only the new rent deficit. The fifth step marks `Config.version` ready, and every operational instruction rejects the incomplete version. The Player cap is deliberately 116 so its 10,232-byte registry and every following draw can be created atomically.

## Custody

- `StakerVault` holds Staker SOL plus its own rent reserve. `active_assets_lamports`, `pending_assets_lamports`, and `withdrawal_liability_lamports` never include rent.
- Queued Staker exits remain represented by shares until settlement. Settlement burns those shares at the post-result price and freezes the resulting SOL in `withdrawal_liability_lamports`, which cannot be exposed to later draws.
- Each `PlayerRegistry` holds that draw's refundable deposits, committed deposits, or winner claim plus its rent reserve.
- `Config`, `StakerRegistry`, and `Draw` hold only their rent reserves.
- Protocol fees leave custody accounts during settlement and go to the configured fee treasury.
- A transaction must never transfer an account below its rent reserve or below its tracked user liabilities.

On a Player win, erosion moves from `StakerVault` to the draw's `PlayerRegistry`; the fee moves to the treasury; the remaining payout stays claimable in the registry. On a Staker win, the Player registry transfers the jackpot and pro-rata amounts into `StakerVault` and the fee into the treasury.

Settlement prices every queued exit against the same post-result share price, burns those shares, and converts the resulting SOL into a fixed liability before pending deposits become active. Pending deposits then mint at one common post-exit price. On a Staker jackpot, new shares are rounded down so their mint can never reduce the value of existing shares; any representation dust remains in the active vault. If a jackpot is smaller than one share at the current price, it becomes an exact withdrawal liability for the selected Staker instead.

## Fixed Registries

- `StakerRegistry` contains 512 entries of 80 bytes.
- `PlayerRegistry` contains 116 entries of 88 bytes.
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

Two permissionless instructions now reclaim bounded per-draw storage. `close_player_registry` is available only after settlement or voiding when every Player position and tracked liability is zero. `close_draw` is available only after its registry is closed and the draw has left the ten-result history. Both verify the canonical PDA, exact account type, lifecycle state, and the refund address stored in `Draw.rent_payer`.

- A Staker entry may be reused only when active shares, pending deposits, queued withdrawals, and claimable withdrawal SOL are all zero.
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
