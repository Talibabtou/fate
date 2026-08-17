#!/usr/bin/env python3
"""
Threshold-triggered simulator for the Solana Hybrid Lottery.

Current model:
- Staker SOL is inert and earns no external yield.
- Staker upside comes only from losing Player deposits.
- Player deposits are pending until Player TVL reaches a threshold.
- Threshold default: Player TVL >= 1% of active Staker TVL.
- Once threshold is crossed, a 5-minute countdown starts.
- Player deposits can still enter during the countdown.
- Staker deposits made after countdown start only count from the next draw.
- Every activated draw has exactly one jackpot winner wallet.
- Fees are charged on losing Player deposits plus Staker erosion when Player wins.
- Player-win erosion is min(0.07% of Staker TVL, 7% of Player TVL).
- Staker wins split Player TVL 30% jackpot, 65% pro-rata, and 5% protocol fee.
"""

from __future__ import annotations

import argparse
import csv
import random
from dataclasses import dataclass, field
from pathlib import Path
from statistics import mean, median


SIZE_PRESETS = {
    "small": {
        "seed": 20260811,
        "capital_scale": 0.20,
        "initial_safe_users": 30,
        "initial_safe_whales": 2,
        "persistent_risk_users": 8,
        "safe_entrant_scale": 0.30,
        "player_arrivals_per_interval": 1.00,
    },
    "medium": {
        "seed": 20260817,
        "capital_scale": 1.0,
        "initial_safe_users": 100,
        "initial_safe_whales": 5,
        "persistent_risk_users": 24,
        "safe_entrant_scale": 1.0,
        "player_arrivals_per_interval": 1.00,
    },
    "large": {
        "seed": 20260829,
        "capital_scale": 5.0,
        "initial_safe_users": 400,
        "initial_safe_whales": 20,
        "persistent_risk_users": 96,
        "safe_entrant_scale": 4.0,
        "player_arrivals_per_interval": 1.50,
    },
}


@dataclass
class Config:
    draws: int = 1000
    seed: int = 20260817
    output_dir: Path = Path("data/medium")
    protocol_size: str = "medium"
    capital_scale: float = 1.0
    target_risk_probability: float = 0.90
    protocol_fee_rate: float = 0.05
    risk_threshold_pct_of_safe_tvl: float = 0.01
    threshold_decay_interval_minutes: int = 10
    threshold_decay_factor: float = 0.90
    minimum_draw_pool_sol: float = 0.10
    activation_floor_pct_of_safe_tvl: float = 0.001
    minimum_player_deposit_sol: float = 0.01
    minimum_staker_deposit_sol: float = 0.10
    player_arrivals_per_interval: float = 1.00
    pending_withdrawal_probability: float = 0.01
    funding_staker_withdrawal_probability: float = 0.001
    countdown_staker_withdrawal_probability: float = 0.001
    countdown_minutes: int = 5
    safe_jackpot_share: float = 0.30
    safe_pro_rata_share: float = 0.65
    safe_erosion_on_risk_win_rate: float = 0.0007
    risk_tvl_erosion_cap_rate: float | None = 0.07
    max_early_boost: float = 0.50
    min_effective_risk_participants: float = 0.0
    max_largest_risk_share: float = 1.0
    min_median_profit_multiple: float = 0.0
    initial_safe_users: int = 100
    initial_safe_whales: int = 5
    persistent_risk_users: int = 24
    safe_entrant_scale: float = 1.0
    record_cumulative_draw_pnl: bool = True


def config_for_size(protocol_size: str) -> Config:
    preset = SIZE_PRESETS[protocol_size]
    return Config(
        protocol_size=protocol_size,
        seed=preset["seed"],
        output_dir=Path("data") / protocol_size,
        capital_scale=preset["capital_scale"],
        initial_safe_users=preset["initial_safe_users"],
        initial_safe_whales=preset["initial_safe_whales"],
        persistent_risk_users=preset["persistent_risk_users"],
        safe_entrant_scale=preset["safe_entrant_scale"],
        player_arrivals_per_interval=preset["player_arrivals_per_interval"],
    )


@dataclass
class Participant:
    participant_id: str
    mode: str
    archetype: str
    safe_principal: float = 0.0
    active: bool = True
    active_from_draw: int = 1
    bankroll: float = 0.0
    cumulative_pnl: float = 0.0
    wins: int = 0
    losses: int = 0
    entries: int = 0
    withdrawals: int = 0
    fees_paid: float = 0.0
    pro_rata_received: float = 0.0


@dataclass
class RiskPosition:
    draw: int
    phase: str
    participant_id: str
    archetype: str
    amount: float
    risk_tvl_before_deposit: float
    early_boost: float
    second_draw_weight: float
    entered_at_minute: int = 0
    withdrawn_at_minute: int | None = None
    probability_side_and_wallet: float = 0.0
    probability_if_risk_side_wins: float = 0.0
    profit_if_win: float = 0.0
    ev: float = 0.0
    payout_multiple: float = 0.0
    status: str = "pending"
    pnl: float = 0.0
    fee_paid: float = 0.0


@dataclass
class State:
    participants: dict[str, Participant] = field(default_factory=dict)
    risk_participant_ids: list[str] = field(default_factory=list)
    next_safe_id: int = 0
    next_risk_id: int = 0
    protocol_revenue: float = 0.0


@dataclass
class FundingResult:
    positions: list[RiskPosition]
    withdrawn_positions: list[RiskPosition]
    safe_participants: list[Participant]
    funding_minutes: int
    threshold_decay_steps: int
    initial_threshold: float
    activation_threshold: float
    activation_floor: float
    minutes_at_floor: int
    funding_staker_withdrawal_count: int
    funding_staker_withdrawal_tvl: float
    funding_clock_resets: int


def bounded_lognormal(rng: random.Random, mu: float, sigma: float, lo: float, hi: float) -> float:
    return min(max(rng.lognormvariate(mu, sigma), lo), hi)


def effective_count(amounts: list[float]) -> float:
    total = sum(amounts)
    squares = sum(x * x for x in amounts)
    if total <= 0 or squares <= 0:
        return 0.0
    return (total * total) / squares


