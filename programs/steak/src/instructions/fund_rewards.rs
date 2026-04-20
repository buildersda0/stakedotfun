use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::SteakError;
use crate::state::StakePool;

#[derive(Accounts)]
pub struct FundRewards<'info> {
    /// Anyone can fund rewards — not restricted to pool authority
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.stake_mint.as_ref(), stake_pool.authority.as_ref()],
        bump = stake_pool.bump,
        has_one = reward_vault,
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(mut)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = funder_token_account.mint == stake_pool.stake_mint @ SteakError::InvalidMint,
        constraint = funder_token_account.owner == funder.key(),
    )]
    pub funder_token_account: InterfaceAccount<'info, TokenAccount>,

    pub stake_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, SteakError::AmountZero);

    let decimals = ctx.accounts.stake_mint.decimals;

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.funder_token_account.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    let pool = &mut ctx.accounts.stake_pool;
    pool.total_rewards_funded = pool
        .total_rewards_funded
        .checked_add(amount)
        .ok_or(SteakError::MathOverflow)?;

    emit!(RewardsFunded {
        pool: pool.key(),
        funder: ctx.accounts.funder.key(),
        amount,
        total_funded: pool.total_rewards_funded,
    });

    Ok(())
}

#[event]
pub struct RewardsFunded {
    pub pool: Pubkey,
    pub funder: Pubkey,
    pub amount: u64,
    pub total_funded: u64,
}
