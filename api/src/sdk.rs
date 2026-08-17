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

pub fn request_stake_withdrawal(
    program_id: Pubkey,
    staker: Pubkey,
    draw_id: u64,
    shares: u64,
) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(staker, true),
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(staker_vault_pda(&program_id).0, false),
            AccountMeta::new(staker_registry_pda(&program_id).0, false),
        ],
        data: RequestStakeWithdrawal {
            shares: shares.to_le_bytes(),
        }
        .to_bytes(),
    }
}

pub fn deposit_player(
    program_id: Pubkey,
    player: Pubkey,
    draw_id: u64,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(player, true),
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(player_registry_pda(&program_id, draw_id).0, false),
            AccountMeta::new_readonly(staker_vault_pda(&program_id).0, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: DepositPlayer {
            amount: amount.to_le_bytes(),
        }
        .to_bytes(),
    }
}

pub fn refund_player(program_id: Pubkey, player: Pubkey, draw_id: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(player, true),
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(player_registry_pda(&program_id, draw_id).0, false),
        ],
        data: RefundPlayer {}.to_bytes(),
    }
}

pub fn activate_draw(program_id: Pubkey, draw_id: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(player_registry_pda(&program_id, draw_id).0, false),
        ],
        data: ActivateDraw {}.to_bytes(),
    }
}

pub fn pause(program_id: Pubkey, authority: Pubkey) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(config_pda(&program_id).0, false),
        ],
        data: Pause {}.to_bytes(),
    }
}

pub fn unpause(program_id: Pubkey, authority: Pubkey) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(config_pda(&program_id).0, false),
        ],
        data: Unpause {}.to_bytes(),
    }
}

pub fn claim_player(program_id: Pubkey, player: Pubkey, draw_id: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(player, true),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(player_registry_pda(&program_id, draw_id).0, false),
        ],
        data: ClaimPlayer {
            draw_id: draw_id.to_le_bytes(),
        }
        .to_bytes(),
    }
}

pub fn claim_stake_withdrawal(program_id: Pubkey, staker: Pubkey) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(staker, true),
            AccountMeta::new(staker_vault_pda(&program_id).0, false),
            AccountMeta::new(staker_registry_pda(&program_id).0, false),
        ],
        data: ClaimStakeWithdrawal {}.to_bytes(),
    }
}

