# Fate

Fate is a SOL lottery with two ways to participate:

- **Staker:** deposits SOL persistently and receives exposure to Player losses.
- **Player:** commits SOL to one draw for a chance to win the other Player deposits plus a small contribution from Stakers.

Staker SOL is held inert. It does not earn validator or DeFi yield. Game returns come from Player losses, and Staker principal can erode when the Player side wins.

## Draw Model

Every activated draw has two rolls:

1. Select the winning side: `90% Player / 10% Staker`.
2. Select exactly one winner wallet from that side using wallet-weighted odds.

All deposits controlled by the same wallet are aggregated before odds and payouts are calculated. Multiple deposits cannot create multiple winner payments.

There is no participant-count or concentration gate. One Player may fund an entire draw and bet directly against the Stakers.

## Draw Lifecycle

```text
FUNDING -> ACTIVATED -> 5-MINUTE COUNTDOWN -> LOCKED -> DRAW -> SETTLED
```

During funding:

- Player deposits are pending and refundable.
- The initial activation target is `1% of active Staker TVL`.
- The first Player deposit starts the waiting clock.
- Player deposits accumulate until the active threshold is reached.

At activation:

- the active threshold is frozen;
- all pending Player deposits become committed;
- a 5-minute countdown begins;
- additional Player deposits may join and are immediately committed;
- new Staker deposits wait for the next draw.

At the end of the countdown, deposits lock, secure randomness selects the side and winner, settlement executes, and the next funding period opens. Every activated draw produces exactly one jackpot winner.

## Player Win

If the Player side is selected, one Player wallet wins. It keeps its own committed deposit, receives the losing Player deposits after fees, and receives Staker erosion.

```text
losing_player = player_tvl - winner_deposit
protocol_fee = 5% * losing_player
staker_erosion = min(0.07% * staker_tvl, 7% * player_tvl)

winner_profit = losing_player - protocol_fee + staker_erosion
winner_payout = winner_deposit + winner_profit
```

All other Players lose their committed deposits. Staker erosion is deducted pro-rata from every active Staker position.

A solo Player pays no fee when the Player side wins because there are no losing Player deposits. If the Staker side wins, the solo Player loses the entire committed deposit.

## Staker Win

If the Staker side is selected, every Player deposit is lost and one Staker wallet is selected by deposited SOL weight.

```text
30% of Player TVL -> one Staker jackpot winner
65% of Player TVL -> all active Stakers pro-rata
 5% of Player TVL -> protocol
```

The jackpot winner also receives its normal pro-rata share. The `30/65/5` split preserves a visible jackpot while allowing Stakers to benefit without needing to win the jackpot personally.

## Early Player Boost

Deposits made earlier in funding receive more weight in the Player winner roll:

```text
boost = 1 + 50% * remaining_initial_threshold_fraction
wallet_weight = sum(deposit * boost_at_deposit)
```

| Player TVL before deposit | Player weight |
| ---: | ---: |
| 0% of initial threshold | 1.50x |
| 25% | 1.375x |
| 50% | 1.25x |
| 75% | 1.125x |
| 100% | 1.00x |

The boost changes only which Player wins after the Player side is selected. It never changes the fixed 90% Player-side probability.

## Anti-Stall Threshold

A fixed 1% threshold can make a large Staker pool difficult to activate. Fate lowers the target by 10% every 10 minutes after the first pending Player deposit:

```text
initial_threshold = 1% * staker_tvl_snapshot
waiting_steps = floor(waiting_minutes / 10)
minimum_draw_pool = min(0.1 SOL, initial_threshold)
active_threshold = max(minimum_draw_pool, initial_threshold * 90%^waiting_steps)
```

Staker TVL is snapshotted when the first Player enters, preventing new Staker deposits from moving the target upward. If every pending Player withdraws, the waiting clock and snapshot reset.

Once the active threshold is reached, decay stops and the 5-minute countdown begins. The `0.1 SOL` floor prevents dust-sized draws and must be rechecked against the selected randomness and settlement costs before deployment.

### Erosion During Threshold Decay

Erosion should not receive an additional time-based reduction. The existing dynamic cap already scales it down automatically.

When Player TVL is below `1%` of Staker TVL:

```text
staker_erosion = 7% * player_tvl
```

For a solo Player at any reduced threshold:

```text
90% chance: +7% of deposit
10% chance: -100% of deposit
expected Player PnL = -3.7% of deposit

expected Staker PnL = +3.2% of Player TVL
expected protocol revenue = +0.5% of Player TVL
```

This remains proportional even as the activation threshold falls. Applying the same decay factor to erosion a second time would worsen the solo Player EV and weaken the incentive needed to activate a delayed draw.

## Scale Results

The current datasets contain 1,000 timed draws per scenario. Each funding period begins with one Player, adds stochastic arrivals every 10 minutes, gives every pending position a 1% withdrawal chance per interval, and applies threshold decay until activation.

