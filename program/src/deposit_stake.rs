use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

use crate::weight_tree::{prepare_weight_path, update_weight_path};

pub fn process_deposit_stake(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let amount = u64::from_le_bytes(DepositStake::try_from_bytes(data)?.amount);
    if amount < MINIMUM_STAKER_DEPOSIT_LAMPORTS {
        return Err(FateError::DepositTooSmall.into());
    }
    let [staker, config_info, draw_info, vault_info, position_info, system_program_info, pages @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    staker.is_signer()?.is_writable()?;
    if config_info.is_writable || draw_info.is_writable || system_program_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    vault_info
        .is_writable()?
        .has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    position_info
        .is_writable()?
        .has_seeds(&[STAKER_POSITION_SEED, staker.key.as_ref()], program_id)?;
    system_program_info.is_program(&system_program::ID)?;

    let config = config_info.as_account::<Config>(program_id)?;
    if config.version != PROGRAM_VERSION || config.is_paused() {
        return Err(if config.is_paused() {
            FateError::ProtocolPaused
        } else {
            FateError::InvalidInitializationState
        }
        .into());
    }
    draw_info.has_seeds(
        &[DRAW_SEED, &config.current_draw_id.to_le_bytes()],
        program_id,
    )?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    if draw.id != config.current_draw_id
        || draw.phase() != Some(DrawPhase::Funding)
        || draw.first_player_at != 0
    {
        return Err(FateError::DepositsClosed.into());
    }

    let vault = vault_info.as_account::<StakerVault>(program_id)?;
    let shares = vault.preview_deposit_shares(amount)?;
    if shares == 0 {
        return Err(FateError::InvalidShareAmount.into());
    }
    let (leaf_index, old_weight, is_new) = if position_info.data_is_empty() {
        if vault.next_position_index > MAX_PARTICIPANT_INDEX {
            return Err(FateError::ParticipantIndexExhausted.into());
        }
        (vault.next_position_index, 0, true)
    } else {
        let position = position_info.as_account::<StakerPosition>(program_id)?;
        if !position.is_initialized() || position.authority != *staker.key {
            return Err(FateError::StakerPositionNotFound.into());
        }
        (
            position.leaf_index,
            u128::from(position.active_shares),
            false,
        )
    };
    prepare_weight_path(
        program_id,
        staker,
        system_program_info,
        vault_info,
        leaf_index,
        pages,
    )?;
    if pages[0].as_account::<WeightPage>(program_id)?.total()? != u128::from(vault.total_shares) {
        return Err(FateError::InvalidWeightTree.into());
    }
    if is_new {
        create_program_account::<StakerPosition>(
            position_info,
            system_program_info,
            staker,
            program_id,
            &[STAKER_POSITION_SEED, staker.key.as_ref()],
        )?;
        let position = position_info.as_account_mut::<StakerPosition>(program_id)?;
        position.authority = *staker.key;
        position.rent_payer = *staker.key;
        position.leaf_index = leaf_index;
        position.status = STAKER_STATUS_INITIALIZED;
    }
    let new_weight = old_weight
        .checked_add(u128::from(shares))
        .ok_or(FateError::ArithmeticOverflow)?;
    update_weight_path(
        program_id,
        vault_info.key,
        leaf_index,
        old_weight,
        new_weight,
        pages,
    )?;
    vault_info.collect(amount, staker)?;

    let vault = vault_info.as_account_mut::<StakerVault>(program_id)?;
    vault.active_assets_lamports = vault
        .active_assets_lamports
        .checked_add(amount)
        .ok_or(FateError::ArithmeticOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_add(shares)
        .ok_or(FateError::ArithmeticOverflow)?;
    if is_new {
        vault.next_position_index = vault
            .next_position_index
            .checked_add(1)
            .ok_or(FateError::ParticipantIndexExhausted)?;
    }
    let position = position_info.as_account_mut::<StakerPosition>(program_id)?;
    position.active_shares = position
        .active_shares
        .checked_add(shares)
        .ok_or(FateError::ArithmeticOverflow)?;
    position.lifetime_deposited_lamports = position
        .lifetime_deposited_lamports
        .checked_add(amount)
        .ok_or(FateError::ArithmeticOverflow)?;

    let tracked = vault
        .active_assets_lamports
        .checked_add(vault.withdrawal_liability_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    if vault_info
        .lamports()
        .saturating_sub(Rent::get()?.minimum_balance(StakerVault::SIZE))
        < tracked
    {
        return Err(FateError::InsufficientCustody.into());
    }
    DepositEvent {
        kind: EVENT_DEPOSIT,
        side: EVENT_SIDE_STAKER,
        reserved: [0; 6],
        draw_id: config_info
            .as_account::<Config>(program_id)?
            .current_draw_id,
        wallet: *staker.key,
        amount_lamports: amount,
        weight: u128::from(shares).to_le_bytes(),
    }
    .log();
    Ok(())
}
