# Steak Protocol — Developer Documentation

Steak is a Solana staking program for pump.fun Token-2022 meme coins. One deployment, unlimited pools — anyone can create a staking pool for any token.

**Program ID:** `DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae`
**Network:** Solana Mainnet
**Token standard:** Token-2022 (SPL Token Extensions)

---

## How It Works

A pool creator picks a pump.fun token, sets a reward rate (tokens per second), and funds a reward vault. Users stake tokens and earn rewards proportional to their share of the pool over time. Anyone can create pools, anyone can stake, anyone can fund rewards.

```
Pool Creator                          Users
    │                                   │
    ├── initialize_pool ──────────┐     │
    ├── fund_rewards ─────────────┤     │
    │                             │     │
    │                         [POOL]    │
    │                             │     │
    │                             ├── stake
    │                             ├── claim_rewards
    │                             ├── unstake
    │                             │
    ├── update_pool               │
    └── close_pool                │
```

---

## Accounts

### StakePool

One per token-per-creator. Stores pool configuration and reward tracking.

**PDA seeds:** `["stake_pool", mint_pubkey, authority_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| authority | Pubkey | Pool creator, can update/close |
| stake_mint | Pubkey | Token mint (Token-2022) |
| token_program | Pubkey | Token-2022 program ID |
| vault | Pubkey | PDA token account holding staked tokens |
| reward_vault | Pubkey | PDA token account holding reward tokens |
| total_staked | u64 | Sum of all user stakes |
| reward_rate | u64 | Tokens emitted per second (base units) |
| reward_per_token_stored | u128 | Accumulated reward accumulator (scaled by 10^12) |
| last_update_time | i64 | Unix timestamp of last reward update |
| reward_end_time | i64 | When rewards stop (0 = never) |
| is_active | bool | Whether new stakes are accepted |

### UserStake

One per user-per-pool. Tracks individual staking position.

**PDA seeds:** `["user_stake", pool_pubkey, user_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| pool | Pubkey | Which pool this stake belongs to |
| user | Pubkey | The staker |
| staked_amount | u64 | Tokens currently staked |
| reward_per_token_paid | u128 | Snapshot of accumulator at last claim |
| rewards_pending | u64 | Accrued unclaimed rewards |
| last_stake_time | i64 | Timestamp of last stake/unstake |

### Vault & Reward Vault

PDA token accounts owned by the StakePool PDA. Created automatically during `initialize_pool`.

| Account | PDA Seeds | Purpose |
|---------|-----------|---------|
| Vault | `["vault", pool_pubkey]` | Holds staked tokens |
| Reward Vault | `["reward_vault", pool_pubkey]` | Holds reward tokens |

---

## Instructions

### 1. initialize_pool

Creates a new staking pool for a Token-2022 mint.

**Who can call:** Anyone (the signer becomes the pool authority)

**Arguments:**
```typescript
{
  rewardRate: BN,      // tokens per second in base units (e.g., 10_000_000 = 10 tokens/sec at 6 decimals)
  rewardEndTime: BN,   // unix timestamp when rewards stop (0 = no end)
}
```

**Accounts:**
```typescript
{
  authority: Signer,           // pool creator (becomes authority)
  stakeMint: Token-2022 Mint,  // the pump.fun token
  stakePool: PDA,              // derived from ["stake_pool", mint, authority]
  vault: PDA,                  // derived from ["vault", stakePool]
  rewardVault: PDA,            // derived from ["reward_vault", stakePool]
  systemProgram: SystemProgram,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  rent: SYSVAR_RENT,
}
```

**Cost:** ~0.05 SOL (rent for pool + vault accounts)

**Example:**
```typescript
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

const PROGRAM_ID = new PublicKey("DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae");
const mint = new PublicKey("YOUR_PUMP_FUN_TOKEN_MINT");

// Derive PDAs
const [stakePool] = PublicKey.findProgramAddressSync(
  [Buffer.from("stake_pool"), mint.toBuffer(), wallet.publicKey.toBuffer()],
  PROGRAM_ID
);
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), stakePool.toBuffer()],
  PROGRAM_ID
);
const [rewardVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("reward_vault"), stakePool.toBuffer()],
  PROGRAM_ID
);

await program.methods
  .initializePool({
    rewardRate: new BN(10_000_000),  // 10 tokens/sec
    rewardEndTime: new BN(0),        // no end
  })
  .accounts({
    authority: wallet.publicKey,
    stakeMint: mint,
    stakePool,
    vault,
    rewardVault,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

---

### 2. fund_rewards

Deposit tokens into the reward vault. These tokens are distributed to stakers over time.

**Who can call:** Anyone (permissionless)

**Arguments:**
```typescript
amount: BN  // tokens to deposit in base units
```

**Accounts:**
```typescript
{
  funder: Signer,              // whoever is depositing
  stakePool: PDA,
  rewardVault: PDA,
  funderTokenAccount: ATA,     // funder's token account
  stakeMint: Token-2022 Mint,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
}
```

**Example:**
```typescript
await program.methods
  .fundRewards(new BN(1_000_000 * 1_000_000))  // 1M tokens
  .accounts({
    funder: wallet.publicKey,
    stakePool,
    rewardVault,
    funderTokenAccount: funderAta,
    stakeMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

---

### 3. stake

Deposit tokens into the staking vault. Creates a UserStake account on first call.

**Who can call:** Any token holder (pool must be active)

**Arguments:**
```typescript
amount: BN  // tokens to stake in base units (min 1_000_000 = 1 token on first stake)
```

**Accounts:**
```typescript
{
  user: Signer,
  stakePool: PDA,
  userStake: PDA,              // derived from ["user_stake", stakePool, user]
  vault: PDA,
  userTokenAccount: ATA,       // user's token account
  stakeMint: Token-2022 Mint,
  systemProgram: SystemProgram,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
}
```

**Example:**
```typescript
const [userStake] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_stake"), stakePool.toBuffer(), wallet.publicKey.toBuffer()],
  PROGRAM_ID
);

await program.methods
  .stake(new BN(50_000 * 1_000_000))  // 50K tokens
  .accounts({
    user: wallet.publicKey,
    stakePool,
    userStake,
    vault,
    userTokenAccount: userAta,
    stakeMint: mint,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

**Notes:**
- First stake must be >= 1 token (1,000,000 base units)
- Additional stakes can be any amount > 0
- Pending rewards are synced before adding to the stake

---

### 4. unstake

Withdraw staked tokens. Instant — no lock period.

**Who can call:** Only the user who staked (enforced by PDA + `has_one`)

**Arguments:**
```typescript
amount: BN  // tokens to withdraw (must be <= staked_amount)
```

**Accounts:**
```typescript
{
  user: Signer,
  stakePool: PDA,
  userStake: PDA,
  vault: PDA,
  userTokenAccount: ATA,
  stakeMint: Token-2022 Mint,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
}
```

**Example:**
```typescript
await program.methods
  .unstake(new BN(25_000 * 1_000_000))  // unstake 25K tokens
  .accounts({
    user: wallet.publicKey,
    stakePool,
    userStake,
    vault,
    userTokenAccount: userAta,
    stakeMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

**Notes:**
- Works even when pool is paused (users can always exit)
- Pending rewards are synced before unstaking
- Partial unstake is supported

---

### 5. claim_rewards

Claim accrued rewards. Transfers tokens from the reward vault to the user.

**Who can call:** Only the staker

**Arguments:** None

**Accounts:**
```typescript
{
  user: Signer,
  stakePool: PDA,
  userStake: PDA,
  rewardVault: PDA,
  userTokenAccount: ATA,
  stakeMint: Token-2022 Mint,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
}
```

**Example:**
```typescript
await program.methods
  .claimRewards()
  .accounts({
    user: wallet.publicKey,
    stakePool,
    userStake,
    rewardVault,
    userTokenAccount: userAta,
    stakeMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

**Notes:**
- Fails with `NoRewardsToClaim` if nothing is pending
- Fails with `InsufficientRewardFunds` if reward vault is empty

---

### 6. update_pool

Change pool parameters. Only the pool authority can call.

**Arguments:**
```typescript
{
  rewardRate: BN | null,      // new rate (null = no change)
  rewardEndTime: BN | null,   // new end time (null = no change)
  isActive: boolean | null,   // pause/unpause (null = no change)
}
```

**Accounts:**
```typescript
{
  authority: Signer,
  stakePool: PDA,
}
```

**Example — pause the pool:**
```typescript
await program.methods
  .updatePool({ rewardRate: null, rewardEndTime: null, isActive: false })
  .accounts({ authority: wallet.publicKey, stakePool })
  .rpc();
```

**Notes:**
- Reward accumulator is updated before changing rate (locks in rewards at old rate)
- Pausing blocks new stakes but unstake/claim still work

---

### 7. close_pool

Close the pool and recover rent. Sweeps remaining reward vault tokens to authority.

**Who can call:** Only pool authority, and only when `total_staked == 0`

**Accounts:**
```typescript
{
  authority: Signer,
  stakePool: PDA,
  vault: PDA,
  rewardVault: PDA,
  authorityTokenAccount: ATA,  // receives swept reward tokens
  stakeMint: Token-2022 Mint,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
}
```

**Example:**
```typescript
await program.methods
  .closePool()
  .accounts({
    authority: wallet.publicKey,
    stakePool,
    vault,
    rewardVault,
    authorityTokenAccount: authorityAta,
    stakeMint: mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

---

## PDA Derivation Reference

All PDAs use program ID `DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae`.

```typescript
const PROGRAM_ID = new PublicKey("DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae");

// Pool
const [stakePool] = PublicKey.findProgramAddressSync(
  [Buffer.from("stake_pool"), mint.toBuffer(), authority.toBuffer()],
  PROGRAM_ID
);

// Vault (staked tokens)
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), stakePool.toBuffer()],
  PROGRAM_ID
);

// Reward vault (reward tokens)
const [rewardVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("reward_vault"), stakePool.toBuffer()],
  PROGRAM_ID
);

// User stake account
const [userStake] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_stake"), stakePool.toBuffer(), user.toBuffer()],
  PROGRAM_ID
);
```

---

## Reward Math

The program uses the Synthetix `reward_per_token` model. Rewards accrue continuously based on time and are distributed proportionally to each staker's share.

**Global update (runs on every stake/unstake/claim):**
```
if total_staked > 0:
    time_elapsed = now - last_update_time
    reward_per_token_stored += (time_elapsed * reward_rate * 10^12) / total_staked
```

**Per-user calculation:**
```
pending = staked_amount * (reward_per_token_stored - reward_per_token_paid) / 10^12
total_claimable = rewards_pending + pending
```

**Example:**
```
Pool: reward_rate = 10 tokens/sec, total_staked = 100 tokens
User A staked 60 tokens (60%), User B staked 40 tokens (40%)
After 100 seconds:
  Total rewards = 10 * 100 = 1,000 tokens
  User A earns = 1,000 * 60% = 600 tokens
  User B earns = 1,000 * 40% = 400 tokens
```

---

## Calculating Reward Rate

The reward rate is in **base units per second**. Pump.fun tokens have 6 decimals, so 1 token = 1,000,000 base units.

| Desired rate | reward_rate value |
|-------------|-------------------|
| 1 token/sec | 1,000,000 |
| 10 tokens/sec | 10,000,000 |
| 100 tokens/sec | 100,000,000 |
| 1,000 tokens/day | 1,000,000,000,000 / 86,400 ≈ 11,574,074 |

**How long will rewards last:**
```
duration_seconds = reward_vault_balance / reward_rate
```

Example: 1M tokens funded, rate = 10 tokens/sec → lasts 100,000 seconds ≈ 27.7 hours.

---

## Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0x1770 | AmountZero | Amount must be > 0 |
| 0x1771 | BelowMinimumStake | First stake must be >= 1 token |
| 0x1772 | InsufficientStake | Trying to unstake more than staked |
| 0x1773 | PoolNotActive | Pool is paused |
| 0x1774 | MathOverflow | Arithmetic overflow |
| 0x1775 | Unauthorized | Signer is not pool authority |
| 0x1776 | InsufficientRewardFunds | Reward vault empty |
| 0x1777 | InvalidMint | Token mint mismatch |
| 0x1778 | PoolHasStakers | Cannot close pool with active stakers |
| 0x1779 | NoRewardsToClaim | No pending rewards |

---

## Security Model

| Scenario | Protection |
|----------|-----------|
| Someone unstakes your tokens | Impossible — PDA derived from your pubkey + `has_one = user` + `Signer` check |
| Someone claims your rewards | Impossible — same PDA + signer protections |
| Unstake more than staked | Blocked — `amount <= staked_amount` check |
| Admin drains staking vault | Impossible — vault authority is PDA, not admin |
| Admin closes pool while users staked | Blocked — `total_staked == 0` constraint |
| Admin changes reward rate | Allowed — but accumulator is updated first (existing rewards locked in) |
| Admin pauses pool | Allowed — but unstake and claim always work even when paused |

---

## Quick Start: Create a Pool in 3 Transactions

```typescript
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae");
const mint = new PublicKey("YOUR_PUMP_FUN_TOKEN_MINT");

// 1. Derive all PDAs
const [stakePool] = PublicKey.findProgramAddressSync(
  [Buffer.from("stake_pool"), mint.toBuffer(), wallet.publicKey.toBuffer()], PROGRAM_ID);
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), stakePool.toBuffer()], PROGRAM_ID);
const [rewardVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("reward_vault"), stakePool.toBuffer()], PROGRAM_ID);

// 2. Create pool (1 tx)
await program.methods.initializePool({
  rewardRate: new BN(10_000_000),  // 10 tokens/sec
  rewardEndTime: new BN(0),
}).accounts({
  authority: wallet.publicKey, stakeMint: mint, stakePool, vault, rewardVault,
  systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID,
  rent: SYSVAR_RENT_PUBKEY,
}).rpc();

// 3. Fund rewards (1 tx)
await program.methods.fundRewards(
  new BN(1_000_000 * 1_000_000)  // 1M tokens
).accounts({
  funder: wallet.publicKey, stakePool, rewardVault,
  funderTokenAccount: yourAta, stakeMint: mint,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
}).rpc();

// Done — users can now stake
```
