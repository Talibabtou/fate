use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

pub fn process_deposit_player(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let args = DepositPlayer::try_from_bytes(data)?;
    let amount = u64::from_le_bytes(args.amount);
    if amount < MINIMUM_PLAYER_DEPOSIT_LAMPORTS {
        return Err(FateError::DepositTooSmall.into());
    }

    let [player_info, config_info, draw_info, player_registry_info, staker_vault_info, system_program_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    player_info.is_signer()?.is_writable()?;
    draw_info.is_writable()?;
    player_registry_info.is_writable()?;
    if config_info.is_writable || staker_vault_info.is_writable || system_program_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    staker_vault_info.has_seeds(&[STAKER_VAULT_SEED], program_id)?;
    system_program_info.is_program(&system_program::ID)?;
    if player_info.key == draw_info.key
        || player_info.key == player_registry_info.key
        || draw_info.key == player_registry_info.key
    {
        return Err(ProgramError::InvalidArgument);
    }

    let config = config_info.as_account::<Config>(program_id)?;
    if config.is_paused() {
        return Err(FateError::ProtocolPaused.into());
    }
    let draw_id_bytes = config.current_draw_id.to_le_bytes();
    draw_info.has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    player_registry_info.has_seeds(&[PLAYER_REGISTRY_SEED, &draw_id_bytes], program_id)?;

    let now = Clock::get()?.unix_timestamp;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    let registry = player_registry_info.as_account::<PlayerRegistry>(program_id)?;
    if draw.id != config.current_draw_id || registry.draw_id != draw.id {
        return Err(FateError::InvalidDraw.into());
    }
    let is_activated = match draw.phase() {
        Some(DrawPhase::Funding) => false,
        Some(DrawPhase::Activated) if now < draw.locks_at => true,
        _ => return Err(FateError::DepositsClosed.into()),
    };
    if (!is_activated && draw.first_player_at == 0 && draw.player_tvl_lamports != 0)
        || (!is_activated && draw.first_player_at != 0 && draw.player_tvl_lamports == 0)
    {
        return Err(FateError::InvalidDraw.into());
    }

    let first_player = !is_activated && draw.first_player_at == 0;
    let staker_vault = staker_vault_info.as_account::<StakerVault>(program_id)?;
    let staker_snapshot = if first_player {
        staker_vault.active_assets_lamports
    } else {
        draw.staker_tvl_snapshot
    };
    let initial_threshold = if first_player {
        initial_activation_threshold(staker_snapshot)?
    } else {
        draw.initial_threshold_lamports
    };
    let live_threshold = if first_player {
        activation_threshold(staker_snapshot, 0)?
    } else {
        draw.activation_threshold_lamports
    };
    let boost_bps = player_boost_bps(draw.player_tvl_lamports, initial_threshold, is_activated)?;
    let weight = boosted_player_weight(amount, boost_bps)?;
    draw.player_tvl_lamports
        .checked_add(amount)
        .ok_or(FateError::ArithmeticOverflow)?;
    draw.total_player_weight
        .get()
        .checked_add(weight)
        .ok_or(FateError::ArithmeticOverflow)?;
    if registry.find_index(player_info.key).is_none()
        && registry.occupied_entries >= MAX_PLAYERS_PER_DRAW as u64
    {
        return Err(FateError::RegistryFull.into());
    }

    player_registry_info.collect(amount, player_info)?;

    let draw = draw_info.as_account_mut::<Draw>(program_id)?;
    let registry = player_registry_info.as_account_mut::<PlayerRegistry>(program_id)?;
    apply_player_deposit(
        draw,
        registry,
        *player_info.key,
        amount,
        weight,
        is_activated,
        first_player,
        now,
        staker_snapshot,
        initial_threshold,
        live_threshold,
    )?;

    let tracked_assets = draw
        .player_tvl_lamports
        .checked_add(draw.outstanding_player_claim_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    let rent_reserve = Rent::get()?.minimum_balance(PlayerRegistry::SIZE);
    if player_registry_info.lamports().saturating_sub(rent_reserve) < tracked_assets {
        return Err(FateError::InsufficientCustody.into());
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply_player_deposit(
    draw: &mut Draw,
    registry: &mut PlayerRegistry,
    authority: Pubkey,
    amount: u64,
    weight: u128,
    is_activated: bool,
    first_player: bool,
    now: i64,
    staker_snapshot: u64,
    initial_threshold: u64,
    live_threshold: u64,
) -> Result<(), FateError> {
    if first_player {
        draw.first_player_at = now;
        draw.staker_tvl_snapshot = staker_snapshot;
        draw.initial_threshold_lamports = initial_threshold;
        draw.activation_threshold_lamports = live_threshold;
    }

    draw.player_tvl_lamports = draw
        .player_tvl_lamports
        .checked_add(amount)
        .ok_or(FateError::ArithmeticOverflow)?;
    draw.total_player_weight = U128Value::new(
        draw.total_player_weight
            .get()
            .checked_add(weight)
            .ok_or(FateError::ArithmeticOverflow)?,
    );
    let entry = registry.get_or_insert(authority)?;
    if is_activated {
        entry.add_committed_deposit(amount, weight)?;
    } else {
        entry.add_refundable_deposit(amount, weight)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_player_starts_funding_and_snapshots_stakers() {
        let authority = Pubkey::new_unique();
        let mut draw = Draw::zeroed();
        let mut registry = Box::new(PlayerRegistry::zeroed());
        registry.draw_id = 0;

        apply_player_deposit(
            &mut draw,
            &mut registry,
            authority,
            LAMPORTS_PER_SOL,
            1_500_000_000,
            false,
            true,
            123,
            1_000 * LAMPORTS_PER_SOL,
            10 * LAMPORTS_PER_SOL,
            10 * LAMPORTS_PER_SOL,
        )
        .unwrap();

        assert_eq!(draw.first_player_at, 123);
        assert_eq!(draw.staker_tvl_snapshot, 1_000 * LAMPORTS_PER_SOL);
        assert_eq!(draw.player_tvl_lamports, LAMPORTS_PER_SOL);
        assert_eq!(draw.total_player_weight.get(), 1_500_000_000);
        let entry = &registry.entries[0];
        assert_eq!(entry.refundable_deposit_lamports, LAMPORTS_PER_SOL);
        assert_eq!(entry.committed_deposit_lamports, 0);
    }

    #[test]
    fn countdown_player_deposit_is_not_refundable() {
        let authority = Pubkey::new_unique();
        let mut draw = Draw {
            phase: DrawPhase::Activated.into(),
            first_player_at: 100,
            ..Draw::zeroed()
        };
        let mut registry = Box::new(PlayerRegistry::zeroed());

        apply_player_deposit(
            &mut draw,
            &mut registry,
            authority,
            LAMPORTS_PER_SOL,
            u128::from(LAMPORTS_PER_SOL),
            true,
            false,
            123,
            0,
            0,
            0,
        )
        .unwrap();

        let entry = &registry.entries[0];
        assert_eq!(entry.refundable_deposit_lamports, 0);
        assert_eq!(entry.committed_deposit_lamports, LAMPORTS_PER_SOL);
    }
}
