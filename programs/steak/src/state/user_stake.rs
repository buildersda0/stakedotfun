use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserStake {
    /// The stake pool this stake belongs to
    pub pool: Pubkey,

    /// The user who owns this stake
    pub user: Pubkey,

    /// Amount of tokens currently staked
    pub staked_amount: u64,

    /// reward_per_token_stored snapshot at last update
    pub reward_per_token_paid: u128,

    /// Accrued but unclaimed rewards
    pub rewards_pending: u64,

    /// Timestamp of last stake/unstake action
    pub last_stake_time: i64,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 32],
}
