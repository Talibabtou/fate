use steel::*;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, TryFromPrimitive)]
pub enum FateInstruction {
    Initialize = 0,
    DepositStake = 1,
    RequestStakeWithdrawal = 2,
    DepositPlayer = 3,
    RefundPlayer = 4,
    ActivateDraw = 5,
    Pause = 6,
    Unpause = 7,
    ClaimPlayer = 8,
    ClaimStakeWithdrawal = 9,
    ReservedGrowProgramAccounts = 10,
    LockDraw = 11,
    SettleDrawDev = 12,
    ReservedClosePlayerRegistry = 13,
    CloseDraw = 14,
    ClosePlayerPosition = 15,
    CloseWeightPage = 16,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Initialize {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct DepositStake {
    pub amount: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct RequestStakeWithdrawal {
    pub shares: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct DepositPlayer {
    pub amount: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct RefundPlayer {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ActivateDraw {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Pause {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Unpause {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ClaimPlayer {
    pub draw_id: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ClaimStakeWithdrawal {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct LockDraw {}

/// Deterministic localnet/devnet fixture. The production program rejects this
/// instruction unless it was explicitly built with `dev-randomness`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SettleDrawDev {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct CloseDraw {
    pub draw_id: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct ClosePlayerPosition {
    pub draw_id: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct CloseWeightPage {
    pub draw_id: [u8; 8],
}

instruction!(FateInstruction, Initialize);
instruction!(FateInstruction, DepositStake);
instruction!(FateInstruction, RequestStakeWithdrawal);
instruction!(FateInstruction, DepositPlayer);
instruction!(FateInstruction, RefundPlayer);
instruction!(FateInstruction, ActivateDraw);
instruction!(FateInstruction, Pause);
instruction!(FateInstruction, Unpause);
instruction!(FateInstruction, ClaimPlayer);
instruction!(FateInstruction, ClaimStakeWithdrawal);
instruction!(FateInstruction, LockDraw);
instruction!(FateInstruction, SettleDrawDev);
instruction!(FateInstruction, CloseDraw);
instruction!(FateInstruction, ClosePlayerPosition);
instruction!(FateInstruction, CloseWeightPage);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_wire_format_is_stable() {
        assert_eq!(
            Initialize {}.to_bytes(),
            vec![FateInstruction::Initialize as u8]
        );
    }

    #[test]
    fn stake_deposit_wire_format_is_stable() {
        let bytes = DepositStake {
            amount: 42u64.to_le_bytes(),
        }
        .to_bytes();
        assert_eq!(bytes[0], FateInstruction::DepositStake as u8);
        assert_eq!(&bytes[1..], &42u64.to_le_bytes());
    }

    #[test]
    fn stake_withdrawal_wire_format_is_stable() {
        let bytes = RequestStakeWithdrawal {
            shares: 42u64.to_le_bytes(),
        }
        .to_bytes();
        assert_eq!(bytes[0], FateInstruction::RequestStakeWithdrawal as u8);
        assert_eq!(&bytes[1..], &42u64.to_le_bytes());
    }

    #[test]
    fn player_deposit_wire_format_is_stable() {
        let bytes = DepositPlayer {
            amount: 42u64.to_le_bytes(),
        }
        .to_bytes();
        assert_eq!(bytes[0], FateInstruction::DepositPlayer as u8);
        assert_eq!(&bytes[1..], &42u64.to_le_bytes());
    }

    #[test]
    fn player_refund_wire_format_is_stable() {
        let bytes = RefundPlayer {}.to_bytes();
        assert_eq!(bytes, [FateInstruction::RefundPlayer as u8]);
    }

    #[test]
    fn activate_draw_wire_format_is_stable() {
        let bytes = ActivateDraw {}.to_bytes();
        assert_eq!(bytes, [FateInstruction::ActivateDraw as u8]);
    }

    #[test]
    fn pause_wire_formats_are_stable() {
        assert_eq!(Pause {}.to_bytes(), [FateInstruction::Pause as u8]);
        assert_eq!(Unpause {}.to_bytes(), [FateInstruction::Unpause as u8]);
    }

    #[test]
    fn player_claim_wire_format_is_stable() {
        let bytes = ClaimPlayer {
            draw_id: 42u64.to_le_bytes(),
        }
        .to_bytes();
        assert_eq!(bytes[0], FateInstruction::ClaimPlayer as u8);
        assert_eq!(&bytes[1..], &42u64.to_le_bytes());
    }

    #[test]
    fn stake_withdrawal_claim_wire_format_is_stable() {
        assert_eq!(
            ClaimStakeWithdrawal {}.to_bytes(),
            [FateInstruction::ClaimStakeWithdrawal as u8]
        );
    }

    #[test]
    fn draw_progression_wire_formats_are_stable() {
        assert_eq!(LockDraw {}.to_bytes(), [FateInstruction::LockDraw as u8]);
        assert_eq!(
            SettleDrawDev {}.to_bytes(),
            [FateInstruction::SettleDrawDev as u8]
        );
    }

    #[test]
    fn storage_cleanup_wire_formats_are_stable() {
        let bytes = CloseDraw {
            draw_id: 42u64.to_le_bytes(),
        }
        .to_bytes();
        assert_eq!(bytes[0], FateInstruction::CloseDraw as u8);
        assert_eq!(&bytes[1..], &42u64.to_le_bytes());
    }
}
