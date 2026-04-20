import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Steak } from "../target/types/steak";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";

const STAKE_MINT = new PublicKey("AnHAvm46SsF45FpysW2aq6Cs2ekDmGRFjWHuAko8Hg1V");
const ONE_TOKEN = 1_000_000;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Steak as Program<Steak>;
  const authority = provider.wallet as anchor.Wallet;

  console.log("=== STEAK Devnet Test ===");
  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Stake Mint:", STAKE_MINT.toBase58());
  console.log("Token Program: Token-2022");
  console.log();

  // Derive PDAs
  const [stakePoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake_pool"), STAKE_MINT.toBuffer(), authority.publicKey.toBuffer()],
    program.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), stakePoolPda.toBuffer()],
    program.programId
  );
  const [rewardVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), stakePoolPda.toBuffer()],
    program.programId
  );
  const [userStakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_stake"), stakePoolPda.toBuffer(), authority.publicKey.toBuffer()],
    program.programId
  );

  // Get authority ATA
  const authorityAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    STAKE_MINT,
    authority.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("Authority ATA:", authorityAta.address.toBase58());
  console.log("Authority balance:", Number(authorityAta.amount) / ONE_TOKEN, "tokens");
  console.log();

  // 1. Initialize Pool
  console.log("--- 1. Initialize Pool ---");
  try {
    const rewardRate = new BN(10 * ONE_TOKEN); // 10 tokens/sec
    const tx = await program.methods
      .initializePool({
        rewardRate,
        rewardEndTime: new BN(0),
      })
      .accounts({
        authority: authority.publicKey,
        stakeMint: STAKE_MINT,
        stakePool: stakePoolPda,
        vault: vaultPda,
        rewardVault: rewardVaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log("Pool initialized! TX:", tx);
  } catch (err: any) {
    if (err.toString().includes("already in use")) {
      console.log("Pool already exists, skipping...");
    } else {
      throw err;
    }
  }

  const pool = await program.account.stakePool.fetch(stakePoolPda);
  console.log("Pool address:", stakePoolPda.toBase58());
  console.log("Reward rate:", pool.rewardRate.toNumber() / ONE_TOKEN, "tokens/sec");
  console.log("Total staked:", pool.totalStaked.toNumber() / ONE_TOKEN, "tokens");
  console.log();

  // 2. Fund Rewards
  console.log("--- 2. Fund Rewards (1M tokens) ---");
  try {
    const tx = await program.methods
      .fundRewards(new BN(1_000_000 * ONE_TOKEN))
      .accounts({
        funder: authority.publicKey,
        stakePool: stakePoolPda,
        rewardVault: rewardVaultPda,
        funderTokenAccount: authorityAta.address,
        stakeMint: STAKE_MINT,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log("Funded! TX:", tx);
  } catch (err: any) {
    console.log("Fund error:", err.message);
  }

  const rewardVaultAccount = await getAccount(
    provider.connection,
    rewardVaultPda,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("Reward vault balance:", Number(rewardVaultAccount.amount) / ONE_TOKEN, "tokens");
  console.log();

  // 3. Stake
  console.log("--- 3. Stake 10,000 tokens ---");
  try {
    const tx = await program.methods
      .stake(new BN(10_000 * ONE_TOKEN))
      .accounts({
        user: authority.publicKey,
        stakePool: stakePoolPda,
        userStake: userStakePda,
        vault: vaultPda,
        userTokenAccount: authorityAta.address,
        stakeMint: STAKE_MINT,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log("Staked! TX:", tx);
  } catch (err: any) {
    console.log("Stake error:", err.message);
  }

  const userStake = await program.account.userStake.fetch(userStakePda);
  console.log("Your staked amount:", userStake.stakedAmount.toNumber() / ONE_TOKEN, "tokens");
  console.log("Pending rewards:", userStake.rewardsPending.toNumber() / ONE_TOKEN, "tokens");
  console.log();

  // 4. Wait and claim
  console.log("--- 4. Waiting 3 seconds for rewards to accrue... ---");
  await new Promise((r) => setTimeout(r, 3000));

  console.log("--- 5. Claim Rewards ---");
  try {
    const tx = await program.methods
      .claimRewards()
      .accounts({
        user: authority.publicKey,
        stakePool: stakePoolPda,
        userStake: userStakePda,
        rewardVault: rewardVaultPda,
        userTokenAccount: authorityAta.address,
        stakeMint: STAKE_MINT,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log("Claimed! TX:", tx);
  } catch (err: any) {
    console.log("Claim result:", err.message);
  }

  const userStakeAfter = await program.account.userStake.fetch(userStakePda);
  console.log("Pending rewards after claim:", userStakeAfter.rewardsPending.toNumber() / ONE_TOKEN, "tokens");
  console.log();

  // 5. Partial unstake
  console.log("--- 6. Unstake 5,000 tokens ---");
  try {
    const tx = await program.methods
      .unstake(new BN(5_000 * ONE_TOKEN))
      .accounts({
        user: authority.publicKey,
        stakePool: stakePoolPda,
        userStake: userStakePda,
        vault: vaultPda,
        userTokenAccount: authorityAta.address,
        stakeMint: STAKE_MINT,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log("Unstaked! TX:", tx);
  } catch (err: any) {
    console.log("Unstake error:", err.message);
  }

  const finalStake = await program.account.userStake.fetch(userStakePda);
  const finalPool = await program.account.stakePool.fetch(stakePoolPda);
  const finalBalance = await getAccount(
    provider.connection,
    authorityAta.address,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log();
  console.log("=== Final State ===");
  console.log("Your staked:", finalStake.stakedAmount.toNumber() / ONE_TOKEN, "tokens");
  console.log("Pool total staked:", finalPool.totalStaked.toNumber() / ONE_TOKEN, "tokens");
  console.log("Your wallet balance:", Number(finalBalance.amount) / ONE_TOKEN, "tokens");
  console.log("Total rewards claimed:", finalPool.totalRewardsClaimed.toNumber() / ONE_TOKEN, "tokens");
  console.log();
  console.log("View program: https://solscan.io/account/" + program.programId.toBase58() + "?cluster=devnet");
  console.log("View pool: https://solscan.io/account/" + stakePoolPda.toBase58() + "?cluster=devnet");
}

main().catch(console.error);
