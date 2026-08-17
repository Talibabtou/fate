use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

pub fn process_claim_stake_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    ClaimStakeWithdrawal::try_from_bytes(data)?;

    let [staker_info, staker_vault_info, staker_registry_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    staker_info.is_signer()?.is_writable()?;
    staker_vault_info
        .is_writable()?
        .has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    staker_registry_info
        .is_writable()?
        .has_seeds(&[STAKER_REGISTRY_SEED], program_id)?;
    if staker_info.key == staker_vault_info.key
        || staker_info.key == staker_registry_info.key
        || staker_vault_info.key == staker_registry_info.key
    {
        return Err(ProgramError::InvalidArgument);
    }

    let vault = staker_vault_info.as_account::<StakerVault>(program_id)?;
    let registry = staker_registry_info.as_account::<StakerRegistry>(program_id)?;
    let entry_index = registry
        .find_index(staker_info.key)
        .ok_or(FateError::StakerPositionNotFound)?;
    let claim_lamports = registry.entries[entry_index].claimable_withdrawal_lamports;
    if claim_lamports == 0 {
        return Err(FateError::NothingToClaim.into());
    }
    vault
        .withdrawal_liability_lamports
        .checked_sub(claim_lamports)
        .ok_or(FateError::InvalidSettlementState)?;
    staker_info
        .lamports()
        .checked_add(claim_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    let vault_after = staker_vault_info
        .lamports()
        .checked_sub(claim_lamports)
        .ok_or(FateError::InsufficientCustody)?;
    let tracked_after = vault
        .active_assets_lamports
        .checked_add(vault.pending_assets_lamports)
        .and_then(|assets| {
            assets.checked_add(
                vault
                    .withdrawal_liability_lamports
                    .checked_sub(claim_lamports)?,
            )
        })
        .ok_or(FateError::ArithmeticOverflow)?;
    let rent_reserve = Rent::get()?.minimum_balance(StakerVault::SIZE);
    if vault_after.saturating_sub(rent_reserve) < tracked_after {
        return Err(FateError::InsufficientCustody.into());
    }

    let vault = staker_vault_info.as_account_mut::<StakerVault>(program_id)?;
    let registry = staker_registry_info.as_account_mut::<StakerRegistry>(program_id)?;
    apply_stake_withdrawal_claim(vault, registry, staker_info.key, claim_lamports)?;
    staker_vault_info.send(claim_lamports, staker_info);

    let tracked_assets = vault
        .active_assets_lamports
        .checked_add(vault.pending_assets_lamports)
        .and_then(|assets| assets.checked_add(vault.withdrawal_liability_lamports))
        .ok_or(FateError::ArithmeticOverflow)?;
    if staker_vault_info.lamports().saturating_sub(rent_reserve) < tracked_assets {
        return Err(FateError::InsufficientCustody.into());
    }

    Ok(())
}

fn apply_stake_withdrawal_claim(
    vault: &mut StakerVault,
    registry: &mut StakerRegistry,
    authority: &Pubkey,
    expected_claim_lamports: u64,
) -> Result<(), FateError> {
    let entry_index = registry
        .find_index(authority)
        .ok_or(FateError::StakerPositionNotFound)?;
    let entry = &mut registry.entries[entry_index];
    if expected_claim_lamports == 0
        || entry.claimable_withdrawal_lamports != expected_claim_lamports
    {
        return Err(FateError::NothingToClaim);
    }
    vault.withdrawal_liability_lamports = vault
        .withdrawal_liability_lamports
        .checked_sub(expected_claim_lamports)
        .ok_or(FateError::InvalidSettlementState)?;
    entry.claimable_withdrawal_lamports = 0;
    entry.status &= !STAKER_STATUS_WITHDRAWAL_CLAIMABLE;
    registry.release_if_empty(authority)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_withdrawal_can_be_claimed_only_once() {
        let authority = Pubkey::new_unique();
        let mut vault = StakerVault {
            withdrawal_liability_lamports: 42,
            ..StakerVault::zeroed()
        };
        let mut registry = Box::new(StakerRegistry::zeroed());
        let entry = registry.get_or_insert(authority).unwrap();
        entry.claimable_withdrawal_lamports = 42;
        entry.status |= STAKER_STATUS_WITHDRAWAL_CLAIMABLE;

        apply_stake_withdrawal_claim(&mut vault, &mut registry, &authority, 42).unwrap();

        assert_eq!(vault.withdrawal_liability_lamports, 0);
        assert!(registry.find_index(&authority).is_none());
        assert_eq!(
            apply_stake_withdrawal_claim(&mut vault, &mut registry, &authority, 42),
            Err(FateError::StakerPositionNotFound)
        );
    }
}
