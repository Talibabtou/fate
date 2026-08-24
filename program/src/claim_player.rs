use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

pub fn process_claim_player(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let draw_id = u64::from_le_bytes(ClaimPlayer::try_from_bytes(data)?.draw_id);
    let [player, draw_info, position_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    player.is_signer()?.is_writable()?;
    let draw_id_bytes = draw_id.to_le_bytes();
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    position_info.is_writable()?.has_seeds(
        &[PLAYER_POSITION_SEED, &draw_id_bytes, player.key.as_ref()],
        program_id,
    )?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    let position = position_info.as_account::<PlayerPosition>(program_id)?;
    if draw.id != draw_id
        || draw.phase() != Some(DrawPhase::Settled)
        || position.authority != *player.key
        || position.draw_id != draw_id
    {
        return Err(FateError::InvalidDraw.into());
    }
    let amount = position.claimable_lamports;
    if amount == 0 {
        return Err(FateError::NothingToClaim.into());
    }
    let liability_after = draw
        .outstanding_player_claim_lamports
        .checked_sub(amount)
        .ok_or(FateError::InvalidDraw)?;
    let lamports_after = draw_info
        .lamports()
        .checked_sub(amount)
        .ok_or(FateError::InsufficientCustody)?;
    if lamports_after.saturating_sub(Rent::get()?.minimum_balance(Draw::SIZE)) < liability_after {
        return Err(FateError::InsufficientCustody.into());
    }
    draw_info
        .as_account_mut::<Draw>(program_id)?
        .outstanding_player_claim_lamports = liability_after;
    position_info
        .as_account_mut::<PlayerPosition>(program_id)?
        .take_claim()?;
    draw_info.send(amount, player);
    ClaimEvent {
        kind: EVENT_CLAIM,
        side: EVENT_SIDE_PLAYER,
        reserved: [0; 6],
        draw_id,
        wallet: *player.key,
        amount_lamports: amount,
        claimed_at: Clock::get()?.unix_timestamp,
    }
    .log();
    Ok(())
}
