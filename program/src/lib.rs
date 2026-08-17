// Solana's entrypoint macro emits target cfgs that host Rust does not know about.
#![allow(unexpected_cfgs)]

mod activate_draw;
mod claim_player;
mod claim_stake_withdrawal;
mod close_draw;
mod close_player_position;
mod close_weight_page;
mod deposit_player;
mod deposit_stake;
mod initialize;
mod lock_draw;
mod refund_player;
mod request_stake_withdrawal;
mod set_pause;
#[cfg(feature = "dev-randomness")]
mod settle_draw_dev;
mod weight_tree;

use activate_draw::*;
use claim_player::*;
use claim_stake_withdrawal::*;
use close_draw::*;
use close_player_position::*;
use close_weight_page::*;
use deposit_player::*;
use deposit_stake::*;
use fate_api::prelude::*;
use initialize::*;
use lock_draw::*;
use refund_player::*;
use request_stake_withdrawal::*;
use set_pause::*;
#[cfg(feature = "dev-randomness")]
use settle_draw_dev::*;
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
        FateInstruction::Pause => process_set_pause(program_id, accounts, data, true),
        FateInstruction::Unpause => process_set_pause(program_id, accounts, data, false),
        FateInstruction::ClaimPlayer => process_claim_player(program_id, accounts, data),
        FateInstruction::ClaimStakeWithdrawal => {
            process_claim_stake_withdrawal(program_id, accounts, data)
        }
        FateInstruction::ReservedGrowProgramAccounts => Err(ProgramError::InvalidInstructionData),
        FateInstruction::LockDraw => process_lock_draw(program_id, accounts, data),
        FateInstruction::SettleDrawDev => {
            #[cfg(feature = "dev-randomness")]
            {
                process_settle_draw_dev(program_id, accounts, data)
            }
            #[cfg(not(feature = "dev-randomness"))]
            {
                let _ = (accounts, data);
                Err(ProgramError::InvalidInstructionData)
            }
        }
        FateInstruction::ReservedClosePlayerRegistry => Err(ProgramError::InvalidInstructionData),
        FateInstruction::CloseDraw => process_close_draw(program_id, accounts, data),
        FateInstruction::ClosePlayerPosition => {
            process_close_player_position(program_id, accounts, data)
        }
        FateInstruction::CloseWeightPage => process_close_weight_page(program_id, accounts, data),
    }
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

#[cfg(all(test, not(feature = "dev-randomness")))]
mod production_tests {
    use super::*;

    #[test]
    fn production_build_rejects_dev_settlement() {
        assert_eq!(
            process_instruction(&Pubkey::new_unique(), &[], &SettleDrawDev {}.to_bytes()),
            Err(ProgramError::InvalidInstructionData)
        );
    }
}
