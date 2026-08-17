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
- Player arrivals per funding interval: 1.50
- Pending Player withdrawal probability per interval: 1.00%
- Minimum draw pool: 0.10 SOL, or the initial threshold when lower
- Countdown: 5 minute(s)
- Player side win probability: 90.00%
- Staker side win probability: 10.00%
- Protocol fee: 5.00% of losing Player deposits when Player wins, or total Player TVL when Staker wins
- Staker erosion paid to Player winner: 0.0700% of active Staker TVL, capped at 7.00% of Player TVL
- Staker-side split: 30% jackpot winner, 65% pro-rata Staker distribution, 5% protocol
- Max early Player boost: 50%

## Outcomes

- Activated draws: 1000 / 1000
- Refunded Player positions: 0
- Withdrawn pending Player positions: 545
- Player wins: 879
- Staker wins: 121
- Realized Player win share: 87.90%
- Average Staker TVL: 14714.8376 SOL
- Average Player TVL: 88.7551 SOL
- Average Player threshold: 61.2434 SOL
- Median funding time: 80.0 minutes
- P90 funding time: 110.0 minutes
- Maximum funding time: 150.0 minutes
- Average activation threshold: 0.4200% of Staker TVL
- Simulated draws per day: 16.02
- Average winner profit: 70.0693 SOL
- Average protocol fee: 3.7657 SOL
- Cumulative protocol revenue: 3765.6835 SOL
- Staker cumulative PnL: 4645.0561 SOL
- Player cumulative PnL: -8410.7396 SOL
- Average quoted Player EV per locked wallet: -0.4095 SOL
- Average quoted Player EV / stake: -7.53%
- Average realized Player PnL / stake: -9.48%

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
