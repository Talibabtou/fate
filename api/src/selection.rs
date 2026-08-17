use solana_program::{keccak::hashv, pubkey::Pubkey};
use steel::*;

use crate::{
    error::FateError,
    math::{
        player_settlement, staker_settlement, unbiased_index, PlayerSettlement, SelectedSide,
        StakerSettlement,
    },
    state::{
        Draw, DrawPhase, PlayerEntry, PlayerRegistry, StakerEntry, StakerRegistry, StakerVault,
        WinnerSide, PLAYER_STATUS_OCCUPIED, STAKER_STATUS_OCCUPIED,
        STAKER_STATUS_WITHDRAWAL_CLAIMABLE, STAKER_STATUS_WITHDRAWAL_QUEUED,
    },
};

const SIDE_DOMAIN: &[u8] = b"fate:side:v1";
const PLAYER_WINNER_DOMAIN: &[u8] = b"fate:player-winner:v1";
const STAKER_WINNER_DOMAIN: &[u8] = b"fate:staker-winner:v1";
const MAX_SELECTION_ATTEMPTS: u64 = 16;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SettlementOutcome {
    pub side: SelectedSide,
    pub winner: Pubkey,
    pub winner_player_deposit_lamports: u64,
    pub winner_staker_shares: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlementEconomics {
    Player(PlayerSettlement),
    Staker(StakerSettlement),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SettlementPlan {
    pub outcome: SettlementOutcome,
    pub economics: SettlementEconomics,
}

/// Builds an immutable economic plan from an Entropy value that the caller has already verified.
/// This function deliberately does not validate an oracle account or authorize settlement.
pub fn plan_settlement_from_verified_entropy(
    entropy_value: &[u8; 32],
    draw: &Draw,
    player_registry: &PlayerRegistry,
    staker_vault: &StakerVault,
    staker_registry: &StakerRegistry,
) -> Result<SettlementPlan, FateError> {
    validate_unsettled_draw(draw)?;
    validate_player_positions(draw, player_registry)?;
    validate_staker_positions(staker_vault, staker_registry)?;

    let side = select_side_from_entropy(entropy_value, draw.id)?;
    let outcome = match side {
        SelectedSide::Player => {
            let entry = select_player_from_entropy(entropy_value, draw.id, player_registry)?;
            SettlementOutcome {
                side,
                winner: entry.authority,
                winner_player_deposit_lamports: entry.committed_deposit_lamports,
                winner_staker_shares: 0,
            }
        }
        SelectedSide::Staker => {
            let entry = select_staker_from_entropy(entropy_value, draw.id, staker_registry)?;
            SettlementOutcome {
                side,
                winner: entry.authority,
                winner_player_deposit_lamports: 0,
                winner_staker_shares: entry.active_shares,
            }
        }
    };

    let economics = match side {
        SelectedSide::Player => SettlementEconomics::Player(player_settlement(
            staker_vault.active_assets_lamports,
            draw.player_tvl_lamports,
            outcome.winner_player_deposit_lamports,
        )?),
        SelectedSide::Staker => {
            SettlementEconomics::Staker(staker_settlement(draw.player_tvl_lamports)?)
        }
    };

    Ok(SettlementPlan { outcome, economics })
}

fn validate_unsettled_draw(draw: &Draw) -> Result<(), FateError> {
    if draw.phase() != Some(DrawPhase::AwaitingRandomness)
        || draw.winner != Pubkey::default()
        || draw.winner_side() != Some(WinnerSide::None)
        || draw.settled_at != 0
        || draw.winner_deposit_lamports != 0
        || draw.winner_payout_lamports != 0
        || draw.outstanding_player_claim_lamports != 0
        || draw.protocol_fee_lamports != 0
        || draw.staker_erosion_lamports != 0
    {
        return Err(FateError::InvalidSettlementState);
    }
    Ok(())
}

fn validate_player_positions(draw: &Draw, registry: &PlayerRegistry) -> Result<(), FateError> {
    if registry.draw_id != draw.id || registry.occupied_entries == 0 {
        return Err(FateError::InvalidSettlementState);
    }

    let mut occupied_entries = 0u64;
    let mut committed_lamports = 0u64;
    let mut total_weight = 0u128;
    for entry in &registry.entries {
        if !entry.is_occupied() {
            if *entry != PlayerEntry::zeroed() {
                return Err(FateError::InvalidSettlementState);
            }
            continue;
        }
        if entry.authority == Pubkey::default()
            || entry.refundable_deposit_lamports != 0
            || entry.committed_deposit_lamports == 0
            || entry.boosted_weight.get() == 0
            || entry.claimable_lamports != 0
            || entry.claimed_lamports != 0
            || entry.status != PLAYER_STATUS_OCCUPIED
        {
            return Err(FateError::InvalidSettlementState);
        }
        occupied_entries = occupied_entries
            .checked_add(1)
            .ok_or(FateError::ArithmeticOverflow)?;
        committed_lamports = committed_lamports
            .checked_add(entry.committed_deposit_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        total_weight = total_weight
            .checked_add(entry.boosted_weight.get())
            .ok_or(FateError::ArithmeticOverflow)?;
    }

    if occupied_entries != registry.occupied_entries
        || committed_lamports != draw.player_tvl_lamports
        || total_weight != draw.total_player_weight.get()
    {
        return Err(FateError::InvalidSettlementState);
    }
    Ok(())
}

fn validate_staker_positions(
    vault: &StakerVault,
    registry: &StakerRegistry,
) -> Result<(), FateError> {
    if vault.active_assets_lamports == 0
        || vault.total_shares == 0
        || registry.occupied_entries == 0
    {
        return Err(FateError::InvalidSettlementState);
    }

    let mut occupied_entries = 0u64;
    let mut active_shares = 0u64;
    let mut pending_lamports = 0u64;
    let mut queued_shares = 0u64;
    let mut claimable_lamports = 0u64;
    for entry in &registry.entries {
        if !entry.is_occupied() {
            if *entry != StakerEntry::zeroed() {
                return Err(FateError::InvalidSettlementState);
            }
            continue;
        }
        if entry.authority == Pubkey::default()
            || entry.queued_withdrawal_shares > entry.active_shares
            || entry.is_empty_position()
        {
            return Err(FateError::InvalidSettlementState);
        }
        let expected_status = STAKER_STATUS_OCCUPIED
            | if entry.queued_withdrawal_shares == 0 {
                0
            } else {
                STAKER_STATUS_WITHDRAWAL_QUEUED
            }
            | if entry.claimable_withdrawal_lamports == 0 {
                0
            } else {
                STAKER_STATUS_WITHDRAWAL_CLAIMABLE
            };
        if entry.status != expected_status {
            return Err(FateError::InvalidSettlementState);
        }
        occupied_entries = occupied_entries
            .checked_add(1)
            .ok_or(FateError::ArithmeticOverflow)?;
        active_shares = active_shares
            .checked_add(entry.active_shares)
            .ok_or(FateError::ArithmeticOverflow)?;
        pending_lamports = pending_lamports
            .checked_add(entry.pending_deposit_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        queued_shares = queued_shares
            .checked_add(entry.queued_withdrawal_shares)
            .ok_or(FateError::ArithmeticOverflow)?;
        claimable_lamports = claimable_lamports
            .checked_add(entry.claimable_withdrawal_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
    }

    if occupied_entries != registry.occupied_entries
        || active_shares != vault.total_shares
        || pending_lamports != vault.pending_assets_lamports
        || queued_shares != vault.queued_withdrawal_shares
        || claimable_lamports != vault.withdrawal_liability_lamports
    {
        return Err(FateError::InvalidSettlementState);
    }
    Ok(())
}

pub fn select_side_from_entropy(
    entropy_value: &[u8; 32],
    draw_id: u64,
) -> Result<SelectedSide, FateError> {
    let roll = derive_unbiased_roll(
        entropy_value,
        draw_id,
        SIDE_DOMAIN,
        u128::from(crate::consts::BPS_DENOMINATOR),
    )?;
    if roll < u128::from(crate::consts::PLAYER_SIDE_BPS) {
        Ok(SelectedSide::Player)
    } else {
        Ok(SelectedSide::Staker)
    }
}

fn select_player_from_entropy<'a>(
    entropy_value: &[u8; 32],
    draw_id: u64,
    registry: &'a PlayerRegistry,
) -> Result<&'a PlayerEntry, FateError> {
    let total_weight = registry.entries.iter().try_fold(0u128, |total, entry| {
        total
            .checked_add(entry.boosted_weight.get())
            .ok_or(FateError::ArithmeticOverflow)
    })?;
    let roll = derive_unbiased_roll(entropy_value, draw_id, PLAYER_WINNER_DOMAIN, total_weight)?;
    let mut cumulative = 0u128;
    for entry in registry.entries.iter().filter(|entry| entry.is_occupied()) {
        cumulative = cumulative
            .checked_add(entry.boosted_weight.get())
            .ok_or(FateError::ArithmeticOverflow)?;
        if roll < cumulative {
            return Ok(entry);
        }
    }
    Err(FateError::SelectionOutOfRange)
}

fn select_staker_from_entropy<'a>(
    entropy_value: &[u8; 32],
    draw_id: u64,
    registry: &'a StakerRegistry,
) -> Result<&'a StakerEntry, FateError> {
    let total_shares = registry.entries.iter().try_fold(0u128, |total, entry| {
        total
            .checked_add(u128::from(entry.active_shares))
            .ok_or(FateError::ArithmeticOverflow)
    })?;
    let roll = derive_unbiased_roll(entropy_value, draw_id, STAKER_WINNER_DOMAIN, total_shares)?;
    let mut cumulative = 0u128;
    for entry in registry
        .entries
        .iter()
        .filter(|entry| entry.is_occupied() && entry.active_shares != 0)
    {
        cumulative = cumulative
            .checked_add(u128::from(entry.active_shares))
            .ok_or(FateError::ArithmeticOverflow)?;
        if roll < cumulative {
            return Ok(entry);
        }
    }
    Err(FateError::SelectionOutOfRange)
}

fn derive_unbiased_roll(
    entropy_value: &[u8; 32],
    draw_id: u64,
    domain: &[u8],
    bound: u128,
) -> Result<u128, FateError> {
    first_unbiased_roll(bound, |attempt| {
        derive_candidate(entropy_value, draw_id, domain, attempt)
    })
}

fn first_unbiased_roll(
    bound: u128,
    mut candidate_at: impl FnMut(u64) -> u128,
) -> Result<u128, FateError> {
    for attempt in 0..MAX_SELECTION_ATTEMPTS {
        let candidate = candidate_at(attempt);
        if let Some(roll) = unbiased_index(candidate, bound)? {
            return Ok(roll);
        }
    }
    Err(FateError::SelectionRetriesExhausted)
}

fn derive_candidate(entropy_value: &[u8; 32], draw_id: u64, domain: &[u8], attempt: u64) -> u128 {
    let draw_id_bytes = draw_id.to_le_bytes();
    let attempt_bytes = attempt.to_le_bytes();
    let digest = hashv(&[domain, &draw_id_bytes, entropy_value, &attempt_bytes]).to_bytes();
    let mut candidate = [0u8; 16];
    candidate.copy_from_slice(&digest[..16]);
    u128::from_le_bytes(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{consts::LAMPORTS_PER_SOL, state::U128Value};

    fn fixture() -> (Draw, Box<PlayerRegistry>, StakerVault, Box<StakerRegistry>) {
        let mut player_registry = Box::new(PlayerRegistry::zeroed());
        player_registry.draw_id = 7;
        player_registry
            .get_or_insert(Pubkey::new_from_array([1; 32]))
            .unwrap()
            .add_committed_deposit(4 * LAMPORTS_PER_SOL, 6_000_000_000)
            .unwrap();
        player_registry
            .get_or_insert(Pubkey::new_from_array([2; 32]))
            .unwrap()
            .add_committed_deposit(6 * LAMPORTS_PER_SOL, 7_500_000_000)
            .unwrap();

        let draw = Draw {
            id: 7,
            phase: DrawPhase::AwaitingRandomness.into(),
            player_tvl_lamports: 10 * LAMPORTS_PER_SOL,
            total_player_weight: U128Value::new(13_500_000_000),
            ..Draw::zeroed()
        };

        let mut staker_registry = Box::new(StakerRegistry::zeroed());
        staker_registry
            .get_or_insert(Pubkey::new_from_array([3; 32]))
            .unwrap()
            .active_shares = 400 * LAMPORTS_PER_SOL;
        staker_registry
            .get_or_insert(Pubkey::new_from_array([4; 32]))
            .unwrap()
            .active_shares = 600 * LAMPORTS_PER_SOL;
        let staker_vault = StakerVault {
            active_assets_lamports: 1_000 * LAMPORTS_PER_SOL,
            total_shares: 1_000 * LAMPORTS_PER_SOL,
            ..StakerVault::zeroed()
        };

        (draw, player_registry, staker_vault, staker_registry)
    }

    #[test]
    fn selection_streams_are_domain_and_draw_scoped() {
        let entropy = [9; 32];
        let side = derive_candidate(&entropy, 7, SIDE_DOMAIN, 0);
        let player = derive_candidate(&entropy, 7, PLAYER_WINNER_DOMAIN, 0);
        let staker = derive_candidate(&entropy, 7, STAKER_WINNER_DOMAIN, 0);

        assert_ne!(side, player);
        assert_ne!(side, staker);
        assert_ne!(player, staker);
        assert_ne!(side, derive_candidate(&entropy, 8, SIDE_DOMAIN, 0));
        assert_ne!(side, derive_candidate(&entropy, 7, SIDE_DOMAIN, 1));
    }

    #[test]
    fn fixture_entropy_produces_one_deterministic_plan() {
        let (draw, players, vault, stakers) = fixture();
        let plan =
            plan_settlement_from_verified_entropy(&[9; 32], &draw, &players, &vault, &stakers)
                .unwrap();

        assert_eq!(
            plan,
            plan_settlement_from_verified_entropy(&[9; 32], &draw, &players, &vault, &stakers)
                .unwrap()
        );
        match plan.outcome.side {
            SelectedSide::Player => {
                assert!(matches!(plan.economics, SettlementEconomics::Player(_)));
                assert!(
                    plan.outcome.winner == Pubkey::new_from_array([1; 32])
                        || plan.outcome.winner == Pubkey::new_from_array([2; 32])
                );
                assert_eq!(plan.outcome.winner_staker_shares, 0);
            }
            SelectedSide::Staker => {
                assert!(matches!(plan.economics, SettlementEconomics::Staker(_)));
                assert!(
                    plan.outcome.winner == Pubkey::new_from_array([3; 32])
                        || plan.outcome.winner == Pubkey::new_from_array([4; 32])
                );
                assert_eq!(plan.outcome.winner_player_deposit_lamports, 0);
            }
        }
    }

    #[test]
    fn settlement_rejects_hidden_or_mismatched_positions() {
        let (draw, mut players, vault, stakers) = fixture();
        players.entries[2].committed_deposit_lamports = 1;
        assert_eq!(
            plan_settlement_from_verified_entropy(&[9; 32], &draw, &players, &vault, &stakers),
            Err(FateError::InvalidSettlementState)
        );

        let (mut draw, players, vault, stakers) = fixture();
        draw.total_player_weight = U128Value::new(1);
        assert_eq!(
            plan_settlement_from_verified_entropy(&[9; 32], &draw, &players, &vault, &stakers),
            Err(FateError::InvalidSettlementState)
        );
    }

    #[test]
    fn settlement_rejects_replay_after_a_result_is_recorded() {
        let (mut draw, players, vault, stakers) = fixture();
        draw.winner = Pubkey::new_unique();
        assert_eq!(
            plan_settlement_from_verified_entropy(&[9; 32], &draw, &players, &vault, &stakers),
            Err(FateError::InvalidSettlementState)
        );
    }

    #[test]
    fn rejected_candidates_advance_without_modulo_bias() {
        let mut calls = 0u64;
        let roll = first_unbiased_roll(10_000, |attempt| {
            calls += 1;
            if attempt == 0 {
                0
            } else {
                10_042
            }
        })
        .unwrap();

        assert_eq!(roll, 42);
        assert_eq!(calls, 2);
        assert_eq!(
            first_unbiased_roll(10_000, |_| 0),
            Err(FateError::SelectionRetriesExhausted)
        );
    }
}
