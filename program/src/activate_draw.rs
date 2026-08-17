use fate_api::prelude::*;
use solana_program::sysvar::Sysvar;
use steel::*;

pub fn process_activate_draw(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    ActivateDraw::try_from_bytes(data)?;

    let [config_info, draw_info, player_registry_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if config_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    if draw_info.key == player_registry_info.key {
        return Err(ProgramError::InvalidArgument);
    }

    let config = config_info.as_account::<Config>(program_id)?;
    if config.is_paused() {
        return Err(FateError::ProtocolPaused.into());
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
    if draw.id != config.current_draw_id || registry.draw_id != draw.id {
        return Err(FateError::InvalidDraw.into());
    }
    validate_funding_positions(draw, registry)?;

    let now = Clock::get()?.unix_timestamp;
    let draw = draw_info.as_account_mut::<Draw>(program_id)?;
    let registry = player_registry_info.as_account_mut::<PlayerRegistry>(program_id)?;
    activate_draw_state(draw, registry, now)?;

    Ok(())
}

fn validate_funding_positions(draw: &Draw, registry: &PlayerRegistry) -> Result<(), FateError> {
    if draw.phase() != Some(DrawPhase::Funding)
        || draw.first_player_at <= 0
        || draw.player_tvl_lamports == 0
        || registry.occupied_entries == 0
        || draw.outstanding_player_claim_lamports != 0
    {
        return Err(FateError::InvalidDraw);
    }

    let mut refundable_lamports = 0u64;
    let mut total_weight = 0u128;
    let mut occupied_entries = 0u64;
    for entry in registry.entries.iter().filter(|entry| entry.is_occupied()) {
        if entry.authority == Pubkey::default()
            || entry.refundable_deposit_lamports == 0
            || entry.committed_deposit_lamports != 0
            || entry.claimable_lamports != 0
        {
            return Err(FateError::InvalidDraw);
        }
        refundable_lamports = refundable_lamports
            .checked_add(entry.refundable_deposit_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        total_weight = total_weight
            .checked_add(entry.boosted_weight.get())
            .ok_or(FateError::ArithmeticOverflow)?;
        occupied_entries = occupied_entries
            .checked_add(1)
            .ok_or(FateError::ArithmeticOverflow)?;
    }

    if refundable_lamports != draw.player_tvl_lamports
        || total_weight != draw.total_player_weight.get()
        || occupied_entries != registry.occupied_entries
    {
        return Err(FateError::InvalidDraw);
    }
    Ok(())
}

fn activate_draw_state(
    draw: &mut Draw,
    registry: &mut PlayerRegistry,
    now: i64,
) -> Result<(), FateError> {
    validate_funding_positions(draw, registry)?;
    let elapsed_seconds = now
        .checked_sub(draw.first_player_at)
        .and_then(|seconds| u64::try_from(seconds).ok())
        .ok_or(FateError::InvalidDraw)?;
    let live_threshold = activation_threshold(draw.staker_tvl_snapshot, elapsed_seconds)?;
    if draw.player_tvl_lamports < live_threshold {
        return Err(FateError::ActivationThresholdNotMet);
    }
    let countdown_seconds =
        i64::try_from(COUNTDOWN_SECONDS).map_err(|_| FateError::ArithmeticOverflow)?;
    let locks_at = now
        .checked_add(countdown_seconds)
        .ok_or(FateError::ArithmeticOverflow)?;

    for entry in registry
        .entries
        .iter_mut()
        .filter(|entry| entry.is_occupied())
    {
        entry.commit_pending()?;
    }
    draw.activation_threshold_lamports = live_threshold;
    draw.activated_at = now;
    draw.locks_at = locks_at;
    draw.phase = DrawPhase::Activated.into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn funding_draw(player_tvl_lamports: u64) -> (Draw, Box<PlayerRegistry>) {
        let authority = Pubkey::new_unique();
        let weight = u128::from(player_tvl_lamports) * 15 / 10;
        let draw = Draw {
            phase: DrawPhase::Funding.into(),
            first_player_at: 1_000,
            staker_tvl_snapshot: 100 * LAMPORTS_PER_SOL,
            initial_threshold_lamports: LAMPORTS_PER_SOL,
            activation_threshold_lamports: LAMPORTS_PER_SOL,
            player_tvl_lamports,
            total_player_weight: U128Value::new(weight),
            ..Draw::zeroed()
        };
        let mut registry = Box::new(PlayerRegistry::zeroed());
        registry
            .get_or_insert(authority)
            .unwrap()
            .add_refundable_deposit(player_tvl_lamports, weight)
            .unwrap();
        (draw, registry)
    }

    #[test]
    fn activation_commits_pending_principal_at_the_exact_threshold() {
        let (mut draw, mut registry) = funding_draw(LAMPORTS_PER_SOL);

        activate_draw_state(&mut draw, &mut registry, 1_000).unwrap();

        assert_eq!(draw.phase(), Some(DrawPhase::Activated));
        assert_eq!(draw.activation_threshold_lamports, LAMPORTS_PER_SOL);
        assert_eq!(draw.activated_at, 1_000);
        assert_eq!(draw.locks_at, 1_000 + 5 * 60);
        assert_eq!(registry.entries[0].refundable_deposit_lamports, 0);
        assert_eq!(
            registry.entries[0].committed_deposit_lamports,
            LAMPORTS_PER_SOL
        );
    }

    #[test]
    fn activation_rejects_tvl_below_the_live_threshold() {
        let (mut draw, mut registry) = funding_draw(LAMPORTS_PER_SOL - 1);

        assert_eq!(
            activate_draw_state(&mut draw, &mut registry, 1_000),
            Err(FateError::ActivationThresholdNotMet)
        );
        assert_eq!(draw.phase(), Some(DrawPhase::Funding));
        assert_eq!(
            registry.entries[0].refundable_deposit_lamports,
            LAMPORTS_PER_SOL - 1
        );
    }

    #[test]
    fn activation_uses_the_decayed_threshold_at_a_boundary() {
        let decayed_threshold = 900_000_000;
        let (mut draw, mut registry) = funding_draw(decayed_threshold);

        activate_draw_state(
            &mut draw,
            &mut registry,
            1_000 + i64::try_from(THRESHOLD_DECAY_INTERVAL_SECONDS).unwrap(),
        )
        .unwrap();

        assert_eq!(draw.activation_threshold_lamports, decayed_threshold);
        assert_eq!(draw.phase(), Some(DrawPhase::Activated));
    }
}
