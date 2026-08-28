import csv
import random
from pathlib import Path
import unittest

from simulate import (
    Config,
    Participant,
    RiskPosition,
    State,
    add_position,
    config_for_size,
    initialize_state,
    probability_for_minutes,
    protocol_activation_threshold,
    protocol_boosted_player_weight,
    protocol_player_boost_bps,
    protocol_player_settlement,
    protocol_staker_erosion,
    protocol_staker_settlement,
    quote_risk_positions,
    run_simulation,
    settle_draw,
)


class FateSimulationTests(unittest.TestCase):
    def test_protocol_math_vectors_match_exact_integer_model(self) -> None:
        vector_path = Path(__file__).with_name("math_vectors.csv")
        with vector_path.open(newline="") as vector_file:
            for row in csv.DictReader(vector_file):
                inputs = [int(row[f"input{index}"]) for index in range(3)]
                expected = [int(row[f"output{index}"]) for index in range(6)]
                if row["operation"] == "threshold":
                    actual = [protocol_activation_threshold(inputs[0], inputs[1])]
                elif row["operation"] == "boost":
                    actual = [protocol_player_boost_bps(inputs[0], inputs[1], bool(inputs[2]))]
                elif row["operation"] == "weight":
                    actual = [protocol_boosted_player_weight(inputs[0], inputs[1])]
                elif row["operation"] == "erosion":
                    actual = [protocol_staker_erosion(inputs[0], inputs[1])]
                elif row["operation"] == "player_settlement":
                    actual = list(protocol_player_settlement(inputs[0], inputs[1], inputs[2]))
                elif row["operation"] == "staker_settlement":
                    actual = list(protocol_staker_settlement(inputs[0]))
                else:
                    self.fail(f"unknown vector operation: {row['operation']}")
                self.assertEqual(actual, expected[: len(actual)], msg=row["operation"])

    def test_interval_probability_keeps_the_same_time_hazard(self) -> None:
        ten_minute_probability = 0.01
        five_minute_probability = probability_for_minutes(ten_minute_probability, 5)
        self.assertAlmostEqual(
            1 - (1 - five_minute_probability) ** 2,
            ten_minute_probability,
        )

    def test_minimum_staker_deposit(self) -> None:
        config = config_for_size("small")
        state = initialize_state(config, random.Random(config.seed))
        stakers = [
            participant
            for participant in state.participants.values()
            if participant.mode == "safe"
        ]
        self.assertTrue(stakers)
        self.assertGreaterEqual(
            min(participant.safe_principal for participant in stakers),
            config.minimum_staker_deposit_sol,
        )

    def test_minimum_player_deposit_and_countdown_boost(self) -> None:
        config = Config()
        participant = Participant("risk_1", "risk", "occasional_risk", bankroll=1.0)
        positions: list[RiskPosition] = []

        add_position(positions, config, 1, participant, 0.009, "bootstrap", 1.0)
        self.assertEqual(positions, [])

        add_position(positions, config, 1, participant, 0.01, "countdown", 1.0)
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0].early_boost, 1.0)

    def test_player_fee_includes_erosion(self) -> None:
        config = Config()
        position = RiskPosition(
            draw=1,
            phase="bootstrap",
            participant_id="risk_1",
            archetype="occasional_risk",
            amount=1.0,
            risk_tvl_before_deposit=0.0,
            early_boost=1.5,
            second_draw_weight=1.5,
        )

        quote_risk_positions(config, [position], safe_tvl=1000.0)

        erosion = 0.07
        expected_profit = erosion * (1 - config.protocol_fee_rate)
        self.assertAlmostEqual(position.profit_if_win, expected_profit)

    def test_staker_win_compounds_into_pool_value(self) -> None:
        config = Config(target_risk_probability=0.0)
        staker = Participant("safe_1", "safe", "small_persistent_safe", safe_principal=10.0)
        player = Participant("risk_1", "risk", "occasional_risk", bankroll=10.0)
        state = State(
            participants={staker.participant_id: staker, player.participant_id: player},
            risk_participant_ids=[player.participant_id],
        )
        position = RiskPosition(
            draw=1,
            phase="bootstrap",
            participant_id=player.participant_id,
            archetype=player.archetype,
            amount=1.0,
            risk_tvl_before_deposit=0.0,
            early_boost=1.5,
            second_draw_weight=1.5,
        )

        row = settle_draw(
            state,
            random.Random(1),
            config,
            1,
            [staker],
            [position],
            initial_threshold=0.1,
            activation_threshold=0.1,
            funding_minutes=0,
            threshold_decay_steps=0,
            withdrawn_positions=[],
        )

        self.assertEqual(row["winner_mode"], "safe")
        self.assertAlmostEqual(staker.safe_principal, 10.95)
        self.assertEqual(row["value_conservation_error"], 0.0)

    def test_scenario_conserves_value_and_uses_larger_floor(self) -> None:
        config = config_for_size("small")
        config.draws = 50
        draws, positions, _ = run_simulation(config)

        self.assertTrue(all(abs(float(row["value_conservation_error"])) <= 1e-7 for row in draws))
        self.assertTrue(
            all(
                float(row["activation_floor"])
                >= max(config.minimum_draw_pool_sol, float(row["safe_tvl"]) * 0.001) - 1e-7
                for row in draws
            )
        )
        self.assertTrue(
            all(position.early_boost == 1.0 for position in positions if position.phase == "countdown")
        )


if __name__ == "__main__":
    unittest.main()
