use steel::*;

use crate::error::FateError;

use super::{FateAccount, U128Value};

pub const PLAYER_STATUS_INITIALIZED: u64 = 1 << 0;
pub const PLAYER_STATUS_CLAIMABLE: u64 = 1 << 1;
pub const PLAYER_STATUS_CLAIMED: u64 = 1 << 2;

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct PlayerPosition {
    pub authority: Pubkey,
    pub rent_payer: Pubkey,
    pub boosted_weight: U128Value,
    pub draw_id: u64,
    pub refundable_deposit_lamports: u64,
    pub committed_deposit_lamports: u64,
    pub claimable_lamports: u64,
    pub claimed_lamports: u64,
    pub leaf_index: u64,
    pub status: u64,
}

impl PlayerPosition {
    pub fn is_initialized(&self) -> bool {
        self.status & PLAYER_STATUS_INITIALIZED != 0
    }

    pub fn add_refundable_deposit(&mut self, amount: u64, weight: u128) -> Result<(), FateError> {
        self.refundable_deposit_lamports = self
            .refundable_deposit_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.add_weight(weight)
    }

    pub fn add_committed_deposit(&mut self, amount: u64, weight: u128) -> Result<(), FateError> {
        self.committed_deposit_lamports = self
            .committed_deposit_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.add_weight(weight)
    }

    fn add_weight(&mut self, weight: u128) -> Result<(), FateError> {
        self.boosted_weight = U128Value::new(
            self.boosted_weight
                .get()
                .checked_add(weight)
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

    pub fn refund_pending(&mut self) -> Result<(u64, u128), FateError> {
        if self.committed_deposit_lamports != 0 {
            return Err(FateError::PlayerFundsCommitted);
        }
        let result = (self.refundable_deposit_lamports, self.boosted_weight.get());
        self.refundable_deposit_lamports = 0;
        self.boosted_weight = U128Value::default();
        Ok(result)
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
        self.claimable_lamports = 0;
        self.claimed_lamports = self
            .claimed_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.status &= !PLAYER_STATUS_CLAIMABLE;
        if amount != 0 {
            self.status |= PLAYER_STATUS_CLAIMED;
        }
        Ok(amount)
    }
}

account!(FateAccount, PlayerPosition);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposits_aggregate_in_one_wallet_position() {
        let mut position = PlayerPosition::zeroed();
        position.add_refundable_deposit(10, 15).unwrap();
        position.add_refundable_deposit(20, 25).unwrap();
        assert_eq!(position.refundable_deposit_lamports, 30);
        assert_eq!(position.boosted_weight.get(), 40);
        position.commit_pending().unwrap();
        assert_eq!(position.committed_deposit_lamports, 30);
    }

    #[test]
    fn account_size_is_stable() {
        assert_eq!(PlayerPosition::SIZE, 144);
    }
}
