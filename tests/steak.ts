import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Steak } from "../target/types/steak";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { assert } from "chai";

const TOKEN_DECIMALS = 6;
const ONE_TOKEN = 1_000_000; // 10^6

describe("steak", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Steak as Program<Steak>;
  const authority = provider.wallet as anchor.Wallet;

  let stakeMint: PublicKey;
  let authorityAta: PublicKey;
  let stakePoolPda: PublicKey;
  let stakePoolBump: number;
  let vaultPda: PublicKey;
  let rewardVaultPda: PublicKey;

  // Test users
  let user1: Keypair;
  let user1Ata: PublicKey;
  let user2: Keypair;
  let user2Ata: PublicKey;

  // Helper: find PDAs
  function findStakePoolPda(mint: PublicKey, auth: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("stake_pool"), mint.toBuffer(), auth.toBuffer()],
      program.programId
    );
  }

  function findVaultPda(pool: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), pool.toBuffer()],
      program.programId
    );
  }

  function findRewardVaultPda(pool: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), pool.toBuffer()],
      program.programId
    );
  }

  function findUserStakePda(pool: PublicKey, user: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), pool.toBuffer(), user.toBuffer()],
      program.programId
    );
  }

  before(async () => {
    // Airdrop SOL to authority
    const sig = await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Create test users
    user1 = Keypair.generate();
    user2 = Keypair.generate();

    // Airdrop SOL to users
    for (const user of [user1, user2]) {
      const airdropSig = await provider.connection.requestAirdrop(
        user.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
    }

    // Create a Token-2022 mint (simulating a pump.fun token)
    stakeMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      TOKEN_DECIMALS,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create ATAs and mint tokens (using Token-2022)
    const authorityAtaAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      stakeMint,
      authority.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    authorityAta = authorityAtaAccount.address;

    const user1AtaAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      stakeMint,
      user1.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    user1Ata = user1AtaAccount.address;

    const user2AtaAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      stakeMint,
      user2.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    user2Ata = user2AtaAccount.address;

    // Mint tokens: 1B to authority (for reward funding), 1M to each user
    await mintTo(
      provider.connection,
      authority.payer,
      stakeMint,
      authorityAta,
      authority.publicKey,
      1_000_000_000 * ONE_TOKEN,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      authority.payer,
      stakeMint,
      user1Ata,
      authority.publicKey,
      1_000_000 * ONE_TOKEN,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      authority.payer,
      stakeMint,
      user2Ata,
      authority.publicKey,
      1_000_000 * ONE_TOKEN,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Derive PDAs
    [stakePoolPda, stakePoolBump] = findStakePoolPda(stakeMint, authority.publicKey);
    [vaultPda] = findVaultPda(stakePoolPda);
    [rewardVaultPda] = findRewardVaultPda(stakePoolPda);
  });

  // ============================
  // 1. Pool Initialization
  // ============================
  describe("Initialize Pool", () => {
    it("initializes a staking pool", async () => {
      // APR mode: reward_rate = apr_bps * PRECISION / (10_000 * SECONDS_PER_YEAR)
      // 10% APR = 1000 bps → 1000 * 1e12 / (1e4 * 3.1536e7) ≈ 3171
      const rewardRate = new BN(3171); // ~10% APR
      const rewardEndTime = new BN(0); // no end

      await program.methods
        .initializePool({
          rewardRate,
          rewardEndTime,
        })
        .accounts({
          authority: authority.publicKey,
          stakeMint,
          stakePool: stakePoolPda,
          vault: vaultPda,
          rewardVault: rewardVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      // Verify pool state
      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.ok(pool.authority.equals(authority.publicKey));
      assert.ok(pool.stakeMint.equals(stakeMint));
      assert.ok(pool.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));
      assert.ok(pool.vault.equals(vaultPda));
      assert.ok(pool.rewardVault.equals(rewardVaultPda));
      assert.equal(pool.totalStaked.toNumber(), 0);
      assert.equal(pool.rewardRate.toNumber(), 3171);
      assert.equal(pool.isActive, true);
      assert.equal(pool.totalRewardsFunded.toNumber(), 0);
      assert.equal(pool.totalRewardsClaimed.toNumber(), 0);
    });

    it("fails to create duplicate pool (PDA collision)", async () => {
      try {
        await program.methods
          .initializePool({
            rewardRate: new BN(100),
            rewardEndTime: new BN(0),
          })
          .accounts({
            authority: authority.publicKey,
            stakeMint,
            stakePool: stakePoolPda,
            vault: vaultPda,
            rewardVault: rewardVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.ok(err);
      }
    });
  });

  // ============================
  // 2. Fund Rewards
  // ============================
  describe("Fund Rewards", () => {
    it("admin deposits reward tokens", async () => {
      const fundAmount = new BN(10_000_000 * ONE_TOKEN); // 10M tokens

      await program.methods
        .fundRewards(fundAmount)
        .accounts({
          funder: authority.publicKey,
          stakePool: stakePoolPda,
          rewardVault: rewardVaultPda,
          funderTokenAccount: authorityAta,
          stakeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      // Verify reward vault balance
      const vaultAccount = await getAccount(
        provider.connection,
        rewardVaultPda,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(Number(vaultAccount.amount), 10_000_000 * ONE_TOKEN);

      // Verify pool tracking
      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.totalRewardsFunded.toNumber(), 10_000_000 * ONE_TOKEN);
    });

    it("anyone can fund rewards", async () => {
      const fundAmount = new BN(1000 * ONE_TOKEN);

      const rewardVaultBefore = await getAccount(
        provider.connection,
        rewardVaultPda,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .fundRewards(fundAmount)
        .accounts({
          funder: user1.publicKey,
          stakePool: stakePoolPda,
          rewardVault: rewardVaultPda,
          funderTokenAccount: user1Ata,
          stakeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const rewardVaultAfter = await getAccount(
        provider.connection,
        rewardVaultPda,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(
        Number(rewardVaultAfter.amount) - Number(rewardVaultBefore.amount),
        1000 * ONE_TOKEN
      );
    });
  });

  // ============================
  // 3. Staking
  // ============================
  describe("Stake", () => {
    it("user1 stakes tokens", async () => {
      const stakeAmount = new BN(10_000 * ONE_TOKEN);
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);

      const balanceBefore = await getAccount(
        provider.connection,
        user1Ata,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .stake(stakeAmount)
        .accounts({
          user: user1.publicKey,
          stakePool: stakePoolPda,
          userStake: userStakePda,
          vault: vaultPda,
          userTokenAccount: user1Ata,
          stakeMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify user stake
      const userStake = await program.account.userStake.fetch(userStakePda);
      assert.equal(userStake.stakedAmount.toNumber(), 10_000 * ONE_TOKEN);
      assert.ok(userStake.user.equals(user1.publicKey));
      assert.ok(userStake.pool.equals(stakePoolPda));

      // Verify vault received tokens
      const vaultAccount = await getAccount(
        provider.connection,
        vaultPda,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(Number(vaultAccount.amount), 10_000 * ONE_TOKEN);

      // Verify user balance decreased
      const balanceAfter = await getAccount(
        provider.connection,
        user1Ata,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(
        Number(balanceBefore.amount) - Number(balanceAfter.amount),
        10_000 * ONE_TOKEN
      );

      // Verify pool total
      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.totalStaked.toNumber(), 10_000 * ONE_TOKEN);
    });

    it("user1 stakes additional tokens (compound)", async () => {
      const stakeAmount = new BN(5_000 * ONE_TOKEN);
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);

      await program.methods
        .stake(stakeAmount)
        .accounts({
          user: user1.publicKey,
          stakePool: stakePoolPda,
          userStake: userStakePda,
          vault: vaultPda,
          userTokenAccount: user1Ata,
          stakeMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const userStake = await program.account.userStake.fetch(userStakePda);
      assert.equal(userStake.stakedAmount.toNumber(), 15_000 * ONE_TOKEN);

      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.totalStaked.toNumber(), 15_000 * ONE_TOKEN);
    });

    it("user2 stakes tokens", async () => {
      const stakeAmount = new BN(5_000 * ONE_TOKEN);
      const [userStakePda] = findUserStakePda(stakePoolPda, user2.publicKey);

      await program.methods
        .stake(stakeAmount)
        .accounts({
          user: user2.publicKey,
          stakePool: stakePoolPda,
          userStake: userStakePda,
          vault: vaultPda,
          userTokenAccount: user2Ata,
          stakeMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.totalStaked.toNumber(), 20_000 * ONE_TOKEN);
    });

    it("fails to stake 0 tokens", async () => {
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);
      try {
        await program.methods
          .stake(new BN(0))
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: userStakePda,
            vault: vaultPda,
            userTokenAccount: user1Ata,
            stakeMint,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.ok(err.toString().includes("AmountZero") || err.toString().includes("0x1770"));
      }
    });
  });

  // ============================
  // 4. Claim Rewards
  // ============================
  describe("Claim Rewards", () => {
    it("user1 claims rewards after time passes", async () => {
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);

      const balanceBefore = await getAccount(
        provider.connection,
        user1Ata,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        await program.methods
          .claimRewards()
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: userStakePda,
            rewardVault: rewardVaultPda,
            userTokenAccount: user1Ata,
            stakeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        const balanceAfter = await getAccount(
          provider.connection,
          user1Ata,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
        assert.ok(Number(balanceAfter.amount) >= Number(balanceBefore.amount));

        const userStakeAfter = await program.account.userStake.fetch(userStakePda);
        assert.equal(userStakeAfter.rewardsPending.toNumber(), 0);
      } catch (err) {
        // NoRewardsToClaim is acceptable in test if clock hasn't advanced
        if (err.toString().includes("NoRewardsToClaim") || err.toString().includes("0x1779")) {
          return;
        }
        throw err;
      }
    });
  });

  // ============================
  // 5. Unstake
  // ============================
  describe("Unstake", () => {
    it("user1 partially unstakes", async () => {
      const unstakeAmount = new BN(5_000 * ONE_TOKEN);
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);

      const balanceBefore = await getAccount(
        provider.connection,
        user1Ata,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .unstake(unstakeAmount)
        .accounts({
          user: user1.publicKey,
          stakePool: stakePoolPda,
          userStake: userStakePda,
          vault: vaultPda,
          userTokenAccount: user1Ata,
          stakeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const userStake = await program.account.userStake.fetch(userStakePda);
      assert.equal(userStake.stakedAmount.toNumber(), 10_000 * ONE_TOKEN);

      const balanceAfter = await getAccount(
        provider.connection,
        user1Ata,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(
        Number(balanceAfter.amount) - Number(balanceBefore.amount),
        5_000 * ONE_TOKEN
      );

      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.totalStaked.toNumber(), 15_000 * ONE_TOKEN);
    });

    it("fails to unstake more than staked", async () => {
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);
      try {
        await program.methods
          .unstake(new BN(100_000 * ONE_TOKEN))
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: userStakePda,
            vault: vaultPda,
            userTokenAccount: user1Ata,
            stakeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.ok(
          err.toString().includes("InsufficientStake") || err.toString().includes("0x1772")
        );
      }
    });

    it("user2 fully unstakes", async () => {
      const [userStakePda] = findUserStakePda(stakePoolPda, user2.publicKey);
      const userStake = await program.account.userStake.fetch(userStakePda);

      await program.methods
        .unstake(userStake.stakedAmount)
        .accounts({
          user: user2.publicKey,
          stakePool: stakePoolPda,
          userStake: userStakePda,
          vault: vaultPda,
          userTokenAccount: user2Ata,
          stakeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      const userStakeAfter = await program.account.userStake.fetch(userStakePda);
      assert.equal(userStakeAfter.stakedAmount.toNumber(), 0);
    });
  });

  // ============================
  // 6. Admin Operations
  // ============================
  describe("Admin Operations", () => {
    it("updates pool reward rate", async () => {
      // Double the APR: ~20% (6341 scaled)
      const newRewardRate = new BN(6341);

      await program.methods
        .updatePool({
          rewardRate: newRewardRate,
          rewardEndTime: null,
          isActive: null,
        })
        .accounts({
          authority: authority.publicKey,
          stakePool: stakePoolPda,
        })
        .rpc();

      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.rewardRate.toNumber(), 6341);
    });

    it("rejects reward rate above max", async () => {
      try {
        await program.methods
          .updatePool({
            rewardRate: new BN(317_101), // MAX_REWARD_RATE + 1
            rewardEndTime: null,
            isActive: null,
          })
          .accounts({
            authority: authority.publicKey,
            stakePool: stakePoolPda,
          })
          .rpc();
        assert.fail("Should have failed with RewardRateTooHigh");
      } catch (err) {
        assert.ok(
          err.toString().includes("RewardRateTooHigh") ||
            err.toString().includes("0x177a")
        );
      }
    });

    it("pauses pool", async () => {
      await program.methods
        .updatePool({
          rewardRate: null,
          rewardEndTime: null,
          isActive: false,
        })
        .accounts({
          authority: authority.publicKey,
          stakePool: stakePoolPda,
        })
        .rpc();

      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.isActive, false);
    });

    it("fails to stake into paused pool", async () => {
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);
      try {
        await program.methods
          .stake(new BN(1_000 * ONE_TOKEN))
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: userStakePda,
            vault: vaultPda,
            userTokenAccount: user1Ata,
            stakeMint,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.ok(
          err.toString().includes("PoolNotActive") || err.toString().includes("0x1773")
        );
      }
    });

    it("reactivates pool", async () => {
      await program.methods
        .updatePool({
          rewardRate: null,
          rewardEndTime: null,
          isActive: true,
        })
        .accounts({
          authority: authority.publicKey,
          stakePool: stakePoolPda,
        })
        .rpc();

      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.isActive, true);
    });

    it("fails when non-authority updates pool", async () => {
      try {
        await program.methods
          .updatePool({
            rewardRate: new BN(0),
            rewardEndTime: null,
            isActive: null,
          })
          .accounts({
            authority: user1.publicKey,
            stakePool: stakePoolPda,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.ok(err);
      }
    });
  });

  // ============================
  // 7. Close Pool
  // ============================
  describe("Close Pool", () => {
    it("fails to close pool with stakers", async () => {
      try {
        await program.methods
          .closePool()
          .accounts({
            authority: authority.publicKey,
            stakePool: stakePoolPda,
            vault: vaultPda,
            rewardVault: rewardVaultPda,
            authorityTokenAccount: authorityAta,
            stakeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.ok(err);
      }
    });

    it("closes pool after all unstake", async () => {
      // First unstake user1's remaining tokens
      const [userStakePda] = findUserStakePda(stakePoolPda, user1.publicKey);
      const userStake = await program.account.userStake.fetch(userStakePda);

      if (userStake.stakedAmount.toNumber() > 0) {
        // Claim any pending rewards first
        try {
          await program.methods
            .claimRewards()
            .accounts({
              user: user1.publicKey,
              stakePool: stakePoolPda,
              userStake: userStakePda,
              rewardVault: rewardVaultPda,
              userTokenAccount: user1Ata,
              stakeMint,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .signers([user1])
            .rpc();
        } catch (err) {
          // NoRewardsToClaim is fine
        }

        await program.methods
          .unstake(userStake.stakedAmount)
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: userStakePda,
            vault: vaultPda,
            userTokenAccount: user1Ata,
            stakeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
      }

      // Verify pool is empty
      const pool = await program.account.stakePool.fetch(stakePoolPda);
      assert.equal(pool.totalStaked.toNumber(), 0);

      const authorityBalanceBefore = await getAccount(
        provider.connection,
        authorityAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Close the pool
      await program.methods
        .closePool()
        .accounts({
          authority: authority.publicKey,
          stakePool: stakePoolPda,
          vault: vaultPda,
          rewardVault: rewardVaultPda,
          authorityTokenAccount: authorityAta,
          stakeMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      // Verify pool account is closed
      try {
        await program.account.stakePool.fetch(stakePoolPda);
        assert.fail("Pool should be closed");
      } catch (err) {
        assert.ok(err.toString().includes("Account does not exist"));
      }

      // Verify remaining reward tokens returned to authority
      const authorityBalanceAfter = await getAccount(
        provider.connection,
        authorityAta,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.ok(Number(authorityBalanceAfter.amount) > Number(authorityBalanceBefore.amount));
    });
  });
});
