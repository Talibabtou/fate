# Threshold Simulation Summary

## Parameters

- Protocol size scenario: large
- Draws: 1000
- Seed: 20260829
- Capital scale: 5.00x medium wallet sizes
- Initial Stakers: 400
- Initial persistent Players: 96
- Staker entrant-rate scale: 4.00x medium
- External yield strategy: none, Staker SOL is inert
- Player threshold: 1.00% of active Staker TVL
- Threshold decay: 10% every 10 minutes
- Player arrivals per 10 funding minutes: 1.50
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
- Withdrawn pending Player positions: 300
- Player wins: 892
- Staker wins: 108
- Realized Player win share: 89.20%
- Average Staker TVL: 8127.7502 SOL
- Average Player TVL: 64.3982 SOL
- Average Player threshold: 41.8328 SOL
- Median funding time: 60.0 minutes
- P90 funding time: 90.0 minutes
- Maximum funding time: 130.0 minutes
- Draws reaching the activation floor: 0
- Total minutes waiting at the activation floor: 0.0
- Immediate Staker withdrawals during funding: 2104
- Queued Staker withdrawals after activation: 295
- Average queued Staker withdrawal wait: 5.0 minutes
- Funding clock resets after all Players refunded: 8
- Average activation threshold: 0.5160% of Staker TVL
- Simulated draws per day: 20.70
- Average winner profit: 49.2654 SOL
- Average protocol fee: 2.8212 SOL
- Cumulative protocol revenue: 2821.1728 SOL
- Maximum absolute value-conservation error: 0.000000000001 SOL
- Staker cumulative PnL: 2495.8949 SOL
- Player cumulative PnL: -5317.0677 SOL
- Average quoted Player EV per locked wallet: -0.3979 SOL
- Average quoted Player EV / stake: -7.88%
- Average realized Player PnL / stake: -8.26%

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
