use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::SteakError;
use crate::state::StakePool;

use super::stake::update_reward_per_token_stored;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdatePoolArgs {
    pub reward_rate: Option<u64>,
    pub reward_end_time: Option<i64>,
    pub is_active: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdatePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.stake_mint.as_ref(), stake_pool.authority.as_ref()],
        bump = stake_pool.bump,
        has_one = authority @ SteakError::Unauthorized,
    )]
    pub stake_pool: Account<'info, StakePool>,
}

pub fn handler(ctx: Context<UpdatePool>, args: UpdatePoolArgs) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.stake_pool;

    // MUST update accumulator before changing reward_rate
    // This locks in accrued rewards at the old rate
    update_reward_per_token_stored(pool, clock.unix_timestamp)?;

    if let Some(reward_rate) = args.reward_rate {
        require!(reward_rate <= MAX_REWARD_RATE, SteakError::RewardRateTooHigh);
        pool.reward_rate = reward_rate;
    }

    if let Some(reward_end_time) = args.reward_end_time {
        pool.reward_end_time = reward_end_time;
    }

    if let Some(is_active) = args.is_active {
        pool.is_active = is_active;
    }

    emit!(PoolUpdated { pool: pool.key() });

    Ok(())
}

#[event]
pub struct PoolUpdated {
    pub pool: Pubkey,
}
