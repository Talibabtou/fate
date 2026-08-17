use fate_api::prelude::*;
use solana_program::{keccak::hashv, rent::Rent, sysvar::Sysvar};
use steel::*;

const DEV_ENTROPY_DOMAIN: &[u8] = b"fate:dev-fixture:v1";
const MAX_DEV_ENTROPY_ATTEMPTS: u64 = 256;

/// Localnet/devnet-only settlement. This module is absent from production
/// builds unless `dev-randomness` is explicitly enabled.
pub fn process_settle_draw_dev(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    SettleDrawDev::try_from_bytes(data)?;
    let [payer, config_info, draw_info, player_registry_info, staker_vault_info, staker_registry_info, fee_treasury_info, next_draw_info, next_player_registry_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    payer.is_signer()?.is_writable()?;
    for account in [
        config_info,
        draw_info,
        player_registry_info,
        staker_vault_info,
        staker_registry_info,
        fee_treasury_info,
        next_draw_info,
        next_player_registry_info,
    ] {
        account.is_writable()?;
    }
    if system_program_info.is_writable || fee_treasury_info.executable {
        return Err(ProgramError::InvalidArgument);
    }
    system_program_info.is_program(&system_program::ID)?;
    ensure_distinct(&[
        payer,
        config_info,
        draw_info,
        player_registry_info,
        staker_vault_info,
        staker_registry_info,
        fee_treasury_info,
        next_draw_info,
        next_player_registry_info,
    ])?;

    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    staker_vault_info.has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    staker_registry_info.has_seeds(&[STAKER_REGISTRY_SEED], program_id)?;

    let (draw_id, next_draw_id) = {
        let config = config_info.as_account::<Config>(program_id)?;
        if config.version != PROGRAM_VERSION || config.fee_treasury != *fee_treasury_info.key {
            return Err(FateError::InvalidInitializationState.into());
        }
        (
            config.current_draw_id,
            config
                .current_draw_id
                .checked_add(1)
                .ok_or(FateError::ArithmeticOverflow)?,
        )
    };
    let draw_id_bytes = draw_id.to_le_bytes();
    let next_draw_id_bytes = next_draw_id.to_le_bytes();
    draw_info.has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    player_registry_info.has_seeds(&[PLAYER_REGISTRY_SEED, &draw_id_bytes], program_id)?;
    next_draw_info
        .is_empty()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[DRAW_SEED, &next_draw_id_bytes], program_id)?;
    next_player_registry_info
        .is_empty()?
        .has_owner(&system_program::ID)?
        .has_seeds(&[PLAYER_REGISTRY_SEED, &next_draw_id_bytes], program_id)?;

    {
        let draw = draw_info.as_account::<Draw>(program_id)?;
        let players = player_registry_info.as_account::<PlayerRegistry>(program_id)?;
        staker_vault_info.as_account::<StakerVault>(program_id)?;
        staker_registry_info.as_account::<StakerRegistry>(program_id)?;
        if draw.id != draw_id
            || draw.phase() != Some(DrawPhase::Locked)
            || players.draw_id != draw_id
        {
            return Err(FateError::InvalidDraw.into());
        }
    }

    create_program_account::<Draw>(
        next_draw_info,
        system_program_info,
        payer,
        program_id,
        &[DRAW_SEED, &next_draw_id_bytes],
    )?;
    create_program_account::<PlayerRegistry>(
        next_player_registry_info,
        system_program_info,
        payer,
        program_id,
        &[PLAYER_REGISTRY_SEED, &next_draw_id_bytes],
    )?;

    let desired_side = if draw_id % 2 == 0 {
        SelectedSide::Player
    } else {
        SelectedSide::Staker
    };
    let entropy = dev_entropy_for_side(draw_id, desired_side)?;
    let settled_at = Clock::get()?.unix_timestamp;
    let applied = {
        let draw = draw_info.as_account_mut::<Draw>(program_id)?;
        draw.phase = DrawPhase::AwaitingRandomness.into();
        apply_settlement_from_verified_entropy(
            entropy,
            settled_at,
            draw,
            player_registry_info.as_account_mut::<PlayerRegistry>(program_id)?,
            staker_vault_info.as_account_mut::<StakerVault>(program_id)?,
            staker_registry_info.as_account_mut::<StakerRegistry>(program_id)?,
        )?
    };

    apply_transfers(
        &applied.transfers,
        player_registry_info,
        staker_vault_info,
        fee_treasury_info,
    )?;
    validate_custody(
        draw_info.as_account::<Draw>(program_id)?,
        player_registry_info,
        staker_vault_info.as_account::<StakerVault>(program_id)?,
        staker_vault_info,
    )?;

    let next_draw = next_draw_info.as_account_mut::<Draw>(program_id)?;
    next_draw.id = next_draw_id;
    next_draw.phase = DrawPhase::Funding.into();
    next_draw.created_at = settled_at;
    next_draw.rent_payer = *payer.key;
    next_player_registry_info
        .as_account_mut::<PlayerRegistry>(program_id)?
        .draw_id = next_draw_id;

    let config = config_info.as_account_mut::<Config>(program_id)?;
    config.current_draw_id = next_draw_id;
    config.push_recent_draw(draw_id);
    Ok(())
}

