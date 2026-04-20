use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("DNKutNU2kSDyssGvn9DdKD9NQWPqGX6wXV2zeTjXeXyU");

#[program]
pub mod steak {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        args: InitializePoolArgs,
    ) -> Result<()> {
        instructions::initialize_pool::handler(ctx, args)
    }

    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        instructions::fund_rewards::handler(ctx, amount)
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler(ctx, amount)
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::unstake::handler(ctx, amount)
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::claim_rewards::handler(ctx)
    }

    pub fn update_pool(ctx: Context<UpdatePool>, args: UpdatePoolArgs) -> Result<()> {
        instructions::update_pool::handler(ctx, args)
    }

    pub fn close_pool(ctx: Context<ClosePool>) -> Result<()> {
        instructions::close_pool::handler(ctx)
    }
}
