# Timed Protocol Size Analysis

Each scenario runs 1,000 draws with the same Fate economics. Only wallet capital, population size, entrant rate, and random seed change.

| Metric | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Seed | 20260811 | 20260817 | 20260829 |
| Capital scale | 0.20x | 1.00x | 5.00x |
| Average Stakers | 45.0 | 134.8 | 546.7 |
| Average Staker TVL | 49.26 SOL | 724.16 SOL | 14714.84 SOL |
| Average Player TVL | 1.14 SOL | 8.58 SOL | 88.76 SOL |
| Median funding time | 20 min | 50 min | 80 min |
| P90 funding time | 40 min | 70 min | 110 min |
| Average activation threshold | 0.80% | 0.62% | 0.42% |
| Simulated draws per day | 51.99 | 27.61 | 16.02 |
| Average effective Player wallets | 3.42 | 4.41 | 6.93 |
| Median largest Player share | 45.06% | 36.64% | 27.49% |
| Realized Player win rate | 90.80% | 91.60% | 87.90% |
| Player EV / stake | -10.26% | -8.45% | -7.53% |
| Realized Player PnL / stake | -9.52% | -6.96% | -9.48% |
| Staker return / draw | 0.14% | 0.04% | 0.03% |
| Protocol revenue | 39.58 SOL | 324.03 SOL | 3765.68 SOL |
| Protocol revenue per simulated day | 2.06 SOL | 8.95 SOL | 60.33 SOL |
| Protocol take / Player SOL | 3.48% | 3.77% | 4.24% |

## Reading The Results

Median funding time rises from 20 to 50 to 80 minutes. The arrival presets intentionally grow more slowly than required Player TVL, so larger pools take longer to fill even though they attract more Player arrivals.

Threshold decay does the work most strongly at scale. The average activation target falls to 0.80% for small, 0.62% for medium, and 0.42% for large. Erosion needs no second time adjustment because its 7% Player-TVL cap already falls with the smaller activated pool.

Quoted Player EV ranges from -10.26% to -7.53%. The large realized Player win rate of 87.90% is below the fixed 90% target in this seed, which explains why its realized PnL is worse than its quoted EV despite more favorable pool composition.

Cadence starts when the first Player enters and excludes idle time before that first deposit. Draws per day and per-day revenue are therefore active-funding scenario outputs, not forecasts. Production estimates require observed arrival and withdrawal data.