pub fn grow_program_accounts(
    program_id: Pubkey,
    payer: Pubkey,
    authority: Pubkey,
    step: u64,
) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(config_pda(&program_id).0, false),
            AccountMeta::new(staker_registry_pda(&program_id).0, false),
            AccountMeta::new(player_registry_pda(&program_id, 0).0, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: GrowProgramAccounts {
            step: step.to_le_bytes(),
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
    fn grow_builder_targets_the_genesis_registries() {
        let program_id = Pubkey::new_unique();
        let payer = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let instruction = grow_program_accounts(program_id, payer, authority, 3);

        assert_eq!(instruction.accounts.len(), 6);
        assert_eq!(instruction.accounts[0], AccountMeta::new(payer, true));
        assert_eq!(
            instruction.accounts[1],
            AccountMeta::new_readonly(authority, true)
        );
        assert_eq!(
            instruction.accounts[3].pubkey,
            staker_registry_pda(&program_id).0
        );
        assert_eq!(
            instruction.accounts[4].pubkey,
            player_registry_pda(&program_id, 0).0
        );
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

    #[test]
    fn stake_withdrawal_builder_can_update_the_current_draw_snapshot() {
        let program_id = Pubkey::new_unique();
        let staker = Pubkey::new_unique();
        let instruction = request_stake_withdrawal(program_id, staker, 7, 123);

        assert_eq!(instruction.accounts.len(), 5);
        assert_eq!(instruction.accounts[0], AccountMeta::new(staker, true));
        assert_eq!(instruction.accounts[1].pubkey, config_pda(&program_id).0);
        assert!(!instruction.accounts[1].is_writable);
        assert_eq!(instruction.accounts[2].pubkey, draw_pda(&program_id, 7).0);
        assert!(instruction.accounts[2].is_writable);
        assert_eq!(
            instruction.accounts[3].pubkey,
            staker_vault_pda(&program_id).0
        );
        assert_eq!(
            instruction.accounts[4].pubkey,
            staker_registry_pda(&program_id).0
        );
    }

    #[test]
    fn player_deposit_builder_targets_draw_scoped_custody() {
        let program_id = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let instruction = deposit_player(program_id, player, 7, 123);

        assert_eq!(instruction.accounts.len(), 6);
        assert_eq!(instruction.accounts[0], AccountMeta::new(player, true));
        assert_eq!(instruction.accounts[2].pubkey, draw_pda(&program_id, 7).0);
        assert_eq!(
            instruction.accounts[3].pubkey,
            player_registry_pda(&program_id, 7).0
        );
        assert!(instruction.accounts[3].is_writable);
        assert_eq!(
            instruction.accounts[4].pubkey,
            staker_vault_pda(&program_id).0
        );
        assert!(!instruction.accounts[4].is_writable);
    }

    #[test]
    fn player_refund_builder_has_no_pause_or_authority_dependency() {
        let program_id = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let instruction = refund_player(program_id, player, 7);

        assert_eq!(instruction.accounts.len(), 4);
        assert_eq!(instruction.accounts[0], AccountMeta::new(player, true));
        assert_eq!(instruction.accounts[1].pubkey, config_pda(&program_id).0);
        assert!(!instruction.accounts[1].is_writable);
        assert_eq!(instruction.accounts[2].pubkey, draw_pda(&program_id, 7).0);
        assert_eq!(
            instruction.accounts[3].pubkey,
            player_registry_pda(&program_id, 7).0
        );
    }

    #[test]
    fn activation_builder_is_permissionless() {
        let program_id = Pubkey::new_unique();
        let instruction = activate_draw(program_id, 7);

        assert_eq!(instruction.accounts.len(), 3);
        assert!(instruction
            .accounts
            .iter()
            .all(|account| !account.is_signer));
        assert_eq!(instruction.accounts[0].pubkey, config_pda(&program_id).0);
        assert_eq!(instruction.accounts[1].pubkey, draw_pda(&program_id, 7).0);
        assert_eq!(
            instruction.accounts[2].pubkey,
            player_registry_pda(&program_id, 7).0
        );
    }

    #[test]
    fn pause_builders_require_only_the_configured_authority() {
        let program_id = Pubkey::new_unique();
        let authority = Pubkey::new_unique();

        for instruction in [pause(program_id, authority), unpause(program_id, authority)] {
            assert_eq!(instruction.accounts.len(), 2);
            assert_eq!(
                instruction.accounts[0],
                AccountMeta::new_readonly(authority, true)
            );
            assert_eq!(instruction.accounts[1].pubkey, config_pda(&program_id).0);
            assert!(instruction.accounts[1].is_writable);
        }
    }

    #[test]
    fn player_claim_builder_is_draw_scoped() {
        let program_id = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let instruction = claim_player(program_id, player, 7);

        assert_eq!(instruction.accounts.len(), 3);
        assert_eq!(instruction.accounts[0], AccountMeta::new(player, true));
        assert_eq!(instruction.accounts[1].pubkey, draw_pda(&program_id, 7).0);
        assert_eq!(
            instruction.accounts[2].pubkey,
            player_registry_pda(&program_id, 7).0
        );
        assert_eq!(&instruction.data[1..], &7u64.to_le_bytes());
    }

    #[test]
    fn stake_withdrawal_claim_builder_targets_persistent_custody() {
        let program_id = Pubkey::new_unique();
        let staker = Pubkey::new_unique();
        let instruction = claim_stake_withdrawal(program_id, staker);

        assert_eq!(instruction.accounts.len(), 3);
        assert_eq!(instruction.accounts[0], AccountMeta::new(staker, true));
        assert_eq!(
            instruction.accounts[1].pubkey,
            staker_vault_pda(&program_id).0
        );
        assert_eq!(
            instruction.accounts[2].pubkey,
            staker_registry_pda(&program_id).0
        );
    }
}
