use solana_program::{keccak::hashv, pubkey::Pubkey};

use crate::{
    error::FateError,
    math::{
        player_settlement, staker_settlement, unbiased_index, PlayerSettlement, SelectedSide,
        StakerSettlement,
    },
    state::{Draw, DrawPhase, PlayerPosition, StakerPosition, StakerVault, WinnerSide},
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

pub fn select_side_from_entropy(
    entropy: &[u8; 32],
    draw_id: u64,
) -> Result<SelectedSide, FateError> {
    let roll = derive_unbiased_roll(
        entropy,
        draw_id,
        SIDE_DOMAIN,
        u128::from(crate::consts::BPS_DENOMINATOR),
    )?;
    Ok(if roll < u128::from(crate::consts::PLAYER_SIDE_BPS) {
        SelectedSide::Player
    } else {
        SelectedSide::Staker
    })
}

pub fn winner_target_from_entropy(
    entropy: &[u8; 32],
    draw_id: u64,
    side: SelectedSide,
    total_weight: u128,
) -> Result<u128, FateError> {
    let domain = match side {
        SelectedSide::Player => PLAYER_WINNER_DOMAIN,
        SelectedSide::Staker => STAKER_WINNER_DOMAIN,
    };
    derive_unbiased_roll(entropy, draw_id, domain, total_weight)
}

pub fn plan_settlement_from_verified_entropy(
    entropy: &[u8; 32],
    draw: &Draw,
    vault: &StakerVault,
    player: Option<&PlayerPosition>,
    staker: Option<&StakerPosition>,
) -> Result<SettlementPlan, FateError> {
    validate_unsettled_draw(draw)?;
    if draw.player_tvl_lamports == 0
        || draw.total_player_weight.get() == 0
        || vault.total_shares == 0
    {
        return Err(FateError::InvalidSettlementState);
    }
    let side = select_side_from_entropy(entropy, draw.id)?;
    let outcome = match side {
        SelectedSide::Player => {
            let position = player.ok_or(FateError::InvalidSettlementState)?;
            if position.draw_id != draw.id
                || position.authority == Pubkey::default()
                || position
                    .refundable_deposit_lamports
                    .checked_add(position.committed_deposit_lamports)
                    .is_none()
                || position.refundable_deposit_lamports + position.committed_deposit_lamports == 0
                || position.boosted_weight.get() == 0
            {
                return Err(FateError::InvalidSettlementState);
            }
            SettlementOutcome {
                side,
                winner: position.authority,
                winner_player_deposit_lamports: position.refundable_deposit_lamports
                    + position.committed_deposit_lamports,
                winner_staker_shares: 0,
            }
        }
        SelectedSide::Staker => {
            let position = staker.ok_or(FateError::InvalidSettlementState)?;
            if !position.is_initialized()
                || position.authority == Pubkey::default()
                || position.active_shares == 0
            {
                return Err(FateError::InvalidSettlementState);
            }
            SettlementOutcome {
                side,
                winner: position.authority,
                winner_player_deposit_lamports: 0,
                winner_staker_shares: position.active_shares,
            }
        }
    };
    let economics = match side {
        SelectedSide::Player => SettlementEconomics::Player(player_settlement(
            vault.active_assets_lamports,
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
        || draw.outstanding_player_claim_lamports != 0
    {
        return Err(FateError::InvalidSettlementState);
    }
    Ok(())
}

fn derive_unbiased_roll(
    entropy: &[u8; 32],
    draw_id: u64,
    domain: &[u8],
    bound: u128,
) -> Result<u128, FateError> {
    for attempt in 0..MAX_SELECTION_ATTEMPTS {
        let digest = hashv(&[
            domain,
            &draw_id.to_le_bytes(),
            entropy,
            &attempt.to_le_bytes(),
        ])
        .to_bytes();
        let mut candidate = [0u8; 16];
        candidate.copy_from_slice(&digest[..16]);
        if let Some(roll) = unbiased_index(u128::from_le_bytes(candidate), bound)? {
            return Ok(roll);
        }
    }
    Err(FateError::SelectionRetriesExhausted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winner_streams_are_domain_separated() {
        let entropy = [9; 32];
        let player =
            winner_target_from_entropy(&entropy, 7, SelectedSide::Player, 1_000_000).unwrap();
        let staker =
            winner_target_from_entropy(&entropy, 7, SelectedSide::Staker, 1_000_000).unwrap();
        assert_ne!(player, staker);
    }
}