def gini(values: list[float]) -> float:
    clean = sorted(x for x in values if x >= 0)
    n = len(clean)
    total = sum(clean)
    if n == 0 or total == 0:
        return 0.0
    weighted = sum((idx + 1) * value for idx, value in enumerate(clean))
    return (2 * weighted) / (n * total) - (n + 1) / n


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = (len(ordered) - 1) * quantile
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = index - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def weighted_choice(rng: random.Random, items: list[tuple[str, float]]) -> str:
    total = sum(weight for _, weight in items)
    if total <= 0:
        raise ValueError("weighted_choice requires positive weight")
    ticket = rng.random() * total
    running = 0.0
    for item, weight in items:
        running += weight
        if ticket <= running:
            return item
    return items[-1][0]


def aggregate_risk_positions(positions: list[RiskPosition]) -> dict[str, dict[str, float]]:
    wallets: dict[str, dict[str, float]] = {}
    for position in positions:
        wallet = wallets.setdefault(
            position.participant_id,
            {
                "amount": 0.0,
                "weight": 0.0,
            },
        )
        wallet["amount"] += position.amount
        wallet["weight"] += position.second_draw_weight
    return wallets


def locked_wallet_metrics(positions: list[RiskPosition]) -> tuple[list[float], list[float], list[float]]:
    wallets: dict[tuple[int, str], dict[str, float]] = {}
    for position in positions:
        if position.status not in {"won", "winner_wallet_merged", "lost"}:
            continue
        wallet = wallets.setdefault(
            (position.draw, position.participant_id),
            {"amount": 0.0, "ev": position.ev, "pnl": 0.0},
        )
        wallet["amount"] += position.amount
        wallet["pnl"] += position.pnl
    return (
        [wallet["amount"] for wallet in wallets.values()],
        [wallet["ev"] for wallet in wallets.values()],
        [wallet["pnl"] for wallet in wallets.values()],
    )


def add_safe_user(state: State, rng: random.Random, config: Config, draw: int, archetype: str) -> Participant:
    state.next_safe_id += 1
    participant_id = f"safe_{state.next_safe_id:05d}"
    if archetype == "safe_whale":
        amount = bounded_lognormal(rng, 3.3, 0.55, 20.0, 140.0)
    else:
        amount = bounded_lognormal(rng, 0.7, 0.9, 0.15, 20.0)
    amount = max(amount * config.capital_scale, config.minimum_staker_deposit_sol)
    participant = Participant(
        participant_id=participant_id,
        mode="safe",
        archetype=archetype,
        safe_principal=round(amount, 9),
        active_from_draw=draw + 1,
    )
    state.participants[participant_id] = participant
    return participant


def add_risk_user(state: State, rng: random.Random, config: Config, archetype: str) -> Participant:
    state.next_risk_id += 1
    participant_id = f"risk_{state.next_risk_id:05d}"
    bankroll = {
        "persistent_risk": bounded_lognormal(rng, 2.0, 0.7, 2.5, 80.0),
        "occasional_risk": bounded_lognormal(rng, 1.4, 0.85, 1.0, 35.0),
        "opportunistic_risk": bounded_lognormal(rng, 2.2, 0.75, 3.0, 90.0),
        "risk_whale": bounded_lognormal(rng, 4.1, 0.5, 35.0, 280.0),
    }[archetype] * config.capital_scale
    participant = Participant(
        participant_id=participant_id,
        mode="risk",
        archetype=archetype,
        bankroll=round(bankroll, 9),
    )
    state.participants[participant_id] = participant
    state.risk_participant_ids.append(participant_id)
    return participant


def initialize_state(config: Config, rng: random.Random) -> State:
    state = State()
    for idx in range(config.initial_safe_users):
        archetype = "safe_whale" if idx < config.initial_safe_whales else "small_persistent_safe"
        p = add_safe_user(state, rng, config, 0, archetype)
        p.active_from_draw = 1
    for _ in range(config.persistent_risk_users):
        add_risk_user(state, rng, config, "persistent_risk")
    return state


def active_safe_participants(state: State, draw: int) -> list[Participant]:
    return [
        p
        for p in state.participants.values()
        if p.mode == "safe" and p.active and p.active_from_draw <= draw
    ]


def safe_population_churn(state: State, rng: random.Random, config: Config, draw: int) -> None:
    for p in active_safe_participants(state, draw):
        exit_probability = 0.004 if p.archetype == "safe_whale" else 0.01
        if rng.random() < exit_probability:
            p.active = False
            p.withdrawals += 1

    entrant_batches = int(config.safe_entrant_scale)
    if rng.random() < config.safe_entrant_scale - entrant_batches:
        entrant_batches += 1
    entrants = sum(
        rng.choices([0, 1, 2, 3, 4], weights=[25, 34, 24, 12, 5], k=1)[0]
        for _ in range(entrant_batches)
    )
    for _ in range(entrants):
        add_safe_user(
            state,
            rng,
            config,
            draw,
            "safe_whale" if rng.random() < 0.04 else "small_persistent_safe",
        )


def choose_risk_amount(
    rng: random.Random,
    participant: Participant,
    phase: str,
    threshold_remaining: float,
    available_bankroll: float,
) -> float:
    if participant.archetype == "persistent_risk":
        fraction = rng.uniform(0.04, 0.16)
    elif participant.archetype == "opportunistic_risk":
        fraction = rng.uniform(0.05, 0.18)
    elif participant.archetype == "risk_whale":
        fraction = rng.uniform(0.02, 0.10)
    else:
        fraction = rng.uniform(0.06, 0.22)

    amount = participant.bankroll * fraction
    if phase == "bootstrap" and threshold_remaining > 0 and rng.random() < 0.35:
        amount = min(amount, threshold_remaining * rng.uniform(0.25, 1.15))
    return round(min(amount, available_bankroll), 9)


def available_risk_bankroll(participant: Participant, committed_by_wallet: dict[str, float]) -> float:
    return max(participant.bankroll - committed_by_wallet.get(participant.participant_id, 0.0), 0.0)


def pick_existing_risk_user(
    state: State,
    rng: random.Random,
    config: Config,
    committed_by_wallet: dict[str, float],
) -> Participant | None:
    minimum_available = config.minimum_player_deposit_sol
    for _ in range(24):
        if not state.risk_participant_ids:
            return None
        participant_id = rng.choice(state.risk_participant_ids)
        participant = state.participants[participant_id]
        if available_risk_bankroll(participant, committed_by_wallet) > minimum_available:
            return participant
    return None


