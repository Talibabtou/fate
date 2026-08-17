// Solana's entrypoint macro emits target cfgs that host Rust does not know about.
#![allow(unexpected_cfgs)]

mod deposit_stake;
mod initialize;

use deposit_stake::*;
use fate_api::prelude::*;
use initialize::*;
use steel::*;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let (instruction, data) = parse_instruction::<FateInstruction>(program_id, program_id, data)?;

    match instruction {
        FateInstruction::Initialize => process_initialize(program_id, accounts, data),
        FateInstruction::DepositStake => process_deposit_stake(program_id, accounts, data),
    }
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
