use steel::*;

use crate::{consts::MAX_PLAYERS_PER_DRAW, error::FateError};

use super::{FateAccount, U128Value};

pub const PLAYER_STATUS_OCCUPIED: u64 = 1 << 0;
pub const PLAYER_STATUS_CLAIMABLE: u64 = 1 << 1;
pub const PLAYER_STATUS_CLAIMED: u64 = 1 << 2;

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct PlayerEntry {
    pub authority: Pubkey,
    pub refundable_deposit_lamports: u64,
    pub committed_deposit_lamports: u64,
    pub boosted_weight: U128Value,
    pub claimable_lamports: u64,
    pub claimed_lamports: u64,
    pub status: u64,
}

impl PlayerEntry {
    pub fn is_occupied(&self) -> bool {
        self.status & PLAYER_STATUS_OCCUPIED != 0
    }

    pub fn add_refundable_deposit(
        &mut self,
        deposit_lamports: u64,
        boosted_weight: u128,
    ) -> Result<(), FateError> {
        self.refundable_deposit_lamports = self
            .refundable_deposit_lamports
            .checked_add(deposit_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.boosted_weight = U128Value::new(
            self.boosted_weight
                .get()
                .checked_add(boosted_weight)
                .ok_or(FateError::ArithmeticOverflow)?,
        );
        Ok(())
    }

    pub fn commit_pending(&mut self) -> Result<(), FateError> {
        self.committed_deposit_lamports = self
            .committed_deposit_lamports
            .checked_add(self.refundable_deposit_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.refundable_deposit_lamports = 0;
        Ok(())
    }

    pub fn add_committed_deposit(
        &mut self,
        deposit_lamports: u64,
        boosted_weight: u128,
    ) -> Result<(), FateError> {
        self.committed_deposit_lamports = self
            .committed_deposit_lamports
            .checked_add(deposit_lamports)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.boosted_weight = U128Value::new(
            self.boosted_weight
                .get()
                .checked_add(boosted_weight)
                .ok_or(FateError::ArithmeticOverflow)?,
        );
        Ok(())
    }

    pub fn refund_pending(&mut self) -> Result<u64, FateError> {
        if self.committed_deposit_lamports != 0 {
            return Err(FateError::PlayerFundsCommitted);
        }
        let refund = self.refundable_deposit_lamports;
        self.refundable_deposit_lamports = 0;
        self.boosted_weight = U128Value::default();
        Ok(refund)
    }

    pub fn credit_claim(&mut self, amount: u64) -> Result<(), FateError> {
        self.claimable_lamports = self
            .claimable_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.status |= PLAYER_STATUS_CLAIMABLE;
        Ok(())
    }

    pub fn take_claim(&mut self) -> Result<u64, FateError> {
        let amount = self.claimable_lamports;
        let claimed_lamports = self
            .claimed_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.claimable_lamports = 0;
        self.claimed_lamports = claimed_lamports;
        self.status &= !PLAYER_STATUS_CLAIMABLE;
        if amount != 0 {
            self.status |= PLAYER_STATUS_CLAIMED;
        }
        Ok(amount)
    }

    pub fn is_empty_position(&self) -> bool {
        self.refundable_deposit_lamports == 0
            && self.committed_deposit_lamports == 0
            && self.claimable_lamports == 0
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct PlayerRegistry {
    pub draw_id: u64,
    pub occupied_entries: u64,
    pub entries: [PlayerEntry; MAX_PLAYERS_PER_DRAW],
}

impl PlayerRegistry {
    pub fn find_index(&self, authority: &Pubkey) -> Option<usize> {
        self.entries
            .iter()
            .position(|entry| entry.is_occupied() && entry.authority == *authority)
    }

    pub fn get_or_insert(&mut self, authority: Pubkey) -> Result<&mut PlayerEntry, FateError> {
        if let Some(index) = self.find_index(&authority) {
            return Ok(&mut self.entries[index]);
        }

        let index = self
            .entries
            .iter()
            .position(|entry| !entry.is_occupied())
            .ok_or(FateError::RegistryFull)?;
        let entry = &mut self.entries[index];
        *entry = PlayerEntry::zeroed();
        entry.authority = authority;
        entry.status = PLAYER_STATUS_OCCUPIED;
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

        self.entries[index] = PlayerEntry::zeroed();
        self.occupied_entries = self
            .occupied_entries
            .checked_sub(1)
            .ok_or(FateError::ArithmeticOverflow)?;
        Ok(true)
    }
}

account!(FateAccount, PlayerRegistry);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wallet_deposits_aggregate_before_commitment() {
        let mut registry = Box::new(PlayerRegistry::zeroed());
        registry.draw_id = 9;
        let wallet = Pubkey::new_unique();
        let player = registry.get_or_insert(wallet).unwrap();
        player.add_refundable_deposit(10, 15).unwrap();
        player.add_refundable_deposit(20, 25).unwrap();
        assert_eq!(player.refundable_deposit_lamports, 30);
        assert_eq!(player.boosted_weight.get(), 40);

        player.commit_pending().unwrap();
        assert_eq!(player.refundable_deposit_lamports, 0);
        assert_eq!(player.committed_deposit_lamports, 30);
        assert_eq!(registry.occupied_entries, 1);
    }

    #[test]
    fn committed_funds_cannot_use_the_refund_path() {
        let mut player = PlayerEntry::zeroed();
        player.refundable_deposit_lamports = 5;
        player.committed_deposit_lamports = 10;
        assert_eq!(
            player.refund_pending(),
            Err(FateError::PlayerFundsCommitted)
        );
        assert_eq!(player.refundable_deposit_lamports, 5);
    }

    #[test]
    fn countdown_deposit_is_committed_immediately() {
        let mut player = PlayerEntry::zeroed();
        player.add_committed_deposit(10, 15).unwrap();
        player.add_committed_deposit(20, 25).unwrap();
        assert_eq!(player.refundable_deposit_lamports, 0);
        assert_eq!(player.committed_deposit_lamports, 30);
        assert_eq!(player.boosted_weight.get(), 40);
    }

    #[test]
    fn claim_can_be_taken_only_once() {
        let mut player = PlayerEntry::zeroed();
        player.credit_claim(42).unwrap();
        assert_eq!(player.take_claim(), Ok(42));
        assert_eq!(player.take_claim(), Ok(0));
        assert_eq!(player.claimed_lamports, 42);
    }

    #[test]
    fn account_size_remains_bounded() {
        assert_eq!(PlayerRegistry::SIZE, 11_288);
    }

    #[test]
    fn registry_rejects_the_129th_wallet() {
        let mut registry = Box::new(PlayerRegistry::zeroed());
        for _ in 0..MAX_PLAYERS_PER_DRAW {
            registry.get_or_insert(Pubkey::new_unique()).unwrap();
        }
        assert_eq!(
            registry.get_or_insert(Pubkey::new_unique()),
            Err(FateError::RegistryFull)
        );
    }
}
