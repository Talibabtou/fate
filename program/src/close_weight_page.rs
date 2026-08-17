use fate_api::prelude::*;
use steel::*;

pub fn process_close_weight_page(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let draw_id = u64::from_le_bytes(CloseWeightPage::try_from_bytes(data)?.draw_id);
    let [draw_info, page_info, rent_payer] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    rent_payer.is_writable()?;
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id.to_le_bytes()], program_id)?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    if !matches!(draw.phase(), Some(DrawPhase::Settled | DrawPhase::Voided)) {
        return Err(FateError::StorageNotClosable.into());
    }
    let page = page_info.as_account::<WeightPage>(program_id)?;
    if page.tree != *draw_info.key || page.rent_payer != *rent_payer.key {
        return Err(FateError::InvalidRentRecipient.into());
    }
    page_info.is_writable()?.has_seeds(
        &[
            WEIGHT_PAGE_SEED,
            draw_info.key.as_ref(),
            &page.level.to_le_bytes(),
            &page.prefix.to_le_bytes(),
        ],
        program_id,
    )?;
    let remaining = draw
        .open_weight_pages
        .checked_sub(1)
        .ok_or(FateError::InvalidDraw)?;
    draw_info
        .as_account_mut::<Draw>(program_id)?
        .open_weight_pages = remaining;
    page_info.close(rent_payer)?;
    Ok(())
}
