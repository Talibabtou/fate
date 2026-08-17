use steel::*;

use crate::{
    error::FateError,
    math::{mul_div_floor, SelectedSide},
    selection::{plan_settlement_from_verified_entropy, SettlementEconomics, SettlementPlan},
    state::{
        Draw, DrawPhase, PlayerEntry, PlayerRegistry, StakerRegistry, StakerVault, U128Value,
        WinnerSide, STAKER_STATUS_WITHDRAWAL_CLAIMABLE, STAKER_STATUS_WITHDRAWAL_QUEUED,
    },
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SettlementTransfers {
    pub player_registry_to_staker_vault_lamports: u64,
    pub staker_vault_to_player_registry_lamports: u64,
    pub player_registry_to_fee_treasury_lamports: u64,
    pub staker_vault_to_fee_treasury_lamports: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AppliedSettlement {
    pub plan: SettlementPlan,
    pub transfers: SettlementTransfers,
    pub jackpot_shares_minted: u64,
    pub queued_withdrawal_lamports_frozen: u64,
    pub pending_deposit_shares_minted: u64,
}

/// Applies accounting only after the caller has verified the Entropy account and generation.
/// No public instruction calls this function until the external randomness gate is complete.
pub fn apply_settlement_from_verified_entropy(
    entropy_value: [u8; 32],
    settled_at: i64,
    draw: &mut Draw,
    player_registry: &mut PlayerRegistry,
    staker_vault: &mut StakerVault,
    staker_registry: &mut StakerRegistry,
) -> Result<AppliedSettlement, FateError> {
    if settled_at <= 0 {
        return Err(FateError::InvalidSettlementState);
    }
    let plan = plan_settlement_from_verified_entropy(
        &entropy_value,
        draw,
        player_registry,
        staker_vault,
        staker_registry,
    )?;

    let mut transfers = SettlementTransfers::default();
    let mut jackpot_shares_minted = 0u64;
    match plan.economics {
        SettlementEconomics::Player(economics) => {
            staker_vault
                .active_assets_lamports
                .checked_sub(economics.staker_erosion_lamports)
                .ok_or(FateError::InvalidSettlementState)?;
            transfers.staker_vault_to_player_registry_lamports = economics.staker_erosion_lamports;
            transfers.player_registry_to_fee_treasury_lamports = economics.protocol_fee_lamports;
        }
        SettlementEconomics::Staker(economics) => {
            let post_pro_rata_assets = staker_vault
                .active_assets_lamports
                .checked_add(economics.pro_rata_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            jackpot_shares_minted = mul_div_floor(
                economics.jackpot_lamports,
                staker_vault.total_shares,
                post_pro_rata_assets,
            )?;
            post_pro_rata_assets
                .checked_add(if jackpot_shares_minted == 0 {
                    0
                } else {
                    economics.jackpot_lamports
                })
                .ok_or(FateError::ArithmeticOverflow)?;
            transfers.player_registry_to_staker_vault_lamports = economics
                .jackpot_lamports
                .checked_add(economics.pro_rata_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            transfers.player_registry_to_fee_treasury_lamports = economics.protocol_fee_lamports;
        }
    }

    apply_side_result(
        draw,
        player_registry,
        staker_vault,
        staker_registry,
        &plan,
        jackpot_shares_minted,
    )?;
    let queued_withdrawal_lamports_frozen =
        freeze_queued_withdrawals(staker_vault, staker_registry, &mut transfers)?;
    let pending_deposit_shares_minted = activate_pending_deposits(staker_vault, staker_registry)?;

    draw.entropy_value = entropy_value;
    draw.entropy_sample_valid = 1;
    draw.settled_at = settled_at;
    draw.phase = DrawPhase::Settled.into();

    validate_post_settlement(draw, player_registry, staker_vault, staker_registry, &plan)?;

    Ok(AppliedSettlement {
        plan,
        transfers,
        jackpot_shares_minted,
        queued_withdrawal_lamports_frozen,
        pending_deposit_shares_minted,
    })
}

fn apply_side_result(
    draw: &mut Draw,
    player_registry: &mut PlayerRegistry,
    staker_vault: &mut StakerVault,
    staker_registry: &mut StakerRegistry,
    plan: &SettlementPlan,
    jackpot_shares_minted: u64,
) -> Result<(), FateError> {
    draw.winner = plan.outcome.winner;
    draw.winner_side = match plan.outcome.side {
        SelectedSide::Player => WinnerSide::Player.into(),
        SelectedSide::Staker => WinnerSide::Staker.into(),
    };

    match plan.economics {
        SettlementEconomics::Player(economics) => {
            staker_vault.active_assets_lamports = staker_vault
                .active_assets_lamports
                .checked_sub(economics.staker_erosion_lamports)
                .ok_or(FateError::InvalidSettlementState)?;
            staker_vault.lifetime_erosion_lamports = staker_vault
                .lifetime_erosion_lamports
                .checked_add(economics.staker_erosion_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;

            let mut winner_found = false;
            for entry in &mut player_registry.entries {
                if !entry.is_occupied() {
                    continue;
                }
                if entry.authority == plan.outcome.winner {
                    if winner_found
                        || entry.committed_deposit_lamports
                            != plan.outcome.winner_player_deposit_lamports
                    {
                        return Err(FateError::InvalidSettlementState);
                    }
                    winner_found = true;
                    entry.committed_deposit_lamports = 0;
                    entry.boosted_weight = U128Value::default();
                    entry.credit_claim(economics.winner_payout_lamports)?;
                } else {
                    *entry = PlayerEntry::zeroed();
                }
            }
            if !winner_found {
                return Err(FateError::InvalidSettlementState);
            }
            player_registry.occupied_entries = 1;
            draw.winner_deposit_lamports = economics
                .winner_payout_lamports
                .checked_sub(economics.winner_profit_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            draw.winner_payout_lamports = economics.winner_payout_lamports;
            draw.outstanding_player_claim_lamports = economics.winner_payout_lamports;
            draw.protocol_fee_lamports = economics.protocol_fee_lamports;
            draw.staker_erosion_lamports = economics.staker_erosion_lamports;
        }
        SettlementEconomics::Staker(economics) => {
            let winner_index = staker_registry
                .find_index(&plan.outcome.winner)
                .ok_or(FateError::InvalidSettlementState)?;
            let post_pro_rata_assets = staker_vault
                .active_assets_lamports
                .checked_add(economics.pro_rata_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;
            staker_vault.active_assets_lamports = post_pro_rata_assets;

            if jackpot_shares_minted == 0 {
                let entry = &mut staker_registry.entries[winner_index];
                entry.claimable_withdrawal_lamports = entry
                    .claimable_withdrawal_lamports
                    .checked_add(economics.jackpot_lamports)
                    .ok_or(FateError::ArithmeticOverflow)?;
                entry.status |= STAKER_STATUS_WITHDRAWAL_CLAIMABLE;
                staker_vault.withdrawal_liability_lamports = staker_vault
                    .withdrawal_liability_lamports
                    .checked_add(economics.jackpot_lamports)
                    .ok_or(FateError::ArithmeticOverflow)?;
            } else {
                staker_vault.active_assets_lamports = staker_vault
                    .active_assets_lamports
                    .checked_add(economics.jackpot_lamports)
                    .ok_or(FateError::ArithmeticOverflow)?;
                staker_vault.total_shares = staker_vault
                    .total_shares
                    .checked_add(jackpot_shares_minted)
                    .ok_or(FateError::ArithmeticOverflow)?;
                let entry = &mut staker_registry.entries[winner_index];
                entry.active_shares = entry
                    .active_shares
                    .checked_add(jackpot_shares_minted)
                    .ok_or(FateError::ArithmeticOverflow)?;
            }
            staker_vault.lifetime_player_losses_lamports = staker_vault
                .lifetime_player_losses_lamports
                .checked_add(draw.player_tvl_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;

            for entry in &mut player_registry.entries {
                *entry = PlayerEntry::zeroed();
            }
            player_registry.occupied_entries = 0;
            draw.winner_payout_lamports = economics.jackpot_lamports;
            draw.protocol_fee_lamports = economics.protocol_fee_lamports;
        }
    }

    draw.player_tvl_lamports = 0;
    draw.total_player_weight = U128Value::default();
    Ok(())
}

fn freeze_queued_withdrawals(
    vault: &mut StakerVault,
    registry: &mut StakerRegistry,
    transfers: &mut SettlementTransfers,
) -> Result<u64, FateError> {
    if vault.queued_withdrawal_shares == 0 {
        return Ok(0);
    }
    let pricing_assets = vault.active_assets_lamports;
    let pricing_shares = vault.total_shares;
    if pricing_assets == 0 || pricing_shares == 0 {
        return Err(FateError::InvalidSettlementState);
    }

    let mut frozen_lamports = 0u64;
    let mut burned_shares = 0u64;
    for entry in &mut registry.entries {
        let queued_shares = entry.queued_withdrawal_shares;
        if queued_shares == 0 {
            continue;
        }
        let withdrawal_lamports = mul_div_floor(queued_shares, pricing_assets, pricing_shares)?;
        if withdrawal_lamports == 0 {
            return Err(FateError::InvalidShareAmount);
        }
        entry.active_shares = entry
            .active_shares
            .checked_sub(queued_shares)
            .ok_or(FateError::InvalidSettlementState)?;
        entry.queued_withdrawal_shares = 0;
        entry.claimable_withdrawal_lamports = entry
            .claimable_withdrawal_lamports
            .checked_add(withdrawal_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        entry.status &= !STAKER_STATUS_WITHDRAWAL_QUEUED;
        entry.status |= STAKER_STATUS_WITHDRAWAL_CLAIMABLE;
        frozen_lamports = frozen_lamports
            .checked_add(withdrawal_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        burned_shares = burned_shares
            .checked_add(queued_shares)
            .ok_or(FateError::ArithmeticOverflow)?;
    }
    if burned_shares != vault.queued_withdrawal_shares {
        return Err(FateError::InvalidSettlementState);
    }

    vault.total_shares = vault
        .total_shares
        .checked_sub(burned_shares)
        .ok_or(FateError::InvalidSettlementState)?;
    vault.active_assets_lamports = vault
        .active_assets_lamports
        .checked_sub(frozen_lamports)
        .ok_or(FateError::InvalidSettlementState)?;
    vault.withdrawal_liability_lamports = vault
        .withdrawal_liability_lamports
        .checked_add(frozen_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    vault.queued_withdrawal_shares = 0;

    if vault.total_shares == 0 && vault.active_assets_lamports != 0 {
        transfers.staker_vault_to_fee_treasury_lamports = vault.active_assets_lamports;
        vault.active_assets_lamports = 0;
    }
    Ok(frozen_lamports)
}

fn activate_pending_deposits(
    vault: &mut StakerVault,
    registry: &mut StakerRegistry,
) -> Result<u64, FateError> {
    if vault.pending_assets_lamports == 0 {
        return Ok(0);
    }
    let pricing_assets = vault.active_assets_lamports;
    let pricing_shares = vault.total_shares;
    if (pricing_assets == 0) != (pricing_shares == 0) {
        return Err(FateError::InvalidSettlementState);
    }

    let mut activated_lamports = 0u64;
    let mut minted_shares = 0u64;
    for entry in &mut registry.entries {
        let pending_lamports = entry.pending_deposit_lamports;
        if pending_lamports == 0 {
            continue;
        }
        let shares = if pricing_shares == 0 {
            pending_lamports
        } else {
            mul_div_floor(pending_lamports, pricing_shares, pricing_assets)?
        };
        if shares == 0 {
            return Err(FateError::InvalidShareAmount);
        }
        entry.pending_deposit_lamports = 0;
        entry.active_shares = entry
            .active_shares
            .checked_add(shares)
            .ok_or(FateError::ArithmeticOverflow)?;
        activated_lamports = activated_lamports
            .checked_add(pending_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        minted_shares = minted_shares
            .checked_add(shares)
            .ok_or(FateError::ArithmeticOverflow)?;
    }
    if activated_lamports != vault.pending_assets_lamports {
        return Err(FateError::InvalidSettlementState);
    }
    vault.active_assets_lamports = vault
        .active_assets_lamports
        .checked_add(activated_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_add(minted_shares)
        .ok_or(FateError::ArithmeticOverflow)?;
    vault.pending_assets_lamports = 0;
    Ok(minted_shares)
}

fn validate_post_settlement(
    draw: &Draw,
    player_registry: &PlayerRegistry,
    vault: &StakerVault,
    staker_registry: &StakerRegistry,
    plan: &SettlementPlan,
) -> Result<(), FateError> {
    if draw.phase() != Some(DrawPhase::Settled)
        || draw.player_tvl_lamports != 0
        || draw.total_player_weight.get() != 0
        || draw.winner != plan.outcome.winner
        || vault.pending_assets_lamports != 0
        || vault.queued_withdrawal_shares != 0
    {
        return Err(FateError::InvalidSettlementState);
    }

    let active_shares = staker_registry
        .entries
        .iter()
        .try_fold(0u64, |sum, entry| {
            sum.checked_add(entry.active_shares)
                .ok_or(FateError::ArithmeticOverflow)
        })?;
    let liabilities = staker_registry
        .entries
        .iter()
        .try_fold(0u64, |sum, entry| {
            sum.checked_add(entry.claimable_withdrawal_lamports)
                .ok_or(FateError::ArithmeticOverflow)
        })?;
    if active_shares != vault.total_shares || liabilities != vault.withdrawal_liability_lamports {
        return Err(FateError::InvalidSettlementState);
    }

    match plan.outcome.side {
        SelectedSide::Player => {
            if player_registry.occupied_entries != 1
                || draw.outstanding_player_claim_lamports != draw.winner_payout_lamports
            {
                return Err(FateError::InvalidSettlementState);
            }
        }
        SelectedSide::Staker => {
            if player_registry.occupied_entries != 0 || draw.outstanding_player_claim_lamports != 0
            {
                return Err(FateError::InvalidSettlementState);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{consts::LAMPORTS_PER_SOL, state::*};

    fn fixture() -> (Draw, Box<PlayerRegistry>, StakerVault, Box<StakerRegistry>) {
        let mut players = Box::new(PlayerRegistry::zeroed());
        players.draw_id = 7;
        players
            .get_or_insert(Pubkey::new_from_array([1; 32]))
            .unwrap()
            .add_committed_deposit(4 * LAMPORTS_PER_SOL, 6_000_000_000)
            .unwrap();
        players
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

        let mut stakers = Box::new(StakerRegistry::zeroed());
        let first = stakers
            .get_or_insert(Pubkey::new_from_array([3; 32]))
            .unwrap();
        first.active_shares = 400 * LAMPORTS_PER_SOL;
        first.queued_withdrawal_shares = 100 * LAMPORTS_PER_SOL;
        first.status |= STAKER_STATUS_WITHDRAWAL_QUEUED;
        let second = stakers
            .get_or_insert(Pubkey::new_from_array([4; 32]))
            .unwrap();
        second.active_shares = 600 * LAMPORTS_PER_SOL;
        second.pending_deposit_lamports = 100 * LAMPORTS_PER_SOL;
        let vault = StakerVault {
            active_assets_lamports: 1_000 * LAMPORTS_PER_SOL,
            pending_assets_lamports: 100 * LAMPORTS_PER_SOL,
            total_shares: 1_000 * LAMPORTS_PER_SOL,
            queued_withdrawal_shares: 100 * LAMPORTS_PER_SOL,
            ..StakerVault::zeroed()
        };
        (draw, players, vault, stakers)
    }

    fn entropy_for_side(
        side: SelectedSide,
        draw: &Draw,
        players: &PlayerRegistry,
        vault: &StakerVault,
        stakers: &StakerRegistry,
    ) -> [u8; 32] {
        for byte in 0..=u8::MAX {
            let entropy = [byte; 32];
            let plan =
                plan_settlement_from_verified_entropy(&entropy, draw, players, vault, stakers)
                    .unwrap();
            if plan.outcome.side == side {
                return entropy;
            }
        }
        panic!("fixture did not produce the requested side");
    }

    #[test]
    fn player_win_conserves_custody_and_freezes_queued_exits() {
        let (mut draw, mut players, mut vault, mut stakers) = fixture();
        let entropy = entropy_for_side(SelectedSide::Player, &draw, &players, &vault, &stakers);
        let custody_before =
            vault.active_assets_lamports + vault.pending_assets_lamports + draw.player_tvl_lamports;

        let applied = apply_settlement_from_verified_entropy(
            entropy,
            1_234,
            &mut draw,
            &mut players,
            &mut vault,
            &mut stakers,
        )
        .unwrap();

        assert_eq!(draw.phase(), Some(DrawPhase::Settled));
        assert_eq!(draw.entropy_value, entropy);
        assert_eq!(draw.entropy_sample_valid, 1);
        assert_eq!(vault.pending_assets_lamports, 0);
        assert_eq!(vault.queued_withdrawal_shares, 0);
        assert!(applied.queued_withdrawal_lamports_frozen > 0);
        assert!(applied.pending_deposit_shares_minted > 0);
        let custody_after = vault.active_assets_lamports
            + vault.withdrawal_liability_lamports
            + draw.outstanding_player_claim_lamports;
        assert_eq!(
            custody_before,
            custody_after
                + applied.transfers.player_registry_to_fee_treasury_lamports
                + applied.transfers.staker_vault_to_fee_treasury_lamports
        );
    }

    #[test]
    fn staker_win_mints_jackpot_without_diluting_existing_shares() {
        let (mut draw, mut players, mut vault, mut stakers) = fixture();
        let entropy = entropy_for_side(SelectedSide::Staker, &draw, &players, &vault, &stakers);
        let custody_before =
            vault.active_assets_lamports + vault.pending_assets_lamports + draw.player_tvl_lamports;
        let plan =
            plan_settlement_from_verified_entropy(&entropy, &draw, &players, &vault, &stakers)
                .unwrap();
        let SettlementEconomics::Staker(economics) = plan.economics else {
            panic!("expected Staker economics");
        };
        let pre_jackpot_assets = vault.active_assets_lamports + economics.pro_rata_lamports;
        let old_shares = vault.total_shares;

        let applied = apply_settlement_from_verified_entropy(
            entropy,
            1_234,
            &mut draw,
            &mut players,
            &mut vault,
            &mut stakers,
        )
        .unwrap();

        assert!(applied.jackpot_shares_minted > 0);
        let post_jackpot_assets = pre_jackpot_assets + economics.jackpot_lamports;
        let post_jackpot_shares = old_shares + applied.jackpot_shares_minted;
        assert!(
            u128::from(post_jackpot_assets) * u128::from(old_shares)
                >= u128::from(pre_jackpot_assets) * u128::from(post_jackpot_shares)
        );
        assert_eq!(players.occupied_entries, 0);
        assert_eq!(draw.outstanding_player_claim_lamports, 0);
        let custody_after = vault.active_assets_lamports + vault.withdrawal_liability_lamports;
        assert_eq!(
            custody_before,
            custody_after
                + applied.transfers.player_registry_to_fee_treasury_lamports
                + applied.transfers.staker_vault_to_fee_treasury_lamports
        );
    }

    #[test]
    fn pending_deposits_join_only_after_exit_price_is_frozen() {
        let (mut draw, mut players, mut vault, mut stakers) = fixture();
        let entropy = entropy_for_side(SelectedSide::Player, &draw, &players, &vault, &stakers);
        let plan =
            plan_settlement_from_verified_entropy(&entropy, &draw, &players, &vault, &stakers)
                .unwrap();
        let SettlementEconomics::Player(economics) = plan.economics else {
            panic!("expected Player economics");
        };
        let post_result_assets = vault.active_assets_lamports - economics.staker_erosion_lamports;
        let expected_exit = mul_div_floor(
            100 * LAMPORTS_PER_SOL,
            post_result_assets,
            vault.total_shares,
        )
        .unwrap();

        let applied = apply_settlement_from_verified_entropy(
            entropy,
            1_234,
            &mut draw,
            &mut players,
            &mut vault,
            &mut stakers,
        )
        .unwrap();

        assert_eq!(applied.queued_withdrawal_lamports_frozen, expected_exit);
        assert_eq!(
            stakers.entries[0].claimable_withdrawal_lamports,
            expected_exit
        );
        assert_eq!(stakers.entries[0].queued_withdrawal_shares, 0);
        assert_eq!(stakers.entries[1].pending_deposit_lamports, 0);
    }

    #[test]
    fn sub_share_jackpot_becomes_an_exact_winner_liability() {
        let (mut draw, mut players, mut vault, mut stakers) = fixture();
        stakers.entries[0].active_shares = 1;
        stakers.entries[0].queued_withdrawal_shares = 0;
        stakers.entries[0].status &= !STAKER_STATUS_WITHDRAWAL_QUEUED;
        stakers.entries[1] = StakerEntry::zeroed();
        stakers.occupied_entries = 1;
        vault.active_assets_lamports = 1_000 * LAMPORTS_PER_SOL;
        vault.pending_assets_lamports = 0;
        vault.total_shares = 1;
        vault.queued_withdrawal_shares = 0;
        let entropy = entropy_for_side(SelectedSide::Staker, &draw, &players, &vault, &stakers);

        let applied = apply_settlement_from_verified_entropy(
            entropy,
            1_234,
            &mut draw,
            &mut players,
            &mut vault,
            &mut stakers,
        )
        .unwrap();
        let SettlementEconomics::Staker(economics) = applied.plan.economics else {
            panic!("expected Staker economics");
        };

        assert_eq!(applied.jackpot_shares_minted, 0);
        assert_eq!(
            stakers.entries[0].claimable_withdrawal_lamports,
            economics.jackpot_lamports
        );
        assert_eq!(
            vault.withdrawal_liability_lamports,
            economics.jackpot_lamports
        );
    }
}
