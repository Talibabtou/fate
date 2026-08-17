use steel::*;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, TryFromPrimitive)]
pub enum FateInstruction {
    Initialize = 0,
    DepositStake = 1,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Initialize {}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct DepositStake {
    pub amount: [u8; 8],
}

instruction!(FateInstruction, Initialize);
instruction!(FateInstruction, DepositStake);

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
}
