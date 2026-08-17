use fate_api::prelude::*;
use solana_program::{rent::Rent, sysvar::Sysvar};
use steel::*;

pub fn process_claim_player(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let args = ClaimPlayer::try_from_bytes(data)?;
    let draw_id = u64::from_le_bytes(args.draw_id);

    let [player_info, draw_info, player_registry_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    player_info.is_signer()?.is_writable()?;
    if player_info.key == draw_info.key
        || player_info.key == player_registry_info.key
        || draw_info.key == player_registry_info.key
    {
        return Err(ProgramError::InvalidArgument);
    }
    let draw_id_bytes = draw_id.to_le_bytes();
    draw_info
        .is_writable()?
        .has_seeds(&[DRAW_SEED, &draw_id_bytes], program_id)?;
    player_registry_info
        .is_writable()?
        .has_seeds(&[PLAYER_REGISTRY_SEED, &draw_id_bytes], program_id)?;

    let draw = draw_info.as_account::<Draw>(program_id)?;
    let registry = player_registry_info.as_account::<PlayerRegistry>(program_id)?;
    if draw.id != draw_id || registry.draw_id != draw_id || draw.phase() != Some(DrawPhase::Settled)
    {
        return Err(FateError::InvalidDraw.into());
    }
    let entry_index = registry
        .find_index(player_info.key)
        .ok_or(FateError::PlayerPositionNotFound)?;
    let claim_lamports = registry.entries[entry_index].claimable_lamports;
    if claim_lamports == 0 {
        return Err(FateError::NothingToClaim.into());
    }
    draw.outstanding_player_claim_lamports
        .checked_sub(claim_lamports)
        .ok_or(FateError::InvalidDraw)?;
    player_info
        .lamports()
        .checked_add(claim_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    let registry_after = player_registry_info
        .lamports()
        .checked_sub(claim_lamports)
        .ok_or(FateError::InsufficientCustody)?;
    let tracked_after = draw
        .player_tvl_lamports
        .checked_add(
            draw.outstanding_player_claim_lamports
                .checked_sub(claim_lamports)
                .ok_or(FateError::InvalidDraw)?,
        )
        .ok_or(FateError::ArithmeticOverflow)?;
    let rent_reserve = Rent::get()?.minimum_balance(PlayerRegistry::SIZE);
    if registry_after.saturating_sub(rent_reserve) < tracked_after {
        return Err(FateError::InsufficientCustody.into());
    }

    let draw = draw_info.as_account_mut::<Draw>(program_id)?;
    let registry = player_registry_info.as_account_mut::<PlayerRegistry>(program_id)?;
    apply_player_claim(draw, registry, player_info.key, claim_lamports)?;
    player_registry_info.send(claim_lamports, player_info);

    let tracked_assets = draw
        .player_tvl_lamports
        .checked_add(draw.outstanding_player_claim_lamports)
        .ok_or(FateError::ArithmeticOverflow)?;
    if player_registry_info.lamports().saturating_sub(rent_reserve) < tracked_assets {
        return Err(FateError::InsufficientCustody.into());
    }

    Ok(())
}

fn apply_player_claim(
    draw: &mut Draw,
    registry: &mut PlayerRegistry,
    authority: &Pubkey,
    expected_claim_lamports: u64,
) -> Result<(), FateError> {
    let entry_index = registry
        .find_index(authority)
        .ok_or(FateError::PlayerPositionNotFound)?;
    if registry.entries[entry_index].claimable_lamports != expected_claim_lamports {
        return Err(FateError::NothingToClaim);
    }
    let claim_lamports = registry.entries[entry_index].take_claim()?;
    if claim_lamports == 0 {
        return Err(FateError::NothingToClaim);
    }
    draw.outstanding_player_claim_lamports = draw
        .outstanding_player_claim_lamports
        .checked_sub(claim_lamports)
        .ok_or(FateError::InvalidDraw)?;
    registry.release_if_empty(authority)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_is_paid_once_and_reduces_the_draw_liability() {
        let authority = Pubkey::new_unique();
        let mut draw = Draw {
            phase: DrawPhase::Settled.into(),
            outstanding_player_claim_lamports: 42,
            ..Draw::zeroed()
        };
        let mut registry = Box::new(PlayerRegistry::zeroed());
        registry
            .get_or_insert(authority)
            .unwrap()
            .credit_claim(42)
            .unwrap();

        apply_player_claim(&mut draw, &mut registry, &authority, 42).unwrap();

        assert_eq!(draw.outstanding_player_claim_lamports, 0);
        assert!(registry.find_index(&authority).is_none());
        assert_eq!(
            apply_player_claim(&mut draw, &mut registry, &authority, 42),
            Err(FateError::PlayerPositionNotFound)
        );
    }

    #[test]
    fn claim_rejects_a_mismatched_recorded_amount() {
        let authority = Pubkey::new_unique();
        let mut draw = Draw {
            phase: DrawPhase::Settled.into(),
            outstanding_player_claim_lamports: 42,
            ..Draw::zeroed()
        };
        let mut registry = Box::new(PlayerRegistry::zeroed());
        registry
            .get_or_insert(authority)
            .unwrap()
            .credit_claim(42)
            .unwrap();

        assert_eq!(
            apply_player_claim(&mut draw, &mut registry, &authority, 41),
            Err(FateError::NothingToClaim)
        );
    }
}
