# Fate Parameter Study

Date: 2026-08-17

## Decision

Change two constants for the next simulator and devnet cycle:

- protocol fee: **5% -> 6%**
- initial activation threshold: **1% -> 0.5% of Staker TVL**

Keep the other current constants for now, including the 90% Player-side probability and the five-minute countdown.

This pair gave the best useful trade among profitable Players, profitable Stakers, draw frequency, and protocol revenue. It is not the highest fee-extraction result. The settings that scored higher did so by making the Player offer worse.

## Recommended Candidate vs Baseline

Each row below aggregates 15 matched runs: three pool sizes, five seeds per size, and 1,000 completed draws per run.

| Metric | Current constants | 6% fee + 0.5% threshold | Change |
|---|---:|---:|---:|
| Profitable Players | 19.31% | 20.82% | +1.51 pp |
| Profitable Stakers | 68.09% | 65.92% | -2.17 pp |
| Profitable users, combined | 37.39% | 38.16% | +0.77 pp |
| Player EV per SOL staked | -9.27% | -9.31% | -0.04 pp |
| Protocol revenue per simulated day | 24.39 SOL | 30.20 SOL | +23.8% absolute average; +31.4% matched index |
| Protocol take per Player SOL | 3.89% | 4.59% | +18.0% matched index |
| Median funding time | 39.3 min | 26.7 min | -12.7 min |
| Activation rate | 100% | 100% | unchanged |

The matched revenue index is the safer comparison because it compares each candidate with the baseline using the same pool size and random seed. The absolute average weights the three pool sizes equally even though their revenue scales differ.

### Result by pool size

| Size | Setting | Profitable Players | Profitable Stakers | Player EV | Revenue/day | Protocol take | Funding time |
|---|---|---:|---:|---:|---:|---:|---:|
| Small | Current | 22.98% | 82.85% | -10.69% | 2.14 SOL | 3.47% | 20 min |
| Small | Recommended | 23.45% | 82.11% | -10.63% | 2.94 SOL | 4.12% | 10 min |
| Medium | Current | 19.84% | 70.82% | -9.24% | 9.29 SOL | 3.83% | 38 min |
| Medium | Recommended | 21.80% | 65.74% | -9.06% | 12.60 SOL | 4.53% | 26 min |
| Large | Current | 15.11% | 50.61% | -7.88% | 61.75 SOL | 4.38% | 60 min |
| Large | Recommended | 17.22% | 49.90% | -8.25% | 75.07 SOL | 5.12% | 44 min |

## Why Not the Highest-Scoring Settings?

The equal-weight score rewards four objectives: profitable Player rate, profitable Staker rate, revenue per day, and protocol take per Player SOL. It is useful for finding candidates, but it cannot decide which user group should bear the cost.

| Candidate | Profitable Players | Profitable Stakers | Combined | Player EV | Revenue/day index | Take index | Decision |
|---|---:|---:|---:|---:|---:|---:|---|
| Current constants | 19.31% | 68.09% | 37.39% | -9.27% | 1.00x | 1.00x | Reference |
| 6% fee + 0.5% threshold | 20.82% | 65.92% | 38.16% | -9.31% | 1.31x | 1.18x | **Recommended** |
| 7.5% fee | 18.98% | 67.65% | 36.25% | -11.01% | 1.51x | 1.51x | Too expensive for Players |
| 7.5% fee + 85% Player side | 17.69% | 85.74% | 44.90% | -15.87% | 1.50x | 1.54x | High score hides Player harm |
| 15-min countdown + 7.5% fee | 11.67% | 75.00% | 27.07% | -12.87% | 2.23x | 1.67x | Revenue-first, poor Player result |
| 2-min countdown | 24.21% | 63.04% | 42.42% | -8.40% | 0.79x | 0.92x | Good user-first fallback, weak revenue |

Moving the Player side from 90% to 85% raises Staker profitability, but Player EV falls sharply. A longer countdown creates more Player entries and more revenue per draw cycle, while the Player profitable rate collapses. Neither should be treated as a healthy route to growth.

## Constant-by-Constant Call

