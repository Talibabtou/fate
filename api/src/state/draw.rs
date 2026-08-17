use num_enum::{IntoPrimitive, TryFromPrimitive};
use steel::*;

use super::{FateAccount, U128Value};

#[repr(u64)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum DrawPhase {
    Funding = 0,
    Activated = 1,
    Locked = 2,
    AwaitingRandomness = 3,
    Settled = 4,
    Voided = 5,
}

#[repr(u64)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum WinnerSide {
    None = 0,
    Player = 1,
    Staker = 2,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct Draw {
    pub winner: Pubkey,
    pub entropy_variable: Pubkey,
    pub rent_payer: Pubkey,
    pub entropy_value: [u8; 32],
    pub id: u64,
    pub phase: u64,
    pub created_at: i64,
    pub first_player_at: i64,
    pub activated_at: i64,
    pub locks_at: i64,
    pub settled_at: i64,
    pub staker_tvl_snapshot: u64,
    pub initial_threshold_lamports: u64,
    pub activation_threshold_lamports: u64,
    pub player_tvl_lamports: u64,
    pub total_player_weight: U128Value,
    pub entropy_end_at: u64,
    pub entropy_generation: u64,
    pub winner_side: u64,
    pub winner_deposit_lamports: u64,
    pub winner_payout_lamports: u64,
    pub outstanding_player_claim_lamports: u64,
    pub protocol_fee_lamports: u64,
    pub staker_erosion_lamports: u64,
    pub entropy_sample_valid: u64,
    pub void_reason: u64,
    pub next_player_index: u64,
    pub open_player_positions: u64,
    pub open_weight_pages: u64,
}

impl Draw {
    pub fn phase(&self) -> Option<DrawPhase> {
        DrawPhase::try_from(self.phase).ok()
    }

    pub fn winner_side(&self) -> Option<WinnerSide> {
        WinnerSide::try_from(self.winner_side).ok()
    }

    pub fn deposits_open(&self) -> bool {
        matches!(
            self.phase(),
            Some(DrawPhase::Funding | DrawPhase::Activated)
        )
    }

    pub fn player_refunds_open(&self) -> bool {
        self.phase() == Some(DrawPhase::Funding)
    }
}

account!(FateAccount, Draw);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_helpers_fail_closed_for_unknown_values() {
        let mut draw = Draw::zeroed();
        assert_eq!(draw.phase(), Some(DrawPhase::Funding));
        assert!(draw.deposits_open());
        assert!(draw.player_refunds_open());

        draw.phase = DrawPhase::Locked.into();
        assert!(!draw.deposits_open());
        assert!(!draw.player_refunds_open());

        draw.phase = u64::MAX;
        assert_eq!(draw.phase(), None);
        assert!(!draw.deposits_open());
        assert!(!draw.player_refunds_open());
    }

    #[test]
    fn account_size_is_stable() {
        assert_eq!(Draw::SIZE, 344);
    }
}
