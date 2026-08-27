use fate_api::prelude::*;
use solana_program::sysvar::Sysvar;
use steel::*;

pub fn process_activate_draw(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    ActivateDraw::try_from_bytes(data)?;
    let [config_info, draw_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if config_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    config_info.has_seeds(&[CONFIG_SEED], program_id)?;
    let config = config_info.as_account::<Config>(program_id)?;
    if config.version != PROGRAM_VERSION || config.is_paused() {
        return Err(if config.is_paused() {
            FateError::ProtocolPaused
        } else {
            FateError::InvalidInitializationState
        }
        .into());
    }
    draw_info.is_writable()?.has_seeds(
        &[DRAW_SEED, &config.current_draw_id.to_le_bytes()],
        program_id,
    )?;
    let now = Clock::get()?.unix_timestamp;
    activate_draw_state(draw_info.as_account_mut::<Draw>(program_id)?, now)?;
    let draw = draw_info.as_account::<Draw>(program_id)?;
    ActivationEvent {
        kind: EVENT_ACTIVATION,
        reserved: [0; 7],
        draw_id: draw.id,
        threshold_lamports: draw.activation_threshold_lamports,
        staker_tvl_snapshot_lamports: draw.staker_tvl_snapshot,
        activated_at: draw.activated_at,
        locks_at: draw.locks_at,
    }
    .log();
    Ok(())
}

pub(crate) fn maybe_activate_draw(
    draw: &mut Draw,
    now: i64,
    paused: bool,
) -> Result<bool, FateError> {
    if paused || draw.phase() != Some(DrawPhase::Funding) {
        return Ok(false);
    }
    if draw.first_player_at <= 0
        || draw.staker_tvl_snapshot == 0
        || draw.player_tvl_lamports == 0
        || draw.total_player_weight.get() == 0
        || draw.outstanding_player_claim_lamports != 0
    {
        return Ok(false);
    }
    let elapsed = u64::try_from(
        now.checked_sub(draw.first_player_at)
            .ok_or(FateError::InvalidDraw)?,
    )
    .map_err(|_| FateError::InvalidDraw)?;
    let live_threshold = activation_threshold(draw.staker_tvl_snapshot, elapsed)?;
    if draw.player_tvl_lamports < live_threshold {
        return Ok(false);
    }
    mark_activated(draw, now, live_threshold)?;
    Ok(true)
}

fn activate_draw_state(draw: &mut Draw, now: i64) -> Result<(), FateError> {
    if draw.phase() != Some(DrawPhase::Funding)
        || draw.first_player_at <= 0
        || draw.staker_tvl_snapshot == 0
        || draw.player_tvl_lamports == 0
        || draw.total_player_weight.get() == 0
        || draw.outstanding_player_claim_lamports != 0
    {
        return Err(FateError::InvalidDraw);
    }
    let elapsed = u64::try_from(
        now.checked_sub(draw.first_player_at)
            .ok_or(FateError::InvalidDraw)?,
    )
    .map_err(|_| FateError::InvalidDraw)?;
    let live_threshold = activation_threshold(draw.staker_tvl_snapshot, elapsed)?;
    if draw.player_tvl_lamports < live_threshold {
        return Err(FateError::ActivationThresholdNotMet);
    }
    mark_activated(draw, now, live_threshold)
}

fn mark_activated(draw: &mut Draw, now: i64, threshold: u64) -> Result<(), FateError> {
    draw.activation_threshold_lamports = threshold;
    draw.activated_at = now;
    draw.locks_at = now
        .checked_add(i64::try_from(COUNTDOWN_SECONDS).map_err(|_| FateError::ArithmeticOverflow)?)
        .ok_or(FateError::ArithmeticOverflow)?;
    draw.phase = DrawPhase::Activated.into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_is_constant_time_at_threshold() {
        let mut draw = Draw {
            phase: DrawPhase::Funding.into(),
            first_player_at: 1_000,
            staker_tvl_snapshot: 100 * LAMPORTS_PER_SOL,
            player_tvl_lamports: LAMPORTS_PER_SOL,
            total_player_weight: U128Value::new(LAMPORTS_PER_SOL as u128),
            ..Draw::zeroed()
        };
        activate_draw_state(&mut draw, 1_000).unwrap();
        assert_eq!(draw.phase(), Some(DrawPhase::Activated));
    }
}
