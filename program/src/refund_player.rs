use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

use crate::weight_tree::update_weight_path;

pub fn process_refund_player(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    RefundPlayer::try_from_bytes(data)?;
    let [player, config_info, draw_info, position_info, pages @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    player.is_signer()?.is_writable()?;
    if config_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    let config = config_info.as_account::<Config>(program_id)?;
    if config.version != PROGRAM_VERSION {
        return Err(FateError::InvalidInitializationState.into());
    }
    let draw_id_bytes = config.current_draw_id.to_le_bytes();
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    position_info.is_writable()?.has_seeds(
        &[PLAYER_POSITION_SEED, &draw_id_bytes, player.key.as_ref()],
        program_id,
    )?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    let position = position_info.as_account::<PlayerPosition>(program_id)?;
    if draw.id != config.current_draw_id
        || !draw.player_refunds_open()
        || position.authority != *player.key
        || position.draw_id != draw.id
    {
        return Err(FateError::InvalidDraw.into());
    }
    if position.committed_deposit_lamports != 0 {
        return Err(FateError::PlayerFundsCommitted.into());
    }
    let amount = position.refundable_deposit_lamports;
    let weight = position.boosted_weight.get();
    if amount == 0 || weight == 0 {
        return Err(FateError::NothingToClaim.into());
    }
    if pages.len() != WEIGHT_TREE_DEPTH
        || pages[0].as_account::<WeightPage>(program_id)?.total()? != draw.total_player_weight.get()
    {
        return Err(FateError::InvalidWeightTree.into());
    }
    update_weight_path(
        program_id,
        draw_info.key,
        position.leaf_index,
        weight,
        0,
        pages,
    )?;
    let tvl_after = draw
        .player_tvl_lamports
        .checked_sub(amount)
        .ok_or(FateError::InvalidDraw)?;
    let total_after = draw
        .total_player_weight
        .get()
        .checked_sub(weight)
        .ok_or(FateError::InvalidDraw)?;
    let lamports_after = draw_info
        .lamports()
        .checked_sub(amount)
        .ok_or(FateError::InsufficientCustody)?;
    if lamports_after.saturating_sub(Rent::get()?.minimum_balance(Draw::SIZE)) < tvl_after {
        return Err(FateError::InsufficientCustody.into());
    }

    position_info
        .as_account_mut::<PlayerPosition>(program_id)?
        .refund_pending()?;
    let draw = draw_info.as_account_mut::<Draw>(program_id)?;
    draw.player_tvl_lamports = tvl_after;
    draw.total_player_weight = U128Value::new(total_after);
    if tvl_after == 0 {
        if total_after != 0 {
            return Err(FateError::InvalidDraw.into());
        }
        draw.first_player_at = 0;
        draw.staker_tvl_snapshot = 0;
        draw.initial_threshold_lamports = 0;
        draw.activation_threshold_lamports = 0;
    }
    draw_info.send(amount, player);
    Ok(())
}
