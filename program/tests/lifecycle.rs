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
use steel::AccountDeserialize;

const SOL: u64 = 1_000_000_000;

struct TestFixture {
    context: ProgramTestContext,
    program_id: Pubkey,
    authority: Keypair,
    #[cfg(feature = "dev-randomness")]
    fee_treasury: Pubkey,
}

impl TestFixture {
    async fn start() -> Self {
        let program_id = Pubkey::new_unique();
        let entropy_program = Pubkey::new_unique();
        let entropy_variable = Pubkey::new_unique();
        let authority = Keypair::new();
        let fee_treasury = Pubkey::new_unique();

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

        let mut context = test.start_with_context().await;
        let instruction = initialize(
            program_id,
            context.payer.pubkey(),
            authority.pubkey(),
            fee_treasury,
            entropy_program,
            entropy_variable,
        );
        process_instruction(&mut context, instruction, &[&authority])
            .await
            .unwrap();

        let config_account = context
            .banks_client
            .get_account(config_pda(&program_id).0)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(read_account::<Config>(&config_account).version, 0);
        assert_eq!(
            context
                .banks_client
                .get_account(staker_registry_pda(&program_id).0)
                .await
                .unwrap()
                .unwrap()
                .data
                .len(),
            8
        );
        for step in 0..5 {
            let instruction =
                grow_program_accounts(program_id, context.payer.pubkey(), authority.pubkey(), step);
            process_instruction(&mut context, instruction, &[&authority])
                .await
                .unwrap();
        }

        let config_account = context
            .banks_client
            .get_account(config_pda(&program_id).0)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            read_account::<Config>(&config_account).version,
            PROGRAM_VERSION
        );

        Self {
            context,
            program_id,
            authority,
            #[cfg(feature = "dev-randomness")]
            fee_treasury,
        }
    }

    async fn fund(&mut self, recipient: &Pubkey, lamports: u64) {
        let instruction = solana_sdk::system_instruction::transfer(
            &self.context.payer.pubkey(),
            recipient,
            lamports,
        );
        process_instruction(&mut self.context, instruction, &[])
            .await
            .unwrap();
    }

    async fn account(&mut self, address: Pubkey) -> Account {
        self.context
            .banks_client
            .get_account(address)
            .await
            .unwrap()
            .unwrap()
    }
}

#[cfg(feature = "dev-randomness")]
#[tokio::test]
async fn dev_draw_loop_settles_both_sides_and_creates_each_next_draw() {
    let mut fixture = TestFixture::start().await;
    let staker = Keypair::new();
    let player = Keypair::new();
    fixture.fund(&staker.pubkey(), 4 * SOL).await;
    fixture.fund(&player.pubkey(), 2 * SOL).await;

    process_instruction(
        &mut fixture.context,
        deposit_stake(fixture.program_id, staker.pubkey(), 0, 2 * SOL),
        &[&staker],
    )
    .await
    .unwrap();

    for (draw_id, expected_side) in [(0, WinnerSide::Player), (1, WinnerSide::Staker)] {
        process_instruction(
            &mut fixture.context,
            deposit_player(fixture.program_id, player.pubkey(), draw_id, 100_000_000),
            &[&player],
        )
        .await
        .unwrap();
        process_instruction(
            &mut fixture.context,
            activate_draw(fixture.program_id, draw_id),
            &[],
        )
        .await
        .unwrap();

        assert!(process_instruction(
            &mut fixture.context,
            lock_draw(fixture.program_id, draw_id),
            &[],
        )
        .await
        .is_err());
        let active_account = fixture
            .account(draw_pda(&fixture.program_id, draw_id).0)
            .await;
        let locks_at = read_account::<Draw>(&active_account).locks_at;
        fixture.context.warp_to_slot(draw_id + 2).unwrap();
        fixture.context.set_sysvar(&Clock {
            unix_timestamp: locks_at,
            ..Clock::default()
        });
        process_instruction(
            &mut fixture.context,
            lock_draw(fixture.program_id, draw_id),
            &[],
        )
        .await
        .unwrap();
        let payer = fixture.context.payer.pubkey();
        process_instruction(
            &mut fixture.context,
            settle_draw_dev(fixture.program_id, payer, fixture.fee_treasury, draw_id),
            &[],
        )
        .await
        .unwrap();

        let settled_account = fixture
            .account(draw_pda(&fixture.program_id, draw_id).0)
            .await;
        let settled = read_account::<Draw>(&settled_account);
        assert_eq!(settled.phase(), Some(DrawPhase::Settled));
        assert_eq!(settled.winner_side(), Some(expected_side));
        assert_eq!(settled.entropy_sample_valid, 1);

        let next_id = draw_id + 1;
        let next_account = fixture
            .account(draw_pda(&fixture.program_id, next_id).0)
            .await;
        let next = read_account::<Draw>(&next_account);
        assert_eq!(next.id, next_id);
        assert_eq!(next.phase(), Some(DrawPhase::Funding));
        let next_registry_account = fixture
            .account(player_registry_pda(&fixture.program_id, next_id).0)
            .await;
        assert_eq!(
            read_account::<PlayerRegistry>(&next_registry_account).draw_id,
            next_id
        );
    }

    let config_account = fixture.account(config_pda(&fixture.program_id).0).await;
    let config = read_account::<Config>(&config_account);
    assert_eq!(config.current_draw_id, 2);
    assert_eq!(config.recent_draw_count, 2);
    assert_eq!(&config.recent_draws_newest_first()[..2], &[1, 0]);
}

