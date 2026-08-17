use fate_api::prelude::*;
use solana_program::{
    entrypoint::MAX_PERMITTED_DATA_INCREASE, program::invoke, rent::Rent, system_instruction,
    sysvar::Sysvar,
};
use steel::*;

const ACCOUNT_PREFIX_SIZE: usize = 8;

pub fn process_grow_program_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let args = GrowProgramAccounts::try_from_bytes(data)?;
    let step = u64::from_le_bytes(args.step);
    if step >= 5 {
        return Err(FateError::InvalidInitializationState.into());
    }

    let [payer, authority, config_info, staker_registry_info, player_registry_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    payer.is_signer()?.is_writable()?;
    authority.is_signer()?;
    if system_program_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    system_program_info.is_program(&system_program::ID)?;
    config_info
        .is_writable()?
        .has_seeds(&[CONFIG_SEED], program_id)?;
    staker_registry_info
        .is_writable()?
        .has_owner(program_id)?
        .has_seeds(&[STAKER_REGISTRY_SEED], program_id)?;
    let draw_id_bytes = 0u64.to_le_bytes();
    player_registry_info
        .is_writable()?
        .has_owner(program_id)?
        .has_seeds(&[PLAYER_REGISTRY_SEED, &draw_id_bytes], program_id)?;
    if staker_registry_info.key == player_registry_info.key
        || staker_registry_info.key == config_info.key
        || player_registry_info.key == config_info.key
    {
        return Err(ProgramError::InvalidArgument);
    }

    let config = config_info.as_account::<Config>(program_id)?;
    if config.authority != *authority.key {
        return Err(FateError::NotAuthorized.into());
    }
    if config.version != 0 {
        return Err(FateError::InvalidInitializationState.into());
    }

    grow_registry(
        payer,
        staker_registry_info,
        system_program_info,
        StakerRegistry::SIZE,
        FateAccount::StakerRegistry as u8,
        step,
    )?;
    grow_registry(
        payer,
        player_registry_info,
        system_program_info,
        PlayerRegistry::SIZE,
        FateAccount::PlayerRegistry as u8,
        step,
    )?;

    if staker_registry_info.data_len() == StakerRegistry::SIZE
        && player_registry_info.data_len() == PlayerRegistry::SIZE
    {
        let registry = player_registry_info.as_account_mut::<PlayerRegistry>(program_id)?;
        registry.draw_id = 0;
        config_info.as_account_mut::<Config>(program_id)?.version = PROGRAM_VERSION;
    }

    Ok(())
}

fn grow_registry<'info>(
    payer: &AccountInfo<'info>,
    registry: &AccountInfo<'info>,
    system_program_info: &AccountInfo<'info>,
    final_size: usize,
    discriminator: u8,
    step: u64,
) -> ProgramResult {
    let current_size = registry.data_len();
    if !(ACCOUNT_PREFIX_SIZE..=final_size).contains(&current_size)
        || registry.try_borrow_data()?[0] != discriminator
    {
        return Err(FateError::InvalidInitializationState.into());
    }
    let step = usize::try_from(step).map_err(|_| FateError::InvalidInitializationState)?;
    let expected_size = ACCOUNT_PREFIX_SIZE
        .checked_add(
            step.checked_mul(MAX_PERMITTED_DATA_INCREASE)
                .ok_or(FateError::ArithmeticOverflow)?,
        )
        .ok_or(FateError::ArithmeticOverflow)?
        .min(final_size);
    let next_step = step.checked_add(1).ok_or(FateError::ArithmeticOverflow)?;
    let next_size = ACCOUNT_PREFIX_SIZE
        .checked_add(
            next_step
                .checked_mul(MAX_PERMITTED_DATA_INCREASE)
                .ok_or(FateError::ArithmeticOverflow)?,
        )
        .ok_or(FateError::ArithmeticOverflow)?
        .min(final_size);
    if current_size != expected_size {
        return Err(FateError::InvalidInitializationState.into());
    }
    if current_size == next_size {
        return Ok(());
    }
    let required_lamports = Rent::get()?
        .minimum_balance(next_size)
        .saturating_sub(registry.lamports());
    if required_lamports != 0 {
        invoke(
            &system_instruction::transfer(payer.key, registry.key, required_lamports),
            &[payer.clone(), registry.clone(), system_program_info.clone()],
        )?;
    }
    registry.realloc(next_size, true)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_growth_finishes_in_bounded_steps() {
        fn steps(final_size: usize) -> usize {
            final_size
                .saturating_sub(ACCOUNT_PREFIX_SIZE)
                .div_ceil(MAX_PERMITTED_DATA_INCREASE)
        }

        assert_eq!(steps(PlayerRegistry::SIZE), 2);
        assert_eq!(steps(StakerRegistry::SIZE), 5);
    }
}
