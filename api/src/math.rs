use crate::{consts::*, error::FateError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectedSide {
    Player,
    Staker,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlayerSettlement {
    pub losing_player_lamports: u64,
    pub staker_erosion_lamports: u64,
    pub gross_profit_lamports: u64,
    pub winner_profit_lamports: u64,
    pub winner_payout_lamports: u64,
    pub protocol_fee_lamports: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StakerSettlement {
    pub jackpot_lamports: u64,
    pub pro_rata_lamports: u64,
    pub protocol_fee_lamports: u64,
}

pub fn mul_div_floor(value: u64, numerator: u64, denominator: u64) -> Result<u64, FateError> {
    if denominator == 0 {
        return Err(FateError::DivisionByZero);
    }

    let product = u128::from(value)
        .checked_mul(u128::from(numerator))
        .ok_or(FateError::ArithmeticOverflow)?;
    let quotient = product / u128::from(denominator);
    u64::try_from(quotient).map_err(|_| FateError::ArithmeticOverflow)
}

pub fn activation_floor(staker_tvl_lamports: u64) -> Result<u64, FateError> {
    let relative_floor = mul_div_floor(
        staker_tvl_lamports,
        RELATIVE_ACTIVATION_FLOOR_BPS,
        BPS_DENOMINATOR,
    )?;
    Ok(relative_floor.max(MINIMUM_DRAW_POOL_LAMPORTS))
}

pub fn initial_activation_threshold(staker_tvl_lamports: u64) -> Result<u64, FateError> {
    mul_div_floor(staker_tvl_lamports, INITIAL_THRESHOLD_BPS, BPS_DENOMINATOR)
}

pub fn activation_threshold(
    staker_tvl_lamports: u64,
    elapsed_funding_seconds: u64,
) -> Result<u64, FateError> {
    let floor = activation_floor(staker_tvl_lamports)?;
    let mut threshold = initial_activation_threshold(staker_tvl_lamports)?.max(floor);
    let decay_steps = elapsed_funding_seconds / THRESHOLD_DECAY_INTERVAL_SECONDS;

    for _ in 0..decay_steps {
        if threshold <= floor {
            return Ok(floor);
        }
        threshold = mul_div_floor(threshold, THRESHOLD_DECAY_BPS, BPS_DENOMINATOR)?;
    }

    Ok(threshold.max(floor))
}

pub fn player_boost_bps(
    player_tvl_before_deposit: u64,
    initial_threshold_lamports: u64,
    is_activated: bool,
) -> Result<u64, FateError> {
    if is_activated || initial_threshold_lamports == 0 {
        return Ok(BASE_PLAYER_BOOST_BPS);
    }

    let remaining = initial_threshold_lamports.saturating_sub(player_tvl_before_deposit);
    let early_boost = mul_div_floor(remaining, MAX_EARLY_BOOST_BPS, initial_threshold_lamports)?;
    Ok((BASE_PLAYER_BOOST_BPS + early_boost).min(MAX_PLAYER_BOOST_BPS))
}

pub fn boosted_player_weight(deposit_lamports: u64, boost_bps: u64) -> Result<u128, FateError> {
    u128::from(deposit_lamports)
        .checked_mul(u128::from(boost_bps))
        .ok_or(FateError::ArithmeticOverflow)
        .map(|product| product / u128::from(BPS_DENOMINATOR))
}

pub fn staker_erosion(
    staker_tvl_lamports: u64,
    player_tvl_lamports: u64,
) -> Result<u64, FateError> {
    let staker_cap = mul_div_floor(staker_tvl_lamports, STAKER_EROSION_BPS, BPS_DENOMINATOR)?;
    let player_cap = mul_div_floor(player_tvl_lamports, PLAYER_EROSION_CAP_BPS, BPS_DENOMINATOR)?;
    Ok(staker_cap.min(player_cap))
}

pub fn player_settlement(
    staker_tvl_lamports: u64,
    player_tvl_lamports: u64,
    winner_deposit_lamports: u64,
) -> Result<PlayerSettlement, FateError> {
    let losing_player_lamports = player_tvl_lamports
        .checked_sub(winner_deposit_lamports)
        .ok_or(FateError::InvalidWinnerDeposit)?;
    let staker_erosion_lamports = staker_erosion(staker_tvl_lamports, player_tvl_lamports)?;
    let gross_profit_lamports = losing_player_lamports
        .checked_add(staker_erosion_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;

    // Calculate the winner's 95% first so every division remainder goes to the treasury.
    let winner_profit_lamports = mul_div_floor(
        gross_profit_lamports,
        BPS_DENOMINATOR - PROTOCOL_FEE_BPS,
        BPS_DENOMINATOR,
    )?;
    let protocol_fee_lamports = gross_profit_lamports - winner_profit_lamports;
    let winner_payout_lamports = winner_deposit_lamports
        .checked_add(winner_profit_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;

    Ok(PlayerSettlement {
        losing_player_lamports,
        staker_erosion_lamports,
        gross_profit_lamports,
        winner_profit_lamports,
        winner_payout_lamports,
        protocol_fee_lamports,
    })
}

pub fn staker_settlement(player_tvl_lamports: u64) -> Result<StakerSettlement, FateError> {
    let jackpot_lamports = mul_div_floor(player_tvl_lamports, STAKER_JACKPOT_BPS, BPS_DENOMINATOR)?;
    let pro_rata_lamports =
        mul_div_floor(player_tvl_lamports, STAKER_PRO_RATA_BPS, BPS_DENOMINATOR)?;
    let protocol_fee_lamports = player_tvl_lamports
        .checked_sub(jackpot_lamports)
        .and_then(|remaining| remaining.checked_sub(pro_rata_lamports))
        .ok_or(FateError::ArithmeticOverflow)?;

    Ok(StakerSettlement {
        jackpot_lamports,
        pro_rata_lamports,
        protocol_fee_lamports,
    })
}

pub fn unbiased_index(sample: u128, bound: u128) -> Result<Option<u128>, FateError> {
    if bound == 0 {
        return Err(FateError::ZeroSelectionWeight);
    }

    let rejection_threshold = 0u128.wrapping_sub(bound) % bound;
    if sample < rejection_threshold {
        return Ok(None);
    }

    Ok(Some(sample % bound))
}

pub fn select_side(sample: u128) -> Result<Option<SelectedSide>, FateError> {
    let Some(roll) = unbiased_index(sample, u128::from(BPS_DENOMINATOR))? else {
        return Ok(None);
    };

    if roll < u128::from(PLAYER_SIDE_BPS) {
        Ok(Some(SelectedSide::Player))
    } else {
        Ok(Some(SelectedSide::Staker))
    }
}

pub fn select_weighted_wallet(sample: u128, weights: &[u128]) -> Result<Option<usize>, FateError> {
    let total_weight = weights.iter().try_fold(0u128, |total, weight| {
        total
            .checked_add(*weight)
            .ok_or(FateError::ArithmeticOverflow)
    })?;
    let Some(roll) = unbiased_index(sample, total_weight)? else {
        return Ok(None);
    };

    let mut cumulative = 0u128;
    for (index, weight) in weights.iter().enumerate() {
        cumulative = cumulative
            .checked_add(*weight)
            .ok_or(FateError::ArithmeticOverflow)?;
        if roll < cumulative {
            return Ok(Some(index));
        }
    }

    Err(FateError::SelectionOutOfRange)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOL: u64 = LAMPORTS_PER_SOL;

    #[test]
    fn constants_preserve_the_accepted_split() {
        assert_eq!(PLAYER_SIDE_BPS + STAKER_SIDE_BPS, BPS_DENOMINATOR);
        assert_eq!(
            STAKER_JACKPOT_BPS + STAKER_PRO_RATA_BPS + PROTOCOL_FEE_BPS,
            BPS_DENOMINATOR
        );
    }

    #[test]
    fn threshold_decays_and_stops_at_the_relative_floor() {
        let staker_tvl = 1_000 * SOL;
        assert_eq!(activation_threshold(staker_tvl, 0), Ok(10 * SOL));
        assert_eq!(activation_threshold(staker_tvl, 600), Ok(9 * SOL));
        assert_eq!(activation_threshold(staker_tvl, 1_200), Ok(8_100_000_000));
        assert_eq!(activation_threshold(staker_tvl, 100 * 600), Ok(SOL));
    }

    #[test]
    fn absolute_floor_wins_for_a_small_staker_pool() {
        let staker_tvl = 50 * SOL;
        assert_eq!(activation_floor(staker_tvl), Ok(MINIMUM_DRAW_POOL_LAMPORTS));
        assert_eq!(
            activation_threshold(staker_tvl, 100 * 600),
            Ok(MINIMUM_DRAW_POOL_LAMPORTS)
        );
    }

    #[test]
    fn early_boost_is_bounded_and_ends_at_activation() {
        let threshold = 100 * SOL;
        assert_eq!(player_boost_bps(0, threshold, false), Ok(15_000));
        assert_eq!(player_boost_bps(25 * SOL, threshold, false), Ok(13_750));
        assert_eq!(player_boost_bps(75 * SOL, threshold, false), Ok(11_250));
        assert_eq!(player_boost_bps(threshold, threshold, false), Ok(10_000));
        assert_eq!(player_boost_bps(0, threshold, true), Ok(10_000));
        assert_eq!(boosted_player_weight(2 * SOL, 13_750), Ok(2_750_000_000));
    }

    #[test]
    fn erosion_uses_the_smaller_cap() {
        assert_eq!(staker_erosion(1_000 * SOL, 10 * SOL), Ok(700_000_000));
        assert_eq!(staker_erosion(1_000 * SOL, SOL), Ok(70_000_000));
    }

    #[test]
    fn player_settlement_conserves_every_lamport() {
        let settlement = player_settlement(1_000 * SOL, 10 * SOL, 4 * SOL).unwrap();
        assert_eq!(settlement.losing_player_lamports, 6 * SOL);
        assert_eq!(settlement.staker_erosion_lamports, 700_000_000);
        assert_eq!(settlement.gross_profit_lamports, 6_700_000_000);
        assert_eq!(settlement.winner_profit_lamports, 6_365_000_000);
        assert_eq!(settlement.protocol_fee_lamports, 335_000_000);

        let before = 1_010 * SOL;
        let after = (1_000 * SOL - settlement.staker_erosion_lamports)
            + settlement.winner_payout_lamports
            + settlement.protocol_fee_lamports;
        assert_eq!(before, after);
    }

    #[test]
    fn solo_player_is_not_charged_on_returned_principal() {
        let settlement = player_settlement(100 * SOL, SOL, SOL).unwrap();
        assert_eq!(settlement.losing_player_lamports, 0);
        assert_eq!(settlement.staker_erosion_lamports, 70_000_000);
        assert_eq!(settlement.winner_profit_lamports, 66_500_000);
        assert_eq!(settlement.protocol_fee_lamports, 3_500_000);
        assert_eq!(settlement.winner_payout_lamports, 1_066_500_000);
    }

    #[test]
    fn payout_rounding_dust_goes_to_the_protocol() {
        let player = player_settlement(0, 2, 1).unwrap();
        assert_eq!(player.winner_profit_lamports, 0);
        assert_eq!(player.protocol_fee_lamports, 1);

        let staker = staker_settlement(1).unwrap();
        assert_eq!(staker.jackpot_lamports, 0);
        assert_eq!(staker.pro_rata_lamports, 0);
        assert_eq!(staker.protocol_fee_lamports, 1);
    }

    #[test]
    fn staker_settlement_conserves_every_lamport() {
        let settlement = staker_settlement(10 * SOL).unwrap();
        assert_eq!(settlement.jackpot_lamports, 3 * SOL);
        assert_eq!(settlement.pro_rata_lamports, 6_500_000_000);
        assert_eq!(settlement.protocol_fee_lamports, 500_000_000);
        assert_eq!(
            settlement.jackpot_lamports
                + settlement.pro_rata_lamports
                + settlement.protocol_fee_lamports,
            10 * SOL
        );
    }

    #[test]
    fn rejection_sampling_and_weighted_selection_are_unbiased() {
        assert_eq!(unbiased_index(0, 10_000), Ok(None));
        assert_eq!(select_side(10_000), Ok(Some(SelectedSide::Player)));
        assert_eq!(select_side(9_000), Ok(Some(SelectedSide::Staker)));

        let weights = [10, 20, 30];
        assert_eq!(select_weighted_wallet(60, &weights), Ok(Some(0)));
        assert_eq!(select_weighted_wallet(76, &weights), Ok(Some(1)));
        assert_eq!(select_weighted_wallet(96, &weights), Ok(Some(2)));
        assert_eq!(select_weighted_wallet(0, &weights), Ok(None));
    }

    #[test]
    fn invalid_inputs_fail_closed() {
        assert_eq!(mul_div_floor(1, 1, 0), Err(FateError::DivisionByZero));
        assert_eq!(
            player_settlement(100, 10, 11),
            Err(FateError::InvalidWinnerDeposit)
        );
        assert_eq!(
            select_weighted_wallet(1, &[0, 0]),
            Err(FateError::ZeroSelectionWeight)
        );
    }
}
