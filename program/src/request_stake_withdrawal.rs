use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WithdrawalMode {
    Immediate,
    Queued,
}

pub fn process_request_stake_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let args = RequestStakeWithdrawal::try_from_bytes(data)?;
    let shares = u64::from_le_bytes(args.shares);
    if shares == 0 {
        return Err(FateError::InvalidShareAmount.into());
    }

    let [staker_info, config_info, draw_info, staker_vault_info, staker_registry_info] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    staker_info.is_signer()?.is_writable()?;
    if config_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    staker_vault_info
        .is_writable()?
        .has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    staker_registry_info
        .is_writable()?
        .has_seeds(&[STAKER_REGISTRY_SEED], program_id)?;
    if [
        draw_info.key,
        staker_vault_info.key,
        staker_registry_info.key,
    ]
    .iter()
    .enumerate()
    .any(|(index, key)| {
        *key == staker_info.key
            || [
                draw_info.key,
                staker_vault_info.key,
                staker_registry_info.key,
            ][..index]
                .contains(key)
    }) {
        return Err(ProgramError::InvalidArgument);
    }

    let config = config_info.as_account::<Config>(program_id)?;
    if config.version != PROGRAM_VERSION {
        return Err(FateError::InvalidInitializationState.into());
    }
    let draw_id_bytes = config.current_draw_id.to_le_bytes();
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    if draw.id != config.current_draw_id {
        return Err(FateError::InvalidDraw.into());
    }
    let mode = match draw.phase() {
        Some(DrawPhase::Funding | DrawPhase::Voided) => WithdrawalMode::Immediate,
        Some(DrawPhase::Activated | DrawPhase::Locked | DrawPhase::AwaitingRandomness) => {
            WithdrawalMode::Queued
        }
        Some(DrawPhase::Settled) | None => return Err(FateError::InvalidDraw.into()),
    };

    let vault = staker_vault_info.as_account::<StakerVault>(program_id)?;
    let registry = staker_registry_info.as_account::<StakerRegistry>(program_id)?;
    let entry_index = registry
        .find_index(staker_info.key)
        .ok_or(FateError::StakerPositionNotFound)?;
    let entry = &registry.entries[entry_index];
    let available_shares = match mode {
        WithdrawalMode::Immediate => entry.active_shares,
        WithdrawalMode::Queued => entry
            .active_shares
            .checked_sub(entry.queued_withdrawal_shares)
            .ok_or(FateError::ArithmeticOverflow)?,
    };
    if shares > available_shares {
        return Err(FateError::WithdrawalExceedsAvailableShares.into());
    }

    let withdrawal_lamports = match mode {
        WithdrawalMode::Immediate => {
            let amount = vault.preview_withdrawal_lamports(shares)?;
            if amount == 0 {
                return Err(FateError::InvalidShareAmount.into());
            }
            let vault_after = staker_vault_info
                .lamports()
                .checked_sub(amount)
                .ok_or(FateError::InsufficientCustody)?;
            staker_info
                .lamports()
                .checked_add(amount)
                .ok_or(FateError::ArithmeticOverflow)?;
            let tracked_after = vault
                .active_assets_lamports
                .checked_sub(amount)
                .and_then(|active| active.checked_add(vault.pending_assets_lamports))
                .and_then(|assets| assets.checked_add(vault.withdrawal_liability_lamports))
                .ok_or(FateError::ArithmeticOverflow)?;
            let rent_reserve = Rent::get()?.minimum_balance(StakerVault::SIZE);
            if vault_after.saturating_sub(rent_reserve) < tracked_after {
                return Err(FateError::InsufficientCustody.into());
            }
            amount
        }
        WithdrawalMode::Queued => 0,
    };

    let vault = staker_vault_info.as_account_mut::<StakerVault>(program_id)?;
    let registry = staker_registry_info.as_account_mut::<StakerRegistry>(program_id)?;
    apply_stake_withdrawal(
        vault,
        registry,
        *staker_info.key,
        shares,
        withdrawal_lamports,
        mode,
    )?;

    if mode == WithdrawalMode::Immediate {
        let draw = draw_info.as_account_mut::<Draw>(program_id)?;
        if draw.phase() == Some(DrawPhase::Funding) && draw.first_player_at != 0 {
            update_funding_snapshot(
                draw,
                vault.active_assets_lamports,
                Clock::get()?.unix_timestamp,
            )?;
        }
        staker_vault_info.send(withdrawal_lamports, staker_info);
        registry.release_if_empty(staker_info.key)?;
    }

    assert_vault_solvency(staker_vault_info, vault)?;
    Ok(())
}