| Constant | Current | Values screened | Call | Reason |
|---|---:|---|---|---|
| Player-side probability | 90% | 85%, 87.5%, 92.5%, 95% | Keep 90% | Lower values transfer too much value from Players; higher values reduce Staker profitability without enough revenue gain. |
| Protocol fee | 5% | 3%, 4%, 6%, 7.5% | Change to 6% | 6% funds the protocol better while leaving Player EV near baseline. 7.5% is visibly harsher. |
| Initial threshold / Staker TVL | 1% | 0.5%, 0.75%, 1.25%, 1.5% | Change to 0.5% | More Players finish profitable, draws fund faster, and it pairs well with the 6% fee. |
| Threshold decay interval | 10 min | 5, 15, 20 min | Keep 10 min | No validated alternative beat the recommended pair; longer intervals slowed funding. |
| Threshold decay factor | 0.90 | 0.85, 0.95, 0.975 | Keep 0.90 | Faster decay helped funding but did not improve protocol take; slower decay reduced revenue or Player profitability. |
| Absolute activation floor | 0.1 SOL | 0.05, 0.2, 0.5 SOL | Keep 0.1 SOL | 0.05 was functionally identical in the screen; higher floors weakened results. |
| Relative activation floor | 0.1% Staker TVL | 0.05%, 0.2%, 0.5% | Keep 0.1% | The lower and 0.2% values were functionally identical; no stable gain justified a change. |
| Minimum Player deposit | 0.01 SOL | 0.005, 0.025, 0.05, 0.1 SOL | Keep 0.01 SOL | Higher minimums cut Player access and profitability; lowering it produced no useful revenue gain. |
| Minimum Staker deposit | 0.1 SOL | 0.05, 0.25, 0.5, 1 SOL | Keep 0.1 SOL | Alternatives did not improve the four-objective result and higher minimums reduce access. |
| Countdown | 5 min | 2, 10, 15 min | Keep 5 min | Two minutes favors users but loses revenue; longer countdowns sharply reduce profitable Players. |
| Staker erosion rate | 0.07% Staker TVL | 0.035%, 0.05%, 0.1%, 0.15% | Keep 0.07% | Higher rates hurt Stakers; lower rates did not survive matched validation as a better balanced choice. |
| Player-side erosion cap | 7% Player TVL | 3.5%, 5%, 10%, 15% | Keep 7% | A 3.5% cap favors Stakers but reduced Player results when paired with the 6% fee. |
| Early-entry boost | 50% max | 0%, 25%, 75%, 100% | Keep 50% | Screening changes were noisy and none produced a convincing cross-group improvement. |
| Staker jackpot share | 30% | 15%, 45%, 60% | Keep 30% | Higher jackpot concentration reduced the rate of profitable Stakers; 15% did not beat the current split. |
| Staker pro-rata share | 65% | Derived from fee and jackpot | Change to 64% | With a 6% fee and 30% jackpot, conservation requires 64% pro rata. |

## Method

The study changed every product constant that had been treated as final. It used three stages:

1. One-at-a-time screen: 51 cases, three pool sizes, 300 completed draws, one matched seed per size.
2. Pair screen: 62 combinations selected from the stronger one-at-a-time results, using the same workload.
3. Final validation: 18 unique settings across the primary and supplemental sets, 1,000 completed draws, five matched seeds, and three pool sizes. This produced 285 validation runs; the duplicated baseline appears in both validation files but only once in the combined summary.

Candidates were compared with their exact pool-size and seed baseline. The balanced score is the equal-weight geometric mean of these four indexes:

- profitable Player rate
- profitable Staker rate
- protocol revenue per simulated day
- protocol take per Player SOL

Pareto membership was also calculated across those four measures. Combined profitable-user rate was reported but not used as the sole target because it can rise while Players get materially worse.

During the study, arrival, refund, and Staker-withdrawal probabilities were corrected to use a fixed ten-minute basis. Without that normalization, changing the decay interval also changed users per hour and falsely made five-minute intervals look like free revenue.

## Limits Before Mainnet Economics

- Demand, deposits, refunds, and withdrawals are synthetic. A fee change may alter real demand even though the simulator holds demand behavior fixed.
- Player profitability is path-dependent and remains well below Staker profitability in every balanced candidate.
- The score treats Player profitability, Staker profitability, revenue/day, and protocol take as equally important. A different product policy changes the ranking.
- The next gate should replay devnet telemetry and measured user behavior through the same candidate set.
- Treat 6% plus 0.5% as the next test setting, not a permanent promise.

## Files

- `screening_summary.csv`: one-at-a-time aggregate results
- `pairwise_summary.csv`: pair aggregate results
- `validation_summary.csv`: primary finalist validation
- `supplemental_validation_summary.csv`: 6% fee neighborhood validation
- `all_validation_summary.csv`: combined, deduplicated validated ranking
- `pareto_frontier.csv`: nondominated validated candidates
- `*_runs.csv`: seed- and size-level source rows
- `manifest.json`: baseline, ranges, run counts, and score definitions
- `run_parameter_study.py`: main sweep and validation runner
- `run_supplemental_validation.py`: focused 6% validation runner

Reproduce from `workspace/fate/data-simulation`:

```bash
python3 parameter-study/run_parameter_study.py
python3 parameter-study/run_supplemental_validation.py
```
