use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::SteakError;
use crate::state::{StakePool, UserStake};

use super::stake::{update_reward_per_token_stored, sync_user_rewards};

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.stake_mint.as_ref(), stake_pool.authority.as_ref()],
        bump = stake_pool.bump,
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [USER_STAKE_SEED, stake_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        has_one = user,
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED, stake_pool.key().as_ref()],
        bump = stake_pool.reward_vault_bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_account.mint == stake_pool.stake_mint @ SteakError::InvalidMint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub stake_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClaimRewards>) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.stake_pool;
    let user_stake = &mut ctx.accounts.user_stake;

    // Update rewards
    update_reward_per_token_stored(pool, clock.unix_timestamp)?;
    sync_user_rewards(pool, user_stake)?;

    let rewards = user_stake.rewards_pending;
    require!(rewards > 0, SteakError::NoRewardsToClaim);
    require!(
        ctx.accounts.reward_vault.amount >= rewards,
        SteakError::InsufficientRewardFunds
    );

    let decimals = ctx.accounts.stake_mint.decimals;

    // Build PDA signer seeds
    let stake_mint_key = pool.stake_mint;
    let authority_key = pool.authority;
    let pool_seeds = &[
        STAKE_POOL_SEED,
        stake_mint_key.as_ref(),
        authority_key.as_ref(),
        &[pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    // Transfer rewards from reward_vault to user
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: pool.to_account_info(),
            },
            signer_seeds,
        ),
        rewards,
        decimals,
    )?;

    // Reset pending rewards
    user_stake.rewards_pending = 0;

    pool.total_rewards_claimed = pool
        .total_rewards_claimed
        .checked_add(rewards)
        .ok_or(SteakError::MathOverflow)?;

    emit!(RewardsClaimed {
        user: ctx.accounts.user.key(),
        pool: pool.key(),
        amount: rewards,
    });

    Ok(())
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
}
