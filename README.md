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
- Stakers may withdraw immediately; each withdrawal recalculates the snapshot and threshold.
- New Staker deposits wait for the next draw after the first Player enters.

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
staker_erosion = min(0.07% * staker_tvl, 7% * player_tvl)
gross_profit = losing_player + staker_erosion
protocol_fee = 5% * gross_profit

winner_profit = gross_profit - protocol_fee
winner_payout = winner_deposit + winner_profit
```

All other Players lose their committed deposits. Staker erosion is deducted pro-rata from every active Staker position.

A solo Player pays no fee on returned principal or nonexistent losing Player deposits. The 5% fee still applies to erosion received as profit. If the Staker side wins, the solo Player loses the entire committed deposit.

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
| ------------------------- | ------------- |
| 0% of initial threshold   | 1.50x         |
| 25%                       | 1.375x        |
| 50%                       | 1.25x         |
| 75%                       | 1.125x        |
| 100%                      | 1.00x         |


The boost changes only which Player wins after the Player side is selected. It never changes the fixed 90% Player-side probability.

## Anti-Stall Threshold

A fixed 1% threshold can make a large Staker pool difficult to activate. Fate lowers the target by 10% every 10 minutes after the first pending Player deposit:

```text
initial_threshold = 1% * staker_tvl_snapshot
waiting_steps = floor(waiting_minutes / 10)
activation_floor = max(0.1 SOL, 0.1% * staker_tvl_snapshot)
active_threshold = max(activation_floor, initial_threshold * 90%^waiting_steps)
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
90% chance: +6.65% of deposit after fee
10% chance: -100% of deposit
expected Player PnL = -4.015% of deposit

expected Staker PnL = +3.2% of Player TVL
expected protocol revenue = +0.815% of Player TVL
```

This remains proportional even as the activation threshold falls. Applying the same decay factor to erosion a second time would worsen the solo Player EV and weaken the incentive needed to activate a delayed draw.

## Scale Results

The current datasets contain 1,000 timed draws for the primary seed of each size, plus four additional verification seeds per size. That is 15,000 draws across 15 scenario/seed combinations. Each funding period begins with one Player, adds stochastic arrivals every 10 minutes, gives pending positions a 1% refund chance per interval, permits immediate Staker exits, and applies threshold decay until activation.


| Metric                                | Small      | Medium     | Large        |
| ------------------------------------- | ---------- | ---------- | ------------ |
| Seed                                  | `20260811` | `20260817` | `20260829`   |
| Average Stakers                       | 34.5       | 92.8       | 319.9        |
| Average Staker TVL                    | 40.85 SOL  | 502.06 SOL | 8,127.75 SOL |
| Average Player TVL                    | 1.05 SOL   | 7.21 SOL   | 64.40 SOL    |
| Median funding time                   | 20 min     | 40 min     | 60 min       |
| P90 funding time                      | 40 min     | 60 min     | 90 min       |
| Maximum funding time                  | 70 min     | 110 min    | 130 min      |
| Average activation threshold          | 0.82%      | 0.68%      | 0.52%        |
| Active-funding draws/day              | 56.47      | 33.36      | 20.70        |
| Average effective Player wallets      | 3.29       | 3.96       | 5.93         |
| Median largest Player share           | 45.66%     | 40.75%     | 30.29%       |
| Player wins                           | 915        | 907        | 892          |
| Median Player winner profit           | 0.56 SOL   | 4.54 SOL   | 50.16 SOL    |
| Median Staker jackpot                 | 0.28 SOL   | 1.80 SOL   | 17.33 SOL    |
| Quoted Player EV / stake              | -10.57%    | -9.19%     | -7.88%       |
| Realized Player PnL / stake           | -9.02%     | -7.88%     | -8.26%       |
| Profitable Players                    | 23.19%     | 20.11%     | 14.65%       |
| Profitable Stakers                    | 78.59%     | 59.63%     | 51.45%       |
| Staker return / draw                  | 0.144%     | 0.059%     | 0.031%       |
| Protocol revenue                      | 36.08 SOL  | 272.46 SOL | 2,821.17 SOL |
| Protocol revenue / Player SOL         | 3.44%      | 3.78%      | 4.38%        |
| Protocol revenue / active-funding day | 2.04 SOL   | 9.09 SOL   | 58.39 SOL    |


Funding time increases with protocol size. The primary seeds produced median waits of `20`, `40`, and `60` minutes. Across all five seeds per size, no draw remained in funding for more than 24 hours; four of 15,000 draws reached the final activation floor under the current arrival assumptions.

Across the five seeds, profitable Player rates ranged from `21.08%` to `23.19%` for small, `18.98%` to `20.90%` for medium, and `14.36%` to `15.89%` for large. The maximum absolute value-conservation residual across all runs was `0.000000000014 SOL`, caused by floating-point simulation arithmetic.

Staker return per draw is game PnL, not APY. Active-funding cadence begins with the first Player deposit and excludes idle time before anyone enters. Actual daily returns and revenue will therefore be lower whenever the protocol waits for its first Player.

Detailed outputs:

```text
data-simulation/small/
data-simulation/medium/
data-simulation/large/
data-simulation/scenario_comparison.csv
data-simulation/scenario_seed_comparison.csv
data-simulation/scenario_analysis.md
```

Run all scenarios:

```bash
python3 data-simulation/run_scenarios.py --data-dir data-simulation
```

## Why These Parameters

- **90% Player / 10% Staker:** gives Players a strong side-level chance while preserving a meaningful Staker event. The UI must also show each Player's much smaller personal winning chance.
- **1% initial threshold:** creates a prize proportional to Staker TVL without requiring a fixed SOL target.
- **10-minute threshold reductions:** prevent growing Staker TVL from making activation progressively harder.
- **0.1 SOL minimum draw pool:** prevents threshold decay from eventually activating an economically meaningless dust draw.
- **5-minute countdown:** gives late Players a visible final entry window while preventing an indefinite post-activation wait.
- **5% fee:** applies to Player profit from losing Player deposits and Staker erosion, never to the winner's returned principal.
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

Before mainnet parameters are immutable, testnet usage must replace synthetic arrival assumptions with observed data. The account model and deterministic economic core are ready; the build still needs instruction handlers, pending Player custody, permissionless activation and settlement, verifiable randomness, timeout recovery, capacity benchmarks, and a complete invariant test suite.