use fate_api::prelude::*;
use steel::*;

pub fn process_close_draw(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let args = CloseDraw::try_from_bytes(data)?;
    let draw_id = u64::from_le_bytes(args.draw_id);
    let [config_info, draw_info, player_registry_info, rent_payer_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    draw_info.is_writable()?;
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
    let age = config
        .current_draw_id
        .checked_sub(draw_id)
        .ok_or(FateError::StorageNotClosable)?;
    if config.version != PROGRAM_VERSION
        || draw.id != draw_id
        || !matches!(draw.phase(), Some(DrawPhase::Settled | DrawPhase::Voided))
        || draw.player_tvl_lamports != 0
        || draw.outstanding_player_claim_lamports != 0
        || age <= RECENT_DRAW_CAPACITY as u64
        || config.contains_recent_draw(draw_id)
    {
        return Err(FateError::StorageNotClosable.into());
    }
    if draw.rent_payer != *rent_payer_info.key {
        return Err(FateError::InvalidRentRecipient.into());
    }
    player_registry_info
        .is_empty()?
        .has_owner(&system_program::ID)?;
    if player_registry_info.lamports() != 0 {
        return Err(FateError::StorageNotClosable.into());
    }
    rent_payer_info
        .lamports()
        .checked_add(draw_info.lamports())
        .ok_or(FateError::ArithmeticOverflow)?;

    draw_info.close(rent_payer_info)
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
