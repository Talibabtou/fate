use fate_api::prelude::*;
use solana_program::{keccak::hashv, rent::Rent, sysvar::Sysvar};
use steel::*;

use crate::lock_draw::validate_lock;
use crate::weight_tree::{select_weight_path, update_weight_path};

const DEV_ENTROPY_DOMAIN: &[u8] = b"fate:dev-fixture:v1";
const MAX_DEV_ENTROPY_ATTEMPTS: u64 = 256;

pub fn process_settle_draw_dev(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    SettleDrawDev::try_from_bytes(data)?;
    if accounts.len() != 9 + 2 * WEIGHT_TREE_DEPTH {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let payer = &accounts[0];
    let config_info = &accounts[1];
    let draw_info = &accounts[2];
    let player_position_info = &accounts[3];
    let vault_info = &accounts[4];
    let staker_position_info = &accounts[5];
    let treasury = &accounts[6];
    let next_draw_info = &accounts[7];
    let system_program_info = &accounts[8];
    let player_pages = &accounts[9..9 + WEIGHT_TREE_DEPTH];
    let staker_pages = &accounts[9 + WEIGHT_TREE_DEPTH..];
    payer.is_signer()?.is_writable()?;
    for info in [
        config_info,
        draw_info,
        player_position_info,
        vault_info,
        staker_position_info,
        treasury,
        next_draw_info,
    ] {
        info.is_writable()?;
    }
    system_program_info.is_program(&system_program::ID)?;
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    vault_info.has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    let config = config_info.as_account::<Config>(program_id)?;
    if config.version != PROGRAM_VERSION || config.fee_treasury != *treasury.key {
        return Err(FateError::InvalidInitializationState.into());
    }
    let draw_id = config.current_draw_id;
    let next_id = draw_id
        .checked_add(1)
        .ok_or(FateError::ArithmeticOverflow)?;
    draw_info.has_seeds(&[DRAW_SEED, &draw_id.to_le_bytes()], program_id)?;
    next_draw_info
        .is_empty()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[DRAW_SEED, &next_id.to_le_bytes()], program_id)?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    let vault = vault_info.as_account::<StakerVault>(program_id)?;
    if draw.id != draw_id {
        return Err(FateError::InvalidDraw.into());
    }
    match draw.phase() {
        Some(DrawPhase::Locked) => {}
        Some(DrawPhase::Activated) => {
            validate_lock(draw, draw_id, Clock::get()?.unix_timestamp)?;
        }
        _ => return Err(FateError::InvalidDraw.into()),
    }
    if player_pages[0]
        .as_account::<WeightPage>(program_id)?
        .total()?
        != draw.total_player_weight.get()
        || staker_pages[0]
            .as_account::<WeightPage>(program_id)?
            .total()?
            != u128::from(vault.total_shares)
    {
        return Err(FateError::InvalidWeightTree.into());
    }

    let desired_side = if draw_id % 2 == 0 {
        SelectedSide::Player
    } else {
        SelectedSide::Staker
    };
    let entropy = dev_entropy_for_side(draw_id, desired_side)?;
    let side = select_side_from_entropy(&entropy, draw_id)?;
    let player_position = *player_position_info.as_account::<PlayerPosition>(program_id)?;
    let staker_position = *staker_position_info.as_account::<StakerPosition>(program_id)?;
    player_position_info.has_seeds(
        &[
            PLAYER_POSITION_SEED,
            &draw_id.to_le_bytes(),
            player_position.authority.as_ref(),
        ],
        program_id,
    )?;
    staker_position_info.has_seeds(
        &[STAKER_POSITION_SEED, staker_position.authority.as_ref()],
        program_id,
    )?;
    for (index, info) in [
        config_info,
        draw_info,
        player_position_info,
        vault_info,
        staker_position_info,
        treasury,
        next_draw_info,
    ]
    .iter()
    .enumerate()
    {
        if [
            config_info,
            draw_info,
            player_position_info,
            vault_info,
            staker_position_info,
            treasury,
            next_draw_info,
        ][..index]
            .iter()
            .any(|other| other.key == info.key)
        {
            return Err(ProgramError::InvalidArgument);
        }
    }
    match side {
        SelectedSide::Player => {
            let target = winner_target_from_entropy(
                &entropy,
                draw_id,
                side,
                draw.total_player_weight.get(),
            )?;
            let selected = select_weight_path(program_id, draw_info.key, target, player_pages)?;
            if selected != player_position.leaf_index
                || player_position.draw_id != draw_id
                || player_pages[WEIGHT_TREE_DEPTH - 1]
                    .as_account::<WeightPage>(program_id)?
                    .weights[weight_branch(selected, WEIGHT_TREE_DEPTH - 1)]
                .get()
                    != player_position.boosted_weight.get()
            {
                return Err(FateError::InvalidWeightTree.into());
            }
        }
        SelectedSide::Staker => {
            let target = winner_target_from_entropy(
                &entropy,
                draw_id,
                side,
                u128::from(vault.total_shares),
            )?;
            let selected = select_weight_path(program_id, vault_info.key, target, staker_pages)?;
            if selected != staker_position.leaf_index
                || staker_pages[WEIGHT_TREE_DEPTH - 1]
                    .as_account::<WeightPage>(program_id)?
                    .weights[weight_branch(selected, WEIGHT_TREE_DEPTH - 1)]
                .get()
                    != u128::from(staker_position.active_shares)
            {
                return Err(FateError::InvalidWeightTree.into());
            }
        }
    }
    let old_staker_weight = staker_position.active_shares;
    create_program_account::<Draw>(
        next_draw_info,
        system_program_info,
        payer,
        program_id,
        &[DRAW_SEED, &next_id.to_le_bytes()],
    )?;
    draw_info.as_account_mut::<Draw>(program_id)?.phase = DrawPhase::AwaitingRandomness.into();
    let applied = apply_settlement_from_verified_entropy(
        entropy,
        Clock::get()?.unix_timestamp,
        draw_info.as_account_mut::<Draw>(program_id)?,
        vault_info.as_account_mut::<StakerVault>(program_id)?,
        if side == SelectedSide::Player {
            Some(player_position_info.as_account_mut::<PlayerPosition>(program_id)?)
        } else {
            None
        },
        if side == SelectedSide::Staker {
            Some(staker_position_info.as_account_mut::<StakerPosition>(program_id)?)
        } else {
            None
        },
    )?;
    if side == SelectedSide::Staker && applied.jackpot_shares_minted != 0 {
        let new_weight = staker_position_info
            .as_account::<StakerPosition>(program_id)?
            .active_shares;
        update_weight_path(
            program_id,
            vault_info.key,
            staker_position_info
                .as_account::<StakerPosition>(program_id)?
                .leaf_index,
            u128::from(old_staker_weight),
            u128::from(new_weight),
            staker_pages,
        )?;
    }
    apply_transfers(&applied.transfers, draw_info, vault_info, treasury)?;
    validate_custody(
        draw_info.as_account::<Draw>(program_id)?,
        draw_info,
        vault_info.as_account::<StakerVault>(program_id)?,
        vault_info,
    )?;

    let settled_draw = draw_info.as_account::<Draw>(program_id)?;
    SettlementEvent {
        kind: EVENT_SETTLEMENT,
        winner_side: settled_draw.winner_side as u8,
        reserved: [0; 6],
        draw_id: settled_draw.id,
        winner: settled_draw.winner,
        winner_deposit_lamports: settled_draw.winner_deposit_lamports,
        winner_payout_lamports: settled_draw.winner_payout_lamports,
        protocol_fee_lamports: settled_draw.protocol_fee_lamports,
        staker_erosion_lamports: settled_draw.staker_erosion_lamports,
        settled_at: settled_draw.settled_at,
    }
    .log();
    let settled_at = settled_draw.settled_at;
    let next = next_draw_info.as_account_mut::<Draw>(program_id)?;
    next.id = next_id;
    next.phase = DrawPhase::Funding.into();
    next.created_at = settled_at;
    next.rent_payer = *payer.key;
    let config = config_info.as_account_mut::<Config>(program_id)?;
    config.current_draw_id = next_id;
    config.push_recent_draw(draw_id);
    Ok(())
}

