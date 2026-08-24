use fate_api::prelude::*;
use solana_program::pubkey::Pubkey;
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
#[cfg(feature = "dev-randomness")]
use solana_sdk::clock::Clock;
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use steel::{AccountDeserialize, Discriminator};

const SOL: u64 = 1_000_000_000;

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

#[tokio::test]
async fn per_wallet_positions_exceed_the_old_player_registry_cap() {
    let (mut context, program_id, _, _) = start().await;
    let staker = Keypair::new();
    fund(&mut context, &staker.pubkey(), 3 * SOL).await;
    send(
        &mut context,
        deposit_stake(program_id, staker.pubkey(), 0, 0, SOL),
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
        request_stake_withdrawal(program_id, staker.pubkey(), 0, 0, SOL / 2),
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
    assert_eq!(draw.staker_tvl_snapshot, SOL / 2);
    assert_eq!(
        draw.player_tvl_lamports,
        player_count * MINIMUM_PLAYER_DEPOSIT_LAMPORTS
    );
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
    send(&mut context, activate_draw(program_id, 0), &[])
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
    send(&mut context, lock_draw(program_id, 0), &[])
        .await
        .unwrap();
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

    let (deposit_units, deposit_packet) = measure(
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

    let (activation_units, activation_packet) =
        measure(&mut context, activate_draw(program_id, 0), &[]).await;
    send(&mut context, activate_draw(program_id, 0), &[])
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

    send(
        &mut context,
        deposit_player(program_id, player.pubkey(), 1, 0, activation_deposit),
        &[&player],
    )
    .await
    .unwrap();
    send(&mut context, activate_draw(program_id, 1), &[])
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
    send(&mut context, lock_draw(program_id, 1), &[])
        .await
        .unwrap();
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

    println!(
        "WEIGHT_PATH_BENCHMARK deposit={deposit_units}/{deposit_packet} refund={refund_units}/{refund_packet} withdrawal={withdrawal_units}/{withdrawal_packet} repeat_deposit={repeat_deposit_units}/{repeat_deposit_packet} activation={activation_units}/{activation_packet} lock={lock_units}/{lock_packet} settle_player={settle_player_units}/{settle_player_packet} claim={claim_units}/{claim_packet} settle_staker={settle_staker_units}/{settle_staker_packet}"
    );
    for packet_bytes in [
        deposit_packet,
        refund_packet,
        withdrawal_packet,
        repeat_deposit_packet,
        activation_packet,
        lock_packet,
        settle_player_packet,
        claim_packet,
        settle_staker_packet,
    ] {
        assert!(packet_bytes <= 1_232);
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
    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(extra);
    Transaction::new_signed_with_payer(
        &[instruction],
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
    (simulate_units(context, transaction).await, packet_bytes)
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
    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(extra);
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
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