async fn process_instruction(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    additional_signers: &[&Keypair],
) -> Result<(), solana_program_test::BanksClientError> {
    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(additional_signers);
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &signers,
        blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

fn read_account<T: AccountDeserialize>(account: &Account) -> &T {
    T::try_from_bytes(&account.data).unwrap()
}

#[tokio::test]
async fn custody_lifecycle_executes_and_exits_remain_available_during_pause() {
    let mut fixture = TestFixture::start().await;
    let staker = Keypair::new();
    let player = Keypair::new();
    fixture.fund(&staker.pubkey(), 2 * SOL).await;
    fixture.fund(&player.pubkey(), SOL).await;

    process_instruction(
        &mut fixture.context,
        deposit_stake(fixture.program_id, staker.pubkey(), 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();

    process_instruction(
        &mut fixture.context,
        deposit_player(fixture.program_id, player.pubkey(), 0, 20_000_000),
        &[&player],
    )
    .await
    .unwrap();

    process_instruction(
        &mut fixture.context,
        pause(fixture.program_id, fixture.authority.pubkey()),
        &[&fixture.authority],
    )
    .await
    .unwrap();

    assert!(process_instruction(
        &mut fixture.context,
        deposit_player(fixture.program_id, player.pubkey(), 0, 10_000_000),
        &[&player],
    )
    .await
    .is_err());

    process_instruction(
        &mut fixture.context,
        refund_player(fixture.program_id, player.pubkey(), 0),
        &[&player],
    )
    .await
    .unwrap();

    process_instruction(
        &mut fixture.context,
        request_stake_withdrawal(fixture.program_id, staker.pubkey(), 0, 100_000_000),
        &[&staker],
    )
    .await
    .unwrap();

    process_instruction(
        &mut fixture.context,
        unpause(fixture.program_id, fixture.authority.pubkey()),
        &[&fixture.authority],
    )
    .await
    .unwrap();

    process_instruction(
        &mut fixture.context,
        deposit_player(fixture.program_id, player.pubkey(), 0, 100_000_000),
        &[&player],
    )
    .await
    .unwrap();

    process_instruction(
        &mut fixture.context,
        activate_draw(fixture.program_id, 0),
        &[],
    )
    .await
    .unwrap();

    process_instruction(
        &mut fixture.context,
        request_stake_withdrawal(fixture.program_id, staker.pubkey(), 0, 100_000_000),
        &[&staker],
    )
    .await
    .unwrap();

    let config_account = fixture.account(config_pda(&fixture.program_id).0).await;
    let config = read_account::<Config>(&config_account);
    assert!(!config.is_paused());
    assert_eq!(config.current_draw_id, 0);

    let draw_account = fixture.account(draw_pda(&fixture.program_id, 0).0).await;
    let draw = read_account::<Draw>(&draw_account);
    assert_eq!(draw.phase(), Some(DrawPhase::Activated));
    assert_eq!(draw.player_tvl_lamports, 100_000_000);
    assert_eq!(draw.staker_tvl_snapshot, 900_000_000);

    let player_registry_account = fixture
        .account(player_registry_pda(&fixture.program_id, 0).0)
        .await;
    let player_registry = read_account::<PlayerRegistry>(&player_registry_account);
    let player_entry =
        &player_registry.entries[player_registry.find_index(&player.pubkey()).unwrap()];
    assert_eq!(player_entry.refundable_deposit_lamports, 0);
    assert_eq!(player_entry.committed_deposit_lamports, 100_000_000);

    let vault_account = fixture
        .account(staker_vault_pda(&fixture.program_id).0)
        .await;
    let vault = read_account::<StakerVault>(&vault_account);
    assert_eq!(vault.active_assets_lamports, 900_000_000);
    assert_eq!(vault.total_shares, 900_000_000);
    assert_eq!(vault.queued_withdrawal_shares, 100_000_000);

    let staker_registry_account = fixture
        .account(staker_registry_pda(&fixture.program_id).0)
        .await;
    let staker_registry = read_account::<StakerRegistry>(&staker_registry_account);
    let staker_entry =
        &staker_registry.entries[staker_registry.find_index(&staker.pubkey()).unwrap()];
    assert_eq!(staker_entry.active_shares, 900_000_000);
    assert_eq!(staker_entry.queued_withdrawal_shares, 100_000_000);
}

#[tokio::test]
async fn activation_rejects_a_player_pool_below_the_live_floor() {
    let mut fixture = TestFixture::start().await;
    let staker = Keypair::new();
    let player = Keypair::new();
    fixture.fund(&staker.pubkey(), 2 * SOL).await;
    fixture.fund(&player.pubkey(), SOL).await;

    process_instruction(
        &mut fixture.context,
        deposit_stake(fixture.program_id, staker.pubkey(), 0, SOL),
        &[&staker],
    )
    .await
    .unwrap();
    process_instruction(
        &mut fixture.context,
        deposit_player(fixture.program_id, player.pubkey(), 0, 99_999_999),
        &[&player],
    )
    .await
    .unwrap();

    assert!(process_instruction(
        &mut fixture.context,
        activate_draw(fixture.program_id, 0),
        &[],
    )
    .await
    .is_err());

    let draw_account = fixture.account(draw_pda(&fixture.program_id, 0).0).await;
    assert_eq!(
        read_account::<Draw>(&draw_account).phase(),
        Some(DrawPhase::Funding)
    );
}