fn dev_entropy_for_side(draw_id: u64, desired: SelectedSide) -> Result<[u8; 32], FateError> {
    for nonce in 0..MAX_DEV_ENTROPY_ATTEMPTS {
        let entropy = hashv(&[
            DEV_ENTROPY_DOMAIN,
            &draw_id.to_le_bytes(),
            &nonce.to_le_bytes(),
        ])
        .to_bytes();
        if select_side_from_entropy(&entropy, draw_id)? == desired {
            return Ok(entropy);
        }
    }
    Err(FateError::SelectionRetriesExhausted)
}

fn apply_transfers<'info>(
    transfers: &SettlementTransfers,
    draw: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
) -> ProgramResult {
    if transfers.staker_vault_to_draw_lamports != 0 {
        vault.send(transfers.staker_vault_to_draw_lamports, draw);
    }
    if transfers.draw_to_staker_vault_lamports != 0 {
        draw.send(transfers.draw_to_staker_vault_lamports, vault);
    }
    if transfers.draw_to_fee_treasury_lamports != 0 {
        draw.send(transfers.draw_to_fee_treasury_lamports, treasury);
    }
    if transfers.staker_vault_to_fee_treasury_lamports != 0 {
        vault.send(transfers.staker_vault_to_fee_treasury_lamports, treasury);
    }
    Ok(())
}

fn validate_custody(
    draw: &Draw,
    draw_info: &AccountInfo<'_>,
    vault: &StakerVault,
    vault_info: &AccountInfo<'_>,
) -> ProgramResult {
    let rent = Rent::get()?;
    if draw_info
        .lamports()
        .saturating_sub(rent.minimum_balance(Draw::SIZE))
        < draw.outstanding_player_claim_lamports
    {
        return Err(FateError::InsufficientCustody.into());
    }
    let tracked = vault
        .active_assets_lamports
        .checked_add(vault.withdrawal_liability_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    if vault_info
        .lamports()
        .saturating_sub(rent.minimum_balance(StakerVault::SIZE))
        < tracked
    {
        return Err(FateError::InsufficientCustody.into());
    }
    Ok(())
}
