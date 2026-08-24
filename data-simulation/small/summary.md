# Threshold Simulation Summary

## Parameters

- Protocol size scenario: small
- Draws: 1000
- Seed: 20260811
- Capital scale: 0.20x medium wallet sizes
- Initial Stakers: 30
- Initial persistent Players: 8
- Staker entrant-rate scale: 0.30x medium
- External yield strategy: none, Staker SOL is inert
- Player threshold: 1.00% of active Staker TVL
- Threshold decay: 10% every 10 minutes
- Player arrivals per 10 funding minutes: 1.00
- Pending Player withdrawal probability per 10 minutes: 1.00%
- Staker withdrawal probability per 10 funding minutes: 0.10%
- Staker withdrawal-request probability during countdown: 0.10%
- Activation floor: max(0.10 SOL, 0.10% of Staker TVL)
- Minimum Player deposit: 0.01 SOL
- Minimum Staker deposit: 0.10 SOL
- Countdown: 5 minute(s)
- Player side win probability: 90.00%
- Staker side win probability: 10.00%
- Protocol fee: 5.00% of losing Player deposits plus erosion when Player wins, or total Player TVL when Staker wins
- Staker erosion paid to Player winner: 0.0700% of active Staker TVL, capped at 7.00% of Player TVL
- Staker-side split: 30% jackpot winner, 65% pro-rata Staker distribution, 5% protocol
- Max early Player boost: 50%

## Outcomes

- Activated draws: 1000 / 1000
- Refunded Player positions: 0
- Withdrawn pending Player positions: 27
- Player wins: 895
- Staker wins: 105
- Realized Player win share: 89.50%
- Average Staker TVL: 35.8440 SOL
- Average Player TVL: 1.0664 SOL
- Average Player threshold: 0.2933 SOL
- Median funding time: 20.0 minutes
- P90 funding time: 30.0 minutes
- Maximum funding time: 60.0 minutes
- Draws reaching the activation floor: 0
- Total minutes waiting at the activation floor: 0.0
- Immediate Staker withdrawals during funding: 61
- Queued Staker withdrawals after activation: 33
- Average queued Staker withdrawal wait: 5.0 minutes
- Funding clock resets after all Players refunded: 5
- Average activation threshold: 0.8364% of Staker TVL
- Simulated draws per day: 62.99
- Average winner profit: 0.6165 SOL
- Average protocol fee: 0.0362 SOL
- Cumulative protocol revenue: 36.2143 SOL
- Maximum absolute value-conservation error: 0.000000000000 SOL
- Staker cumulative PnL: 82.5667 SOL
- Player cumulative PnL: -118.7810 SOL
- Average quoted Player EV per locked wallet: -0.0224 SOL
- Average quoted Player EV / stake: -10.82%
- Average realized Player PnL / stake: -11.14%

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
