use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::SteakError;
use crate::state::StakePool;

#[derive(Accounts)]
pub struct ClosePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.stake_mint.as_ref(), stake_pool.authority.as_ref()],
        bump = stake_pool.bump,
        has_one = authority @ SteakError::Unauthorized,
        constraint = stake_pool.total_staked == 0 @ SteakError::PoolHasStakers,
        close = authority,
    )]
    pub stake_pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [VAULT_SEED, stake_pool.key().as_ref()],
        bump = stake_pool.vault_bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED, stake_pool.key().as_ref()],
        bump = stake_pool.reward_vault_bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,

    /// Where remaining tokens get swept to
    #[account(
        mut,
        constraint = authority_token_account.mint == stake_pool.stake_mint @ SteakError::InvalidMint,
    )]
    pub authority_token_account: InterfaceAccount<'info, TokenAccount>,

    pub stake_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClosePool>) -> Result<()> {
    let pool = &ctx.accounts.stake_pool;
    let decimals = ctx.accounts.stake_mint.decimals;

    let stake_mint_key = pool.stake_mint;
    let authority_key = pool.authority;
    let pool_seeds = &[
        STAKE_POOL_SEED,
        stake_mint_key.as_ref(),
        authority_key.as_ref(),
        &[pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    // Sweep any remaining reward vault tokens to authority
    let reward_vault_balance = ctx.accounts.reward_vault.amount;
    if reward_vault_balance > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.stake_mint.to_account_info(),
                    to: ctx.accounts.authority_token_account.to_account_info(),
                    authority: ctx.accounts.stake_pool.to_account_info(),
                },
                signer_seeds,
            ),
            reward_vault_balance,
            decimals,
        )?;
    }

    // Close reward vault (rent refund to authority)
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.reward_vault.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: ctx.accounts.stake_pool.to_account_info(),
        },
        signer_seeds,
    ))?;

    // Close vault (should be empty since total_staked == 0)
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: ctx.accounts.stake_pool.to_account_info(),
        },
        signer_seeds,
    ))?;

    emit!(PoolClosed {
        pool: ctx.accounts.stake_pool.key(),
    });

    Ok(())
}

#[event]
pub struct PoolClosed {
    pub pool: Pubkey,
}