| Metric | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Seed | `20260811` | `20260817` | `20260829` |
| Average Stakers | 45.0 | 134.8 | 546.7 |
| Average Staker TVL | 49.26 SOL | 724.16 SOL | 14,714.84 SOL |
| Average Player TVL | 1.14 SOL | 8.58 SOL | 88.76 SOL |
| Median funding time | 20 min | 50 min | 80 min |
| P90 funding time | 40 min | 70 min | 110 min |
| Maximum funding time | 90 min | 120 min | 150 min |
| Average activation threshold | 0.80% | 0.62% | 0.42% |
| Active-funding draws/day | 51.99 | 27.61 | 16.02 |
| Average effective Player wallets | 3.42 | 4.41 | 6.93 |
| Median largest Player share | 45.06% | 36.64% | 27.49% |
| Player wins | 908 | 916 | 879 |
| Median Player winner profit | 0.65 SOL | 5.92 SOL | 70.32 SOL |
| Median Staker jackpot | 0.30 SOL | 2.47 SOL | 23.86 SOL |
| Quoted Player EV / stake | -10.26% | -8.45% | -7.53% |
| Realized Player PnL / stake | -9.52% | -6.96% | -9.48% |
| Profitable Players | 22.23% | 18.83% | 11.55% |
| Profitable Stakers | 80.70% | 53.14% | 68.83% |
| Staker return / draw | 0.140% | 0.038% | 0.032% |
| Protocol revenue | 39.58 SOL | 324.03 SOL | 3,765.68 SOL |
| Protocol revenue / Player SOL | 3.48% | 3.77% | 4.24% |
| Protocol revenue / active-funding day | 2.06 SOL | 8.95 SOL | 60.33 SOL |

Funding time now increases with protocol size as intended. Player arrival capacity grows more slowly than required Player TVL, producing median waits of `20`, `50`, and `80` minutes. Threshold decay responds by lowering the average activation target more aggressively at larger scale.

The large seed realized only `87.9%` Player-side wins against the fixed `90%` probability. This normal random deviation explains why its realized Player PnL is worse than its quoted EV. Quoted EV is the player parameter-comparison metric; realized PnL shows the variance users actually experience.

Staker return per draw is game PnL, not APY. Active-funding cadence begins with the first Player deposit and excludes idle time before anyone enters. Actual daily returns and revenue will therefore be lower whenever the protocol waits for its first Player.

Detailed outputs:

```text
data/small/
data/medium/
data/large/
data/scenario_comparison.csv
data/scenario_analysis.md
```

Run all scenarios:

```bash
python3 run_scenarios.py
```

## Why These Parameters

- **90% Player / 10% Staker:** gives Players a strong side-level chance while preserving a meaningful Staker event. The UI must also show each Player's much smaller personal winning chance.
- **1% initial threshold:** creates a prize proportional to Staker TVL without requiring a fixed SOL target.
- **10-minute threshold reductions:** prevent growing Staker TVL from making activation progressively harder.
- **0.1 SOL minimum draw pool:** prevents threshold decay from eventually activating an economically meaningless dust draw.
- **5-minute countdown:** gives late Players a visible final entry window while preventing an indefinite post-activation wait.
- **5% fee:** is simple and explicit. On Player wins it applies only to losing Player deposits, never to the winner's returned principal.
- **Dynamic erosion:** keeps the Player bonus meaningful while limiting each Player-side win to at most `0.07%` of Staker TVL and `7%` of Player TVL.
- **30/65/5 Staker split:** keeps one jackpot winner but directs most Staker-side winnings to every active Staker.
- **50% maximum early boost:** rewards the wallets that help start funding without changing the fixed side probabilities.
- **No concentration gate:** allows a single Player to activate a draw and treats concentration as disclosed odds rather than an invalid state.

## Required User Disclosures

- A Player can lose the full committed deposit.
- Player expected value is negative under the current parameters.
- Staker principal can erode and is not guaranteed or risk-free.
- Pending Player deposits are refundable only before activation.
- The interface must show the current threshold, waiting time, threshold decay, pool composition, wallet concentration, personal odds, exact profit if selected, maximum loss, erosion, and fees before commitment.
- Randomness must be unpredictable before lock, operator-independent, verifiable after settlement, and have a defined timeout or provider-failure path.

## Build Readiness

The mechanism is ready for implementation planning. The simulator now covers capital scale, timed Player arrivals, pending withdrawals, threshold decay, countdown entry, wallet aggregation, settlement, fees, erosion, and long-run participant PnL.

Before mainnet parameters are immutable, testnet usage must replace synthetic arrival assumptions with observed data. The build still needs an account model, Staker share accounting, pending Player custody, permissionless activation and settlement, verifiable randomness, timeout recovery, precision limits, and a complete invariant test suite.
