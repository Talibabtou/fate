use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

use crate::weight_tree::update_weight_path;

pub fn process_request_stake_withdrawal(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let shares = u64::from_le_bytes(RequestStakeWithdrawal::try_from_bytes(data)?.shares);
    if shares == 0 {
        return Err(FateError::InvalidShareAmount.into());
    }
    let [staker, config_info, draw_info, vault_info, position_info, pages @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    staker.is_signer()?.is_writable()?;
    if config_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    vault_info
        .is_writable()?
        .has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    position_info
        .is_writable()?
        .has_seeds(&[STAKER_POSITION_SEED, staker.key.as_ref()], program_id)?;
    let config = config_info.as_account::<Config>(program_id)?;
    if config.version != PROGRAM_VERSION {
        return Err(FateError::InvalidInitializationState.into());
    }
    draw_info.is_writable()?.has_seeds(
        &[DRAW_SEED, &config.current_draw_id.to_le_bytes()],
        program_id,
    )?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    if draw.id != config.current_draw_id || draw.phase() != Some(DrawPhase::Funding) {
        return Err(FateError::DepositsClosed.into());
    }
    let vault = vault_info.as_account::<StakerVault>(program_id)?;
    let position = position_info.as_account::<StakerPosition>(program_id)?;
    if !position.is_initialized() || position.authority != *staker.key {
        return Err(FateError::StakerPositionNotFound.into());
    }
    if shares > position.active_shares {
        return Err(FateError::WithdrawalExceedsAvailableShares.into());
    }
    let draw_id = draw.id;
    if pages.len() != WEIGHT_TREE_DEPTH
        || pages[0].as_account::<WeightPage>(program_id)?.total()? != u128::from(vault.total_shares)
    {
        return Err(FateError::InvalidWeightTree.into());
    }
    let amount = vault.preview_withdrawal_lamports(shares)?;
    if amount == 0 {
        return Err(FateError::InvalidShareAmount.into());
    }
    let new_shares = position
        .active_shares
        .checked_sub(shares)
        .ok_or(FateError::ArithmeticOverflow)?;
    if draw.player_tvl_lamports != 0 && vault.total_shares == shares {
        return Err(FateError::InvalidShareAmount.into());
    }
    update_weight_path(
        program_id,
        vault_info.key,
        position.leaf_index,
        u128::from(position.active_shares),
        u128::from(new_shares),
        pages,
    )?;

    let rent = Rent::get()?.minimum_balance(StakerVault::SIZE);
    let vault_after = vault_info
        .lamports()
        .checked_sub(amount)
        .ok_or(FateError::InsufficientCustody)?;
    let active_after = vault
        .active_assets_lamports
        .checked_sub(amount)
        .ok_or(FateError::InvalidSettlementState)?;
    let tracked_after = active_after
        .checked_add(vault.withdrawal_liability_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    if vault_after.saturating_sub(rent) < tracked_after {
        return Err(FateError::InsufficientCustody.into());
    }

    let vault = vault_info.as_account_mut::<StakerVault>(program_id)?;
    vault.active_assets_lamports = active_after;
    vault.total_shares = vault
        .total_shares
        .checked_sub(shares)
        .ok_or(FateError::InvalidSettlementState)?;
    position_info
        .as_account_mut::<StakerPosition>(program_id)?
        .active_shares = new_shares;
    if draw.first_player_at != 0 {
        let now = Clock::get()?.unix_timestamp;
        let elapsed = u64::try_from(
            now.checked_sub(draw.first_player_at)
                .ok_or(FateError::InvalidDraw)?,
        )
        .map_err(|_| FateError::InvalidDraw)?;
        let draw = draw_info.as_account_mut::<Draw>(program_id)?;
        draw.staker_tvl_snapshot = active_after;
        draw.initial_threshold_lamports = initial_activation_threshold(active_after)?;
        draw.activation_threshold_lamports = activation_threshold(active_after, elapsed)?;
    }
    vault_info.send(amount, staker);
    WithdrawalRequestEvent {
        kind: EVENT_WITHDRAWAL_REQUEST,
        side: EVENT_SIDE_STAKER,
        reserved: [0; 6],
        draw_id,
        staker: *staker.key,
        shares,
        amount_lamports: amount,
        requested_at: Clock::get()?.unix_timestamp,
    }
    .log();
    Ok(())
}
