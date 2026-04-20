use anchor_lang::prelude::*;

#[error_code]
pub enum SteakError {
    #[msg("Amount must be greater than zero")]
    AmountZero,

    #[msg("Amount is below the minimum stake")]
    BelowMinimumStake,

    #[msg("Insufficient staked balance")]
    InsufficientStake,

    #[msg("Pool is not active")]
    PoolNotActive,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Unauthorized: signer is not pool authority")]
    Unauthorized,

    #[msg("Reward vault has insufficient funds")]
    InsufficientRewardFunds,

    #[msg("Invalid mint: does not match pool configuration")]
    InvalidMint,

    #[msg("Pool still has stakers; cannot close")]
    PoolHasStakers,

    #[msg("No rewards to claim")]
    NoRewardsToClaim,

    #[msg("Reward rate exceeds max APR bound")]
    RewardRateTooHigh,
}