def add_position(
    positions: list[RiskPosition],
    config: Config,
    draw: int,
    participant: Participant,
    amount: float,
    phase: str,
    threshold: float,
    entered_at_minute: int = 0,
) -> None:
    if amount < config.minimum_player_deposit_sol:
        return
    risk_tvl_before = sum(p.amount for p in positions)
    remaining_fraction = max(threshold - risk_tvl_before, 0.0) / threshold if threshold > 0 else 0.0
    early_boost = 1.0 + config.max_early_boost * remaining_fraction if phase == "bootstrap" else 1.0
    positions.append(
        RiskPosition(
            draw=draw,
            phase=phase,
            participant_id=participant.participant_id,
            archetype=participant.archetype,
            amount=amount,
            risk_tvl_before_deposit=round(risk_tvl_before, 9),
            early_boost=round(early_boost, 9),
            second_draw_weight=round(amount * early_boost, 9),
            entered_at_minute=entered_at_minute,
        )
    )


def stochastic_count(rng: random.Random, expected: float) -> int:
    whole = int(expected)
    return whole + (1 if rng.random() < expected - whole else 0)


def probability_for_minutes(probability_per_10_minutes: float, minutes: int) -> float:
    """Scale a ten-minute event probability without changing its time hazard."""
    return 1 - (1 - probability_per_10_minutes) ** (minutes / 10)


def add_funding_player(
    state: State,
    rng: random.Random,
    config: Config,
    draw: int,
    positions: list[RiskPosition],
    committed_by_wallet: dict[str, float],
    initial_threshold: float,
    entered_at_minute: int,
) -> None:
    participant = pick_existing_risk_user(state, rng, config, committed_by_wallet)
    if participant is None or rng.random() < 0.18:
        archetype = rng.choices(
            ["occasional_risk", "opportunistic_risk", "risk_whale"],
            weights=[78, 17, 5],
            k=1,
        )[0]
        participant = add_risk_user(state, rng, config, archetype)
    threshold_remaining = max(initial_threshold - sum(p.amount for p in positions), 0.0)
    amount = choose_risk_amount(
        rng,
        participant,
        "bootstrap",
        threshold_remaining,
        available_risk_bankroll(participant, committed_by_wallet),
    )
    count_before = len(positions)
    add_position(
        positions,
        config,
        draw,
        participant,
        amount,
        "bootstrap",
        initial_threshold,
        entered_at_minute,
    )
    if len(positions) > count_before:
        committed_by_wallet[participant.participant_id] = (
            committed_by_wallet.get(participant.participant_id, 0.0) + amount
        )


def collect_timed_funding(
    state: State,
    rng: random.Random,
    config: Config,
    draw: int,
    safe_participants: list[Participant],
) -> FundingResult:
    staker_tvl_snapshot = sum(p.safe_principal for p in safe_participants)
    initial_threshold = staker_tvl_snapshot * config.risk_threshold_pct_of_safe_tvl
    activation_floor = max(
        config.minimum_draw_pool_sol,
        staker_tvl_snapshot * config.activation_floor_pct_of_safe_tvl,
    )
    positions: list[RiskPosition] = []
    withdrawn: list[RiskPosition] = []
    committed_by_wallet: dict[str, float] = {}
    elapsed_minutes = 0
    waiting_steps = 0
    minutes_at_floor = 0
    funding_staker_withdrawal_count = 0
    funding_staker_withdrawal_tvl = 0.0
    funding_clock_resets = 0

    add_funding_player(
        state,
        rng,
        config,
        draw,
        positions,
        committed_by_wallet,
        initial_threshold,
        elapsed_minutes,
    )

    while True:
        active_threshold = max(
            activation_floor,
            initial_threshold * config.threshold_decay_factor**waiting_steps,
        )
        if sum(p.amount for p in positions) >= active_threshold:
            return FundingResult(
                positions=positions,
                withdrawn_positions=withdrawn,
                safe_participants=safe_participants,
                funding_minutes=elapsed_minutes,
                threshold_decay_steps=waiting_steps,
                initial_threshold=initial_threshold,
                activation_threshold=active_threshold,
                activation_floor=activation_floor,
                minutes_at_floor=minutes_at_floor,
                funding_staker_withdrawal_count=funding_staker_withdrawal_count,
                funding_staker_withdrawal_tvl=funding_staker_withdrawal_tvl,
                funding_clock_resets=funding_clock_resets,
            )

        elapsed_minutes += config.threshold_decay_interval_minutes
        if active_threshold <= activation_floor:
            minutes_at_floor += config.threshold_decay_interval_minutes
        if elapsed_minutes > 7 * 24 * 60:
            raise RuntimeError("funding did not activate within the simulator safety bound")

        funding_staker_withdrawal_probability = probability_for_minutes(
            config.funding_staker_withdrawal_probability,
            config.threshold_decay_interval_minutes,
        )
        funding_withdrawal_ids = {
            staker.participant_id
            for staker in safe_participants
            if rng.random() < funding_staker_withdrawal_probability
        }
        if len(funding_withdrawal_ids) == len(safe_participants) and safe_participants:
            funding_withdrawal_ids.remove(safe_participants[-1].participant_id)
        remaining_stakers = []
        for staker in safe_participants:
            if staker.participant_id in funding_withdrawal_ids:
                staker.active = False
                staker.withdrawals += 1
                funding_staker_withdrawal_count += 1
                funding_staker_withdrawal_tvl += staker.safe_principal
            else:
                remaining_stakers.append(staker)
        safe_participants = remaining_stakers

        staker_tvl_snapshot = sum(p.safe_principal for p in safe_participants)
        initial_threshold = staker_tvl_snapshot * config.risk_threshold_pct_of_safe_tvl
        activation_floor = max(
            config.minimum_draw_pool_sol,
            staker_tvl_snapshot * config.activation_floor_pct_of_safe_tvl,
        )

        pending_withdrawal_probability = probability_for_minutes(
            config.pending_withdrawal_probability,
            config.threshold_decay_interval_minutes,
        )
        had_positions = bool(positions)
        remaining = []
        for position in positions:
            if rng.random() < pending_withdrawal_probability:
                position.status = "pending_withdrawn"
                position.withdrawn_at_minute = elapsed_minutes
                state.participants[position.participant_id].withdrawals += 1
                withdrawn.append(position)
            else:
                remaining.append(position)
        positions = remaining
        committed_by_wallet = {
            participant_id: wallet["amount"]
            for participant_id, wallet in aggregate_risk_positions(positions).items()
        }

        if positions:
            waiting_steps += 1
        else:
            waiting_steps = 0
            if had_positions:
                funding_clock_resets += 1

        arrivals = stochastic_count(
            rng,
            config.player_arrivals_per_interval
            * config.threshold_decay_interval_minutes
            / 10,
        )
        for _ in range(arrivals):
            add_funding_player(
                state,
                rng,
                config,
                draw,
                positions,
                committed_by_wallet,
                initial_threshold,
                elapsed_minutes,
            )


