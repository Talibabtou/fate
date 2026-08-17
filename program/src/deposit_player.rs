use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

use crate::weight_tree::{prepare_weight_path, update_weight_path};

pub fn process_deposit_player(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let amount = u64::from_le_bytes(DepositPlayer::try_from_bytes(data)?.amount);
    if amount < MINIMUM_PLAYER_DEPOSIT_LAMPORTS {
        return Err(FateError::DepositTooSmall.into());
    }
    let [player, config_info, draw_info, position_info, vault_info, system_program_info, pages @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    player.is_signer()?.is_writable()?;
    if config_info.is_writable || vault_info.is_writable || system_program_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    vault_info.has_seeds(&[STAKER_VAULT_SEED], program_id)?;
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
    let draw_id = config.current_draw_id;
    let draw_id_bytes = draw_id.to_le_bytes();
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    position_info.is_writable()?.has_seeds(
        &[PLAYER_POSITION_SEED, &draw_id_bytes, player.key.as_ref()],
        program_id,
    )?;
    let now = Clock::get()?.unix_timestamp;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    let activated = match draw.phase() {
        Some(DrawPhase::Funding) => false,
        Some(DrawPhase::Activated) if now < draw.locks_at => true,
        _ => return Err(FateError::DepositsClosed.into()),
    };
    let first = !activated && draw.first_player_at == 0;
    let vault = vault_info.as_account::<StakerVault>(program_id)?;
    if first && vault.total_shares == 0 {
        return Err(FateError::InvalidSettlementState.into());
    }
    let snapshot = if first {
        vault.active_assets_lamports
    } else {
        draw.staker_tvl_snapshot
    };
    let initial_threshold = if first {
        initial_activation_threshold(snapshot)?
    } else {
        draw.initial_threshold_lamports
    };
    let live_threshold = if first {
        activation_threshold(snapshot, 0)?
    } else {
        draw.activation_threshold_lamports
    };
    let boost = player_boost_bps(draw.player_tvl_lamports, initial_threshold, activated)?;
    let added_weight = boosted_player_weight(amount, boost)?;

    let (leaf_index, old_weight, is_new) = if position_info.data_is_empty() {
        if draw.next_player_index > MAX_PARTICIPANT_INDEX {
            return Err(FateError::ParticipantIndexExhausted.into());
        }
        (draw.next_player_index, 0, true)
    } else {
        let position = position_info.as_account::<PlayerPosition>(program_id)?;
        if !position.is_initialized()
            || position.authority != *player.key
            || position.draw_id != draw_id
        {
            return Err(FateError::PlayerPositionNotFound.into());
        }
        (position.leaf_index, position.boosted_weight.get(), false)
    };
    let created_pages = pages.iter().filter(|page| page.data_is_empty()).count() as u64;
    prepare_weight_path(
        program_id,
        player,
        system_program_info,
        draw_info,
        leaf_index,
        pages,
    )?;
    if pages[0].as_account::<WeightPage>(program_id)?.total()? != draw.total_player_weight.get() {
        return Err(FateError::InvalidWeightTree.into());
    }
    if is_new {
        create_program_account::<PlayerPosition>(
            position_info,
            system_program_info,
            player,
            program_id,
            &[PLAYER_POSITION_SEED, &draw_id_bytes, player.key.as_ref()],
        )?;
        let position = position_info.as_account_mut::<PlayerPosition>(program_id)?;
        position.authority = *player.key;
        position.rent_payer = *player.key;
        position.draw_id = draw_id;
        position.leaf_index = leaf_index;
        position.status = PLAYER_STATUS_INITIALIZED;
    }
    let new_weight = old_weight
        .checked_add(added_weight)
        .ok_or(FateError::ArithmeticOverflow)?;
    update_weight_path(
        program_id,
        draw_info.key,
        leaf_index,
        old_weight,
        new_weight,
        pages,
    )?;
    draw_info.collect(amount, player)?;

    let draw = draw_info.as_account_mut::<Draw>(program_id)?;
    draw.open_weight_pages = draw
        .open_weight_pages
        .checked_add(created_pages)
        .ok_or(FateError::ArithmeticOverflow)?;
    if first {
        draw.first_player_at = now;
        draw.staker_tvl_snapshot = snapshot;
        draw.initial_threshold_lamports = initial_threshold;
        draw.activation_threshold_lamports = live_threshold;
    }
    draw.player_tvl_lamports = draw
        .player_tvl_lamports
        .checked_add(amount)
        .ok_or(FateError::ArithmeticOverflow)?;
    draw.total_player_weight = U128Value::new(
        new_weight
            .checked_add(
                draw.total_player_weight
                    .get()
                    .checked_sub(old_weight)
                    .ok_or(FateError::InvalidWeightTree)?,
            )
            .ok_or(FateError::ArithmeticOverflow)?,
    );
    if is_new {
        draw.next_player_index = draw
            .next_player_index
            .checked_add(1)
            .ok_or(FateError::ParticipantIndexExhausted)?;
        draw.open_player_positions = draw
            .open_player_positions
            .checked_add(1)
            .ok_or(FateError::ArithmeticOverflow)?;
    }
    let position = position_info.as_account_mut::<PlayerPosition>(program_id)?;
    if activated {
        position.add_committed_deposit(amount, added_weight)?;
    } else {
        position.add_refundable_deposit(amount, added_weight)?;
    }

    let tracked = draw
        .player_tvl_lamports
        .checked_add(draw.outstanding_player_claim_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    if draw_info
        .lamports()
        .saturating_sub(Rent::get()?.minimum_balance(Draw::SIZE))
        < tracked
    {
        return Err(FateError::InsufficientCustody.into());
    }
    Ok(())
}