fn apply_stake_withdrawal(
    vault: &mut StakerVault,
    registry: &mut StakerRegistry,
    authority: Pubkey,
    shares: u64,
    withdrawal_lamports: u64,
    mode: WithdrawalMode,
) -> Result<(), FateError> {
    let index = registry
        .find_index(&authority)
        .ok_or(FateError::StakerPositionNotFound)?;
    let entry = &mut registry.entries[index];

    match mode {
        WithdrawalMode::Immediate => {
            entry.active_shares = entry
                .active_shares
                .checked_sub(shares)
                .ok_or(FateError::WithdrawalExceedsAvailableShares)?;
            vault.total_shares = vault
                .total_shares
                .checked_sub(shares)
                .ok_or(FateError::ArithmeticOverflow)?;
            vault.active_assets_lamports = vault
                .active_assets_lamports
                .checked_sub(withdrawal_lamports)
                .ok_or(FateError::ArithmeticOverflow)?;

            let queued_reduction = shares.min(entry.queued_withdrawal_shares);
            entry.queued_withdrawal_shares = entry
                .queued_withdrawal_shares
                .checked_sub(queued_reduction)
                .ok_or(FateError::ArithmeticOverflow)?;
            vault.queued_withdrawal_shares = vault
                .queued_withdrawal_shares
                .checked_sub(queued_reduction)
                .ok_or(FateError::ArithmeticOverflow)?;
            if entry.queued_withdrawal_shares == 0 {
                entry.status &= !STAKER_STATUS_WITHDRAWAL_QUEUED;
            }
        }
        WithdrawalMode::Queued => {
            let available = entry
                .active_shares
                .checked_sub(entry.queued_withdrawal_shares)
                .ok_or(FateError::ArithmeticOverflow)?;
            if shares > available {
                return Err(FateError::WithdrawalExceedsAvailableShares);
            }
            entry.queued_withdrawal_shares = entry
                .queued_withdrawal_shares
                .checked_add(shares)
                .ok_or(FateError::ArithmeticOverflow)?;
            vault.queued_withdrawal_shares = vault
                .queued_withdrawal_shares
                .checked_add(shares)
                .ok_or(FateError::ArithmeticOverflow)?;
            entry.status |= STAKER_STATUS_WITHDRAWAL_QUEUED;
        }
    }

    Ok(())
}

fn update_funding_snapshot(
    draw: &mut Draw,
    active_assets_lamports: u64,
    now: i64,
) -> Result<(), FateError> {
    let elapsed = now
        .checked_sub(draw.first_player_at)
        .and_then(|seconds| u64::try_from(seconds).ok())
        .ok_or(FateError::InvalidDraw)?;
    draw.staker_tvl_snapshot = active_assets_lamports;
    draw.initial_threshold_lamports = initial_activation_threshold(active_assets_lamports)?;
    draw.activation_threshold_lamports = activation_threshold(active_assets_lamports, elapsed)?;
    Ok(())
}

fn assert_vault_solvency(
    vault_info: &AccountInfo<'_>,
    vault: &StakerVault,
) -> Result<(), ProgramError> {
    let tracked_assets = vault
        .active_assets_lamports
        .checked_add(vault.pending_assets_lamports)
        .and_then(|assets| assets.checked_add(vault.withdrawal_liability_lamports))
        .ok_or(FateError::ArithmeticOverflow)?;
    let rent_reserve = Rent::get()?.minimum_balance(StakerVault::SIZE);
    if vault_info.lamports().saturating_sub(rent_reserve) < tracked_assets {
        return Err(FateError::InsufficientCustody.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immediate_withdrawal_burns_shares_at_current_value() {
        let authority = Pubkey::new_unique();
        let mut vault = StakerVault {
            active_assets_lamports: 1_100,
            total_shares: 1_000,
            ..StakerVault::zeroed()
        };
        let mut registry = Box::new(StakerRegistry::zeroed());
        registry.get_or_insert(authority).unwrap().active_shares = 1_000;

        let amount = vault.preview_withdrawal_lamports(100).unwrap();
        apply_stake_withdrawal(
            &mut vault,
            &mut registry,
            authority,
            100,
            amount,
            WithdrawalMode::Immediate,
        )
        .unwrap();

        assert_eq!(amount, 110);
        assert_eq!(vault.active_assets_lamports, 990);
        assert_eq!(vault.total_shares, 900);
        assert_eq!(registry.entries[0].active_shares, 900);
    }

    #[test]
    fn activated_withdrawal_queues_shares_without_freezing_value() {
        let authority = Pubkey::new_unique();
        let mut vault = StakerVault {
            active_assets_lamports: 1_100,
            total_shares: 1_000,
            ..StakerVault::zeroed()
        };
        let mut registry = Box::new(StakerRegistry::zeroed());
        registry.get_or_insert(authority).unwrap().active_shares = 1_000;

        apply_stake_withdrawal(
            &mut vault,
            &mut registry,
            authority,
            400,
            0,
            WithdrawalMode::Queued,
        )
        .unwrap();

        assert_eq!(vault.active_assets_lamports, 1_100);
        assert_eq!(vault.total_shares, 1_000);
        assert_eq!(vault.queued_withdrawal_shares, 400);
        assert_eq!(registry.entries[0].queued_withdrawal_shares, 400);
        assert_ne!(
            registry.entries[0].status & STAKER_STATUS_WITHDRAWAL_QUEUED,
            0
        );
        assert_eq!(
            apply_stake_withdrawal(
                &mut vault,
                &mut registry,
                authority,
                601,
                0,
                WithdrawalMode::Queued,
            ),
            Err(FateError::WithdrawalExceedsAvailableShares)
        );
    }

    #[test]
    fn funding_withdrawal_recalculates_the_live_threshold() {
        let mut draw = Draw {
            phase: DrawPhase::Funding.into(),
            first_player_at: 1_000,
            ..Draw::zeroed()
        };

        update_funding_snapshot(&mut draw, 900 * LAMPORTS_PER_SOL, 1_600).unwrap();

        assert_eq!(draw.staker_tvl_snapshot, 900 * LAMPORTS_PER_SOL);
        assert_eq!(draw.initial_threshold_lamports, 9 * LAMPORTS_PER_SOL);
        assert_eq!(draw.activation_threshold_lamports, 8_100_000_000);
    }
}
