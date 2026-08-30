use fate_api::prelude::*;
use solana_program::pubkey::Pubkey;
#[cfg(feature = "dev-randomness")]
use solana_program::rent::Rent;
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
#[cfg(feature = "dev-randomness")]
use solana_sdk::clock::Clock;
use solana_sdk::{
    account::Account,
    compute_budget::ComputeBudgetInstruction,
    instruction::Instruction,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use steel::{AccountDeserialize, Discriminator};

const SOL: u64 = 1_000_000_000;
const COMPUTE_UNIT_LIMIT: u32 = 400_000;
#[cfg(feature = "dev-randomness")]
const MAX_EXPECTED_COMPUTE_UNITS: u64 = 250_000;

async fn start() -> (ProgramTestContext, Pubkey, Keypair, Pubkey) {
    let program_id = Pubkey::new_unique();
    let entropy_program = Pubkey::new_unique();
    let entropy_variable = Pubkey::new_unique();
    let authority = Keypair::new();
    let fee_treasury = Pubkey::new_unique();
    let mut test = ProgramTest::new("fate", program_id, processor!(fate::process_instruction));
    for (address, owner, executable, data) in [
        (
            entropy_program,
            solana_program::bpf_loader::ID,
            true,
            vec![],
        ),
        (entropy_variable, entropy_program, false, vec![0]),
        (
            fee_treasury,
            solana_program::system_program::ID,
            false,
            vec![],
        ),
    ] {
        test.add_account(
            address,
            Account {
                lamports: SOL,
                data,
                owner,
                executable,
                rent_epoch: 0,
            },
        );
    }
    let mut context = test.start_with_context().await;
    let payer = context.payer.pubkey();
    send(
        &mut context,
        initialize(
            program_id,
            payer,
            authority.pubkey(),
            fee_treasury,
            entropy_program,
            entropy_variable,
        ),
        &[&authority],
    )
    .await
    .unwrap();
    (context, program_id, authority, fee_treasury)
}

async fn assert_rejected(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    extra: &[&Keypair],
) {
    assert!(
        send(context, instruction, extra).await.is_err(),
        "invalid instruction unexpectedly succeeded"
    );
}

async fn initialize_with_prefunded_config(
    config_data: Vec<u8>,
    config_owner: Pubkey,
) -> (
    ProgramTestContext,
    Pubkey,
    Result<(), solana_program_test::BanksClientError>,
) {
    let program_id = Pubkey::new_unique();
    let entropy_program = Pubkey::new_unique();
    let entropy_variable = Pubkey::new_unique();
    let authority = Keypair::new();
    let fee_treasury = Pubkey::new_unique();
    let config = config_pda(&program_id).0;
    let mut test = ProgramTest::new("fate", program_id, processor!(fate::process_instruction));
    test.add_account(
        entropy_program,
        Account {
            lamports: SOL,
            data: vec![],
            owner: solana_program::bpf_loader::ID,
            executable: true,
            rent_epoch: 0,
        },
    );
    test.add_account(
        entropy_variable,
        Account {
            lamports: SOL,
            data: vec![0],
            owner: entropy_program,
            executable: false,
            rent_epoch: 0,
        },
    );
    test.add_account(
        fee_treasury,
        Account {
            lamports: SOL,
            data: vec![],
            owner: solana_program::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    test.add_account(
        config,
        Account {
            lamports: SOL,
            data: config_data,
            owner: config_owner,
            executable: false,
            rent_epoch: 0,
        },
    );
    let mut context = test.start_with_context().await;
    let payer = context.payer.pubkey();
    let result = send(
        &mut context,
        initialize(
            program_id,
            payer,
            authority.pubkey(),
            fee_treasury,
            entropy_program,
            entropy_variable,
        ),
        &[&authority],
    )
    .await;
    (context, program_id, result)
}

#[tokio::test]
async fn per_wallet_positions_exceed_the_old_player_registry_cap() {
    let (mut context, program_id, _, _) = start().await;
    let staker = Keypair::new();
    fund(&mut context, &staker.pubkey(), 123 * SOL).await;
    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, 120 * SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let player_count = 117u64;
    for leaf_index in 0..player_count {
        let player = Keypair::new();
        fund(&mut context, &player.pubkey(), 100_000_000).await;
        send(
            &mut context,
            deposit_player(
                program_id,
                player.pubkey(),
                0,
                leaf_index,
                MINIMUM_PLAYER_DEPOSIT_LAMPORTS,
            ),
            &[&player],
        )
        .await
        .unwrap_or_else(|error| panic!("player {leaf_index} failed: {error:?}"));
    }
    send(
        &mut context,
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let draw_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 0).0)
        .await
        .unwrap()
        .unwrap();
    let draw = read_account::<Draw>(&draw_account);
    assert_eq!(draw.next_player_index, player_count);
    assert_eq!(draw.open_player_positions, player_count);
    assert_eq!(draw.staker_tvl_snapshot, 119 * SOL);
    assert_eq!(
        draw.player_tvl_lamports,
        player_count * MINIMUM_PLAYER_DEPOSIT_LAMPORTS
    );
    println!(
        "CAPACITY_BENCHMARK player_positions={} weight_pages_per_position={} player_tvl_lamports={}",
        player_count,
        WEIGHT_TREE_DEPTH,
        draw.player_tvl_lamports
    );
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn staker_withdrawal_can_trigger_activation_after_repricing_the_threshold() {
    let (mut context, program_id, _, _) = start().await;
    let staker = Keypair::new();
    let player = Keypair::new();
    fund(&mut context, &staker.pubkey(), 23 * SOL).await;
    fund(&mut context, &player.pubkey(), SOL).await;

    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, 20 * SOL),
        &[&staker],
    )
    .await
    .unwrap();
    send(
        &mut context,
        deposit_player(program_id, player.pubkey(), 0, 0, 180_000_000),
        &[&player],
    )
    .await
    .unwrap();

    let funding = read_account::<Draw>(
        &context
            .banks_client
            .get_account(draw_pda(&program_id, 0).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    assert_eq!(funding.phase(), Some(DrawPhase::Funding));
    assert_eq!(funding.activation_threshold_lamports, 200_000_000);

    send(
        &mut context,
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, 2 * SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let activated = read_account::<Draw>(
        &context
            .banks_client
            .get_account(draw_pda(&program_id, 0).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    assert_eq!(activated.phase(), Some(DrawPhase::Activated));
    assert_eq!(activated.staker_tvl_snapshot, 18 * SOL);
    assert_eq!(activated.activation_threshold_lamports, 180_000_000);
    assert!(activated.locks_at > activated.activated_at);
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn paused_withdrawal_does_not_activate_until_unpaused() {
    let (mut context, program_id, authority, _) = start().await;
    let staker = Keypair::new();
    let player = Keypair::new();
    fund(&mut context, &staker.pubkey(), 23 * SOL).await;
    fund(&mut context, &player.pubkey(), SOL).await;

    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, 20 * SOL),
        &[&staker],
    )
    .await
    .unwrap();
    send(
        &mut context,
        deposit_player(program_id, player.pubkey(), 0, 0, 180_000_000),
        &[&player],
    )
    .await
    .unwrap();
    send(
        &mut context,
        pause(program_id, authority.pubkey()),
        &[&authority],
    )
    .await
    .unwrap();
    send(
        &mut context,
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, 2 * SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let funding = read_account::<Draw>(
        &context
            .banks_client
            .get_account(draw_pda(&program_id, 0).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    assert_eq!(funding.phase(), Some(DrawPhase::Funding));
    assert_eq!(funding.activation_threshold_lamports, 180_000_000);

    send(
        &mut context,
        unpause(program_id, authority.pubkey()),
        &[&authority],
    )
    .await
    .unwrap();
    send(&mut context, activate_draw(program_id, 0), &[])
        .await
        .unwrap();
    let activated_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 0).0)
        .await
        .unwrap()
        .unwrap();
    let activated = read_account::<Draw>(&activated_account);
    assert_eq!(activated.phase(), Some(DrawPhase::Activated));
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn timed_transitions_reject_wrong_phases_and_replays() {
    let (mut context, program_id, _, fee_treasury) = start().await;
    let payer = context.payer.pubkey();
    let staker = Keypair::new();
    let player = Keypair::new();
    fund(&mut context, &staker.pubkey(), 3 * SOL).await;
    fund(&mut context, &player.pubkey(), SOL).await;

    assert_rejected(&mut context, activate_draw(program_id, 0), &[]).await;
    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();
    send(
        &mut context,
        deposit_player(
            program_id,
            player.pubkey(),
            0,
            0,
            MINIMUM_DRAW_POOL_LAMPORTS,
        ),
        &[&player],
    )
    .await
    .unwrap();

    let mut too_early_lock = lock_draw(program_id, 0);
    assert_rejected(&mut context, too_early_lock.clone(), &[]).await;
    assert_rejected(
        &mut context,
        refund_player(program_id, player.pubkey(), 0, 0),
        &[&player],
    )
    .await;
    assert_rejected(
        &mut context,
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, SOL / 2),
        &[&staker],
    )
    .await;

    // Deposits remain open during the countdown, then close at the lock boundary.
    send(
        &mut context,
        deposit_player(
            program_id,
            player.pubkey(),
            0,
            0,
            MINIMUM_PLAYER_DEPOSIT_LAMPORTS,
        ),
        &[&player],
    )
    .await
    .unwrap();
    let draw = read_account::<Draw>(
        &context
            .banks_client
            .get_account(draw_pda(&program_id, 0).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    too_early_lock = lock_draw(program_id, 0);
    assert_rejected(&mut context, too_early_lock, &[]).await;
    context.warp_to_slot(2).unwrap();
    context.set_sysvar(&Clock {
        unix_timestamp: draw.locks_at,
        ..Clock::default()
    });

    assert_rejected(
        &mut context,
        deposit_player(
            program_id,
            player.pubkey(),
            0,
            0,
            MINIMUM_PLAYER_DEPOSIT_LAMPORTS,
        ),
        &[&player],
    )
    .await;
    assert_rejected(
        &mut context,
        refund_player(program_id, player.pubkey(), 0, 0),
        &[&player],
    )
    .await;
    assert_rejected(&mut context, activate_draw(program_id, 0), &[]).await;

    send(
        &mut context,
        settle_draw_dev(
            program_id,
            payer,
            fee_treasury,
            0,
            player.pubkey(),
            0,
            staker.pubkey(),
            0,
        ),
        &[],
    )
    .await
    .unwrap();
    assert_rejected(
        &mut context,
        settle_draw_dev(
            program_id,
            payer,
            fee_treasury,
            0,
            player.pubkey(),
            0,
            staker.pubkey(),
            0,
        ),
        &[],
    )
    .await;
    send(
        &mut context,
        claim_player(program_id, player.pubkey(), 0),
        &[&player],
    )
    .await
    .unwrap();
    assert_rejected(
        &mut context,
        claim_player(program_id, player.pubkey(), 0),
        &[&player],
    )
    .await;
    assert_rejected(
        &mut context,
        claim_stake_withdrawal(program_id, staker.pubkey()),
        &[&staker],
    )
    .await;
}

#[tokio::test]
async fn account_contract_matrix_rejects_substitution_signer_and_mutability() {
    let (mut context, program_id, authority, _) = start().await;
    let payer = context.payer.pubkey();
    let staker = Keypair::new();
    let player = Keypair::new();
    fund(&mut context, &staker.pubkey(), 3 * SOL).await;
    fund(&mut context, &player.pubkey(), SOL).await;

    let mut wrong_config = deposit_stake(program_id, staker.pubkey(), 0, 0, SOL);
    wrong_config.accounts[1].pubkey = Pubkey::new_unique();
    assert_rejected(&mut context, wrong_config, &[&staker]).await;

    let mut writable_config = deposit_stake(program_id, staker.pubkey(), 0, 0, SOL);
    writable_config.accounts[1].is_writable = true;
    assert_rejected(&mut context, writable_config, &[&staker]).await;

    let mut missing_staker_signature = deposit_stake(program_id, staker.pubkey(), 0, 0, SOL);
    missing_staker_signature.accounts[0].is_signer = false;
    assert_rejected(&mut context, missing_staker_signature, &[]).await;

    let mut wrong_weight_page = deposit_stake(program_id, staker.pubkey(), 0, 0, SOL);
    wrong_weight_page.accounts[6].pubkey = Pubkey::new_unique();
    assert_rejected(&mut context, wrong_weight_page, &[&staker]).await;

    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let substitution_seed = deposit_player(
        program_id,
        player.pubkey(),
        0,
        0,
        MINIMUM_PLAYER_DEPOSIT_LAMPORTS,
    );
    let mut mutation_state = 0xFA7E_CAFE_u64;
    for _ in 0..128 {
        mutation_state = mutation_state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1);
        let account_index = 1 + (mutation_state as usize) % (substitution_seed.accounts.len() - 1);
        let mut substituted = substitution_seed.clone();
        substituted.accounts[account_index].pubkey = Pubkey::new_unique();
        assert_rejected(&mut context, substituted, &[&player]).await;
    }

    let mut wrong_player_position = deposit_player(
        program_id,
        player.pubkey(),
        0,
        0,
        MINIMUM_DRAW_POOL_LAMPORTS,
    );
    wrong_player_position.accounts[3].pubkey = Pubkey::new_unique();
    assert_rejected(&mut context, wrong_player_position, &[&player]).await;

    let mut wrong_system_program = deposit_player(
        program_id,
        player.pubkey(),
        0,
        0,
        MINIMUM_DRAW_POOL_LAMPORTS,
    );
    wrong_system_program.accounts[5].pubkey = Pubkey::new_unique();
    assert_rejected(&mut context, wrong_system_program, &[&player]).await;

    send(
        &mut context,
        deposit_player(
            program_id,
            player.pubkey(),
            0,
            0,
            MINIMUM_DRAW_POOL_LAMPORTS,
        ),
        &[&player],
    )
    .await
    .unwrap();

    let mut wrong_refund_page = refund_player(program_id, player.pubkey(), 0, 0);
    wrong_refund_page.accounts[4].pubkey = Pubkey::new_unique();
    assert_rejected(&mut context, wrong_refund_page, &[&player]).await;

    let mut wrong_withdrawal_page =
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, SOL / 2);
    wrong_withdrawal_page.accounts[5].pubkey = Pubkey::new_unique();
    assert_rejected(&mut context, wrong_withdrawal_page, &[&staker]).await;

    let unauthorized = Keypair::new();
    let mut unauthorized_pause = pause(program_id, unauthorized.pubkey());
    fund(&mut context, &unauthorized.pubkey(), SOL / 10).await;
    assert_rejected(&mut context, unauthorized_pause.clone(), &[&unauthorized]).await;
    unauthorized_pause.accounts[0].is_signer = false;
    assert_rejected(&mut context, unauthorized_pause, &[]).await;

    let mut wrong_activation_draw = activate_draw(program_id, 0);
    wrong_activation_draw.accounts[1].pubkey = Pubkey::new_unique();
    assert_rejected(&mut context, wrong_activation_draw, &[]).await;

    // Reinitialization and duplicate initialization targets are both rejected before state mutation.
    assert_rejected(
        &mut context,
        initialize(
            program_id,
            payer,
            authority.pubkey(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ),
        &[&authority],
    )
    .await;
    let config = config_pda(&program_id).0;
    assert_rejected(
        &mut context,
        initialize(
            program_id,
            payer,
            authority.pubkey(),
            config,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ),
        &[&authority],
    )
    .await;
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn conflicting_withdrawal_contention_allows_one_state_transition() {
    let (mut context, program_id, _, _) = start().await;
    let staker = Keypair::new();
    fund(&mut context, &staker.pubkey(), 2 * SOL).await;
    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let first = request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, 3 * SOL / 4);
    let second = first.clone();
    send(&mut context, first, &[&staker]).await.unwrap();
    assert_rejected(&mut context, second, &[&staker]).await;
    println!("CONTENTION_BENCHMARK same_staker_withdrawals=2 successful_withdrawals=1");
}

#[tokio::test]
async fn initialization_handles_prefunded_pdas_and_rejects_bad_targets() {
    let (context, program_id, result) =
        initialize_with_prefunded_config(vec![], solana_program::system_program::ID).await;
    result.unwrap();
    let config_account = context
        .banks_client
        .get_account(config_pda(&program_id).0)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(config_account.owner, program_id);
    assert_eq!(config_account.data.len(), Config::SIZE);

    let (_, _, wrong_owner_result) =
        initialize_with_prefunded_config(vec![], Pubkey::new_unique()).await;
    assert!(wrong_owner_result.is_err());

    let (_, _, wrong_length_result) =
        initialize_with_prefunded_config(vec![0], solana_program::system_program::ID).await;
    assert!(wrong_length_result.is_err());
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn weighted_paths_settle_claim_and_release_draw_storage() {
    let (mut context, program_id, _, fee_treasury) = start().await;
    let staker = Keypair::new();
    let player = Keypair::new();
    fund(&mut context, &staker.pubkey(), 3 * SOL).await;
    fund(&mut context, &player.pubkey(), SOL).await;
    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();
    send(
        &mut context,
        deposit_player(program_id, player.pubkey(), 0, 0, 100_000_000),
        &[&player],
    )
    .await
    .unwrap();
    let draw_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 0).0)
        .await
        .unwrap()
        .unwrap();
    let locks_at = read_account::<Draw>(&draw_account).locks_at;
    context.warp_to_slot(2).unwrap();
    context.set_sysvar(&Clock {
        unix_timestamp: locks_at,
        ..Clock::default()
    });
    let payer = context.payer.pubkey();
    send(
        &mut context,
        settle_draw_dev(
            program_id,
            payer,
            fee_treasury,
            0,
            player.pubkey(),
            0,
            staker.pubkey(),
            0,
        ),
        &[],
    )
    .await
    .unwrap();
    send(
        &mut context,
        claim_player(program_id, player.pubkey(), 0),
        &[&player],
    )
    .await
    .unwrap();
    send(
        &mut context,
        close_player_position(program_id, player.pubkey(), player.pubkey(), 0),
        &[],
    )
    .await
    .unwrap();
    let tree = draw_pda(&program_id, 0).0;
    for level in 0..WEIGHT_TREE_DEPTH as u64 {
        send(
            &mut context,
            close_weight_page(program_id, tree, player.pubkey(), 0, level, 0),
            &[],
        )
        .await
        .unwrap();
    }
    let settled_account = context
        .banks_client
        .get_account(tree)
        .await
        .unwrap()
        .unwrap();
    let settled = read_account::<Draw>(&settled_account);
    assert_eq!(settled.phase(), Some(DrawPhase::Settled));
    assert_eq!(settled.open_player_positions, 0);
    assert_eq!(settled.open_weight_pages, 0);
    let next_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 1).0)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        read_account::<Draw>(&next_account).phase(),
        Some(DrawPhase::Funding)
    );
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn weighted_path_compute_and_packet_budget() {
    let (mut context, program_id, _, _) = start().await;
    let staker = Keypair::new();
    let player = Keypair::new();
    fund(&mut context, &staker.pubkey(), 3 * SOL).await;
    fund(&mut context, &player.pubkey(), SOL).await;
    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let first = deposit_player(
        program_id,
        player.pubkey(),
        0,
        0,
        MINIMUM_PLAYER_DEPOSIT_LAMPORTS,
    );
    let first_transaction = signed_transaction(&mut context, first, &[&player]).await;
    let first_packet_bytes = bincode::serialize(&first_transaction).unwrap().len();
    let first_units = simulate_units(&mut context, first_transaction).await;
    send(
        &mut context,
        deposit_player(
            program_id,
            player.pubkey(),
            0,
            0,
            MINIMUM_PLAYER_DEPOSIT_LAMPORTS,
        ),
        &[&player],
    )
    .await
    .unwrap();

    let repeat = deposit_player(
        program_id,
        player.pubkey(),
        0,
        0,
        MINIMUM_PLAYER_DEPOSIT_LAMPORTS,
    );
    let repeat_transaction = signed_transaction(&mut context, repeat, &[&player]).await;
    let repeat_packet_bytes = bincode::serialize(&repeat_transaction).unwrap().len();
    let repeat_units = simulate_units(&mut context, repeat_transaction).await;

    println!(
        "WEIGHT_PATH_BENCHMARK first_units={first_units} repeat_units={repeat_units} first_packet_bytes={first_packet_bytes} repeat_packet_bytes={repeat_packet_bytes}"
    );
    assert!(first_packet_bytes <= 1_232);
    assert!(repeat_packet_bytes <= 1_232);
    assert!(first_units < 1_400_000);
    assert!(repeat_units < 1_400_000);
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn weighted_path_operations_reconcile_economics_and_budget() {
    let (mut context, program_id, _, fee_treasury) = start().await;
    let payer = context.payer.pubkey();
    let activation_deposit = MINIMUM_DRAW_POOL_LAMPORTS;
    let pending_deposit = MINIMUM_PLAYER_DEPOSIT_LAMPORTS;
    let staker = Keypair::new();
    let player = Keypair::new();
    fund(&mut context, &staker.pubkey(), 3 * SOL).await;
    fund(&mut context, &player.pubkey(), SOL).await;
    let (deposit_staker_units, deposit_staker_packet) = measure(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await;
    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();

    let (deposit_units, deposit_packet) = measure(
        &mut context,
        deposit_player(program_id, player.pubkey(), 0, 0, pending_deposit),
        &[&player],
    )
    .await;
    send(
        &mut context,
        deposit_player(program_id, player.pubkey(), 0, 0, pending_deposit),
        &[&player],
    )
    .await
    .unwrap();

    let rent = Rent::default();
    let rent_rows = [
        ("config", Config::SIZE, config_pda(&program_id).0),
        ("draw", Draw::SIZE, draw_pda(&program_id, 0).0),
        (
            "staker_vault",
            StakerVault::SIZE,
            staker_vault_pda(&program_id).0,
        ),
        (
            "staker_position",
            StakerPosition::SIZE,
            staker_position_pda(&program_id, &staker.pubkey()).0,
        ),
    ];
    for (name, size, address) in rent_rows {
        let account = context
            .banks_client
            .get_account(address)
            .await
            .unwrap()
            .unwrap();
        assert!(
            account.lamports >= rent.minimum_balance(size),
            "{name} is not rent exempt"
        );
    }
    let player_account = context
        .banks_client
        .get_account(player_position_pda(&program_id, 0, &player.pubkey()).0)
        .await
        .unwrap()
        .unwrap();
    assert!(player_account.lamports >= rent.minimum_balance(PlayerPosition::SIZE));
    let page_account = context
        .banks_client
        .get_account(weight_page_pda(&program_id, &draw_pda(&program_id, 0).0, 0, 0).0)
        .await
        .unwrap()
        .unwrap();
    assert!(page_account.lamports >= rent.minimum_balance(WeightPage::SIZE));
    println!(
        "RENT_BENCHMARK config={} draw={} staker_vault={} staker_position={} player_position={} weight_page={}",
        rent.minimum_balance(Config::SIZE),
        rent.minimum_balance(Draw::SIZE),
        rent.minimum_balance(StakerVault::SIZE),
        rent.minimum_balance(StakerPosition::SIZE),
        rent.minimum_balance(PlayerPosition::SIZE),
        rent.minimum_balance(WeightPage::SIZE),
    );

    let (refund_units, refund_packet) = measure(
        &mut context,
        refund_player(program_id, player.pubkey(), 0, 0),
        &[&player],
    )
    .await;
    send(
        &mut context,
        refund_player(program_id, player.pubkey(), 0, 0),
        &[&player],
    )
    .await
    .unwrap();

    let (withdrawal_units, withdrawal_packet) = measure(
        &mut context,
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, SOL / 2),
        &[&staker],
    )
    .await;
    send(
        &mut context,
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, SOL / 2),
        &[&staker],
    )
    .await
    .unwrap();

    let (repeat_deposit_units, repeat_deposit_packet) = measure(
        &mut context,
        deposit_player(program_id, player.pubkey(), 0, 0, activation_deposit),
        &[&player],
    )
    .await;
    send(
        &mut context,
        deposit_player(program_id, player.pubkey(), 0, 0, activation_deposit),
        &[&player],
    )
    .await
    .unwrap();

    let draw_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 0).0)
        .await
        .unwrap()
        .unwrap();
    let locks_at = read_account::<Draw>(&draw_account).locks_at;
    context.warp_to_slot(2).unwrap();
    context.set_sysvar(&Clock {
        unix_timestamp: locks_at,
        ..Clock::default()
    });

    let (lock_units, lock_packet) = measure(&mut context, lock_draw(program_id, 0), &[]).await;
    send(&mut context, lock_draw(program_id, 0), &[])
        .await
        .unwrap();

    let draw_before = read_account::<Draw>(
        &context
            .banks_client
            .get_account(draw_pda(&program_id, 0).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    let vault_before = read_account::<StakerVault>(
        &context
            .banks_client
            .get_account(staker_vault_pda(&program_id).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    let treasury_before = account_lamports(&mut context, fee_treasury).await;
    let player_settlement_expected = player_settlement(
        vault_before.active_assets_lamports,
        draw_before.player_tvl_lamports,
        activation_deposit,
    )
    .unwrap();

    let settle_player_ix = settle_draw_dev(
        program_id,
        payer,
        fee_treasury,
        0,
        player.pubkey(),
        0,
        staker.pubkey(),
        0,
    );
    let (settle_player_units, settle_player_packet) =
        measure(&mut context, settle_player_ix, &[]).await;
    send(
        &mut context,
        settle_draw_dev(
            program_id,
            payer,
            fee_treasury,
            0,
            player.pubkey(),
            0,
            staker.pubkey(),
            0,
        ),
        &[],
    )
    .await
    .unwrap();

    let settled_draw_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 0).0)
        .await
        .unwrap()
        .unwrap();
    let settled_draw = read_account::<Draw>(&settled_draw_account);
    let settled_vault_account = context
        .banks_client
        .get_account(staker_vault_pda(&program_id).0)
        .await
        .unwrap()
        .unwrap();
    let settled_vault = read_account::<StakerVault>(&settled_vault_account);
    assert_eq!(settled_draw.winner_side(), Some(WinnerSide::Player));
    assert_eq!(
        settled_draw.winner_payout_lamports,
        player_settlement_expected.winner_payout_lamports
    );
    assert_eq!(
        settled_draw.protocol_fee_lamports,
        player_settlement_expected.protocol_fee_lamports
    );
    assert_eq!(
        settled_draw.staker_erosion_lamports,
        player_settlement_expected.staker_erosion_lamports
    );
    assert_eq!(
        settled_vault.active_assets_lamports,
        vault_before.active_assets_lamports - player_settlement_expected.staker_erosion_lamports
    );
    assert_eq!(
        account_lamports(&mut context, fee_treasury).await - treasury_before,
        player_settlement_expected.protocol_fee_lamports
    );

    let (claim_units, claim_packet) = measure(
        &mut context,
        claim_player(program_id, player.pubkey(), 0),
        &[&player],
    )
    .await;
    send(
        &mut context,
        claim_player(program_id, player.pubkey(), 0),
        &[&player],
    )
    .await
    .unwrap();
    let claimed_draw_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 0).0)
        .await
        .unwrap()
        .unwrap();
    let claimed_draw = read_account::<Draw>(&claimed_draw_account);
    assert_eq!(claimed_draw.outstanding_player_claim_lamports, 0);

    let tree = draw_pda(&program_id, 0).0;
    let (close_position_units, close_position_packet) = measure(
        &mut context,
        close_player_position(program_id, player.pubkey(), player.pubkey(), 0),
        &[],
    )
    .await;
    send(
        &mut context,
        close_player_position(program_id, player.pubkey(), player.pubkey(), 0),
        &[],
    )
    .await
    .unwrap();
    let (close_page_units, close_page_packet) = measure(
        &mut context,
        close_weight_page(program_id, tree, player.pubkey(), 0, 0, 0),
        &[],
    )
    .await;
    send(
        &mut context,
        close_weight_page(program_id, tree, player.pubkey(), 0, 0, 0),
        &[],
    )
    .await
    .unwrap();
    for level in 1..WEIGHT_TREE_DEPTH as u64 {
        send(
            &mut context,
            close_weight_page(program_id, tree, player.pubkey(), 0, level, 0),
            &[],
        )
        .await
        .unwrap();
    }

    send(
        &mut context,
        deposit_player(program_id, player.pubkey(), 1, 0, activation_deposit),
        &[&player],
    )
    .await
    .unwrap();
    let draw_one = read_account::<Draw>(
        &context
            .banks_client
            .get_account(draw_pda(&program_id, 1).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    context.set_sysvar(&Clock {
        unix_timestamp: draw_one.locks_at,
        ..Clock::default()
    });
    let vault_before_staker = read_account::<StakerVault>(
        &context
            .banks_client
            .get_account(staker_vault_pda(&program_id).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    let treasury_before_staker = account_lamports(&mut context, fee_treasury).await;
    let staker_expected = staker_settlement(activation_deposit).unwrap();
    let settle_staker_ix = settle_draw_dev(
        program_id,
        context.payer.pubkey(),
        fee_treasury,
        1,
        player.pubkey(),
        0,
        staker.pubkey(),
        0,
    );
    let (settle_staker_units, settle_staker_packet) =
        measure(&mut context, settle_staker_ix, &[]).await;
    send(
        &mut context,
        settle_draw_dev(
            program_id,
            payer,
            fee_treasury,
            1,
            player.pubkey(),
            0,
            staker.pubkey(),
            0,
        ),
        &[],
    )
    .await
    .unwrap();
    let settled_staker_draw_account = context
        .banks_client
        .get_account(draw_pda(&program_id, 1).0)
        .await
        .unwrap()
        .unwrap();
    let settled_staker_draw = read_account::<Draw>(&settled_staker_draw_account);
    let settled_staker_vault_account = context
        .banks_client
        .get_account(staker_vault_pda(&program_id).0)
        .await
        .unwrap()
        .unwrap();
    let settled_staker_vault = read_account::<StakerVault>(&settled_staker_vault_account);
    assert_eq!(settled_staker_draw.winner_side(), Some(WinnerSide::Staker));
    assert_eq!(
        settled_staker_draw.protocol_fee_lamports,
        staker_expected.protocol_fee_lamports
    );
    assert_eq!(
        settled_staker_vault.active_assets_lamports,
        vault_before_staker.active_assets_lamports
            + staker_expected.pro_rata_lamports
            + staker_expected.jackpot_lamports
    );
    assert_eq!(
        account_lamports(&mut context, fee_treasury).await - treasury_before_staker,
        staker_expected.protocol_fee_lamports
    );

    // Advance the recent-draw ring with released positions so archival draw
    // cleanup is measured against the real not-recent guard.
    for draw_id in 2..=10 {
        settle_and_release_draw(
            &mut context,
            program_id,
            fee_treasury,
            &player,
            &staker,
            draw_id,
        )
        .await;
    }
    let (close_draw_units, close_draw_packet) =
        measure(&mut context, close_draw(program_id, payer, 0), &[]).await;
    send(&mut context, close_draw(program_id, payer, 0), &[])
        .await
        .unwrap();

    println!(
        "LIFECYCLE_BENCHMARK deposit_staker={deposit_staker_units}/{deposit_staker_packet} deposit_player={deposit_units}/{deposit_packet} refund={refund_units}/{refund_packet} withdrawal={withdrawal_units}/{withdrawal_packet} activation_via_deposit={repeat_deposit_units}/{repeat_deposit_packet} lock={lock_units}/{lock_packet} settle_player={settle_player_units}/{settle_player_packet} claim_player={claim_units}/{claim_packet} close_position={close_position_units}/{close_position_packet} close_page={close_page_units}/{close_page_packet} settle_staker={settle_staker_units}/{settle_staker_packet} close_draw={close_draw_units}/{close_draw_packet}"
    );
    for packet_bytes in [
        deposit_staker_packet,
        deposit_packet,
        refund_packet,
        withdrawal_packet,
        repeat_deposit_packet,
        lock_packet,
        settle_player_packet,
        claim_packet,
        close_position_packet,
        close_page_packet,
        settle_staker_packet,
        close_draw_packet,
    ] {
        assert!(packet_bytes <= 1_232);
    }
    for units in [
        deposit_staker_units,
        deposit_units,
        refund_units,
        withdrawal_units,
        repeat_deposit_units,
        lock_units,
        settle_player_units,
        claim_units,
        close_position_units,
        close_page_units,
        settle_staker_units,
        close_draw_units,
    ] {
        assert!(units <= MAX_EXPECTED_COMPUTE_UNITS);
    }
}

#[cfg(feature = "dev-randomness")]
async fn settle_and_release_draw(
    context: &mut ProgramTestContext,
    program_id: Pubkey,
    fee_treasury: Pubkey,
    player: &Keypair,
    staker: &Keypair,
    draw_id: u64,
) {
    send(
        context,
        deposit_player(
            program_id,
            player.pubkey(),
            draw_id,
            0,
            MINIMUM_DRAW_POOL_LAMPORTS,
        ),
        &[player],
    )
    .await
    .unwrap();
    let draw = read_account::<Draw>(
        &context
            .banks_client
            .get_account(draw_pda(&program_id, draw_id).0)
            .await
            .unwrap()
            .unwrap(),
    )
    .to_owned();
    context.set_sysvar(&Clock {
        unix_timestamp: draw.locks_at,
        ..Clock::default()
    });
    send(
        context,
        settle_draw_dev(
            program_id,
            context.payer.pubkey(),
            fee_treasury,
            draw_id,
            player.pubkey(),
            0,
            staker.pubkey(),
            0,
        ),
        &[],
    )
    .await
    .unwrap();
    if draw_id % 2 == 0 {
        send(
            context,
            claim_player(program_id, player.pubkey(), draw_id),
            &[player],
        )
        .await
        .unwrap();
    }
    send(
        context,
        close_player_position(program_id, player.pubkey(), player.pubkey(), draw_id),
        &[],
    )
    .await
    .unwrap();
    let tree = draw_pda(&program_id, draw_id).0;
    for level in 0..WEIGHT_TREE_DEPTH as u64 {
        send(
            context,
            close_weight_page(program_id, tree, player.pubkey(), draw_id, level, 0),
            &[],
        )
        .await
        .unwrap();
    }
}

async fn fund(context: &mut ProgramTestContext, recipient: &Pubkey, lamports: u64) {
    let ix = solana_sdk::system_instruction::transfer(&context.payer.pubkey(), recipient, lamports);
    send(context, ix, &[]).await.unwrap();
}

#[cfg(feature = "dev-randomness")]
async fn signed_transaction(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    extra: &[&Keypair],
) -> Transaction {
    let blockhash = context.get_new_latest_blockhash().await.unwrap();
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(extra);
    Transaction::new_signed_with_payer(
        &[
            ComputeBudgetInstruction::set_compute_unit_limit(COMPUTE_UNIT_LIMIT),
            instruction,
        ],
        Some(&context.payer.pubkey()),
        &signers,
        blockhash,
    )
}

#[cfg(feature = "dev-randomness")]
async fn simulate_units(context: &mut ProgramTestContext, transaction: Transaction) -> u64 {
    let result = context
        .banks_client
        .simulate_transaction(transaction)
        .await
        .unwrap();
    let simulation_result = result.result.expect("simulation did not return a result");
    assert!(
        simulation_result.is_ok(),
        "benchmark transaction simulation failed: {simulation_result:?}"
    );
    result.simulation_details.unwrap().units_consumed
}

#[cfg(feature = "dev-randomness")]
async fn measure(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    extra: &[&Keypair],
) -> (u64, usize) {
    let transaction = signed_transaction(context, instruction, extra).await;
    let packet_bytes = bincode::serialize(&transaction).unwrap().len();
    let units = simulate_units(context, transaction).await;
    assert!(
        units <= MAX_EXPECTED_COMPUTE_UNITS,
        "measured {units} compute units, expected at most {MAX_EXPECTED_COMPUTE_UNITS}"
    );
    (units, packet_bytes)
}

#[cfg(feature = "dev-randomness")]
async fn account_lamports(context: &mut ProgramTestContext, address: Pubkey) -> u64 {
    context
        .banks_client
        .get_account(address)
        .await
        .unwrap()
        .unwrap()
        .lamports
}

async fn send(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    extra: &[&Keypair],
) -> Result<(), solana_program_test::BanksClientError> {
    let blockhash = context.get_new_latest_blockhash().await.unwrap();
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(extra);
    let transaction = Transaction::new_signed_with_payer(
        &[
            ComputeBudgetInstruction::set_compute_unit_limit(COMPUTE_UNIT_LIMIT),
            instruction,
        ],
        Some(&context.payer.pubkey()),
        &signers,
        blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

fn read_account<T>(account: &Account) -> &T
where
    T: AccountDeserialize + Discriminator,
{
    T::try_from_bytes(&account.data).unwrap()
}