def collect_countdown_risk(
    state: State,
    rng: random.Random,
    config: Config,
    draw: int,
    positions: list[RiskPosition],
    threshold: float,
    activation_minute: int,
) -> None:
    risk_tvl = sum(p.amount for p in positions)
    committed_by_wallet: dict[str, float] = {}
    for position in positions:
        committed_by_wallet[position.participant_id] = (
            committed_by_wallet.get(position.participant_id, 0.0) + position.amount
        )
    base_new_entries = max(1, int(risk_tvl / (8 * config.capital_scale)))
    countdown_scale = max(config.countdown_minutes, 1)
    extra_entries = rng.randint(0, max(2, base_new_entries * countdown_scale))
    for _ in range(extra_entries):
        if rng.random() < 0.55:
            archetype = rng.choices(
                ["occasional_risk", "opportunistic_risk", "risk_whale"],
                weights=[76, 19, 5],
                k=1,
            )[0]
            participant = add_risk_user(state, rng, config, archetype)
        else:
            participant = pick_existing_risk_user(state, rng, config, committed_by_wallet)
            if participant is None:
                continue
        amount = choose_risk_amount(
            rng,
            participant,
            "countdown",
            0.0,
            available_risk_bankroll(participant, committed_by_wallet),
        )
        count_before = len(positions)
        add_position(
            positions,
            config,
            draw,
            participant,
            amount,
            "countdown",
            threshold,
            activation_minute,
        )
        if len(positions) > count_before:
            committed_by_wallet[participant.participant_id] = (
                committed_by_wallet.get(participant.participant_id, 0.0) + amount
            )


def quote_risk_positions(config: Config, positions: list[RiskPosition], safe_tvl: float) -> None:
    risk_tvl = sum(p.amount for p in positions)
    wallets = aggregate_risk_positions(positions)
    total_second_draw_weight = sum(wallet["weight"] for wallet in wallets.values())
    safe_erosion_bonus = calculate_safe_erosion(config, safe_tvl, risk_tvl)
    for position in positions:
        wallet = wallets[position.participant_id]
        wallet_amount = wallet["amount"]
        losing_risk_deposits = max(risk_tvl - wallet_amount, 0.0)
        gross_profit = losing_risk_deposits + safe_erosion_bonus
        fee = gross_profit * config.protocol_fee_rate
        position.profit_if_win = max(gross_profit - fee, 0.0)
        position.probability_if_risk_side_wins = (
            wallet["weight"] / total_second_draw_weight if total_second_draw_weight > 0 else 0.0
        )
        position.probability_side_and_wallet = config.target_risk_probability * position.probability_if_risk_side_wins
        position.ev = (
            position.probability_side_and_wallet * position.profit_if_win
            - (1 - position.probability_side_and_wallet) * wallet_amount
        )
        position.payout_multiple = position.profit_if_win / wallet_amount if wallet_amount > 0 else 0.0


def calculate_safe_erosion(config: Config, safe_tvl: float, risk_tvl: float) -> float:
    safe_tvl_erosion = safe_tvl * config.safe_erosion_on_risk_win_rate
    if config.risk_tvl_erosion_cap_rate is None:
        return safe_tvl_erosion
    return min(safe_tvl_erosion, risk_tvl * config.risk_tvl_erosion_cap_rate)


def risk_pool_health(config: Config, positions: list[RiskPosition]) -> tuple[bool, float, float, float, str]:
    wallets = aggregate_risk_positions(positions)
    amounts = [wallet["amount"] for wallet in wallets.values()]
    risk_tvl = sum(amounts)
    n_eff = effective_count(amounts)
    largest_share = max(amounts) / risk_tvl if risk_tvl > 0 else 0.0
    median_profit_multiple = median([p.payout_multiple for p in positions]) if positions else 0.0

    reasons = []
    if config.min_effective_risk_participants > 0 and n_eff < config.min_effective_risk_participants:
        reasons.append("low_effective_participant_count")
    if config.max_largest_risk_share < 1 and largest_share > config.max_largest_risk_share:
        reasons.append("whale_concentration")
    if config.min_median_profit_multiple > 0 and median_profit_multiple < config.min_median_profit_multiple:
        reasons.append("low_median_profit_multiple")
    return len(reasons) == 0, n_eff, largest_share, median_profit_multiple, "|".join(reasons) or "activated"


