use steel::*;

use crate::{consts::WEIGHT_TREE_DEPTH, instruction::*, state::*};

fn weight_path_metas(program_id: Pubkey, tree: Pubkey, leaf_index: u64) -> Vec<AccountMeta> {
    (0..WEIGHT_TREE_DEPTH)
        .map(|level| {
            AccountMeta::new(
                weight_page_pda(
                    &program_id,
                    &tree,
                    level as u64,
                    weight_prefix(leaf_index, level),
                )
                .0,
                false,
            )
        })
        .collect()
}

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
            AccountMeta::new(draw_pda(&program_id, 0).0, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: Initialize {}.to_bytes(),
    }
}

pub fn deposit_stake(
    program_id: Pubkey,
    staker: Pubkey,
    draw_id: u64,
    leaf_index: u64,
    amount: u64,
) -> Instruction {
    let vault = staker_vault_pda(&program_id).0;
    let mut accounts = vec![
        AccountMeta::new(staker, true),
        AccountMeta::new_readonly(config_pda(&program_id).0, false),
        AccountMeta::new_readonly(draw_pda(&program_id, draw_id).0, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(staker_position_pda(&program_id, &staker).0, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];
    accounts.extend(weight_path_metas(program_id, vault, leaf_index));
    Instruction {
        program_id,
        accounts,
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
    leaf_index: u64,
    shares: u64,
) -> Instruction {
    let vault = staker_vault_pda(&program_id).0;
    let mut accounts = vec![
        AccountMeta::new(staker, true),
        AccountMeta::new_readonly(config_pda(&program_id).0, false),
        AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(staker_position_pda(&program_id, &staker).0, false),
    ];
    accounts.extend(weight_path_metas(program_id, vault, leaf_index));
    Instruction {
        program_id,
        accounts,
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
    leaf_index: u64,
    amount: u64,
) -> Instruction {
    let draw = draw_pda(&program_id, draw_id).0;
    let mut accounts = vec![
        AccountMeta::new(player, true),
        AccountMeta::new_readonly(config_pda(&program_id).0, false),
        AccountMeta::new(draw, false),
        AccountMeta::new(player_position_pda(&program_id, draw_id, &player).0, false),
        AccountMeta::new_readonly(staker_vault_pda(&program_id).0, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];
    accounts.extend(weight_path_metas(program_id, draw, leaf_index));
    Instruction {
        program_id,
        accounts,
        data: DepositPlayer {
            amount: amount.to_le_bytes(),
        }
        .to_bytes(),
    }
}

pub fn refund_player(
    program_id: Pubkey,
    player: Pubkey,
    draw_id: u64,
    leaf_index: u64,
) -> Instruction {
    let draw = draw_pda(&program_id, draw_id).0;
    let mut accounts = vec![
        AccountMeta::new(player, true),
        AccountMeta::new_readonly(config_pda(&program_id).0, false),
        AccountMeta::new(draw, false),
        AccountMeta::new(player_position_pda(&program_id, draw_id, &player).0, false),
    ];
    accounts.extend(weight_path_metas(program_id, draw, leaf_index));
    Instruction {
        program_id,
        accounts,
        data: RefundPlayer {}.to_bytes(),
    }
}

pub fn activate_draw(program_id: Pubkey, draw_id: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
        ],
        data: ActivateDraw {}.to_bytes(),
    }
}

pub fn pause(program_id: Pubkey, authority: Pubkey) -> Instruction {
    set_pause_instruction(program_id, authority, true)
}

pub fn unpause(program_id: Pubkey, authority: Pubkey) -> Instruction {
    set_pause_instruction(program_id, authority, false)
}

fn set_pause_instruction(program_id: Pubkey, authority: Pubkey, paused: bool) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(config_pda(&program_id).0, false),
        ],
        data: if paused {
            Pause {}.to_bytes()
        } else {
            Unpause {}.to_bytes()
        },
    }
}

pub fn claim_player(program_id: Pubkey, player: Pubkey, draw_id: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(player, true),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(player_position_pda(&program_id, draw_id, &player).0, false),
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
            AccountMeta::new(staker_position_pda(&program_id, &staker).0, false),
        ],
        data: ClaimStakeWithdrawal {}.to_bytes(),
    }
}

pub fn lock_draw(program_id: Pubkey, draw_id: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
        ],
        data: LockDraw {}.to_bytes(),
    }
}

pub fn settle_draw_dev(
    program_id: Pubkey,
    payer: Pubkey,
    fee_treasury: Pubkey,
    draw_id: u64,
    player: Pubkey,
    player_index: u64,
    staker: Pubkey,
    staker_index: u64,
) -> Instruction {
    let draw = draw_pda(&program_id, draw_id).0;
    let vault = staker_vault_pda(&program_id).0;
    let mut accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new(config_pda(&program_id).0, false),
        AccountMeta::new(draw, false),
        AccountMeta::new(player_position_pda(&program_id, draw_id, &player).0, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(staker_position_pda(&program_id, &staker).0, false),
        AccountMeta::new(fee_treasury, false),
        AccountMeta::new(draw_pda(&program_id, draw_id.saturating_add(1)).0, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];
    accounts.extend(weight_path_metas(program_id, draw, player_index));
    accounts.extend(weight_path_metas(program_id, vault, staker_index));
    Instruction {
        program_id,
        accounts,
        data: SettleDrawDev {}.to_bytes(),
    }
}

pub fn close_draw(program_id: Pubkey, rent_payer: Pubkey, draw_id: u64) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(config_pda(&program_id).0, false),
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(rent_payer, false),
        ],
        data: CloseDraw {
            draw_id: draw_id.to_le_bytes(),
        }
        .to_bytes(),
    }
}

pub fn close_player_position(
    program_id: Pubkey,
    authority: Pubkey,
    rent_payer: Pubkey,
    draw_id: u64,
) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(draw_pda(&program_id, draw_id).0, false),
            AccountMeta::new(
                player_position_pda(&program_id, draw_id, &authority).0,
                false,
            ),
            AccountMeta::new(rent_payer, false),
        ],
        data: ClosePlayerPosition {
            draw_id: draw_id.to_le_bytes(),
        }
        .to_bytes(),
    }
}

pub fn close_weight_page(
    program_id: Pubkey,
    tree: Pubkey,
    rent_payer: Pubkey,
    draw_id: u64,
    level: u64,
    prefix: u64,
) -> Instruction {
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(tree, false),
            AccountMeta::new(weight_page_pda(&program_id, &tree, level, prefix).0, false),
            AccountMeta::new(rent_payer, false),
        ],
        data: CloseWeightPage {
            draw_id: draw_id.to_le_bytes(),
        }
        .to_bytes(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn participant_builders_use_per_wallet_pdas_and_full_paths() {
        let program = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let ix = deposit_player(program, wallet, 7, 42, 100);
        assert_eq!(
            ix.accounts[3].pubkey,
            player_position_pda(&program, 7, &wallet).0
        );
        assert_eq!(ix.accounts.len(), 6 + WEIGHT_TREE_DEPTH);
    }
}
