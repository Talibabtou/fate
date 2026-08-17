mod config;
mod draw;
mod player;
mod staker;

pub use config::*;
pub use draw::*;
pub use player::*;
pub use staker::*;

use num_enum::{IntoPrimitive, TryFromPrimitive};
use solana_program::pubkey::Pubkey;
use steel::*;

use crate::consts::*;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum FateAccount {
    Config = 100,
    StakerVault = 101,
    StakerRegistry = 102,
    Draw = 103,
    PlayerRegistry = 104,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Pod, Zeroable)]
pub struct U128Value {
    pub low: u64,
    pub high: u64,
}

impl U128Value {
    pub const fn new(value: u128) -> Self {
        Self {
            low: value as u64,
            high: (value >> 64) as u64,
        }
    }

    pub const fn get(self) -> u128 {
        self.low as u128 | ((self.high as u128) << 64)
    }
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn staker_vault_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKER_VAULT_SEED], program_id)
}

pub fn staker_registry_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKER_REGISTRY_SEED], program_id)
}

pub fn draw_pda(program_id: &Pubkey, draw_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[DRAW_SEED, &draw_id.to_le_bytes()], program_id)
}

pub fn player_registry_pda(program_id: &Pubkey, draw_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PLAYER_REGISTRY_SEED, &draw_id.to_le_bytes()], program_id)
}

pub fn entropy_authority_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ENTROPY_AUTHORITY_SEED], program_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u128_storage_round_trips() {
        for value in [0, 1, u128::from(u64::MAX), u128::MAX] {
            assert_eq!(U128Value::new(value).get(), value);
        }
    }

    #[test]
    fn pda_domains_are_distinct_and_draw_scoped() {
        let program_id = Pubkey::new_unique();
        let addresses = [
            config_pda(&program_id).0,
            staker_vault_pda(&program_id).0,
            staker_registry_pda(&program_id).0,
            draw_pda(&program_id, 7).0,
            player_registry_pda(&program_id, 7).0,
            entropy_authority_pda(&program_id).0,
        ];

        for (index, address) in addresses.iter().enumerate() {
            assert!(!addresses[..index].contains(address));
        }
        assert_ne!(draw_pda(&program_id, 7), draw_pda(&program_id, 8));
        assert_ne!(
            player_registry_pda(&program_id, 7),
            player_registry_pda(&program_id, 8)
        );
    }
}
