use fate_api::prelude::*;
use steel::*;

pub fn process_close_draw(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let draw_id = u64::from_le_bytes(CloseDraw::try_from_bytes(data)?.draw_id);
    let [config_info, draw_info, rent_payer] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    rent_payer.is_writable()?;
    if config_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id.to_le_bytes()], program_id)?;
    let config = config_info.as_account::<Config>(program_id)?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    if draw.id != draw_id
        || config.contains_recent_draw(draw_id)
        || config.current_draw_id == draw_id
        || draw.outstanding_player_claim_lamports != 0
        || draw.open_player_positions != 0
        || draw.open_weight_pages != 0
        || !matches!(draw.phase(), Some(DrawPhase::Settled | DrawPhase::Voided))
    {
        return Err(FateError::StorageNotClosable.into());
    }
    if draw.rent_payer != *rent_payer.key {
        return Err(FateError::InvalidRentRecipient.into());
    }
    draw_info.close(rent_payer)?;
    Ok(())
}
