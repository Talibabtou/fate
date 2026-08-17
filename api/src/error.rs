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

    #[error("Deposit is below the protocol minimum")]
    DepositTooSmall = 8,

    #[error("Protocol deposits are paused")]
    ProtocolPaused = 9,

    #[error("Draw state or relationship is invalid")]
    InvalidDraw = 10,

    #[error("Program custody does not cover tracked assets")]
    InsufficientCustody = 11,

    #[error("Staker position does not exist")]
    StakerPositionNotFound = 12,

    #[error("Withdrawal exceeds available active shares")]
    WithdrawalExceedsAvailableShares = 13,

    #[error("Deposits are closed for this draw")]
    DepositsClosed = 14,

    #[error("Player position does not exist")]
    PlayerPositionNotFound = 15,

    #[error("Player TVL is below the live activation threshold")]
    ActivationThresholdNotMet = 16,

    #[error("The signer is not authorized for this instruction")]
    NotAuthorized = 17,

    #[error("Account has no claimable balance")]
    NothingToClaim = 18,

    #[error("Settlement state is internally inconsistent")]
    InvalidSettlementState = 19,

    #[error("Unbiased selection exhausted its deterministic candidates")]
    SelectionRetriesExhausted = 20,

    #[error("Program account initialization is incomplete or invalid")]
    InvalidInitializationState = 21,

    #[error("The draw countdown is still active")]
    CountdownActive = 22,
}

error!(FateError);
