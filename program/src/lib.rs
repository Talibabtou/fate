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

#[cfg(test)]
mod malformed_input_tests {
    use super::*;

    #[test]
    fn rejects_empty_and_unknown_instruction_data() {
        let program_id = Pubkey::new_unique();

        assert_eq!(
            process_instruction(&program_id, &[], &[]),
            Err(ProgramError::InvalidInstructionData)
        );
        assert_eq!(
            process_instruction(&program_id, &[], &[u8::MAX]),
            Err(ProgramError::InvalidInstructionData)
        );
    }

    #[test]
    fn every_instruction_rejects_an_empty_account_slice() {
        let program_id = Pubkey::new_unique();
        let instructions = [
            Initialize {}.to_bytes(),
            DepositStake { amount: [0; 8] }.to_bytes(),
            RequestStakeWithdrawal { shares: [0; 8] }.to_bytes(),
            DepositPlayer { amount: [0; 8] }.to_bytes(),
            RefundPlayer {}.to_bytes(),
            ActivateDraw {}.to_bytes(),
            Pause {}.to_bytes(),
            Unpause {}.to_bytes(),
            ClaimPlayer { draw_id: [0; 8] }.to_bytes(),
            ClaimStakeWithdrawal {}.to_bytes(),
            LockDraw {}.to_bytes(),
            SettleDrawDev {}.to_bytes(),
            CloseDraw { draw_id: [0; 8] }.to_bytes(),
            ClosePlayerPosition { draw_id: [0; 8] }.to_bytes(),
            CloseWeightPage { draw_id: [0; 8] }.to_bytes(),
        ];

        for data in instructions {
            assert!(
                process_instruction(&program_id, &[], &data).is_err(),
                "malformed account list unexpectedly succeeded for tag {}",
                data[0]
            );
        }
    }

    #[test]
    fn every_instruction_rejects_truncated_wire_data() {
        let program_id = Pubkey::new_unique();
        let instructions = [
            Initialize {}.to_bytes(),
            DepositStake { amount: [0; 8] }.to_bytes(),
            RequestStakeWithdrawal { shares: [0; 8] }.to_bytes(),
            DepositPlayer { amount: [0; 8] }.to_bytes(),
            RefundPlayer {}.to_bytes(),
            ActivateDraw {}.to_bytes(),
            Pause {}.to_bytes(),
            Unpause {}.to_bytes(),
            ClaimPlayer { draw_id: [0; 8] }.to_bytes(),
            ClaimStakeWithdrawal {}.to_bytes(),
            LockDraw {}.to_bytes(),
            SettleDrawDev {}.to_bytes(),
            CloseDraw { draw_id: [0; 8] }.to_bytes(),
            ClosePlayerPosition { draw_id: [0; 8] }.to_bytes(),
            CloseWeightPage { draw_id: [0; 8] }.to_bytes(),
        ];

        for data in instructions {
            if data.len() > 1 {
                assert!(
                    process_instruction(&program_id, &[], &data[..data.len() - 1]).is_err(),
                    "truncated instruction unexpectedly parsed for tag {}",
                    data[0]
                );
            }
        }
    }

    #[test]
    fn every_account_decode_rejects_wrong_owner_length_and_discriminator() {
        let program_id = Pubkey::new_unique();
        let key = Pubkey::new_unique();
        let mut lamports = 1;

        let mut wrong_owner_data = vec![0; 8 + std::mem::size_of::<Config>()];
        let wrong_owner = Pubkey::new_unique();
        let wrong_owner_account = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut wrong_owner_data,
            &wrong_owner,
            false,
            0,
        );
        assert!(wrong_owner_account
            .as_account::<Config>(&program_id)
            .is_err());

        let mut wrong_length_data = vec![0; 8 + std::mem::size_of::<Config>() - 1];
        let correct_account = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut wrong_length_data,
            &program_id,
            false,
            0,
        );
        assert!(correct_account.as_account::<Config>(&program_id).is_err());

        let mut wrong_discriminator_data = vec![0; 8 + std::mem::size_of::<Config>()];
        wrong_discriminator_data[0] = Config::discriminator().wrapping_add(1);
        let wrong_discriminator_account = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut wrong_discriminator_data,
            &program_id,
            false,
            0,
        );
        assert!(wrong_discriminator_account
            .as_account::<Config>(&program_id)
            .is_err());
    }
}