fn dev_entropy_for_side(draw_id: u64, desired_side: SelectedSide) -> Result<[u8; 32], FateError> {
    let draw_id_bytes = draw_id.to_le_bytes();
    for nonce in 0..MAX_DEV_ENTROPY_ATTEMPTS {
        let nonce_bytes = nonce.to_le_bytes();
        let entropy = hashv(&[DEV_ENTROPY_DOMAIN, &draw_id_bytes, &nonce_bytes]).to_bytes();
        if select_side_from_entropy(&entropy, draw_id)? == desired_side {
            return Ok(entropy);
        }
    }
    Err(FateError::SelectionRetriesExhausted)
}

fn apply_transfers<'info>(
    transfers: &SettlementTransfers,
    players: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
) -> ProgramResult {
    treasury
        .lamports()
        .checked_add(transfers.player_registry_to_fee_treasury_lamports)
        .and_then(|value| value.checked_add(transfers.staker_vault_to_fee_treasury_lamports))
        .ok_or(FateError::ArithmeticOverflow)?;

    if transfers.staker_vault_to_player_registry_lamports != 0 {
        vault.send(transfers.staker_vault_to_player_registry_lamports, players);
    }
    if transfers.player_registry_to_staker_vault_lamports != 0 {
        players.send(transfers.player_registry_to_staker_vault_lamports, vault);
    }
    if transfers.player_registry_to_fee_treasury_lamports != 0 {
        players.send(transfers.player_registry_to_fee_treasury_lamports, treasury);
    }
    if transfers.staker_vault_to_fee_treasury_lamports != 0 {
        vault.send(transfers.staker_vault_to_fee_treasury_lamports, treasury);
    }
    Ok(())
}

fn validate_custody(
    draw: &Draw,
    player_registry_info: &AccountInfo<'_>,
    vault: &StakerVault,
    staker_vault_info: &AccountInfo<'_>,
) -> ProgramResult {
    let rent = Rent::get()?;
    let player_assets = draw
        .player_tvl_lamports
        .checked_add(draw.outstanding_player_claim_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    if player_registry_info
        .lamports()
        .saturating_sub(rent.minimum_balance(PlayerRegistry::SIZE))
        < player_assets
    {
        return Err(FateError::InsufficientCustody.into());
    }
    let staker_assets = vault
        .active_assets_lamports
        .checked_add(vault.pending_assets_lamports)
        .and_then(|value| value.checked_add(vault.withdrawal_liability_lamports))
        .ok_or(FateError::ArithmeticOverflow)?;
    if staker_vault_info
        .lamports()
        .saturating_sub(rent.minimum_balance(StakerVault::SIZE))
        < staker_assets
    {
        return Err(FateError::InsufficientCustody.into());
    }
    Ok(())
}

fn ensure_distinct(accounts: &[&AccountInfo<'_>]) -> ProgramResult {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_fixture_alternates_sides_by_draw() {
        for draw_id in 0..8 {
            let expected = if draw_id % 2 == 0 {
                SelectedSide::Player
            } else {
                SelectedSide::Staker
            };
            let entropy = dev_entropy_for_side(draw_id, expected).unwrap();
            assert_eq!(select_side_from_entropy(&entropy, draw_id), Ok(expected));
        }
    }
}
