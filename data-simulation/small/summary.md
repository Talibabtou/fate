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
- Withdrawn pending Player positions: 40
- Player wins: 908
- Staker wins: 92
- Realized Player win share: 90.80%
- Average Staker TVL: 49.2617 SOL
- Average Player TVL: 1.1389 SOL
- Average Player threshold: 0.3888 SOL
- Median funding time: 20.0 minutes
- P90 funding time: 40.0 minutes
- Maximum funding time: 90.0 minutes
- Average activation threshold: 0.7952% of Staker TVL
- Simulated draws per day: 51.99
- Average winner profit: 0.7147 SOL
- Average protocol fee: 0.0396 SOL
- Cumulative protocol revenue: 39.5796 SOL
- Staker cumulative PnL: 68.8684 SOL
- Player cumulative PnL: -108.4480 SOL
- Average quoted Player EV per locked wallet: -0.0204 SOL
- Average quoted Player EV / stake: -10.26%
- Average realized Player PnL / stake: -9.52%

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
