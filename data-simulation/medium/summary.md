# Threshold Simulation Summary

## Parameters

- Protocol size scenario: medium
- Draws: 1000
- Seed: 20260817
- Capital scale: 1.00x medium wallet sizes
- Initial Stakers: 100
- Initial persistent Players: 24
- Staker entrant-rate scale: 1.00x medium
- External yield strategy: none, Staker SOL is inert
- Player threshold: 1.00% of active Staker TVL
- Threshold decay: 10% every 10 minutes
- Player arrivals per funding interval: 1.00
- Pending Player withdrawal probability per interval: 1.00%
- Staker withdrawal probability per funding interval: 0.10%
- Staker withdrawal-request probability during countdown: 0.10%
- Activation floor: max(0.10 SOL, 0.10% of Staker TVL)
- Minimum Player deposit: 0.01 SOL
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
- Withdrawn pending Player positions: 99
- Player wins: 907
- Staker wins: 93
- Realized Player win share: 90.70%
- Average Staker TVL: 502.0552 SOL
- Average Player TVL: 7.2060 SOL
- Average Player threshold: 3.3631 SOL
- Median funding time: 40.0 minutes
- P90 funding time: 60.0 minutes
- Maximum funding time: 110.0 minutes
- Draws reaching the activation floor: 0
- Total minutes waiting at the activation floor: 0.0
- Immediate Staker withdrawals during funding: 375
- Queued Staker withdrawals after activation: 83
- Average queued Staker withdrawal wait: 5.0 minutes
- Funding clock resets after all Players refunded: 7
- Average activation threshold: 0.6803% of Staker TVL
- Simulated draws per day: 33.36
- Average winner profit: 4.7682 SOL
- Average protocol fee: 0.2725 SOL
- Cumulative protocol revenue: 272.4625 SOL
- Maximum absolute value-conservation error: 0.000000000001 SOL
- Staker cumulative PnL: 295.2257 SOL
- Player cumulative PnL: -567.6882 SOL
- Average quoted Player EV per locked wallet: -0.0921 SOL
- Average quoted Player EV / stake: -9.19%
- Average realized Player PnL / stake: -7.88%

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
