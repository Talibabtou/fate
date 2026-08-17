use fate_api::prelude::*;
use steel::*;

const INITIAL_DRAW_ID: u64 = 0;

pub fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    Initialize::try_from_bytes(data)?;

    let [payer, authority, fee_treasury, entropy_program, entropy_variable, config_info, staker_vault_info, staker_registry_info, draw_info, player_registry_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    payer.is_signer()?.is_writable()?;
    authority.is_signer()?;
    if entropy_program.is_writable
        || entropy_variable.is_writable
        || system_program_info.is_writable
    {
        return Err(ProgramError::InvalidArgument);
    }
    system_program_info.is_program(&system_program::ID)?;
    if fee_treasury.executable {
        return Err(ProgramError::InvalidAccountData);
    }
    validate_entropy_accounts(entropy_program, entropy_variable)?;

    let draw_id_bytes = INITIAL_DRAW_ID.to_le_bytes();
    let targets = [
        config_info,
        staker_vault_info,
        staker_registry_info,
        draw_info,
        player_registry_info,
    ];
    ensure_distinct(&targets)?;

    config_info
        .is_empty()?
        .is_writable()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[CONFIG_SEED], program_id)?;
    staker_vault_info
        .is_empty()?
        .is_writable()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    staker_registry_info
        .is_empty()?
        .is_writable()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[STAKER_REGISTRY_SEED], program_id)?;
    draw_info
        .is_empty()?
        .is_writable()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    player_registry_info
        .is_empty()?
        .is_writable()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[PLAYER_REGISTRY_SEED, &draw_id_bytes], program_id)?;

    let created_at = Clock::get()?.unix_timestamp;

    create_program_account::<Config>(
        config_info,
        system_program_info,
        payer,
        program_id,
        &[CONFIG_SEED],
    )?;
    create_program_account::<StakerVault>(
        staker_vault_info,
        system_program_info,
        payer,
        program_id,
        &[STAKER_VAULT_SEED],
    )?;
    create_registry_bootstrap_account(
        staker_registry_info,
        system_program_info,
        payer,
        program_id,
        &[STAKER_REGISTRY_SEED],
        FateAccount::StakerRegistry as u8,
    )?;
    create_program_account::<Draw>(
        draw_info,
        system_program_info,
        payer,
        program_id,
        &[DRAW_SEED, &draw_id_bytes],
    )?;
    create_program_account::<PlayerRegistry>(
        player_registry_info,
        system_program_info,
        payer,
        program_id,
        &[PLAYER_REGISTRY_SEED, &draw_id_bytes],
    )?;

    let config = config_info.as_account_mut::<Config>(program_id)?;
    let draw = draw_info.as_account_mut::<Draw>(program_id)?;
    player_registry_info
        .as_account_mut::<PlayerRegistry>(program_id)?
        .draw_id = INITIAL_DRAW_ID;
    initialize_genesis_state(
        config,
        draw,
        authority.key,
        fee_treasury.key,
        entropy_program.key,
        entropy_variable.key,
        payer.key,
        created_at,
    );

    Ok(())
}

#[cfg(not(feature = "dev-randomness"))]
fn validate_entropy_accounts(
    entropy_program: &AccountInfo<'_>,
    entropy_variable: &AccountInfo<'_>,
) -> ProgramResult {
    entropy_program.is_program(entropy_program.key)?;
    entropy_variable.has_owner(entropy_program.key)?;
    if entropy_variable.data_is_empty() || entropy_variable.executable {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

#[cfg(feature = "dev-randomness")]
fn validate_entropy_accounts(
    _entropy_program: &AccountInfo<'_>,
    _entropy_variable: &AccountInfo<'_>,
) -> ProgramResult {
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn initialize_genesis_state(
    config: &mut Config,
    draw: &mut Draw,
    authority: &Pubkey,
    fee_treasury: &Pubkey,
    entropy_program: &Pubkey,
    entropy_variable: &Pubkey,
    rent_payer: &Pubkey,
    created_at: i64,
) {
    config.authority = *authority;
    config.fee_treasury = *fee_treasury;
    config.entropy_program = *entropy_program;
    config.entropy_variable = *entropy_variable;
    config.version = 0;
    config.paused = 0;
    config.current_draw_id = INITIAL_DRAW_ID;

    draw.id = INITIAL_DRAW_ID;
    draw.phase = DrawPhase::Funding.into();
    draw.created_at = created_at;
    draw.rent_payer = *rent_payer;
}

fn create_registry_bootstrap_account<'a, 'info>(
    target: &'a AccountInfo<'info>,
    system_program: &'a AccountInfo<'info>,
    payer: &'a AccountInfo<'info>,
    owner: &Pubkey,
    seeds: &[&[u8]],
    discriminator: u8,
) -> ProgramResult {
    allocate_account(target, system_program, payer, 8, owner, seeds)?;
    target.try_borrow_mut_data()?[0] = discriminator;
    Ok(())
}

fn ensure_distinct(accounts: &[&AccountInfo<'_>]) -> ProgramResult {
    for (index, account) in accounts.iter().enumerate() {
        if accounts[..index]
            .iter()
            .any(|other| other.key == account.key)
        {
            return Err(ProgramError::InvalidArgument);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn genesis_state_starts_unpaused_in_funding() {
        let authority = Pubkey::new_unique();
        let treasury = Pubkey::new_unique();
        let entropy_program = Pubkey::new_unique();
        let entropy_variable = Pubkey::new_unique();
        let rent_payer = Pubkey::new_unique();
        let mut config = Config::zeroed();
        let mut draw = Draw::zeroed();

        initialize_genesis_state(
            &mut config,
            &mut draw,
            &authority,
            &treasury,
            &entropy_program,
            &entropy_variable,
            &rent_payer,
            123,
        );

        assert_eq!(config.authority, authority);
        assert_eq!(config.fee_treasury, treasury);
        assert_eq!(config.entropy_program, entropy_program);
        assert_eq!(config.entropy_variable, entropy_variable);
        assert_eq!(config.version, 0);
        assert!(!config.is_paused());
        assert_eq!(config.current_draw_id, 0);
        assert_eq!(draw.phase(), Some(DrawPhase::Funding));
        assert_eq!(draw.created_at, 123);
        assert_eq!(draw.rent_payer, rent_payer);
    }

    #[test]
    fn duplicate_mutable_accounts_are_rejected() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let mut first_lamports = 0;
        let mut first_data = [];
        let mut second_lamports = 0;
        let mut second_data = [];
        let first = AccountInfo::new(
            &key,
            false,
            true,
            &mut first_lamports,
            &mut first_data,
            &owner,
            false,
            0,
        );
        let second = AccountInfo::new(
            &key,
            false,
            true,
            &mut second_lamports,
            &mut second_data,
            &owner,
            false,
            0,
        );

        assert_eq!(
            ensure_distinct(&[&first, &second]),
            Err(ProgramError::InvalidArgument)
        );
    }
}
