use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::SteakError;
use crate::state::StakePool;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializePoolArgs {
    pub reward_rate: u64,
    pub reward_end_time: i64,
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The pump.fun Token-2022 mint to stake (and earn rewards in)
    pub stake_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        space = 8 + StakePool::INIT_SPACE,
        seeds = [STAKE_POOL_SEED, stake_mint.key().as_ref(), authority.key().as_ref()],
        bump,
    )]
    pub stake_pool: Box<Account<'info, StakePool>>,

    /// CHECK: Initialized as token account via CPI in handler
    #[account(
        mut,
        seeds = [VAULT_SEED, stake_pool.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: Initialized as token account via CPI in handler
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED, stake_pool.key().as_ref()],
        bump,
    )]
    pub reward_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializePool>, args: InitializePoolArgs) -> Result<()> {
    require!(args.reward_rate <= MAX_REWARD_RATE, SteakError::RewardRateTooHigh);

    let clock = Clock::get()?;

    let stake_pool_key = ctx.accounts.stake_pool.key();
    let stake_mint_key = ctx.accounts.stake_mint.key();
    let authority_key = ctx.accounts.authority.key();
    let token_program_key = ctx.accounts.token_program.key();

    // Manually create and init vault token account
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, stake_pool_key.as_ref(), &[vault_bump]];
    let vault_signer_seeds = &[vault_seeds];

    // Calculate space for Token-2022 account (165 bytes for base token account)
    let token_account_space: usize = 165; // SPL token account size
    let rent = &ctx.accounts.rent;
    let lamports = rent.minimum_balance(token_account_space);

    // Create vault account
    system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::CreateAccount {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
            vault_signer_seeds,
        ),
        lamports,
        token_account_space as u64,
        &token_program_key,
    )?;

    // Initialize vault as token account
    anchor_spl::token_interface::initialize_account3(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::InitializeAccount3 {
                account: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
                authority: ctx.accounts.stake_pool.to_account_info(),
            },
        ),
    )?;

    // Create reward vault account
    let reward_vault_bump = ctx.bumps.reward_vault;
    let rv_seeds: &[&[u8]] = &[REWARD_VAULT_SEED, stake_pool_key.as_ref(), &[reward_vault_bump]];
    let rv_signer_seeds = &[rv_seeds];

    system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::CreateAccount {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
            },
            rv_signer_seeds,
        ),
        lamports,
        token_account_space as u64,
        &token_program_key,
    )?;

    anchor_spl::token_interface::initialize_account3(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::InitializeAccount3 {
                account: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
                authority: ctx.accounts.stake_pool.to_account_info(),
            },
        ),
    )?;

    // Populate pool state
    let pool = &mut ctx.accounts.stake_pool;
    pool.authority = authority_key;
    pool.stake_mint = stake_mint_key;
    pool.token_program = token_program_key;
    pool.vault = ctx.accounts.vault.key();
    pool.reward_vault = ctx.accounts.reward_vault.key();
    pool.total_staked = 0;
    pool.reward_rate = args.reward_rate;
    pool.reward_per_token_stored = 0;
    pool.last_update_time = clock.unix_timestamp;
    pool.reward_end_time = args.reward_end_time;
    pool.is_active = true;
    pool.bump = ctx.bumps.stake_pool;
    pool.vault_bump = vault_bump;
    pool.reward_vault_bump = reward_vault_bump;
    pool.total_rewards_funded = 0;
    pool.total_rewards_claimed = 0;
    pool._reserved = [0u8; 32];

    emit!(PoolInitialized {
        pool: pool.key(),
        authority: pool.authority,
        stake_mint: pool.stake_mint,
        reward_rate: pool.reward_rate,
    });

    Ok(())
}

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub stake_mint: Pubkey,
    pub reward_rate: u64,
}
