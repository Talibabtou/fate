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
- Withdrawn pending Player positions: 49
- Player wins: 915
- Staker wins: 85
- Realized Player win share: 91.50%
- Average Staker TVL: 40.8494 SOL
- Average Player TVL: 1.0501 SOL
- Average Player threshold: 0.3247 SOL
- Median funding time: 20.0 minutes
- P90 funding time: 40.0 minutes
- Maximum funding time: 70.0 minutes
- Draws reaching the activation floor: 0
- Total minutes waiting at the activation floor: 0.0
- Immediate Staker withdrawals during funding: 76
- Queued Staker withdrawals after activation: 28
- Average queued Staker withdrawal wait: 5.0 minutes
- Funding clock resets after all Players refunded: 14
- Average activation threshold: 0.8161% of Staker TVL
- Simulated draws per day: 56.47
- Average winner profit: 0.6277 SOL
- Average protocol fee: 0.0361 SOL
- Cumulative protocol revenue: 36.0803 SOL
- Maximum absolute value-conservation error: 0.000000000000 SOL
- Staker cumulative PnL: 58.6566 SOL
- Player cumulative PnL: -94.7369 SOL
- Average quoted Player EV per locked wallet: -0.0204 SOL
- Average quoted Player EV / stake: -10.57%
- Average realized Player PnL / stake: -9.02%

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