def settle_draw(
    state: State,
    rng: random.Random,
    config: Config,
    draw: int,
    safe_participants: list[Participant],
    positions: list[RiskPosition],
    initial_threshold: float,
    activation_threshold: float,
    funding_minutes: int,
    threshold_decay_steps: int,
    withdrawn_positions: list[RiskPosition],
) -> dict[str, object]:
    affected_participant_ids = {
        *(participant.participant_id for participant in safe_participants),
        *(position.participant_id for position in positions),
    }
    pnl_before = sum(
        state.participants[participant_id].cumulative_pnl
        for participant_id in affected_participant_ids
    )
    protocol_revenue_before = state.protocol_revenue
    safe_tvl = sum(p.safe_principal for p in safe_participants)
    risk_tvl = sum(p.amount for p in positions)
    threshold = activation_threshold
    quote_risk_positions(config, positions, safe_tvl)
    activated, n_eff, largest_share, median_profit_multiple, activation_reason = risk_pool_health(config, positions)

    fee = 0.0
    winner_mode = "none"
    winner_id = ""
    winner_profit = 0.0
    safe_jackpot_paid = 0.0
    safe_pro_rata_paid = 0.0
    safe_erosion_paid = 0.0

    if activated:
        winner_mode = weighted_choice(
            rng,
            [("risk", config.target_risk_probability), ("safe", 1 - config.target_risk_probability)],
        )
        if winner_mode == "risk":
            risk_wallets = aggregate_risk_positions(positions)
            winner_id = weighted_choice(
                rng,
                [(participant_id, wallet["weight"]) for participant_id, wallet in risk_wallets.items()],
            )
            winning_wallet_amount = risk_wallets[winner_id]["amount"]
            losing_risk_deposits = max(risk_tvl - winning_wallet_amount, 0.0)
            safe_erosion_paid = calculate_safe_erosion(config, safe_tvl, risk_tvl)
            gross_profit = losing_risk_deposits + safe_erosion_paid
            fee = gross_profit * config.protocol_fee_rate
            state.protocol_revenue += fee
            winner_profit = max(gross_profit - fee, 0.0)
            for safe in safe_participants:
                erosion = safe.safe_principal / safe_tvl * safe_erosion_paid if safe_tvl > 0 else 0.0
                safe.safe_principal -= erosion
                safe.cumulative_pnl -= erosion
            winning_profit_recorded = False
            for position in positions:
                participant = state.participants[position.participant_id]
                participant.entries += 1
                if position.participant_id == winner_id:
                    if not winning_profit_recorded:
                        participant.bankroll += winner_profit
                        participant.cumulative_pnl += winner_profit
                        participant.wins += 1
                        participant.fees_paid += fee
                        position.pnl = winner_profit
                        position.fee_paid = fee
                        winning_profit_recorded = True
                        position.status = "won"
                    else:
                        position.pnl = 0.0
                        position.status = "winner_wallet_merged"
                else:
                    participant.bankroll -= position.amount
                    participant.cumulative_pnl -= position.amount
                    participant.losses += 1
                    position.status = "lost"
                    position.pnl = -position.amount
        else:
            fee = risk_tvl * config.protocol_fee_rate
            state.protocol_revenue += fee
            net_prize = risk_tvl - fee
            safe_jackpot_paid = risk_tvl * config.safe_jackpot_share
            safe_pro_rata_paid = risk_tvl * config.safe_pro_rata_share
            if safe_jackpot_paid + safe_pro_rata_paid > net_prize:
                scale = net_prize / (safe_jackpot_paid + safe_pro_rata_paid) if net_prize > 0 else 0.0
                safe_jackpot_paid *= scale
                safe_pro_rata_paid *= scale

            staker_shares = {
                participant.participant_id: participant.safe_principal / safe_tvl
                for participant in safe_participants
            }
            winner_id = weighted_choice(rng, [(p.participant_id, p.safe_principal) for p in safe_participants])
            winner = state.participants[winner_id]
            winner.safe_principal += safe_jackpot_paid
            winner.cumulative_pnl += safe_jackpot_paid
            winner.wins += 1
            winner_profit = safe_jackpot_paid

            for safe in safe_participants:
                share = staker_shares[safe.participant_id]
                payout = safe_pro_rata_paid * share
                safe.safe_principal += payout
                safe.cumulative_pnl += payout
                safe.pro_rata_received += payout

            for position in positions:
                participant = state.participants[position.participant_id]
                participant.bankroll -= position.amount
                participant.cumulative_pnl -= position.amount
                participant.losses += 1
                participant.entries += 1
                position.status = "lost"
                position.pnl = -position.amount
    else:
        for position in positions:
            position.status = "pending_refunded"
            position.pnl = 0.0

    pnl_after = sum(
        state.participants[participant_id].cumulative_pnl
        for participant_id in affected_participant_ids
    )
    protocol_revenue_after = state.protocol_revenue
    conservation_error = (pnl_after - pnl_before) + (
        protocol_revenue_after - protocol_revenue_before
    )
    if abs(conservation_error) > 1e-7:
        raise AssertionError(
            f"draw {draw} failed value conservation by {conservation_error:.12f} SOL"
        )

    return {
        "draw": draw,
        "safe_count": len(safe_participants),
        "safe_tvl": round(safe_tvl, 9),
        "initial_risk_threshold": round(initial_threshold, 9),
        "risk_threshold": round(threshold, 9),
        "activation_threshold_pct": round(threshold / safe_tvl, 9) if safe_tvl > 0 else 0.0,
        "funding_minutes": funding_minutes,
        "threshold_decay_steps": threshold_decay_steps,
        "cycle_minutes": funding_minutes + config.countdown_minutes,
        "pending_withdrawn_count": len(withdrawn_positions),
        "pending_withdrawn_tvl": round(sum(p.amount for p in withdrawn_positions), 9),
        "risk_count": len(positions),
        "risk_tvl": round(risk_tvl, 9),
        "bootstrap_risk_tvl": round(sum(p.amount for p in positions if p.phase == "bootstrap"), 9),
        "countdown_risk_tvl": round(sum(p.amount for p in positions if p.phase == "countdown"), 9),
        "risk_effective_count": round(n_eff, 6),
        "risk_largest_share": round(largest_share, 6),
        "risk_gini": round(gini([p.amount for p in positions]), 6),
        "median_risk_profit_multiple": round(median_profit_multiple, 9),
        "target_risk_probability": config.target_risk_probability,
        "activated": activated,
        "activation_reason": activation_reason,
        "winner_mode": winner_mode,
        "winner_id": winner_id,
        "gross_prize": round(risk_tvl, 9),
        "protocol_fee": round(fee, 9),
        "winner_profit": round(winner_profit, 9),
        "safe_jackpot_paid": round(safe_jackpot_paid, 9),
        "safe_pro_rata_paid": round(safe_pro_rata_paid, 9),
        "safe_erosion_paid": round(safe_erosion_paid, 9),
        "protocol_revenue_cumulative": round(state.protocol_revenue, 9),
        "value_conservation_error": round(conservation_error, 12),
        "safe_cumulative_pnl": round(
            sum(p.cumulative_pnl for p in state.participants.values() if p.mode == "safe"), 9
        )
        if config.record_cumulative_draw_pnl
        else None,
        "risk_cumulative_pnl": round(
            sum(p.cumulative_pnl for p in state.participants.values() if p.mode == "risk"), 9
        )
        if config.record_cumulative_draw_pnl
        else None,
    }


