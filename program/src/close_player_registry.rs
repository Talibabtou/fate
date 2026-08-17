use fate_api::prelude::*;
use steel::*;

pub fn process_close_player_registry(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let args = ClosePlayerRegistry::try_from_bytes(data)?;
    let draw_id = u64::from_le_bytes(args.draw_id);
    let [config_info, draw_info, player_registry_info, rent_payer_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    player_registry_info.is_writable()?;
    rent_payer_info.is_writable()?;
    ensure_distinct(
        config_info,
        draw_info,
        player_registry_info,
        rent_payer_info,
    )?;
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    let draw_id_bytes = draw_id.to_le_bytes();
    draw_info.has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    player_registry_info.has_seeds(&[PLAYER_REGISTRY_SEED, &draw_id_bytes], program_id)?;

    let config = config_info.as_account::<Config>(program_id)?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    let registry = player_registry_info.as_account::<PlayerRegistry>(program_id)?;
    if config.version != PROGRAM_VERSION
        || draw.id != draw_id
        || registry.draw_id != draw_id
        || draw_id >= config.current_draw_id
        || !matches!(draw.phase(), Some(DrawPhase::Settled | DrawPhase::Voided))
        || draw.player_tvl_lamports != 0
        || draw.outstanding_player_claim_lamports != 0
        || !registry.is_empty()
    {
        return Err(FateError::StorageNotClosable.into());
    }
    validate_rent_recipient(draw, rent_payer_info)?;
    rent_payer_info
        .lamports()
        .checked_add(player_registry_info.lamports())
        .ok_or(FateError::ArithmeticOverflow)?;

    player_registry_info.close(rent_payer_info)
}

fn validate_rent_recipient(draw: &Draw, rent_payer_info: &AccountInfo<'_>) -> ProgramResult {
    if draw.rent_payer != *rent_payer_info.key {
        return Err(FateError::InvalidRentRecipient.into());
    }
    Ok(())
}

fn ensure_distinct<'info>(
    config: &AccountInfo<'info>,
    draw: &AccountInfo<'info>,
    registry: &AccountInfo<'info>,
    rent_payer: &AccountInfo<'info>,
) -> ProgramResult {
    let accounts = [config, draw, registry, rent_payer];
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
