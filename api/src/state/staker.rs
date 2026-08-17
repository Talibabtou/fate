use steel::*;

use crate::{error::FateError, math::mul_div_floor};

use super::FateAccount;

pub const STAKER_STATUS_INITIALIZED: u64 = 1 << 0;
pub const STAKER_STATUS_WITHDRAWAL_CLAIMABLE: u64 = 1 << 1;

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct StakerVault {
    pub active_assets_lamports: u64,
    pub withdrawal_liability_lamports: u64,
    pub total_shares: u64,
    pub lifetime_player_losses_lamports: u64,
    pub lifetime_erosion_lamports: u64,
    pub next_position_index: u64,
}

impl StakerVault {
    pub fn preview_deposit_shares(&self, deposit_lamports: u64) -> Result<u64, FateError> {
        if self.total_shares == 0 {
            return Ok(deposit_lamports);
        }
        if self.active_assets_lamports == 0 {
            return Err(FateError::InvalidShareAmount);
        }
        mul_div_floor(
            deposit_lamports,
            self.total_shares,
            self.active_assets_lamports,
        )
    }

    pub fn preview_withdrawal_lamports(&self, shares: u64) -> Result<u64, FateError> {
        if shares > self.total_shares || self.total_shares == 0 {
            return Err(FateError::InvalidShareAmount);
        }
        mul_div_floor(shares, self.active_assets_lamports, self.total_shares)
    }
}

account!(FateAccount, StakerVault);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct StakerPosition {
    pub authority: Pubkey,
    pub rent_payer: Pubkey,
    pub active_shares: u64,
    pub claimable_withdrawal_lamports: u64,
    pub lifetime_deposited_lamports: u64,
    pub leaf_index: u64,
    pub status: u64,
}

impl StakerPosition {
    pub fn is_initialized(&self) -> bool {
        self.status & STAKER_STATUS_INITIALIZED != 0
    }

    pub fn credit_claim(&mut self, amount: u64) -> Result<(), FateError> {
        self.claimable_withdrawal_lamports = self
            .claimable_withdrawal_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.status |= STAKER_STATUS_WITHDRAWAL_CLAIMABLE;
        Ok(())
    }

    pub fn take_claim(&mut self) -> Result<u64, FateError> {
        let amount = self.claimable_withdrawal_lamports;
        self.claimable_withdrawal_lamports = 0;
        self.status &= !STAKER_STATUS_WITHDRAWAL_CLAIMABLE;
        Ok(amount)
    }
}

account!(FateAccount, StakerPosition);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consts::LAMPORTS_PER_SOL;

    #[test]
    fn share_price_tracks_gains_and_erosion() {
        let mut vault = StakerVault {
            active_assets_lamports: 100 * LAMPORTS_PER_SOL,
            total_shares: 100 * LAMPORTS_PER_SOL,
            ..StakerVault::zeroed()
        };
        assert_eq!(
            vault.preview_deposit_shares(10 * LAMPORTS_PER_SOL),
            Ok(10 * LAMPORTS_PER_SOL)
        );
        vault.active_assets_lamports += 10 * LAMPORTS_PER_SOL;
        assert_eq!(
            vault.preview_withdrawal_lamports(10 * LAMPORTS_PER_SOL),
            Ok(11 * LAMPORTS_PER_SOL)
        );
        vault.active_assets_lamports -= 20 * LAMPORTS_PER_SOL;
        assert_eq!(
            vault.preview_withdrawal_lamports(10 * LAMPORTS_PER_SOL),
            Ok(9 * LAMPORTS_PER_SOL)
        );
    }

    #[test]
    fn account_sizes_are_stable() {
        assert_eq!(StakerVault::SIZE, 56);
        assert_eq!(StakerPosition::SIZE, 112);
    }
}
