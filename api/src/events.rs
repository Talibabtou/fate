use steel::*;

pub const EVENT_DEPOSIT: u8 = 1;
pub const EVENT_REFUND: u8 = 2;
pub const EVENT_ACTIVATION: u8 = 3;
pub const EVENT_LOCK: u8 = 4;
pub const EVENT_SETTLEMENT: u8 = 5;
pub const EVENT_CLAIM: u8 = 6;
pub const EVENT_PAUSE_CHANGE: u8 = 7;
pub const EVENT_WITHDRAWAL_REQUEST: u8 = 8;

pub const EVENT_SIDE_STAKER: u8 = 1;
pub const EVENT_SIDE_PLAYER: u8 = 2;

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct DepositEvent {
    pub kind: u8,
    pub side: u8,
    pub reserved: [u8; 6],
    pub draw_id: u64,
    pub wallet: Pubkey,
    pub amount_lamports: u64,
    pub weight: [u8; 16],
}
event!(DepositEvent);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct RefundEvent {
    pub kind: u8,
    pub reserved: [u8; 7],
    pub draw_id: u64,
    pub player: Pubkey,
    pub amount_lamports: u64,
    pub weight: [u8; 16],
}
event!(RefundEvent);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct ActivationEvent {
    pub kind: u8,
    pub reserved: [u8; 7],
    pub draw_id: u64,
    pub threshold_lamports: u64,
    pub staker_tvl_snapshot_lamports: u64,
    pub activated_at: i64,
    pub locks_at: i64,
}
event!(ActivationEvent);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct LockEvent {
    pub kind: u8,
    pub reserved: [u8; 7],
    pub draw_id: u64,
    pub locked_at: i64,
    pub player_tvl_lamports: u64,
    pub staker_tvl_snapshot_lamports: u64,
}
event!(LockEvent);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct SettlementEvent {
    pub kind: u8,
    pub winner_side: u8,
    pub reserved: [u8; 6],
    pub draw_id: u64,
    pub winner: Pubkey,
    pub winner_deposit_lamports: u64,
    pub winner_payout_lamports: u64,
    pub protocol_fee_lamports: u64,
    pub staker_erosion_lamports: u64,
    pub settled_at: i64,
}
event!(SettlementEvent);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct ClaimEvent {
    pub kind: u8,
    pub side: u8,
    pub reserved: [u8; 6],
    pub draw_id: u64,
    pub wallet: Pubkey,
    pub amount_lamports: u64,
    pub claimed_at: i64,
}
event!(ClaimEvent);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct PauseChangeEvent {
    pub kind: u8,
    pub paused: u8,
    pub reserved: [u8; 6],
    pub authority: Pubkey,
    pub changed_at: i64,
}
event!(PauseChangeEvent);

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct WithdrawalRequestEvent {
    pub kind: u8,
    pub side: u8,
    pub reserved: [u8; 6],
    pub draw_id: u64,
    pub staker: Pubkey,
    pub shares: u64,
    pub amount_lamports: u64,
    pub requested_at: i64,
}
event!(WithdrawalRequestEvent);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_payloads_are_fixed_size_and_tagged() {
        assert_eq!(core::mem::size_of::<DepositEvent>(), 72);
        assert_eq!(core::mem::size_of::<RefundEvent>(), 72);
        assert_eq!(core::mem::size_of::<ActivationEvent>(), 48);
        assert_eq!(core::mem::size_of::<LockEvent>(), 40);
        assert_eq!(core::mem::size_of::<SettlementEvent>(), 88);
        assert_eq!(core::mem::size_of::<ClaimEvent>(), 64);
        assert_eq!(core::mem::size_of::<PauseChangeEvent>(), 48);
        assert_eq!(core::mem::size_of::<WithdrawalRequestEvent>(), 72);

        let event = PauseChangeEvent {
            kind: EVENT_PAUSE_CHANGE,
            paused: 1,
            ..PauseChangeEvent::zeroed()
        };
        assert_eq!(event.to_bytes()[0], EVENT_PAUSE_CHANGE);
        assert_eq!(PauseChangeEvent::from_bytes(event.to_bytes()), &event);
    }
}
