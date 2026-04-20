use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::SteakError;
use crate::state::{StakePool, UserStake};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.stake_mint.as_ref(), stake_pool.authority.as_ref()],
        bump = stake_pool.bump,
        constraint = stake_pool.is_active @ SteakError::PoolNotActive,
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserStake::INIT_SPACE,
        seeds = [USER_STAKE_SEED, stake_pool.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(
        mut,
        seeds = [VAULT_SEED, stake_pool.key().as_ref()],
        bump = stake_pool.vault_bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.mint == stake_pool.stake_mint @ SteakError::InvalidMint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub stake_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, SteakError::AmountZero);

    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.stake_pool;
    let user_stake = &mut ctx.accounts.user_stake;

    // Update global reward accumulator
    update_reward_per_token_stored(pool, clock.unix_timestamp)?;

    // Sync user rewards if they already have a stake
    if user_stake.staked_amount > 0 {
        sync_user_rewards(pool, user_stake)?;
    }

    // Enforce minimum on first stake
    if user_stake.staked_amount == 0 {
        require!(amount >= MIN_STAKE_AMOUNT, SteakError::BelowMinimumStake);

        // Initialize user stake fields on first stake
        user_stake.pool = pool.key();
        user_stake.user = ctx.accounts.user.key();
        user_stake.reward_per_token_paid = pool.reward_per_token_stored;
        user_stake.rewards_pending = 0;
        user_stake.bump = ctx.bumps.user_stake;
        user_stake._reserved = [0u8; 32];
    }

    let decimals = ctx.accounts.stake_mint.decimals;

    // Transfer tokens from user to vault
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_token_account.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    // Update balances
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_add(amount)
        .ok_or(SteakError::MathOverflow)?;
    user_stake.last_stake_time = clock.unix_timestamp;

    pool.total_staked = pool
        .total_staked
        .checked_add(amount)
        .ok_or(SteakError::MathOverflow)?;

    emit!(Staked {
        user: ctx.accounts.user.key(),
        pool: pool.key(),
        amount,
        total_staked: pool.total_staked,
    });

    Ok(())
}

/// Update the global reward_per_token_stored accumulator.
///
/// APR mode: `reward_rate` is a PRECISION-scaled per-second APR fraction, so
/// each staked base-unit earns `reward_rate / PRECISION` tokens per second.
/// The accumulator itself is PRECISION-scaled to preserve precision for
/// `sync_user_rewards`, so we only multiply by `reward_rate * dt` here.
pub fn update_reward_per_token_stored(pool: &mut StakePool, current_time: i64) -> Result<()> {
    let applicable_time = if pool.reward_end_time > 0 {
        current_time.min(pool.reward_end_time)
    } else {
        current_time
    };

    if pool.total_staked > 0 && applicable_time > pool.last_update_time {
        let time_elapsed = (applicable_time - pool.last_update_time) as u128;
        let reward_accrued = time_elapsed
            .checked_mul(pool.reward_rate as u128)
            .ok_or(SteakError::MathOverflow)?;

        pool.reward_per_token_stored = pool
            .reward_per_token_stored
            .checked_add(reward_accrued)
            .ok_or(SteakError::MathOverflow)?;
    }

    pool.last_update_time = applicable_time;
    Ok(())
}

/// Sync a user's pending rewards based on the current global accumulator
pub fn sync_user_rewards(pool: &StakePool, user_stake: &mut UserStake) -> Result<()> {
    let reward_per_token_delta = pool
        .reward_per_token_stored
        .checked_sub(user_stake.reward_per_token_paid)
        .ok_or(SteakError::MathOverflow)?;

    let new_rewards = (user_stake.staked_amount as u128)
        .checked_mul(reward_per_token_delta)
        .ok_or(SteakError::MathOverflow)?
        .checked_div(PRECISION)
        .ok_or(SteakError::MathOverflow)? as u64;

    user_stake.rewards_pending = user_stake
        .rewards_pending
        .checked_add(new_rewards)
        .ok_or(SteakError::MathOverflow)?;

    user_stake.reward_per_token_paid = pool.reward_per_token_stored;
    Ok(())
}

#[event]
pub struct Staked {
    pub user: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
}
