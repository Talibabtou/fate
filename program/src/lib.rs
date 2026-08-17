// Solana's entrypoint macro emits target cfgs that host Rust does not know about.
#![allow(unexpected_cfgs)]

mod activate_draw;
mod deposit_player;
mod deposit_stake;
mod initialize;
mod refund_player;
mod request_stake_withdrawal;

use activate_draw::*;
use deposit_player::*;
use deposit_stake::*;
use fate_api::prelude::*;
use initialize::*;
use refund_player::*;
use request_stake_withdrawal::*;
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
        FateInstruction::RequestStakeWithdrawal => {
            process_request_stake_withdrawal(program_id, accounts, data)
        }
        FateInstruction::DepositPlayer => process_deposit_player(program_id, accounts, data),
        FateInstruction::RefundPlayer => process_refund_player(program_id, accounts, data),
        FateInstruction::ActivateDraw => process_activate_draw(program_id, accounts, data),
    }
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