def run_simulation(config: Config) -> tuple[list[dict[str, object]], list[RiskPosition], State]:
    rng = random.Random(config.seed)
    state = initialize_state(config, rng)
    draw_rows: list[dict[str, object]] = []
    all_positions: list[RiskPosition] = []

    for draw in range(1, config.draws + 1):
        safe_population_churn(state, rng, config, draw)
        safe_participants = active_safe_participants(state, draw)
        funding = collect_timed_funding(state, rng, config, draw, safe_participants)
        positions = funding.positions
        collect_countdown_risk(
            state,
            rng,
            config,
            draw,
            positions,
            funding.initial_threshold,
            funding.funding_minutes,
        )

        if any(position.early_boost != 1.0 for position in positions if position.phase == "countdown"):
            raise AssertionError(f"draw {draw} applied an early boost after activation")

        queued_staker_withdrawals = [
            participant
            for participant in funding.safe_participants
            if rng.random() < config.countdown_staker_withdrawal_probability
        ]
        if len(queued_staker_withdrawals) == len(funding.safe_participants):
            queued_staker_withdrawals = queued_staker_withdrawals[:-1]
        queued_staker_withdrawal_tvl = sum(
            participant.safe_principal for participant in queued_staker_withdrawals
        )

        row = settle_draw(
            state,
            rng,
            config,
            draw,
            funding.safe_participants,
            positions,
            funding.initial_threshold,
            funding.activation_threshold,
            funding.funding_minutes,
            funding.threshold_decay_steps,
            funding.withdrawn_positions,
        )
        for participant in queued_staker_withdrawals:
            participant.active = False
            participant.withdrawals += 1
        row.update(
            {
                "activation_floor": round(funding.activation_floor, 9),
                "minutes_at_floor": funding.minutes_at_floor,
                "funding_staker_withdrawal_count": funding.funding_staker_withdrawal_count,
                "funding_staker_withdrawal_tvl": round(funding.funding_staker_withdrawal_tvl, 9),
                "queued_staker_withdrawal_count": len(queued_staker_withdrawals),
                "queued_staker_withdrawal_tvl": round(queued_staker_withdrawal_tvl, 9),
                "queued_staker_withdrawal_minutes": (
                    config.countdown_minutes if queued_staker_withdrawals else 0
                ),
                "funding_clock_resets": funding.funding_clock_resets,
            }
        )
        draw_rows.append(row)
        all_positions.extend(positions)
        all_positions.extend(funding.withdrawn_positions)

    return draw_rows, all_positions, state


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def public_participant_id(participant_id: str) -> str:
    return participant_id.replace("safe_", "staker_", 1).replace("risk_", "player_", 1)


def public_archetype(archetype: str) -> str:
    return archetype.replace("safe", "staker").replace("risk", "player")


