use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

pub fn process_claim_stake_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    ClaimStakeWithdrawal::try_from_bytes(data)?;
    let [staker, vault_info, position_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    staker.is_signer()?.is_writable()?;
    vault_info
        .is_writable()?
        .has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    position_info
        .is_writable()?
        .has_seeds(&[STAKER_POSITION_SEED, staker.key.as_ref()], program_id)?;
    let vault = vault_info.as_account::<StakerVault>(program_id)?;
    let position = position_info.as_account::<StakerPosition>(program_id)?;
    if position.authority != *staker.key || !position.is_initialized() {
        return Err(FateError::StakerPositionNotFound.into());
    }
    let amount = position.claimable_withdrawal_lamports;
    if amount == 0 {
        return Err(FateError::NothingToClaim.into());
    }
    let liability_after = vault
        .withdrawal_liability_lamports
        .checked_sub(amount)
        .ok_or(FateError::InvalidSettlementState)?;
    let lamports_after = vault_info
        .lamports()
        .checked_sub(amount)
        .ok_or(FateError::InsufficientCustody)?;
    let tracked_after = vault
        .active_assets_lamports
        .checked_add(liability_after)
        .ok_or(FateError::ArithmeticOverflow)?;
    if lamports_after.saturating_sub(Rent::get()?.minimum_balance(StakerVault::SIZE))
        < tracked_after
    {
        return Err(FateError::InsufficientCustody.into());
    }
    vault_info
        .as_account_mut::<StakerVault>(program_id)?
        .withdrawal_liability_lamports = liability_after;
    position_info
        .as_account_mut::<StakerPosition>(program_id)?
        .take_claim()?;
    vault_info.send(amount, staker);
    ClaimEvent {
        kind: EVENT_CLAIM,
        side: EVENT_SIDE_STAKER,
        reserved: [0; 6],
        draw_id: 0,
        wallet: *staker.key,
        amount_lamports: amount,
        claimed_at: Clock::get()?.unix_timestamp,
    }
    .log();
    Ok(())
}
