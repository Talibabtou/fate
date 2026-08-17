use steel::*;

use crate::{consts::MAX_STAKERS, error::FateError, math::mul_div_floor};

use super::FateAccount;

pub const STAKER_STATUS_OCCUPIED: u64 = 1 << 0;
pub const STAKER_STATUS_WITHDRAWAL_QUEUED: u64 = 1 << 1;

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct StakerVault {
    pub active_assets_lamports: u64,
    pub pending_assets_lamports: u64,
    pub total_shares: u64,
    pub queued_withdrawal_shares: u64,
    pub lifetime_player_losses_lamports: u64,
    pub lifetime_erosion_lamports: u64,
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
pub struct StakerEntry {
    pub authority: Pubkey,
    pub active_shares: u64,
    pub pending_deposit_lamports: u64,
    pub queued_withdrawal_shares: u64,
    pub lifetime_deposited_lamports: u64,
    pub status: u64,
}

impl StakerEntry {
    pub fn is_occupied(&self) -> bool {
        self.status & STAKER_STATUS_OCCUPIED != 0
    }

    pub fn is_empty_position(&self) -> bool {
        self.active_shares == 0
            && self.pending_deposit_lamports == 0
            && self.queued_withdrawal_shares == 0
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct StakerRegistry {
    pub occupied_entries: u64,
    pub entries: [StakerEntry; MAX_STAKERS],
}

impl StakerRegistry {
    pub fn find_index(&self, authority: &Pubkey) -> Option<usize> {
        self.entries
            .iter()
            .position(|entry| entry.is_occupied() && entry.authority == *authority)
    }

    pub fn get_or_insert(&mut self, authority: Pubkey) -> Result<&mut StakerEntry, FateError> {
        if let Some(index) = self.find_index(&authority) {
            return Ok(&mut self.entries[index]);
        }

        let index = self
            .entries
            .iter()
            .position(|entry| !entry.is_occupied())
            .ok_or(FateError::RegistryFull)?;
        let entry = &mut self.entries[index];
        *entry = StakerEntry::zeroed();
        entry.authority = authority;
        entry.status = STAKER_STATUS_OCCUPIED;
        self.occupied_entries = self
            .occupied_entries
            .checked_add(1)
            .ok_or(FateError::ArithmeticOverflow)?;
        Ok(entry)
    }

    pub fn release_if_empty(&mut self, authority: &Pubkey) -> Result<bool, FateError> {
        let Some(index) = self.find_index(authority) else {
            return Ok(false);
        };
        if !self.entries[index].is_empty_position() {
            return Ok(false);
        }

        self.entries[index] = StakerEntry::zeroed();
        self.occupied_entries = self
            .occupied_entries
            .checked_sub(1)
            .ok_or(FateError::ArithmeticOverflow)?;
        Ok(true)
    }
}

account!(FateAccount, StakerRegistry);

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
    fn registry_aggregates_one_entry_per_wallet_and_reuses_empty_slots() {
        let mut registry = Box::new(StakerRegistry::zeroed());
        let wallet = Pubkey::new_unique();
        registry.get_or_insert(wallet).unwrap().active_shares = 10;
        registry.get_or_insert(wallet).unwrap().active_shares += 5;
        assert_eq!(registry.occupied_entries, 1);
        assert_eq!(registry.find_index(&wallet), Some(0));
        assert_eq!(registry.entries[0].active_shares, 15);

        registry.entries[0].active_shares = 0;
        assert_eq!(registry.release_if_empty(&wallet), Ok(true));
        assert_eq!(registry.occupied_entries, 0);
        assert_eq!(registry.find_index(&wallet), None);
    }

    #[test]
    fn account_sizes_remain_bounded() {
        assert_eq!(StakerVault::SIZE, 56);
        assert_eq!(StakerRegistry::SIZE, 36_880);
    }
}
