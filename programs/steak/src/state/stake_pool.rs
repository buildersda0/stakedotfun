use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StakePool {
    /// The authority (admin) who created and controls this pool
    pub authority: Pubkey,

    /// The SPL token mint being staked (Token-2022 pump.fun token, also used for rewards)
    pub stake_mint: Pubkey,

    /// The token program (Token or Token-2022)
    pub token_program: Pubkey,

    /// Token account PDA holding staked tokens
    pub vault: Pubkey,

    /// Token account PDA holding reward tokens
    pub reward_vault: Pubkey,

    /// Total tokens currently staked across all users
    pub total_staked: u64,

    /// PRECISION-scaled APR fraction per second: each staked base-unit accrues
    /// `reward_rate / PRECISION` tokens per second. Convert from basis-points-
    /// per-year via `reward_rate = apr_bps * PRECISION / (10_000 * SECONDS_PER_YEAR)`.
    /// Capped by `MAX_REWARD_RATE` (~1000% APR).
    pub reward_rate: u64,

    /// Accumulated reward per token (PRECISION-scaled). Per-user delta
    /// consumed by `sync_user_rewards` as `staked * delta / PRECISION`.
    pub reward_per_token_stored: u128,

    /// Last time rewards were updated (Unix timestamp)
    pub last_update_time: i64,

    /// Timestamp when rewards distribution ends (0 = no end)
    pub reward_end_time: i64,

    /// Whether the pool is accepting stakes
    pub is_active: bool,

    /// PDA bump seed
    pub bump: u8,

    /// Vault PDA bump seed
    pub vault_bump: u8,

    /// Reward vault PDA bump seed
    pub reward_vault_bump: u8,

    /// Total rewards funded into the pool
    pub total_rewards_funded: u64,

    /// Total rewards claimed from the pool
    pub total_rewards_claimed: u64,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 32],
}
