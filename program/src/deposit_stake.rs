use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

pub fn process_deposit_stake(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let args = DepositStake::try_from_bytes(data)?;
    let amount = u64::from_le_bytes(args.amount);
    if amount < MINIMUM_STAKER_DEPOSIT_LAMPORTS {
        return Err(FateError::DepositTooSmall.into());
    }

    let [staker_info, config_info, draw_info, staker_vault_info, staker_registry_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    staker_info.is_signer()?.is_writable()?;
    if config_info.is_writable || draw_info.is_writable || system_program_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    staker_vault_info
        .is_writable()?
        .has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    staker_registry_info
        .is_writable()?
        .has_seeds(&[STAKER_REGISTRY_SEED], program_id)?;
    system_program_info.is_program(&system_program::ID)?;

    if staker_info.key == staker_vault_info.key
        || staker_info.key == staker_registry_info.key
        || staker_vault_info.key == staker_registry_info.key
    {
        return Err(ProgramError::InvalidArgument);
    }

    let config = config_info.as_account::<Config>(program_id)?;
    if config.is_paused() {
        return Err(FateError::ProtocolPaused.into());
    }

    let draw_id_bytes = config.current_draw_id.to_le_bytes();
    draw_info.has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    if draw.id != config.current_draw_id
        || matches!(
            draw.phase(),
            None | Some(DrawPhase::Settled | DrawPhase::Voided)
        )
    {
        return Err(FateError::InvalidDraw.into());
    }

    let queue_for_next_draw = draw.phase() != Some(DrawPhase::Funding) || draw.first_player_at != 0;
    let vault = staker_vault_info.as_account::<StakerVault>(program_id)?;
    let shares = if queue_for_next_draw {
        0
    } else {
        let shares = vault.preview_deposit_shares(amount)?;
        if shares == 0 {
            return Err(FateError::InvalidShareAmount.into());
        }
        shares
    };
    let registry = staker_registry_info.as_account::<StakerRegistry>(program_id)?;
    if registry.find_index(staker_info.key).is_none()
        && registry.occupied_entries >= MAX_STAKERS as u64
    {
        return Err(FateError::RegistryFull.into());
    }

    staker_vault_info.collect(amount, staker_info)?;

    let vault = staker_vault_info.as_account_mut::<StakerVault>(program_id)?;
    let registry = staker_registry_info.as_account_mut::<StakerRegistry>(program_id)?;
    apply_staker_deposit(
        vault,
        registry,
        *staker_info.key,
        amount,
        shares,
        queue_for_next_draw,
    )?;

    let tracked_assets = vault
        .active_assets_lamports
        .checked_add(vault.pending_assets_lamports)
        .and_then(|assets| assets.checked_add(vault.withdrawal_liability_lamports))
        .ok_or(FateError::ArithmeticOverflow)?;
    let rent_reserve = Rent::get()?.minimum_balance(StakerVault::SIZE);
    let custody_assets = staker_vault_info.lamports().saturating_sub(rent_reserve);
    if custody_assets < tracked_assets {
        return Err(FateError::InsufficientCustody.into());
    }

    Ok(())
}

fn apply_staker_deposit(
    vault: &mut StakerVault,
    registry: &mut StakerRegistry,
    authority: Pubkey,
    amount: u64,
    shares: u64,
    queued: bool,
) -> Result<(), FateError> {
    let entry = registry.get_or_insert(authority)?;
    entry.lifetime_deposited_lamports = entry
        .lifetime_deposited_lamports
        .checked_add(amount)
        .ok_or(FateError::ArithmeticOverflow)?;

    if queued {
        vault.pending_assets_lamports = vault
            .pending_assets_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        entry.pending_deposit_lamports = entry
            .pending_deposit_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
    } else {
        vault.active_assets_lamports = vault
            .active_assets_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_add(shares)
            .ok_or(FateError::ArithmeticOverflow)?;
        entry.active_shares = entry
            .active_shares
            .checked_add(shares)
            .ok_or(FateError::ArithmeticOverflow)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposits_are_active_before_funding_starts() {
        let authority = Pubkey::new_unique();
        let mut vault = StakerVault::zeroed();
        let mut registry = Box::new(StakerRegistry::zeroed());

        apply_staker_deposit(&mut vault, &mut registry, authority, 100, 100, false).unwrap();

        assert_eq!(vault.active_assets_lamports, 100);
        assert_eq!(vault.pending_assets_lamports, 0);
        assert_eq!(vault.total_shares, 100);
        let entry = &registry.entries[registry.find_index(&authority).unwrap()];
        assert_eq!(entry.active_shares, 100);
        assert_eq!(entry.lifetime_deposited_lamports, 100);
    }

    #[test]
    fn deposits_queue_after_funding_starts() {
        let authority = Pubkey::new_unique();
        let mut vault = StakerVault {
            active_assets_lamports: 1_000,
            total_shares: 1_000,
            ..StakerVault::zeroed()
        };
        let mut registry = Box::new(StakerRegistry::zeroed());

        apply_staker_deposit(&mut vault, &mut registry, authority, 100, 0, true).unwrap();

        assert_eq!(vault.active_assets_lamports, 1_000);
        assert_eq!(vault.pending_assets_lamports, 100);
        assert_eq!(vault.total_shares, 1_000);
        let entry = &registry.entries[registry.find_index(&authority).unwrap()];
        assert_eq!(entry.active_shares, 0);
        assert_eq!(entry.pending_deposit_lamports, 100);
    }
}
