use fate_api::prelude::*;
use steel::*;

pub fn process_set_pause(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
    paused: bool,
) -> ProgramResult {
    if paused {
        Pause::try_from_bytes(data)?;
    } else {
        Unpause::try_from_bytes(data)?;
    }

    let [authority_info, config_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    authority_info.is_signer()?;
    if authority_info.is_writable || authority_info.key == config_info.key {
        return Err(ProgramError::InvalidArgument);
    }
    config_info
        .is_writable()?
        .has_seeds(&[CONFIG_SEED], program_id)?;

    let config = config_info.as_account_mut::<Config>(program_id)?;
    if config.authority != *authority_info.key {
        return Err(FateError::NotAuthorized.into());
    }
    config.paused = u64::from(paused);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_state_is_idempotent() {
        let mut config = Config::zeroed();

        config.paused = u64::from(true);
        assert!(config.is_paused());
        config.paused = u64::from(true);
        assert!(config.is_paused());
        config.paused = u64::from(false);
        assert!(!config.is_paused());
    }
}
