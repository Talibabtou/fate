#!/usr/bin/env python3
"""Validate the six-percent fee neighborhood omitted by finalist selection."""

from __future__ import annotations

import csv
from pathlib import Path

from run_parameter_study import STUDY_DIR, aggregate_rows, make_case, run_cases, write_csv


CASES = [
    make_case({}),
    make_case({"protocol_fee_rate": 0.06}, prefix="supplemental"),
    make_case(
        {"protocol_fee_rate": 0.06, "risk_threshold_pct_of_safe_tvl": 0.005},
        prefix="supplemental",
    ),
    make_case(
        {"protocol_fee_rate": 0.06, "risk_tvl_erosion_cap_rate": 0.035},
        prefix="supplemental",
    ),
    make_case(
        {"protocol_fee_rate": 0.06, "target_risk_probability": 0.875},
        prefix="supplemental",
    ),
    make_case(
        {"protocol_fee_rate": 0.06, "threshold_decay_factor": 0.85},
        prefix="supplemental",
    ),
    make_case(
        {"protocol_fee_rate": 0.06, "threshold_decay_factor": 0.95},
        prefix="supplemental",
    ),
]


def read_csv(path: Path) -> list[dict[str, object]]:
    with path.open(newline="") as file:
        return list(csv.DictReader(file))


def main() -> None:
    rows = run_cases(
        CASES,
        "supplemental_validation",
        draws=1000,
        seeds_per_size=5,
        seed_offset=30_000,
    )
    summary = aggregate_rows(rows)
    write_csv(STUDY_DIR / "supplemental_validation_runs.csv", rows)
    write_csv(STUDY_DIR / "supplemental_validation_summary.csv", summary)

    primary_rows = read_csv(STUDY_DIR / "validation_runs.csv")
    combined_rows = primary_rows + [row for row in rows if row["case_id"] != "baseline"]
    combined_summary = aggregate_rows(combined_rows)
    write_csv(STUDY_DIR / "all_validation_summary.csv", combined_summary)
    write_csv(
        STUDY_DIR / "pareto_frontier.csv",
        [row for row in combined_summary if bool(row["pareto"])],
    )
    print(f"Supplemental outputs written to {STUDY_DIR}")


if __name__ == "__main__":
    main()
