pub const STAKE_POOL_SEED: &[u8] = b"stake_pool";
pub const USER_STAKE_SEED: &[u8] = b"user_stake";
pub const VAULT_SEED: &[u8] = b"vault";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";

/// Precision multiplier for reward math (10^12).
/// Keeps intermediate u128 products within bounds for 6-decimal tokens.
pub const PRECISION: u128 = 1_000_000_000_000;

/// Minimum stake: 1 token (1_000_000 base units at 6 decimals)
pub const MIN_STAKE_AMOUNT: u64 = 1_000_000;

/// Seconds in a year (365 days). Used for APR ↔ reward_rate conversion.
pub const SECONDS_PER_YEAR: u64 = 31_536_000;

/// Cap on `reward_rate` — equivalent to ~1000% APR (10× stake per year).
/// 1000% APR = 10.0 * PRECISION / SECONDS_PER_YEAR ≈ 317_097.
pub const MAX_REWARD_RATE: u64 = 317_100;
