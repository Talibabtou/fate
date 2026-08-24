use fate_api::prelude::*;
use solana_program::sysvar::Sysvar;
use steel::*;

pub fn process_lock_draw(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    LockDraw::try_from_bytes(data)?;

    let [config_info, draw_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if config_info.is_writable || config_info.key == draw_info.key {
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

    let draw = draw_info.as_account::<Draw>(program_id)?;
    let now = Clock::get()?.unix_timestamp;
    validate_lock(draw, config.current_draw_id, now)?;

    draw_info.as_account_mut::<Draw>(program_id)?.phase = DrawPhase::Locked.into();
    let draw = draw_info.as_account::<Draw>(program_id)?;
    LockEvent {
        kind: EVENT_LOCK,
        reserved: [0; 7],
        draw_id: draw.id,
        locked_at: now,
        player_tvl_lamports: draw.player_tvl_lamports,
        staker_tvl_snapshot_lamports: draw.staker_tvl_snapshot,
    }
    .log();
    Ok(())
}

fn validate_lock(draw: &Draw, current_draw_id: u64, now: i64) -> Result<(), FateError> {
    if draw.id != current_draw_id
        || draw.phase() != Some(DrawPhase::Activated)
        || draw.locks_at <= 0
    {
        return Err(FateError::InvalidDraw);
    }
    if now < draw.locks_at {
        return Err(FateError::CountdownActive);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_is_allowed_at_the_exact_deadline() {
        let draw = Draw {
            id: 7,
            phase: DrawPhase::Activated.into(),
            locks_at: 1_000,
            ..Draw::zeroed()
        };
        assert_eq!(
            validate_lock(&draw, 7, 999),
            Err(FateError::CountdownActive)
        );
        assert_eq!(validate_lock(&draw, 7, 1_000), Ok(()));
    }
}