def public_draw_rows(draw_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    key_map = {
        "safe_count": "staker_count",
        "safe_tvl": "staker_tvl",
        "initial_risk_threshold": "initial_player_threshold",
        "risk_threshold": "player_threshold",
        "risk_count": "player_position_count",
        "risk_tvl": "player_tvl",
        "bootstrap_risk_tvl": "bootstrap_player_tvl",
        "countdown_risk_tvl": "countdown_player_tvl",
        "risk_effective_count": "player_effective_wallet_count",
        "risk_largest_share": "player_largest_share",
        "risk_gini": "player_gini",
        "median_risk_profit_multiple": "median_player_profit_multiple",
        "target_risk_probability": "target_player_probability",
        "safe_jackpot_paid": "staker_jackpot_paid",
        "safe_pro_rata_paid": "staker_pro_rata_paid",
        "safe_erosion_paid": "staker_erosion_paid",
        "safe_cumulative_pnl": "staker_cumulative_pnl",
        "risk_cumulative_pnl": "player_cumulative_pnl",
    }
    public_rows = []
    for row in draw_rows:
        public_row = {key_map.get(key, key): value for key, value in row.items()}
        if public_row["winner_mode"] == "safe":
            public_row["winner_mode"] = "staker"
        elif public_row["winner_mode"] == "risk":
            public_row["winner_mode"] = "player"
        public_row["winner_id"] = public_participant_id(str(public_row["winner_id"]))
        public_rows.append(public_row)
    return public_rows


def write_positions(path: Path, positions: list[RiskPosition]) -> None:
    rows = [
        {
            "draw": p.draw,
            "phase": p.phase,
            "participant_id": public_participant_id(p.participant_id),
            "archetype": public_archetype(p.archetype),
            "amount": round(p.amount, 9),
            "player_tvl_before_deposit": p.risk_tvl_before_deposit,
            "early_boost": p.early_boost,
            "second_draw_weight": p.second_draw_weight,
            "entered_at_minute": p.entered_at_minute,
            "withdrawn_at_minute": p.withdrawn_at_minute if p.withdrawn_at_minute is not None else "",
            "probability_if_player_side_wins": round(p.probability_if_risk_side_wins, 9),
            "probability_side_and_wallet": round(p.probability_side_and_wallet, 9),
            "profit_if_win": round(p.profit_if_win, 9),
            "payout_multiple": round(p.payout_multiple, 9),
            "ev": round(p.ev, 9),
            "status": p.status,
            "pnl": round(p.pnl, 9),
            "fee_paid": round(p.fee_paid, 9),
        }
        for p in positions
    ]
    write_csv(path, rows)


def write_participants(path: Path, state: State) -> None:
    rows = []
    for p in sorted(state.participants.values(), key=lambda item: item.participant_id):
        rows.append(
            {
                "participant_id": public_participant_id(p.participant_id),
                "mode": "staker" if p.mode == "safe" else "player",
                "archetype": public_archetype(p.archetype),
                "staker_principal": round(p.safe_principal, 9),
                "active": p.active,
                "active_from_draw": p.active_from_draw,
                "bankroll": round(p.bankroll, 9),
                "cumulative_pnl": round(p.cumulative_pnl, 9),
                "wins": p.wins,
                "losses": p.losses,
                "entries": p.entries,
                "withdrawals": p.withdrawals,
                "fees_paid": round(p.fees_paid, 9),
                "pro_rata_received": round(p.pro_rata_received, 9),
            }
        )
    write_csv(path, rows)


def write_summary(path: Path, config: Config, draw_rows: list[dict[str, object]], positions: list[RiskPosition], state: State) -> None:
    activated = [row for row in draw_rows if row["activated"] is True]
    safe_wins = [row for row in activated if row["winner_mode"] == "safe"]
    risk_wins = [row for row in activated if row["winner_mode"] == "risk"]
    refunded = [p for p in positions if p.status == "pending_refunded"]
    withdrawn = [p for p in positions if p.status == "pending_withdrawn"]
    risk_amounts, risk_evs, risk_pnls = locked_wallet_metrics(positions)

    summary = f"""# Threshold Simulation Summary

## Parameters

- Protocol size scenario: {config.protocol_size}
- Draws: {config.draws}
- Seed: {config.seed}
- Capital scale: {config.capital_scale:.2f}x medium wallet sizes
- Initial Stakers: {config.initial_safe_users}
- Initial persistent Players: {config.persistent_risk_users}
- Staker entrant-rate scale: {config.safe_entrant_scale:.2f}x medium
- External yield strategy: none, Staker SOL is inert
- Player threshold: {config.risk_threshold_pct_of_safe_tvl:.2%} of active Staker TVL
- Threshold decay: {(1 - config.threshold_decay_factor):.0%} every {config.threshold_decay_interval_minutes} minutes
- Player arrivals per 10 funding minutes: {config.player_arrivals_per_interval:.2f}
- Pending Player withdrawal probability per 10 minutes: {config.pending_withdrawal_probability:.2%}
- Staker withdrawal probability per 10 funding minutes: {config.funding_staker_withdrawal_probability:.2%}
- Staker withdrawal-request probability during countdown: {config.countdown_staker_withdrawal_probability:.2%}
- Activation floor: max({config.minimum_draw_pool_sol:.2f} SOL, {config.activation_floor_pct_of_safe_tvl:.2%} of Staker TVL)
- Minimum Player deposit: {config.minimum_player_deposit_sol:.2f} SOL
- Minimum Staker deposit: {config.minimum_staker_deposit_sol:.2f} SOL
- Countdown: {config.countdown_minutes} minute(s)
- Player side win probability: {config.target_risk_probability:.2%}
- Staker side win probability: {1 - config.target_risk_probability:.2%}
- Protocol fee: {config.protocol_fee_rate:.2%} of losing Player deposits plus erosion when Player wins, or total Player TVL when Staker wins
- Staker erosion paid to Player winner: {config.safe_erosion_on_risk_win_rate:.4%} of active Staker TVL{f", capped at {config.risk_tvl_erosion_cap_rate:.2%} of Player TVL" if config.risk_tvl_erosion_cap_rate is not None else ""}
- Staker-side split: {config.safe_jackpot_share:.0%} jackpot winner, {config.safe_pro_rata_share:.0%} pro-rata Staker distribution, {config.protocol_fee_rate:.0%} protocol
- Max early Player boost: {config.max_early_boost:.0%}

## Outcomes

- Activated draws: {len(activated)} / {len(draw_rows)}
- Refunded Player positions: {len(refunded)}
- Withdrawn pending Player positions: {len(withdrawn)}
- Player wins: {len(risk_wins)}
- Staker wins: {len(safe_wins)}
- Realized Player win share: {(len(risk_wins) / len(activated)) if activated else 0:.2%}
- Average Staker TVL: {mean(float(row["safe_tvl"]) for row in draw_rows):.4f} SOL
- Average Player TVL: {mean(float(row["risk_tvl"]) for row in draw_rows):.4f} SOL
- Average Player threshold: {mean(float(row["risk_threshold"]) for row in draw_rows):.4f} SOL
- Median funding time: {median(float(row["funding_minutes"]) for row in draw_rows):.1f} minutes
- P90 funding time: {percentile([float(row["funding_minutes"]) for row in draw_rows], 0.90):.1f} minutes
- Maximum funding time: {max(float(row["funding_minutes"]) for row in draw_rows):.1f} minutes
- Draws reaching the activation floor: {sum(float(row["minutes_at_floor"]) > 0 for row in draw_rows)}
- Total minutes waiting at the activation floor: {sum(float(row["minutes_at_floor"]) for row in draw_rows):.1f}
- Immediate Staker withdrawals during funding: {sum(int(row["funding_staker_withdrawal_count"]) for row in draw_rows)}
- Queued Staker withdrawals after activation: {sum(int(row["queued_staker_withdrawal_count"]) for row in draw_rows)}
- Average queued Staker withdrawal wait: {mean(float(row["queued_staker_withdrawal_minutes"]) for row in draw_rows if int(row["queued_staker_withdrawal_count"]) > 0) if any(int(row["queued_staker_withdrawal_count"]) > 0 for row in draw_rows) else 0:.1f} minutes
- Funding clock resets after all Players refunded: {sum(int(row["funding_clock_resets"]) for row in draw_rows)}
- Average activation threshold: {mean(float(row["activation_threshold_pct"]) for row in draw_rows):.4%} of Staker TVL
- Simulated draws per day: {len(activated) / (sum(float(row["cycle_minutes"]) for row in draw_rows) / 1440) if activated else 0:.2f}
- Average winner profit: {mean(float(row["winner_profit"]) for row in activated) if activated else 0:.4f} SOL
- Average protocol fee: {mean(float(row["protocol_fee"]) for row in activated) if activated else 0:.4f} SOL
- Cumulative protocol revenue: {state.protocol_revenue:.4f} SOL
- Maximum absolute value-conservation error: {max(abs(float(row["value_conservation_error"])) for row in draw_rows):.12f} SOL
- Staker cumulative PnL: {sum(p.cumulative_pnl for p in state.participants.values() if p.mode == "safe"):.4f} SOL
- Player cumulative PnL: {sum(p.cumulative_pnl for p in state.participants.values() if p.mode == "risk"):.4f} SOL
- Average quoted Player EV per locked wallet: {mean(risk_evs) if risk_evs else 0:.4f} SOL
- Average quoted Player EV / stake: {(mean(risk_evs) / mean(risk_amounts)) if risk_amounts else 0:.2%}
- Average realized Player PnL / stake: {(mean(risk_pnls) / mean(risk_amounts)) if risk_amounts else 0:.2%}

## Files

- `draws.csv`
- `player_positions.csv`
- `participants.csv`
"""
    path.write_text(summary)


def parse_args() -> Config:
    parser = argparse.ArgumentParser()
    parser.add_argument("--protocol-size", choices=SIZE_PRESETS, default="medium")
    parser.add_argument("--draws", type=int, default=1000)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--capital-scale", type=float)
    parser.add_argument("--initial-safe-users", type=int)
    parser.add_argument("--initial-safe-whales", type=int)
    parser.add_argument("--persistent-risk-users", type=int)
    parser.add_argument("--safe-entrant-scale", type=float)
    parser.add_argument("--target-risk-probability", type=float, default=0.90)
    parser.add_argument("--protocol-fee-rate", type=float, default=0.05)
    parser.add_argument("--risk-threshold-pct-of-safe-tvl", type=float, default=0.01)
    parser.add_argument("--threshold-decay-interval-minutes", type=int, default=10)
    parser.add_argument("--threshold-decay-factor", type=float, default=0.90)
    parser.add_argument("--minimum-draw-pool-sol", type=float, default=0.10)
    parser.add_argument("--activation-floor-pct-of-safe-tvl", type=float, default=0.001)
    parser.add_argument("--minimum-player-deposit-sol", type=float, default=0.01)
    parser.add_argument("--minimum-staker-deposit-sol", type=float, default=0.10)
    parser.add_argument("--player-arrivals-per-interval", type=float)
    parser.add_argument("--pending-withdrawal-probability", type=float, default=0.01)
    parser.add_argument("--funding-staker-withdrawal-probability", type=float, default=0.001)
    parser.add_argument("--countdown-staker-withdrawal-probability", type=float, default=0.001)
    parser.add_argument("--safe-erosion-on-risk-win-rate", type=float, default=0.0007)
    parser.add_argument("--risk-tvl-erosion-cap-rate", type=float, default=0.07)
    parser.add_argument("--safe-jackpot-share", type=float, default=0.30)
    parser.add_argument("--safe-pro-rata-share", type=float, default=0.65)
    parser.add_argument("--countdown-minutes", type=int, default=5)
    parser.add_argument("--max-early-boost", type=float, default=0.50)
    parser.add_argument("--min-effective-risk-participants", type=float, default=0.0)
    parser.add_argument("--max-largest-risk-share", type=float, default=1.0)
    parser.add_argument("--min-median-profit-multiple", type=float, default=0.0)
    args = parser.parse_args()
    config = config_for_size(args.protocol_size)
    config.draws = args.draws
    config.seed = args.seed if args.seed is not None else config.seed
    config.output_dir = args.output_dir if args.output_dir is not None else config.output_dir
    config.capital_scale = args.capital_scale if args.capital_scale is not None else config.capital_scale
    config.initial_safe_users = (
        args.initial_safe_users if args.initial_safe_users is not None else config.initial_safe_users
    )
    config.initial_safe_whales = (
        args.initial_safe_whales if args.initial_safe_whales is not None else config.initial_safe_whales
    )
    config.persistent_risk_users = (
        args.persistent_risk_users
        if args.persistent_risk_users is not None
        else config.persistent_risk_users
    )
    config.safe_entrant_scale = (
        args.safe_entrant_scale if args.safe_entrant_scale is not None else config.safe_entrant_scale
    )
    config.target_risk_probability = args.target_risk_probability
    config.protocol_fee_rate = args.protocol_fee_rate
    config.safe_jackpot_share = args.safe_jackpot_share
    config.safe_pro_rata_share = args.safe_pro_rata_share
    config.risk_threshold_pct_of_safe_tvl = args.risk_threshold_pct_of_safe_tvl
    config.threshold_decay_interval_minutes = args.threshold_decay_interval_minutes
    config.threshold_decay_factor = args.threshold_decay_factor
    config.minimum_draw_pool_sol = args.minimum_draw_pool_sol
    config.activation_floor_pct_of_safe_tvl = args.activation_floor_pct_of_safe_tvl
    config.minimum_player_deposit_sol = args.minimum_player_deposit_sol
    config.minimum_staker_deposit_sol = args.minimum_staker_deposit_sol
    config.player_arrivals_per_interval = (
        args.player_arrivals_per_interval
        if args.player_arrivals_per_interval is not None
        else config.player_arrivals_per_interval
    )
    config.pending_withdrawal_probability = args.pending_withdrawal_probability
    config.funding_staker_withdrawal_probability = args.funding_staker_withdrawal_probability
    config.countdown_staker_withdrawal_probability = args.countdown_staker_withdrawal_probability
    config.safe_erosion_on_risk_win_rate = args.safe_erosion_on_risk_win_rate
    config.risk_tvl_erosion_cap_rate = args.risk_tvl_erosion_cap_rate
    config.countdown_minutes = args.countdown_minutes
    config.max_early_boost = args.max_early_boost
    config.min_effective_risk_participants = args.min_effective_risk_participants
    config.max_largest_risk_share = args.max_largest_risk_share
    config.min_median_profit_multiple = args.min_median_profit_multiple
    return config


def write_simulation_outputs(
    config: Config,
    draw_rows: list[dict[str, object]],
    positions: list[RiskPosition],
    state: State,
) -> None:
    config.output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(config.output_dir / "draws.csv", public_draw_rows(draw_rows))
    write_positions(config.output_dir / "player_positions.csv", positions)
    write_participants(config.output_dir / "participants.csv", state)
    write_summary(config.output_dir / "summary.md", config, draw_rows, positions, state)


def main() -> None:
    config = parse_args()
    draw_rows, positions, state = run_simulation(config)
    write_simulation_outputs(config, draw_rows, positions, state)
    print(f"Wrote threshold simulation outputs to {config.output_dir}")


if __name__ == "__main__":
    main()
