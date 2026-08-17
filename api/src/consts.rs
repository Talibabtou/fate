pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const PROGRAM_VERSION: u64 = 1;

pub const PLAYER_SIDE_BPS: u64 = 9_000;
pub const STAKER_SIDE_BPS: u64 = BPS_DENOMINATOR - PLAYER_SIDE_BPS;
pub const PROTOCOL_FEE_BPS: u64 = 500;

pub const INITIAL_THRESHOLD_BPS: u64 = 100;
pub const RELATIVE_ACTIVATION_FLOOR_BPS: u64 = 10;
pub const THRESHOLD_DECAY_BPS: u64 = 9_000;
pub const THRESHOLD_DECAY_INTERVAL_SECONDS: u64 = 10 * 60;
pub const COUNTDOWN_SECONDS: u64 = 5 * 60;

pub const MINIMUM_DRAW_POOL_LAMPORTS: u64 = LAMPORTS_PER_SOL / 10;
pub const MINIMUM_PLAYER_DEPOSIT_LAMPORTS: u64 = LAMPORTS_PER_SOL / 100;
pub const MINIMUM_STAKER_DEPOSIT_LAMPORTS: u64 = LAMPORTS_PER_SOL / 10;

pub const STAKER_EROSION_BPS: u64 = 7;
pub const PLAYER_EROSION_CAP_BPS: u64 = 700;

pub const BASE_PLAYER_BOOST_BPS: u64 = BPS_DENOMINATOR;
pub const MAX_EARLY_BOOST_BPS: u64 = 5_000;
pub const MAX_PLAYER_BOOST_BPS: u64 = BASE_PLAYER_BOOST_BPS + MAX_EARLY_BOOST_BPS;

pub const STAKER_JACKPOT_BPS: u64 = 3_000;
pub const STAKER_PRO_RATA_BPS: u64 = 6_500;

pub const CONFIG_SEED: &[u8] = b"config";
pub const STAKER_VAULT_SEED: &[u8] = b"staker-vault";
pub const STAKER_POSITION_SEED: &[u8] = b"staker-position";
pub const DRAW_SEED: &[u8] = b"draw";
pub const PLAYER_POSITION_SEED: &[u8] = b"player-position";
pub const WEIGHT_PAGE_SEED: &[u8] = b"weight-page";
// Eight radix-16 levels cover 2^32 positions while keeping settlement below
// Solana's transaction account/packet limits without an address lookup table.
pub const WEIGHT_TREE_DEPTH: usize = 8;
pub const WEIGHT_PAGE_WIDTH: usize = 16;
pub const MAX_PARTICIPANT_INDEX: u64 = u32::MAX as u64;
pub const ENTROPY_AUTHORITY_SEED: &[u8] = b"entropy-authority";
