# Timed Protocol Size Analysis

Each scenario runs 1,000 draws with the same Fate economics. Only wallet capital, population size, entrant rate, and random seed change.

| Metric | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Seed | 20260811 | 20260817 | 20260829 |
| Capital scale | 0.20x | 1.00x | 5.00x |
| Average Stakers | 34.5 | 92.8 | 319.9 |
| Average Staker TVL | 40.85 SOL | 502.06 SOL | 8127.75 SOL |
| Average Player TVL | 1.05 SOL | 7.21 SOL | 64.40 SOL |
| Median funding time | 20 min | 40 min | 60 min |
| P90 funding time | 40 min | 60 min | 90 min |
| Average activation threshold | 0.82% | 0.68% | 0.52% |
| Simulated draws per day | 56.47 | 33.36 | 20.70 |
| Average effective Player wallets | 3.29 | 3.96 | 5.93 |
| Median largest Player share | 45.66% | 40.75% | 30.29% |
| Realized Player win rate | 91.50% | 90.70% | 89.20% |
| Player EV / stake | -10.57% | -9.19% | -7.88% |
| Realized Player PnL / stake | -9.02% | -7.88% | -8.26% |
| Staker return / draw | 0.14% | 0.06% | 0.03% |
| Protocol revenue | 36.08 SOL | 272.46 SOL | 2821.17 SOL |
| Protocol revenue per simulated day | 2.04 SOL | 9.09 SOL | 58.39 SOL |
| Protocol take / Player SOL | 3.44% | 3.78% | 4.38% |
| Profitable Players | 23.19% | 20.11% | 14.65% |
| Profitable Stakers | 78.59% | 59.63% | 51.45% |

## Reading The Results

Median funding time rises from 20 to 40 to 60 minutes. The arrival presets intentionally grow more slowly than required Player TVL, so larger pools take longer to fill even though they attract more Player arrivals.

Threshold decay does the work most strongly at scale. The average activation target falls to 0.82% for small, 0.68% for medium, and 0.52% for large. Erosion needs no second time adjustment because its 7% Player-TVL cap already falls with the smaller activated pool.

Quoted Player EV ranges from -10.57% to -7.88%. The large realized Player win rate of 89.20% is below the fixed 90% target in this seed, which explains why its realized PnL is worse than its quoted EV despite more favorable pool composition.

Cadence starts when the first Player enters and excludes idle time before that first deposit. Draws per day and per-day revenue are therefore active-funding scenario outputs, not forecasts. Production estimates require observed arrival and withdrawal data.

## Multi-Seed Checks

The runner checked 15 scenario/seed combinations. Maximum absolute value-conservation error was 0.000000000014 SOL. Draws that remained in funding for more than 24 hours: 0.
