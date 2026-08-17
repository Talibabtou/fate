#!/usr/bin/env python3
"""Run and compare Fate's small, medium, and large protocol-size scenarios."""

from __future__ import annotations

import argparse
from pathlib import Path
from statistics import mean, median

from simulate import (
    SIZE_PRESETS,
    RiskPosition,
    State,
    config_for_size,
    locked_wallet_metrics,
    percentile,
    run_simulation,
    write_csv,
    write_simulation_outputs,
)


def safe_median(values: list[float]) -> float:
    return median(values) if values else 0.0


def scenario_metrics(
    size: str,
    draws: list[dict[str, object]],
    positions: list[RiskPosition],
    state: State,
) -> dict[str, object]:
    activated = [row for row in draws if row["activated"] is True]
    risk_wins = [row for row in activated if row["winner_mode"] == "risk"]
    staking_wins = [row for row in activated if row["winner_mode"] == "safe"]
    risk_amounts, risk_evs, risk_pnls = locked_wallet_metrics(positions)
    risk_stake = sum(risk_amounts)
    risk_ev = sum(risk_evs)
    risk_pnl = sum(risk_pnls)
    safe_users = [p for p in state.participants.values() if p.mode == "safe"]
    risk_users = [p for p in state.participants.values() if p.mode == "risk"]
    average_safe_tvl = mean(float(row["safe_tvl"]) for row in draws)
    safe_pnl = sum(p.cumulative_pnl for p in safe_users)
    total_cycle_minutes = sum(float(row["cycle_minutes"]) for row in draws)
    funding_minutes = [float(row["funding_minutes"]) for row in draws]
    simulated_days = total_cycle_minutes / 1440

    return {
        "scenario": size,
        "seed": SIZE_PRESETS[size]["seed"],
        "capital_scale": SIZE_PRESETS[size]["capital_scale"],
        "activated_draws": len(activated),
        "player_wins": len(risk_wins),
        "staker_wins": len(staking_wins),
        "player_win_rate": len(risk_wins) / len(activated) if activated else 0.0,
        "avg_stakers": mean(float(row["safe_count"]) for row in draws),
        "avg_staker_tvl": average_safe_tvl,
        "avg_player_positions": mean(float(row["risk_count"]) for row in draws),
        "avg_player_tvl": mean(float(row["risk_tvl"]) for row in draws),
        "median_funding_minutes": median(funding_minutes),
        "p90_funding_minutes": percentile(funding_minutes, 0.90),
        "max_funding_minutes": max(funding_minutes),
        "avg_activation_threshold_pct": mean(float(row["activation_threshold_pct"]) for row in draws),
        "avg_pending_withdrawn_positions": mean(float(row["pending_withdrawn_count"]) for row in draws),
        "draws_per_day": len(activated) / simulated_days if simulated_days else 0.0,
        "avg_effective_player_wallets": mean(float(row["risk_effective_count"]) for row in draws),
        "median_largest_player_share": median(float(row["risk_largest_share"]) for row in draws),
        "median_player_gini": median(float(row["risk_gini"]) for row in draws),
        "median_player_winner_profit": safe_median([float(row["winner_profit"]) for row in risk_wins]),
        "median_staker_jackpot": safe_median([float(row["safe_jackpot_paid"]) for row in staking_wins]),
        "median_staker_prorata": safe_median([float(row["safe_pro_rata_paid"]) for row in staking_wins]),
        "protocol_revenue": state.protocol_revenue,
        "protocol_revenue_per_day": state.protocol_revenue / simulated_days if simulated_days else 0.0,
        "protocol_take_per_player_sol": state.protocol_revenue / risk_stake if risk_stake else 0.0,
        "staker_pnl": safe_pnl,
        "staker_return_per_draw": safe_pnl / average_safe_tvl / len(activated) if activated else 0.0,
        "player_pnl": sum(p.cumulative_pnl for p in risk_users),
        "player_ev_per_stake": risk_ev / risk_stake if risk_stake else 0.0,
        "player_pnl_per_stake": risk_pnl / risk_stake if risk_stake else 0.0,
        "profitable_stakers": sum(p.cumulative_pnl > 0 for p in safe_users),
        "stakers": len(safe_users),
        "profitable_players": sum(p.cumulative_pnl > 0 for p in risk_users),
        "players": len(risk_users),
    }


def percentage(value: object) -> str:
    return f"{float(value):.2%}"


