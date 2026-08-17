use crate::{
    error::FateError,
    math::{mul_div_floor, SelectedSide},
    selection::{plan_settlement_from_verified_entropy, SettlementEconomics, SettlementPlan},
    state::{Draw, DrawPhase, PlayerPosition, StakerPosition, StakerVault, U128Value, WinnerSide},
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SettlementTransfers {
    pub draw_to_staker_vault_lamports: u64,
    pub staker_vault_to_draw_lamports: u64,
    pub draw_to_fee_treasury_lamports: u64,
    pub staker_vault_to_fee_treasury_lamports: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AppliedSettlement {
    pub plan: SettlementPlan,
    pub transfers: SettlementTransfers,
    pub jackpot_shares_minted: u64,
}

pub fn apply_settlement_from_verified_entropy(
    entropy: [u8; 32],
    settled_at: i64,
    draw: &mut Draw,
    vault: &mut StakerVault,
    mut player: Option<&mut PlayerPosition>,
    mut staker: Option<&mut StakerPosition>,
) -> Result<AppliedSettlement, FateError> {
    if settled_at <= 0 {
        return Err(FateError::InvalidSettlementState);
    }
    let plan = plan_settlement_from_verified_entropy(
        &entropy,
        draw,
        vault,
        player.as_deref(),
        staker.as_deref(),
    )?;
    let mut transfers = SettlementTransfers::default();
    let mut jackpot_shares_minted = 0;

    draw.winner = plan.outcome.winner;
    draw.winner_side = match plan.outcome.side {
        SelectedSide::Player => WinnerSide::Player.into(),
        SelectedSide::Staker => WinnerSide::Staker.into(),
    };

    match plan.economics {
        SettlementEconomics::Player(economics) => {
            let winner = player
                .as_deref_mut()
                .ok_or(FateError::InvalidSettlementState)?;
            winner.refundable_deposit_lamports = 0;
            winner.committed_deposit_lamports = 0;
            winner.boosted_weight = U128Value::default();
            winner.credit_claim(economics.winner_payout_lamports)?;
            vault.active_assets_lamports = vault
                .active_assets_lamports
                .checked_sub(economics.staker_erosion_lamports)
                .ok_or(FateError::InvalidSettlementState)?;
            vault.lifetime_erosion_lamports = vault
                .lifetime_erosion_lamports
                .checked_add(economics.staker_erosion_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            transfers.staker_vault_to_draw_lamports = economics.staker_erosion_lamports;
            transfers.draw_to_fee_treasury_lamports = economics.protocol_fee_lamports;
            draw.winner_deposit_lamports = plan.outcome.winner_player_deposit_lamports;
            draw.winner_payout_lamports = economics.winner_payout_lamports;
            draw.outstanding_player_claim_lamports = economics.winner_payout_lamports;
            draw.staker_erosion_lamports = economics.staker_erosion_lamports;
            draw.protocol_fee_lamports = economics.protocol_fee_lamports;
        }
        SettlementEconomics::Staker(economics) => {
            let winner = staker
                .as_deref_mut()
                .ok_or(FateError::InvalidSettlementState)?;
            let post_pro_rata_assets = vault
                .active_assets_lamports
                .checked_add(economics.pro_rata_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            jackpot_shares_minted = mul_div_floor(
                economics.jackpot_lamports,
                vault.total_shares,
                post_pro_rata_assets,
            )?;
            vault.active_assets_lamports = post_pro_rata_assets;
            if jackpot_shares_minted == 0 {
                winner.credit_claim(economics.jackpot_lamports)?;
                vault.withdrawal_liability_lamports = vault
                    .withdrawal_liability_lamports
                    .checked_add(economics.jackpot_lamports)
                    .ok_or(FateError::ArithmeticOverflow)?;
            } else {
                vault.active_assets_lamports = vault
                    .active_assets_lamports
                    .checked_add(economics.jackpot_lamports)
                    .ok_or(FateError::ArithmeticOverflow)?;
                vault.total_shares = vault
                    .total_shares
                    .checked_add(jackpot_shares_minted)
                    .ok_or(FateError::ArithmeticOverflow)?;
                winner.active_shares = winner
                    .active_shares
                    .checked_add(jackpot_shares_minted)
                    .ok_or(FateError::ArithmeticOverflow)?;
            }
            vault.lifetime_player_losses_lamports = vault
                .lifetime_player_losses_lamports
                .checked_add(draw.player_tvl_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            transfers.draw_to_staker_vault_lamports = economics
                .jackpot_lamports
                .checked_add(economics.pro_rata_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            transfers.draw_to_fee_treasury_lamports = economics.protocol_fee_lamports;
            draw.winner_payout_lamports = economics.jackpot_lamports;
            draw.protocol_fee_lamports = economics.protocol_fee_lamports;
        }
    }

    draw.player_tvl_lamports = 0;
    draw.total_player_weight = U128Value::default();
    draw.entropy_value = entropy;
    draw.entropy_sample_valid = 1;
    draw.settled_at = settled_at;
    draw.phase = DrawPhase::Settled.into();

    Ok(AppliedSettlement {
        plan,
        transfers,
        jackpot_shares_minted,
    })
}
