use steel::*;

#[repr(u32)]
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq, IntoPrimitive)]
pub enum FateError {
    #[error("Arithmetic overflow")]
    ArithmeticOverflow = 0,

    #[error("Division by zero")]
    DivisionByZero = 1,

    #[error("Winner deposit exceeds Player TVL")]
    InvalidWinnerDeposit = 2,

    #[error("Selection weight is zero")]
    ZeroSelectionWeight = 3,

    #[error("Selected weight is outside the registry")]
    SelectionOutOfRange = 4,

    #[error("Registry is full")]
    RegistryFull = 5,

    #[error("Share amount is invalid")]
    InvalidShareAmount = 6,

    #[error("Player position has committed funds")]
    PlayerFundsCommitted = 7,
}

error!(FateError);
