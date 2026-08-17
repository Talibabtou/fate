// Solana's entrypoint macro emits target cfgs that host Rust does not know about.
#![allow(unexpected_cfgs)]

use steel::*;

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo<'_>],
    _data: &[u8],
) -> ProgramResult {
    Err(ProgramError::InvalidInstructionData)
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
