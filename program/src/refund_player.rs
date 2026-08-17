use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

pub fn process_refund_player(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    RefundPlayer::try_from_bytes(data)?;

    let [player_info, config_info, draw_info, player_registry_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    player_info.is_signer()?.is_writable()?;
    if config_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    if player_info.key == draw_info.key
        || player_info.key == player_registry_info.key
        || draw_info.key == player_registry_info.key
    {
        return Err(ProgramError::InvalidArgument);
    }

    let config = config_info.as_account::<Config>(program_id)?;
    if config.version != PROGRAM_VERSION {
        return Err(FateError::InvalidInitializationState.into());
    }
    let draw_id_bytes = config.current_draw_id.to_le_bytes();
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    player_registry_info
        .is_writable()?
        .has_seeds(&[PLAYER_REGISTRY_SEED, &draw_id_bytes], program_id)?;

    let draw = draw_info.as_account::<Draw>(program_id)?;
    let registry = player_registry_info.as_account::<PlayerRegistry>(program_id)?;
    if draw.id != config.current_draw_id
        || registry.draw_id != draw.id
        || !draw.player_refunds_open()
    {
        return Err(FateError::InvalidDraw.into());
    }

    let entry_index = registry
        .find_index(player_info.key)
        .ok_or(FateError::PlayerPositionNotFound)?;
    let entry = &registry.entries[entry_index];
    if entry.committed_deposit_lamports != 0 {
        return Err(FateError::PlayerFundsCommitted.into());
    }
    let refund_lamports = entry.refundable_deposit_lamports;
    if refund_lamports == 0 {
        return Err(FateError::PlayerPositionNotFound.into());
    }
    let refunded_weight = entry.boosted_weight.get();

    draw.player_tvl_lamports
        .checked_sub(refund_lamports)
        .ok_or(FateError::InvalidDraw)?;
    draw.total_player_weight
        .get()
        .checked_sub(refunded_weight)
        .ok_or(FateError::InvalidDraw)?;
    player_info
        .lamports()
        .checked_add(refund_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    let registry_after = player_registry_info
        .lamports()
        .checked_sub(refund_lamports)
        .ok_or(FateError::InsufficientCustody)?;
    let tracked_after = draw
        .player_tvl_lamports
        .checked_sub(refund_lamports)
        .and_then(|tvl| tvl.checked_add(draw.outstanding_player_claim_lamports))
        .ok_or(FateError::InvalidDraw)?;
    let rent_reserve = Rent::get()?.minimum_balance(PlayerRegistry::SIZE);
    if registry_after.saturating_sub(rent_reserve) < tracked_after {
        return Err(FateError::InsufficientCustody.into());
    }

    let draw = draw_info.as_account_mut::<Draw>(program_id)?;
    let registry = player_registry_info.as_account_mut::<PlayerRegistry>(program_id)?;
    apply_player_refund(
        draw,
        registry,
        player_info.key,
        refund_lamports,
        refunded_weight,
    )?;
    player_registry_info.send(refund_lamports, player_info);

    let tracked_assets = draw
        .player_tvl_lamports
        .checked_add(draw.outstanding_player_claim_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    if player_registry_info.lamports().saturating_sub(rent_reserve) < tracked_assets {
        return Err(FateError::InsufficientCustody.into());
    }

    Ok(())
}

fn apply_player_refund(
    draw: &mut Draw,
    registry: &mut PlayerRegistry,
    authority: &Pubkey,
    refund_lamports: u64,
    refunded_weight: u128,
) -> Result<(), FateError> {
    let entry_index = registry
        .find_index(authority)
        .ok_or(FateError::PlayerPositionNotFound)?;
    let entry = &mut registry.entries[entry_index];
    if entry.refundable_deposit_lamports != refund_lamports
        || entry.boosted_weight.get() != refunded_weight
    {
        return Err(FateError::InvalidDraw);
    }
    entry.refund_pending()?;

    draw.player_tvl_lamports = draw
        .player_tvl_lamports
        .checked_sub(refund_lamports)
        .ok_or(FateError::InvalidDraw)?;
    draw.total_player_weight = U128Value::new(
        draw.total_player_weight
            .get()
            .checked_sub(refunded_weight)
            .ok_or(FateError::InvalidDraw)?,
    );
    registry.release_if_empty(authority)?;

    if draw.player_tvl_lamports == 0 {
        if draw.total_player_weight.get() != 0 || registry.occupied_entries != 0 {
            return Err(FateError::InvalidDraw);
        }
        draw.first_player_at = 0;
        draw.staker_tvl_snapshot = 0;
        draw.initial_threshold_lamports = 0;
        draw.activation_threshold_lamports = 0;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refund_removes_the_complete_wallet_position() {
        let authority = Pubkey::new_unique();
        let mut draw = Draw {
            first_player_at: 100,
            player_tvl_lamports: 30,
            total_player_weight: U128Value::new(40),
            ..Draw::zeroed()
        };
        let mut registry = Box::new(PlayerRegistry::zeroed());
        registry
            .get_or_insert(authority)
            .unwrap()
            .add_refundable_deposit(10, 15)
            .unwrap();
        registry
            .get_or_insert(Pubkey::new_unique())
            .unwrap()
            .add_refundable_deposit(20, 25)
            .unwrap();

        apply_player_refund(&mut draw, &mut registry, &authority, 10, 15).unwrap();

        assert_eq!(draw.player_tvl_lamports, 20);
        assert_eq!(draw.total_player_weight.get(), 25);
        assert!(registry.find_index(&authority).is_none());
        assert_eq!(registry.occupied_entries, 1);
        assert_eq!(draw.first_player_at, 100);
    }

    #[test]
    fn last_refund_resets_the_funding_clock_and_snapshot() {
        let authority = Pubkey::new_unique();
        let mut draw = Draw {
            first_player_at: 100,
            staker_tvl_snapshot: 1_000,
            initial_threshold_lamports: 10,
            activation_threshold_lamports: 9,
            player_tvl_lamports: 10,
            total_player_weight: U128Value::new(15),
            ..Draw::zeroed()
        };
        let mut registry = Box::new(PlayerRegistry::zeroed());
        registry
            .get_or_insert(authority)
            .unwrap()
            .add_refundable_deposit(10, 15)
            .unwrap();

        apply_player_refund(&mut draw, &mut registry, &authority, 10, 15).unwrap();

        assert_eq!(draw.player_tvl_lamports, 0);
        assert_eq!(draw.total_player_weight.get(), 0);
        assert_eq!(draw.first_player_at, 0);
        assert_eq!(draw.staker_tvl_snapshot, 0);
        assert_eq!(draw.initial_threshold_lamports, 0);
        assert_eq!(draw.activation_threshold_lamports, 0);
        assert_eq!(registry.occupied_entries, 0);
    }
}
