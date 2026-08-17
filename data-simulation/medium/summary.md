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
- Withdrawn pending Player positions: 161
- Player wins: 916
- Staker wins: 84
- Realized Player win share: 91.60%
- Average Staker TVL: 724.1564 SOL
- Average Player TVL: 8.5844 SOL
- Average Player threshold: 4.4754 SOL
- Median funding time: 50.0 minutes
- P90 funding time: 70.0 minutes
- Maximum funding time: 120.0 minutes
- Average activation threshold: 0.6213% of Staker TVL
- Simulated draws per day: 27.61
- Average winner profit: 6.1032 SOL
- Average protocol fee: 0.3240 SOL
- Cumulative protocol revenue: 324.0329 SOL
- Staker cumulative PnL: 273.2810 SOL
- Player cumulative PnL: -597.3140 SOL
- Average quoted Player EV per locked wallet: -0.0898 SOL
- Average quoted Player EV / stake: -8.45%
- Average realized Player PnL / stake: -6.96%

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