def write_analysis(path: Path, rows: list[dict[str, object]], draws: int) -> None:
    by_size = {str(row["scenario"]): row for row in rows}
    small = by_size["small"]
    medium = by_size["medium"]
    large = by_size["large"]
    lines = [
        "# Timed Protocol Size Analysis",
        "",
        f"Each scenario runs {draws:,} draws with the same Fate economics. Only wallet capital, population size, entrant rate, and random seed change.",
        "",
        "| Metric | Small | Medium | Large |",
        "| --- | ---: | ---: | ---: |",
        f"| Seed | {small['seed']} | {medium['seed']} | {large['seed']} |",
        f"| Capital scale | {small['capital_scale']:.2f}x | {medium['capital_scale']:.2f}x | {large['capital_scale']:.2f}x |",
        f"| Average Stakers | {small['avg_stakers']:.1f} | {medium['avg_stakers']:.1f} | {large['avg_stakers']:.1f} |",
        f"| Average Staker TVL | {small['avg_staker_tvl']:.2f} SOL | {medium['avg_staker_tvl']:.2f} SOL | {large['avg_staker_tvl']:.2f} SOL |",
        f"| Average Player TVL | {small['avg_player_tvl']:.2f} SOL | {medium['avg_player_tvl']:.2f} SOL | {large['avg_player_tvl']:.2f} SOL |",
        f"| Median funding time | {small['median_funding_minutes']:.0f} min | {medium['median_funding_minutes']:.0f} min | {large['median_funding_minutes']:.0f} min |",
        f"| P90 funding time | {small['p90_funding_minutes']:.0f} min | {medium['p90_funding_minutes']:.0f} min | {large['p90_funding_minutes']:.0f} min |",
        f"| Average activation threshold | {percentage(small['avg_activation_threshold_pct'])} | {percentage(medium['avg_activation_threshold_pct'])} | {percentage(large['avg_activation_threshold_pct'])} |",
        f"| Simulated draws per day | {small['draws_per_day']:.2f} | {medium['draws_per_day']:.2f} | {large['draws_per_day']:.2f} |",
        f"| Average effective Player wallets | {small['avg_effective_player_wallets']:.2f} | {medium['avg_effective_player_wallets']:.2f} | {large['avg_effective_player_wallets']:.2f} |",
        f"| Median largest Player share | {percentage(small['median_largest_player_share'])} | {percentage(medium['median_largest_player_share'])} | {percentage(large['median_largest_player_share'])} |",
        f"| Realized Player win rate | {percentage(small['player_win_rate'])} | {percentage(medium['player_win_rate'])} | {percentage(large['player_win_rate'])} |",
        f"| Player EV / stake | {percentage(small['player_ev_per_stake'])} | {percentage(medium['player_ev_per_stake'])} | {percentage(large['player_ev_per_stake'])} |",
        f"| Realized Player PnL / stake | {percentage(small['player_pnl_per_stake'])} | {percentage(medium['player_pnl_per_stake'])} | {percentage(large['player_pnl_per_stake'])} |",
        f"| Staker return / draw | {percentage(small['staker_return_per_draw'])} | {percentage(medium['staker_return_per_draw'])} | {percentage(large['staker_return_per_draw'])} |",
        f"| Protocol revenue | {small['protocol_revenue']:.2f} SOL | {medium['protocol_revenue']:.2f} SOL | {large['protocol_revenue']:.2f} SOL |",
        f"| Protocol revenue per simulated day | {small['protocol_revenue_per_day']:.2f} SOL | {medium['protocol_revenue_per_day']:.2f} SOL | {large['protocol_revenue_per_day']:.2f} SOL |",
        f"| Protocol take / Player SOL | {percentage(small['protocol_take_per_player_sol'])} | {percentage(medium['protocol_take_per_player_sol'])} | {percentage(large['protocol_take_per_player_sol'])} |",
        "",
        "## Reading The Results",
        "",
        f"Median funding time rises from {small['median_funding_minutes']:.0f} to {medium['median_funding_minutes']:.0f} to {large['median_funding_minutes']:.0f} minutes. The arrival presets intentionally grow more slowly than required Player TVL, so larger pools take longer to fill even though they attract more Player arrivals.",
        "",
        f"Threshold decay does the work most strongly at scale. The average activation target falls to {percentage(small['avg_activation_threshold_pct'])} for small, {percentage(medium['avg_activation_threshold_pct'])} for medium, and {percentage(large['avg_activation_threshold_pct'])} for large. Erosion needs no second time adjustment because its 7% Player-TVL cap already falls with the smaller activated pool.",
        "",
        f"Quoted Player EV ranges from {percentage(small['player_ev_per_stake'])} to {percentage(large['player_ev_per_stake'])}. The large realized Player win rate of {percentage(large['player_win_rate'])} is below the fixed 90% target in this seed, which explains why its realized PnL is worse than its quoted EV despite more favorable pool composition.",
        "",
        "Cadence starts when the first Player enters and excludes idle time before that first deposit. Draws per day and per-day revenue are therefore active-funding scenario outputs, not forecasts. Production estimates require observed arrival and withdrawal data.",
    ]
    path.write_text("\n".join(lines) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--draws", type=int, default=1000)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    comparison = []
    for size in SIZE_PRESETS:
        config = config_for_size(size)
        config.draws = args.draws
        config.output_dir = args.data_dir / size
        draws, positions, state = run_simulation(config)
        write_simulation_outputs(config, draws, positions, state)
        comparison.append(scenario_metrics(size, draws, positions, state))
        print(f"Wrote {size} scenario to {config.output_dir}")

    write_csv(args.data_dir / "scenario_comparison.csv", comparison)
    write_analysis(args.data_dir / "scenario_analysis.md", comparison, args.draws)
    print(f"Wrote scenario comparison to {args.data_dir}")


if __name__ == "__main__":
    main()
