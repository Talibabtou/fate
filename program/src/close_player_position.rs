use fate_api::prelude::*;
use steel::*;

pub fn process_close_player_position(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let draw_id = u64::from_le_bytes(ClosePlayerPosition::try_from_bytes(data)?.draw_id);
    let [draw_info, position_info, rent_payer] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    rent_payer.is_writable()?;
    let draw_id_bytes = draw_id.to_le_bytes();
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    let position = position_info.as_account::<PlayerPosition>(program_id)?;
    position_info.is_writable()?.has_seeds(
        &[
            PLAYER_POSITION_SEED,
            &draw_id_bytes,
            position.authority.as_ref(),
        ],
        program_id,
    )?;
    if position.draw_id != draw_id
        || position.rent_payer != *rent_payer.key
        || position.claimable_lamports != 0
    {
        return Err(FateError::StorageNotClosable.into());
    }
    let draw = draw_info.as_account::<Draw>(program_id)?;
    if !matches!(draw.phase(), Some(DrawPhase::Settled | DrawPhase::Voided)) {
        return Err(FateError::StorageNotClosable.into());
    }
    if draw.phase() == Some(DrawPhase::Voided)
        && (position.refundable_deposit_lamports != 0 || position.committed_deposit_lamports != 0)
    {
        return Err(FateError::StorageNotClosable.into());
    }
    let remaining = draw
        .open_player_positions
        .checked_sub(1)
        .ok_or(FateError::InvalidDraw)?;
    draw_info
        .as_account_mut::<Draw>(program_id)?
        .open_player_positions = remaining;
    position_info.close(rent_payer)?;
    Ok(())
}
