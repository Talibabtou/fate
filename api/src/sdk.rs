use steel::*;

use crate::{instruction::*, state::*};

pub fn initialize(
    program_id: Pubkey,
    payer: Pubkey,
    authority: Pubkey,
    fee_treasury: Pubkey,
    entropy_program: Pubkey,
    entropy_variable: Pubkey,
) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new_readonly(fee_treasury, false),
            AccountMeta::new_readonly(entropy_program, false),
            AccountMeta::new_readonly(entropy_variable, false),
            AccountMeta::new(config_pda(&program_id).0, false),
            AccountMeta::new(staker_vault_pda(&program_id).0, false),
            AccountMeta::new(staker_registry_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, 0).0, false),
            AccountMeta::new(player_registry_pda(&program_id, 0).0, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: Initialize {}.to_bytes(),
    }
}

pub fn deposit_stake(program_id: Pubkey, staker: Pubkey, draw_id: u64, amount: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(staker, true),
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new_readonly(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(staker_vault_pda(&program_id).0, false),
            AccountMeta::new(staker_registry_pda(&program_id).0, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: DepositStake {
            amount: amount.to_le_bytes(),
        }
        .to_bytes(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_builder_uses_canonical_pdas_and_privileges() {
        let program_id = Pubkey::new_unique();
        let payer = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let fee_treasury = Pubkey::new_unique();
        let entropy_program = Pubkey::new_unique();
        let entropy_variable = Pubkey::new_unique();
        let instruction = initialize(
            program_id,
            payer,
            authority,
            fee_treasury,
            entropy_program,
            entropy_variable,
        );

        assert_eq!(instruction.program_id, program_id);
        assert_eq!(instruction.accounts.len(), 11);
        assert_eq!(instruction.accounts[0], AccountMeta::new(payer, true));
        assert_eq!(
            instruction.accounts[1],
            AccountMeta::new_readonly(authority, true)
        );
        assert_eq!(instruction.accounts[5].pubkey, config_pda(&program_id).0);
        assert_eq!(
            instruction.accounts[6].pubkey,
            staker_vault_pda(&program_id).0
        );
        assert_eq!(
            instruction.accounts[7].pubkey,
            staker_registry_pda(&program_id).0
        );
        assert_eq!(instruction.accounts[8].pubkey, draw_pda(&program_id, 0).0);
        assert_eq!(
            instruction.accounts[9].pubkey,
            player_registry_pda(&program_id, 0).0
        );
        assert_eq!(instruction.accounts[10].pubkey, system_program::ID);
        assert_eq!(instruction.data, Initialize {}.to_bytes());
    }

    #[test]
    fn stake_deposit_builder_is_scoped_to_the_current_draw() {
        let program_id = Pubkey::new_unique();
        let staker = Pubkey::new_unique();
        let instruction = deposit_stake(program_id, staker, 7, 123);

        assert_eq!(instruction.accounts.len(), 6);
        assert_eq!(instruction.accounts[0], AccountMeta::new(staker, true));
        assert_eq!(instruction.accounts[1].pubkey, config_pda(&program_id).0);
        assert_eq!(instruction.accounts[2].pubkey, draw_pda(&program_id, 7).0);
        assert_eq!(
            instruction.accounts[3].pubkey,
            staker_vault_pda(&program_id).0
        );
        assert_eq!(
            instruction.accounts[4].pubkey,
            staker_registry_pda(&program_id).0
        );
    }
}
