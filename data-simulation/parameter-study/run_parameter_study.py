#!/usr/bin/env python3
"""Screen Fate constants, build pairwise candidates, and validate finalists."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean


STUDY_DIR = Path(__file__).resolve().parent
SIMULATION_DIR = STUDY_DIR.parent
sys.path.insert(0, str(SIMULATION_DIR))

from run_scenarios import scenario_metrics  # noqa: E402
from simulate import SIZE_PRESETS, Config, config_for_size, run_simulation  # noqa: E402


BASELINE = {
    "target_risk_probability": 0.90,
    "protocol_fee_rate": 0.05,
    "risk_threshold_pct_of_safe_tvl": 0.01,
    "threshold_decay_interval_minutes": 10,
    "threshold_decay_factor": 0.90,
    "minimum_draw_pool_sol": 0.10,
    "activation_floor_pct_of_safe_tvl": 0.001,
    "minimum_player_deposit_sol": 0.01,
    "minimum_staker_deposit_sol": 0.10,
    "countdown_minutes": 5,
    "safe_erosion_on_risk_win_rate": 0.0007,
    "risk_tvl_erosion_cap_rate": 0.07,
    "max_early_boost": 0.50,
    "safe_jackpot_share": 0.30,
}


SWEEP_VALUES = {
    "target_risk_probability": [0.85, 0.875, 0.925, 0.95],
    "protocol_fee_rate": [0.03, 0.04, 0.06, 0.075],
    "risk_threshold_pct_of_safe_tvl": [0.005, 0.0075, 0.0125, 0.015],
    "threshold_decay_interval_minutes": [5, 15, 20],
    "threshold_decay_factor": [0.85, 0.95, 0.975],
    "minimum_draw_pool_sol": [0.05, 0.20, 0.50],
    "activation_floor_pct_of_safe_tvl": [0.0005, 0.002, 0.005],
    "minimum_player_deposit_sol": [0.005, 0.025, 0.05, 0.10],
    "minimum_staker_deposit_sol": [0.05, 0.25, 0.50, 1.00],
    "countdown_minutes": [2, 10, 15],
    "safe_erosion_on_risk_win_rate": [0.00035, 0.0005, 0.001, 0.0015],
    "risk_tvl_erosion_cap_rate": [0.035, 0.05, 0.10, 0.15],
    "max_early_boost": [0.0, 0.25, 0.75, 1.0],
    "safe_jackpot_share": [0.15, 0.45, 0.60],
}


def value_label(value: float | int) -> str:
    if isinstance(value, int):
        return str(value)
    return f"{value:g}".replace(".", "p")


def make_case(changes: dict[str, float | int], prefix: str = "oat") -> dict[str, object]:
    if not changes:
        case_id = "baseline"
    else:
        parts = [f"{name}-{value_label(value)}" for name, value in sorted(changes.items())]
        case_id = f"{prefix}__" + "__".join(parts)
    return {"case_id": case_id, "changes": changes}


def screening_cases() -> list[dict[str, object]]:
    cases = [make_case({})]
    for parameter, values in SWEEP_VALUES.items():
        cases.extend(make_case({parameter: value}) for value in values)
    return cases


def configure(size: str, changes: dict[str, float | int], draws: int, seed: int) -> Config:
    config = config_for_size(size)
    config.draws = draws
    config.seed = seed
    config.record_cumulative_draw_pnl = False
    for name, value in BASELINE.items():
        setattr(config, name, value)
    for name, value in changes.items():
        setattr(config, name, value)
    config.safe_pro_rata_share = 1.0 - config.protocol_fee_rate - config.safe_jackpot_share
    if config.safe_pro_rata_share < 0:
        raise ValueError("Staker jackpot and fee leave a negative pro-rata share")
    return config


def run_cases(
    cases: list[dict[str, object]],
    stage: str,
    draws: int,
    seeds_per_size: int,
    seed_offset: int,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    total = len(cases)
    for case_index, case in enumerate(cases, start=1):
        changes = dict(case["changes"])
        for size in SIZE_PRESETS:
            base_seed = int(SIZE_PRESETS[size]["seed"]) + seed_offset
            for seed_index in range(seeds_per_size):
                seed = base_seed + seed_index
                config = configure(size, changes, draws, seed)
                draw_rows, positions, state = run_simulation(config)
                metrics = scenario_metrics(size, seed, draw_rows, positions, state)
                metrics.update(
                    {
                        "stage": stage,
                        "case_id": case["case_id"],
                        "changes": json.dumps(changes, sort_keys=True, separators=(",", ":")),
                        "draws": draws,
                        "safe_pro_rata_share": config.safe_pro_rata_share,
                    }
                )
                rows.append(metrics)
        print(f"[{stage}] {case_index}/{total} {case['case_id']}", flush=True)
    return rows


def geometric_mean(values: list[float]) -> float:
    positive = [max(value, 1e-12) for value in values]
    return math.exp(sum(math.log(value) for value in positive) / len(positive))


def aggregate_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["case_id"])].append(row)

    baseline_by_run = {
        (str(row["scenario"]), int(row["seed"])): row
        for row in grouped["baseline"]
    }
    summaries = []
    for case_id, case_rows in grouped.items():
        player_profit_indexes = []
        staker_profit_indexes = []
        revenue_day_indexes = []
        take_indexes = []
        combined_profit_rates = []
        for row in case_rows:
            baseline = baseline_by_run[(str(row["scenario"]), int(row["seed"]))]
            player_profit_indexes.append(
                max(float(row["profitable_player_rate"]), 1e-9)
                / max(float(baseline["profitable_player_rate"]), 1e-9)
            )
            staker_profit_indexes.append(
                max(float(row["profitable_staker_rate"]), 1e-9)
                / max(float(baseline["profitable_staker_rate"]), 1e-9)
            )
            revenue_day_indexes.append(
                max(float(row["protocol_revenue_per_day"]), 1e-9)
                / max(float(baseline["protocol_revenue_per_day"]), 1e-9)
            )
            take_indexes.append(
                max(float(row["protocol_take_per_player_sol"]), 1e-9)
                / max(float(baseline["protocol_take_per_player_sol"]), 1e-9)
            )
            profitable_users = int(row["profitable_players"]) + int(row["profitable_stakers"])
            total_users = int(row["players"]) + int(row["stakers"])
            combined_profit_rates.append(profitable_users / total_users if total_users else 0.0)

        player_index = geometric_mean(player_profit_indexes)
        staker_index = geometric_mean(staker_profit_indexes)
        revenue_day_index = geometric_mean(revenue_day_indexes)
        take_index = geometric_mean(take_indexes)
        summaries.append(
            {
                "case_id": case_id,
                "changes": case_rows[0]["changes"],
                "runs": len(case_rows),
                "player_profitable_rate": mean(float(row["profitable_player_rate"]) for row in case_rows),
                "staker_profitable_rate": mean(float(row["profitable_staker_rate"]) for row in case_rows),
                "combined_profitable_rate": mean(combined_profit_rates),
                "player_ev_per_stake": mean(float(row["player_ev_per_stake"]) for row in case_rows),
                "player_pnl_per_stake": mean(float(row["player_pnl_per_stake"]) for row in case_rows),
                "staker_return_per_draw": mean(float(row["staker_return_per_draw"]) for row in case_rows),
                "protocol_revenue_per_day": mean(
                    float(row["protocol_revenue_per_day"]) for row in case_rows
                ),
                "protocol_take_per_player_sol": mean(
                    float(row["protocol_take_per_player_sol"]) for row in case_rows
                ),
                "median_funding_minutes": mean(
                    float(row["median_funding_minutes"]) for row in case_rows
                ),
                "activation_rate": mean(float(row["activation_rate"]) for row in case_rows),
                "player_profit_index": player_index,
                "staker_profit_index": staker_index,
                "revenue_day_index": revenue_day_index,
                "protocol_take_index": take_index,
                "user_profit_index": geometric_mean([player_index, staker_index]),
                "revenue_index": geometric_mean([revenue_day_index, take_index]),
                "balanced_score": geometric_mean(
                    [player_index, staker_index, revenue_day_index, take_index]
                ),
                "pareto": False,
            }
        )

    objectives = [
        "player_profit_index",
        "staker_profit_index",
        "revenue_day_index",
        "protocol_take_index",
    ]
    for candidate in summaries:
        candidate["pareto"] = not any(
            other is not candidate
            and all(float(other[key]) >= float(candidate[key]) for key in objectives)
            and any(float(other[key]) > float(candidate[key]) for key in objectives)
            for other in summaries
        )
    summaries.sort(key=lambda row: float(row["balanced_score"]), reverse=True)
    for rank, row in enumerate(summaries, start=1):
        row["rank"] = rank
    return summaries


def pairwise_cases(screening_summary: list[dict[str, object]], limit: int = 12) -> list[dict[str, object]]:
    strong = [
        row
        for row in screening_summary
        if row["case_id"] != "baseline" and (bool(row["pareto"]) or float(row["balanced_score"]) >= 1.0)
    ][:limit]
    source_changes = [json.loads(str(row["changes"])) for row in strong]
    cases = [make_case({})]
    seen = {"{}"}
    for index, left in enumerate(source_changes):
        for right in source_changes[index + 1 :]:
            if set(left).intersection(right):
                continue
            changes = {**left, **right}
            key = json.dumps(changes, sort_keys=True, separators=(",", ":"))
            if key in seen:
                continue
            seen.add(key)
            cases.append(make_case(changes, prefix="pair"))
    return cases


def finalist_cases(
    screening_summary: list[dict[str, object]],
    pairwise_summary: list[dict[str, object]],
    limit: int,
) -> list[dict[str, object]]:
    pool = screening_summary + pairwise_summary
    selected: list[dict[str, object]] = []
    selectors = [
        lambda row: float(row["balanced_score"]),
        lambda row: float(row["user_profit_index"]),
        lambda row: float(row["revenue_index"]),
        lambda row: float(row["player_profit_index"]),
        lambda row: float(row["staker_profit_index"]),
    ]
    ordered = [next(row for row in pool if row["case_id"] == "baseline")]
    ranked_by_selector = [sorted(pool, key=selector, reverse=True) for selector in selectors]
    for rank_index in range(2):
        for ranked in ranked_by_selector:
            ordered.append(ranked[rank_index])
    non_fee_pool = [row for row in pool if "protocol_fee_rate" not in str(row["changes"])]
    ordered.extend(
        sorted(non_fee_pool, key=lambda row: float(row["balanced_score"]), reverse=True)[:3]
    )
    ordered.extend(
        sorted(
            (row for row in pool if bool(row["pareto"])),
            key=lambda row: float(row["balanced_score"]),
            reverse=True,
        )
    )

    seen = set()
    for row in ordered:
        changes = str(row["changes"])
        if changes in seen:
            continue
        seen.add(changes)
        selected.append(make_case(json.loads(changes), prefix="final"))
        if len(selected) >= limit:
            break
    return selected


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def write_manifest(path: Path, args: argparse.Namespace, counts: dict[str, int]) -> None:
    manifest = {
        "baseline": BASELINE,
        "sweep_values": SWEEP_VALUES,
        "screening_draws": args.screening_draws,
        "screening_seeds": args.screening_seeds,
        "validation_draws": args.validation_draws,
        "validation_seeds": args.validation_seeds,
        "finalist_limit": args.finalist_limit,
        "case_counts": counts,
        "scoring": {
            "player_profit_index": "geometric mean of profitable-Player rate / matched baseline",
            "staker_profit_index": "geometric mean of profitable-Staker rate / matched baseline",
            "revenue_day_index": "geometric mean of protocol revenue/day / matched baseline",
            "protocol_take_index": "geometric mean of protocol take per Player SOL / matched baseline",
            "balanced_score": "equal-weight geometric mean of the four indexes",
        },
    }
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--screening-draws", type=int, default=300)
    parser.add_argument("--screening-seeds", type=int, default=1)
    parser.add_argument("--validation-draws", type=int, default=1000)
    parser.add_argument("--validation-seeds", type=int, default=5)
    parser.add_argument("--pair-source-limit", type=int, default=12)
    parser.add_argument("--finalist-limit", type=int, default=12)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    STUDY_DIR.mkdir(parents=True, exist_ok=True)

    screen_cases = screening_cases()
    screening_rows = run_cases(
        screen_cases,
        "screening",
        args.screening_draws,
        args.screening_seeds,
        seed_offset=10_000,
    )
    screening_summary = aggregate_rows(screening_rows)
    write_csv(STUDY_DIR / "screening_runs.csv", screening_rows)
    write_csv(STUDY_DIR / "screening_summary.csv", screening_summary)

    pairs = pairwise_cases(screening_summary, args.pair_source_limit)
    pair_rows = run_cases(
        pairs,
        "pairwise",
        args.screening_draws,
        args.screening_seeds,
        seed_offset=20_000,
    )
    pair_summary = aggregate_rows(pair_rows)
    write_csv(STUDY_DIR / "pairwise_runs.csv", pair_rows)
    write_csv(STUDY_DIR / "pairwise_summary.csv", pair_summary)

    finalists = finalist_cases(screening_summary, pair_summary, args.finalist_limit)
    validation_rows = run_cases(
        finalists,
        "validation",
        args.validation_draws,
        args.validation_seeds,
        seed_offset=30_000,
    )
    validation_summary = aggregate_rows(validation_rows)
    write_csv(STUDY_DIR / "validation_runs.csv", validation_rows)
    write_csv(STUDY_DIR / "validation_summary.csv", validation_summary)
    write_csv(
        STUDY_DIR / "pareto_frontier.csv",
        [row for row in validation_summary if bool(row["pareto"])],
    )
    write_manifest(
        STUDY_DIR / "manifest.json",
        args,
        {
            "screening": len(screen_cases),
            "pairwise": len(pairs),
            "validation": len(finalists),
        },
    )
    print(f"Study outputs written to {STUDY_DIR}")


if __name__ == "__main__":
    main()
