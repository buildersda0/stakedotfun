import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Steak } from "../target/types/steak";
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
  VersionedTransaction,
  Connection,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// CONFIG
// ============================================================
const PROGRAM_ID = new PublicKey("DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae");
const TOKEN_MINT = new PublicKey("FuSYKRL1mdhg4a8biN2Qb9JtL2tE7wFxo77aeA5Epump");
const ONE_TOKEN = 1_000_000; // 6 decimals
const REWARD_RATE = 10 * ONE_TOKEN; // 10 tokens/sec
const PUMPDEV_API = "https://pumpdev.io/api/trade-local";
const WALLETS_DIR = path.join(__dirname, "test-wallets");
const REWARD_TOLERANCE = 30; // 30% tolerance for mainnet clock variance

// SOL allocations
const DEPLOYER_SOL = 0.20;
const USER_SOL = 0.12;
const BUY_AMOUNT_SOL = 0.05; // SOL to spend buying tokens per wallet

// ============================================================
// HELPERS
// ============================================================
interface TestResult { name: string; passed: boolean; detail: string; }
const results: TestResult[] = [];
const t0 = Date.now();

function elapsed(): string {
  const ms = Date.now() - t0;
  return `T+${Math.floor(ms / 60000)}:${Math.floor((ms % 60000) / 1000).toString().padStart(2, "0")}`;
}
function log(msg: string) { console.log(`[${elapsed()}] ${msg}`); }
function section(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${elapsed()}] ${title}`);
  console.log("=".repeat(60));
}
function check(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
  console.log(`[${elapsed()}]   [${passed ? "PASS" : "FAIL"}] ${name}: ${detail}`);
}
function tok(n: number | bigint): string { return (Number(n) / ONE_TOKEN).toFixed(2); }

async function wait(sec: number) {
  log(`Waiting ${sec}s...`);
  await new Promise(r => setTimeout(r, sec * 1000));
}

// PDA helpers
function findStakePoolPda(mint: PublicKey, auth: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake_pool"), mint.toBuffer(), auth.toBuffer()], PROGRAM_ID);
}
function findVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], PROGRAM_ID);
}
function findRewardVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("reward_vault"), pool.toBuffer()], PROGRAM_ID);
}
function findUserStakePda(pool: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_stake"), pool.toBuffer(), user.toBuffer()], PROGRAM_ID);
}

// Wallet management
function saveWallet(name: string, kp: Keypair) {
  if (!fs.existsSync(WALLETS_DIR)) fs.mkdirSync(WALLETS_DIR, { recursive: true });
  const filePath = path.join(WALLETS_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  log(`  Saved ${name} wallet: ${kp.publicKey.toBase58().slice(0, 12)}... → ${filePath}`);
}

function loadWallet(name: string): Keypair | null {
  const filePath = path.join(WALLETS_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

// Buy tokens via pumpdev trade-local API
async function buyTokens(
  conn: Connection,
  wallet: Keypair,
  amountSol: number,
): Promise<{ signature: string; tokensReceived: bigint }> {
  log(`  Buying tokens for ${amountSol} SOL via pumpdev...`);

  // Get unsigned transaction from pumpdev
  const res = await fetch(PUMPDEV_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: wallet.publicKey.toBase58(),
      action: "buy",
      mint: TOKEN_MINT.toBase58(),
      amount: amountSol,
      denominatedInSol: "true",
      slippage: 25,
      pool: "auto",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Pumpdev API error ${res.status}: ${errText}`);
  }

  // Pumpdev trade-local returns raw binary transaction bytes
  const arrayBuf = await res.arrayBuffer();
  const txBytes = new Uint8Array(arrayBuf);
  log(`    Got transaction: ${txBytes.length} bytes`);

  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([wallet]);

  // Submit to RPC
  const signature = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await conn.confirmTransaction(signature, "confirmed");

  log(`    Buy TX: ${signature}`);

  // Check token balance after buy
  await new Promise(r => setTimeout(r, 2000));
  const ata = await getOrCreateAssociatedTokenAccount(
    conn, wallet, TOKEN_MINT, wallet.publicKey, false,
    "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID
  );
  const balance = ata.amount;
  log(`    Token balance: ${tok(balance)}`);

  return { signature, tokensReceived: balance };
}

// Get token balance safely
async function bal(conn: Connection, ata: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  } catch {
    return BigInt(0);
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  // Load funder wallet from .env
  const envPath = path.join(__dirname, "..", ".env");
  const envContent = fs.readFileSync(envPath, "utf8");
  const privKey = envContent.match(/DEPLOYER_PRIVATE_KEY=(.+)/)?.[1]?.trim();
  if (!privKey) throw new Error("DEPLOYER_PRIVATE_KEY not found in .env");
  const bs58 = require("bs58");
  const funderKp = Keypair.fromSecretKey(bs58.decode(privKey));

  // Create provider using funder as fee payer
  const conn = new Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );
  const funderWallet = new anchor.Wallet(funderKp);
  const provider = new anchor.AnchorProvider(conn, funderWallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.Steak as Program<Steak>;

  console.log("============================================================");
  console.log("  STEAK MAINNET INTEGRATION TEST");
  console.log("============================================================");
  console.log(`Program:  ${PROGRAM_ID.toBase58()}`);
  console.log(`Token:    $PEACE (${TOKEN_MINT.toBase58()})`);
  console.log(`Funder:   ${funderKp.publicKey.toBase58()}`);
  console.log(`Rate:     ${REWARD_RATE / ONE_TOKEN} tokens/sec`);
  console.log(`Budget:   ~0.46 SOL max`);
  console.log(`Time:     ${new Date().toISOString()}\n`);

  const funderBalance = await conn.getBalance(funderKp.publicKey);
  log(`Funder balance: ${(funderBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (funderBalance < 0.01 * LAMPORTS_PER_SOL) {
    throw new Error("Insufficient funder balance");
  }

  // ========== PHASE 0: CREATE & FUND WALLETS ==========
  section("PHASE 0: Create wallets, fund with SOL, buy tokens");

  // Create or load wallets
  let deployer = loadWallet("deployer");
  let user1 = loadWallet("user1");
  let user2 = loadWallet("user2");

  if (!deployer || !user1 || !user2) {
    deployer = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    saveWallet("deployer", deployer);
    saveWallet("user1", user1);
    saveWallet("user2", user2);
  } else {
    log("  Loaded existing wallets from disk");
    log(`  Deployer: ${deployer.publicKey.toBase58().slice(0, 12)}...`);
    log(`  User 1:   ${user1.publicKey.toBase58().slice(0, 12)}...`);
    log(`  User 2:   ${user2.publicKey.toBase58().slice(0, 12)}...`);
  }

  // Fund wallets with SOL
  log("Funding wallets with SOL...");
  const fundTx = new Transaction();
  const walletBalances = await Promise.all([
    conn.getBalance(deployer.publicKey),
    conn.getBalance(user1.publicKey),
    conn.getBalance(user2.publicKey),
  ]);

  if (walletBalances[0] < 0.1 * LAMPORTS_PER_SOL) {
    fundTx.add(SystemProgram.transfer({
      fromPubkey: funderKp.publicKey, toPubkey: deployer.publicKey,
      lamports: Math.floor(DEPLOYER_SOL * LAMPORTS_PER_SOL),
    }));
  }
  if (walletBalances[1] < 0.05 * LAMPORTS_PER_SOL) {
    fundTx.add(SystemProgram.transfer({
      fromPubkey: funderKp.publicKey, toPubkey: user1.publicKey,
      lamports: Math.floor(USER_SOL * LAMPORTS_PER_SOL),
    }));
  }
  if (walletBalances[2] < 0.05 * LAMPORTS_PER_SOL) {
    fundTx.add(SystemProgram.transfer({
      fromPubkey: funderKp.publicKey, toPubkey: user2.publicKey,
      lamports: Math.floor(USER_SOL * LAMPORTS_PER_SOL),
    }));
  }

  if (fundTx.instructions.length > 0) {
    fundTx.feePayer = funderKp.publicKey;
    fundTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    fundTx.sign(funderKp);
    const sig = await conn.sendRawTransaction(fundTx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    log(`  Funded wallets. TX: ${sig}`);
  } else {
    log("  Wallets already funded");
  }

  check("Wallets created and funded", true,
    `deployer=${(await conn.getBalance(deployer.publicKey) / LAMPORTS_PER_SOL).toFixed(3)} SOL, ` +
    `u1=${(await conn.getBalance(user1.publicKey) / LAMPORTS_PER_SOL).toFixed(3)} SOL, ` +
    `u2=${(await conn.getBalance(user2.publicKey) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);

  // Buy tokens on each wallet
  log("Buying $PEACE tokens on each wallet...");

  // Check if wallets already have tokens
  const deployerAta = (await getOrCreateAssociatedTokenAccount(
    conn, deployer, TOKEN_MINT, deployer.publicKey, false,
    "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID
  )).address;
  const user1Ata = (await getOrCreateAssociatedTokenAccount(
    conn, user1, TOKEN_MINT, user1.publicKey, false,
    "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID
  )).address;
  const user2Ata = (await getOrCreateAssociatedTokenAccount(
    conn, user2, TOKEN_MINT, user2.publicKey, false,
    "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID
  )).address;

  let deployerTokens = await bal(conn, deployerAta);
  let user1Tokens = await bal(conn, user1Ata);
  let user2Tokens = await bal(conn, user2Ata);

  if (deployerTokens < BigInt(1000 * ONE_TOKEN)) {
    const result = await buyTokens(conn, deployer, BUY_AMOUNT_SOL);
    deployerTokens = result.tokensReceived;
  } else {
    log(`  Deployer already has ${tok(deployerTokens)} tokens`);
  }

  if (user1Tokens < BigInt(100 * ONE_TOKEN)) {
    const result = await buyTokens(conn, user1, BUY_AMOUNT_SOL);
    user1Tokens = result.tokensReceived;
  } else {
    log(`  User 1 already has ${tok(user1Tokens)} tokens`);
  }

  if (user2Tokens < BigInt(100 * ONE_TOKEN)) {
    const result = await buyTokens(conn, user2, BUY_AMOUNT_SOL);
    user2Tokens = result.tokensReceived;
  } else {
    log(`  User 2 already has ${tok(user2Tokens)} tokens`);
  }

  // Refresh balances
  deployerTokens = await bal(conn, deployerAta);
  user1Tokens = await bal(conn, user1Ata);
  user2Tokens = await bal(conn, user2Ata);

  check("All wallets hold tokens", deployerTokens > 0n && user1Tokens > 0n && user2Tokens > 0n,
    `deployer=${tok(deployerTokens)} u1=${tok(user1Tokens)} u2=${tok(user2Tokens)}`);

  // Record initial balances for conservation check
  const initialTotal = deployerTokens + user1Tokens + user2Tokens;

  // Re-fund deployer with SOL for pool creation (rent + fees)
  const deployerSolAfterBuy = await conn.getBalance(deployer.publicKey);
  if (deployerSolAfterBuy < 0.05 * LAMPORTS_PER_SOL) {
    log("  Re-funding deployer with SOL for pool creation...");
    const topUpTx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: funderKp.publicKey, toPubkey: deployer.publicKey,
      lamports: Math.floor(0.08 * LAMPORTS_PER_SOL),
    }));
    topUpTx.feePayer = funderKp.publicKey;
    topUpTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    topUpTx.sign(funderKp);
    const topUpSig = await conn.sendRawTransaction(topUpTx.serialize());
    await conn.confirmTransaction(topUpSig, "confirmed");
    log(`    Top-up TX: ${topUpSig}`);
  }

  // ========== PHASE 1: CREATE POOL & FUND REWARDS ==========
  await wait(30);
  section("PHASE 1: Deployer creates pool + funds reward vault");

  const [poolPda] = findStakePoolPda(TOKEN_MINT, deployer.publicKey);
  const [vaultPda] = findVaultPda(poolPda);
  const [rewardVaultPda] = findRewardVaultPda(poolPda);

  // Initialize pool
  const initTx = await program.methods
    .initializePool({ rewardRate: new BN(REWARD_RATE), rewardEndTime: new BN(0) })
    .accounts({
      authority: deployer.publicKey, stakeMint: TOKEN_MINT,
      stakePool: poolPda, vault: vaultPda, rewardVault: rewardVaultPda,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([deployer]).rpc();
  log(`  Pool initialized. TX: ${initTx}`);

  const poolState = await program.account.stakePool.fetch(poolPda);
  check("Pool initialized", poolState.rewardRate.toNumber() === REWARD_RATE,
    `rate=${poolState.rewardRate.toNumber() / ONE_TOKEN} tokens/sec, pool=${poolPda.toBase58().slice(0, 12)}...`);

  // Fund rewards — deployer puts half their tokens in
  const rewardFund = deployerTokens / 2n;
  const fundTx1 = await program.methods
    .fundRewards(new BN(rewardFund.toString()))
    .accounts({
      funder: deployer.publicKey, stakePool: poolPda, rewardVault: rewardVaultPda,
      funderTokenAccount: deployerAta, stakeMint: TOKEN_MINT, tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([deployer]).rpc();
  log(`  Funded reward vault with ${tok(rewardFund)} tokens. TX: ${fundTx1}`);

  await new Promise(r => setTimeout(r, 2000));
  const rvBal = await bal(conn, rewardVaultPda);
  check("Reward vault funded", rvBal === rewardFund,
    `vault=${tok(rvBal)} expected=${tok(rewardFund)}`);

  // ========== PHASE 2: USERS STAKE ==========
  await wait(30);
  section("PHASE 2: User 1 and User 2 stake tokens");

  // User 1 stakes half their tokens
  const u1StakeAmount = user1Tokens / 2n;
  const [u1StakePda] = findUserStakePda(poolPda, user1.publicKey);
  await program.methods.stake(new BN(u1StakeAmount.toString()))
    .accounts({
      user: user1.publicKey, stakePool: poolPda, userStake: u1StakePda,
      vault: vaultPda, userTokenAccount: user1Ata, stakeMint: TOKEN_MINT,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([user1]).rpc();
  log(`  User 1 staked ${tok(u1StakeAmount)} tokens`);

  // User 2 stakes half their tokens
  const u2StakeAmount = user2Tokens / 2n;
  const [u2StakePda] = findUserStakePda(poolPda, user2.publicKey);
  await program.methods.stake(new BN(u2StakeAmount.toString()))
    .accounts({
      user: user2.publicKey, stakePool: poolPda, userStake: u2StakePda,
      vault: vaultPda, userTokenAccount: user2Ata, stakeMint: TOKEN_MINT,
      systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([user2]).rpc();
  log(`  User 2 staked ${tok(u2StakeAmount)} tokens`);

  await new Promise(r => setTimeout(r, 2000));
  const vaultBal = await bal(conn, vaultPda);
  const expectedVault = u1StakeAmount + u2StakeAmount;
  check("Vault balance matches total staked", vaultBal === expectedVault,
    `vault=${tok(vaultBal)} expected=${tok(expectedVault)}`);

  const poolAfterStake = await program.account.stakePool.fetch(poolPda);
  check("Pool total_staked correct", BigInt(poolAfterStake.totalStaked.toString()) === expectedVault,
    `total=${tok(poolAfterStake.totalStaked.toNumber())}`);

  // ========== PHASE 3: SECOND REWARD DEPOSIT ==========
  await wait(30);
  section("PHASE 3: Deployer makes second reward deposit");

  const deployerRemaining = await bal(conn, deployerAta);
  const secondFund = deployerRemaining / 2n;
  if (secondFund > 0n) {
    await program.methods.fundRewards(new BN(secondFund.toString()))
      .accounts({
        funder: deployer.publicKey, stakePool: poolPda, rewardVault: rewardVaultPda,
        funderTokenAccount: deployerAta, stakeMint: TOKEN_MINT, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([deployer]).rpc();
    log(`  Second deposit: ${tok(secondFund)} tokens`);
    check("Second reward deposit", true, `deposited=${tok(secondFund)}`);
  }

  // ========== PHASE 4: USER 1 CLAIMS REWARDS ==========
  await wait(30);
  section("PHASE 4: User 1 claims rewards");

  const poolBeforeClaim = await program.account.stakePool.fetch(poolPda);
  const u1BalBefore = await bal(conn, user1Ata);

  await program.methods.claimRewards()
    .accounts({
      user: user1.publicKey, stakePool: poolPda, userStake: u1StakePda,
      rewardVault: rewardVaultPda, userTokenAccount: user1Ata,
      stakeMint: TOKEN_MINT, tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([user1]).rpc();

  const u1BalAfter = await bal(conn, user1Ata);
  const u1Reward = Number(u1BalAfter - u1BalBefore);
  const poolAfterClaim = await program.account.stakePool.fetch(poolPda);
  const claimTimeElapsed = poolAfterClaim.lastUpdateTime.toNumber() - poolBeforeClaim.lastUpdateTime.toNumber();

  // Expected: U1 share = u1StakeAmount / totalStaked
  const u1Share = Number(u1StakeAmount) / Number(expectedVault);
  const expectedU1 = Math.floor(REWARD_RATE * claimTimeElapsed * u1Share);
  const u1Ok = Math.abs(u1Reward - expectedU1) <= Math.max(expectedU1 * REWARD_TOLERANCE / 100, 2 * REWARD_RATE);

  check("User 1 reward math", u1Ok,
    `actual=${tok(u1Reward)} expected~=${tok(expectedU1)} (${claimTimeElapsed}s, share=${(u1Share * 100).toFixed(1)}%)`);

  // ========== PHASE 5: USER 2 PARTIAL UNSTAKE ==========
  await wait(30);
  section("PHASE 5: User 2 partially unstakes");

  const u2StakeState = await program.account.userStake.fetch(u2StakePda);
  const u2UnstakeAmount = BigInt(u2StakeState.stakedAmount.toString()) / 2n;
  const u2BalBefore = await bal(conn, user2Ata);

  await program.methods.unstake(new BN(u2UnstakeAmount.toString()))
    .accounts({
      user: user2.publicKey, stakePool: poolPda, userStake: u2StakePda,
      vault: vaultPda, userTokenAccount: user2Ata, stakeMint: TOKEN_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([user2]).rpc();

  const u2BalAfter = await bal(conn, user2Ata);
  const unstakeReceived = u2BalAfter - u2BalBefore;
  check("Partial unstake exact amount", unstakeReceived === u2UnstakeAmount,
    `received=${tok(unstakeReceived)} expected=${tok(u2UnstakeAmount)}`);

  // ========== PHASE 6: BOTH CLAIM ==========
  await wait(30);
  section("PHASE 6: User 1 and User 2 claim rewards");

  // User 1 claims again
  const u1Bal2Before = await bal(conn, user1Ata);
  await program.methods.claimRewards()
    .accounts({
      user: user1.publicKey, stakePool: poolPda, userStake: u1StakePda,
      rewardVault: rewardVaultPda, userTokenAccount: user1Ata,
      stakeMint: TOKEN_MINT, tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([user1]).rpc();
  const u1Bal2After = await bal(conn, user1Ata);
  const u1Reward2 = Number(u1Bal2After - u1Bal2Before);
  check("User 1 second claim", u1Reward2 > 0, `claimed=${tok(u1Reward2)}`);

  // User 2 claims
  const u2Bal2Before = await bal(conn, user2Ata);
  await program.methods.claimRewards()
    .accounts({
      user: user2.publicKey, stakePool: poolPda, userStake: u2StakePda,
      rewardVault: rewardVaultPda, userTokenAccount: user2Ata,
      stakeMint: TOKEN_MINT, tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([user2]).rpc();
  const u2Bal2After = await bal(conn, user2Ata);
  const u2Reward = Number(u2Bal2After - u2Bal2Before);
  check("User 2 claim", u2Reward > 0, `claimed=${tok(u2Reward)}`);

  // ========== PHASE 7: FULL UNSTAKE ==========
  await wait(30);
  section("PHASE 7: Both users fully unstake");

  for (const [label, kp, ata, pda] of [
    ["User 1", user1, user1Ata, u1StakePda],
    ["User 2", user2, user2Ata, u2StakePda],
  ] as [string, Keypair, PublicKey, PublicKey][]) {
    const state = await program.account.userStake.fetch(pda);
    const remaining = state.stakedAmount;
    if (remaining.toNumber() > 0) {
      // Claim any pending rewards first
      try {
        await program.methods.claimRewards()
          .accounts({
            user: kp.publicKey, stakePool: poolPda, userStake: pda,
            rewardVault: rewardVaultPda, userTokenAccount: ata,
            stakeMint: TOKEN_MINT, tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([kp]).rpc();
      } catch {}

      await program.methods.unstake(remaining)
        .accounts({
          user: kp.publicKey, stakePool: poolPda, userStake: pda,
          vault: vaultPda, userTokenAccount: ata, stakeMint: TOKEN_MINT,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([kp]).rpc();
      log(`  ${label} fully unstaked`);
    }
  }

  await new Promise(r => setTimeout(r, 2000));
  const finalPool = await program.account.stakePool.fetch(poolPda);
  check("Pool total staked == 0", finalPool.totalStaked.toNumber() === 0,
    `total=${tok(finalPool.totalStaked.toNumber())}`);

  const finalVault = await bal(conn, vaultPda);
  check("Vault empty", finalVault === BigInt(0), `vault=${tok(finalVault)}`);

  check("Rewards claimed <= funded",
    finalPool.totalRewardsClaimed.toNumber() <= finalPool.totalRewardsFunded.toNumber(),
    `claimed=${tok(finalPool.totalRewardsClaimed.toNumber())} funded=${tok(finalPool.totalRewardsFunded.toNumber())}`);

  // ========== PHASE 8: VERIFY & CLOSE ==========
  await wait(30);
  section("PHASE 8: Verify balances + close pool");

  // Token conservation: all tokens accounted for
  const finalDeployer = await bal(conn, deployerAta);
  const finalU1 = await bal(conn, user1Ata);
  const finalU2 = await bal(conn, user2Ata);
  const finalVaultBal = await bal(conn, vaultPda);
  const finalRvBal = await bal(conn, rewardVaultPda);
  const finalTotal = finalDeployer + finalU1 + finalU2 + finalVaultBal + finalRvBal;

  check("Token conservation", finalTotal === initialTotal,
    `final=${tok(finalTotal)} initial=${tok(initialTotal)}`);

  // Close pool
  await program.methods.closePool()
    .accounts({
      authority: deployer.publicKey, stakePool: poolPda,
      vault: vaultPda, rewardVault: rewardVaultPda,
      authorityTokenAccount: deployerAta, stakeMint: TOKEN_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([deployer]).rpc();
  log("  Pool closed");

  await new Promise(r => setTimeout(r, 3000));
  let poolClosed = false;
  try { await program.account.stakePool.fetch(poolPda); }
  catch { poolClosed = true; }
  check("Pool account deleted", poolClosed, poolClosed ? "Deleted" : "Still exists!");

  // Final SOL spent
  const funderFinal = await conn.getBalance(funderKp.publicKey);
  const solSpent = (funderBalance - funderFinal) / LAMPORTS_PER_SOL;

  // ========== SUMMARY ==========
  console.log("\n" + "=".repeat(60));
  console.log("  FINAL SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`  Total checks: ${results.length}`);
  console.log(`  Passed:       ${passed}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  SOL spent:    ${solSpent.toFixed(4)} SOL`);
  console.log();

  if (failed > 0) {
    console.log("  FAILURES:");
    results.filter(r => !r.passed).forEach(r => console.log(`    [FAIL] ${r.name}: ${r.detail}`));
    console.log();
  }

  console.log(`  Elapsed: ${elapsed()}`);
  console.log(`  Result:  ${failed === 0 ? "ALL TESTS PASSED" : `${failed} TESTS FAILED`}`);
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error("FATAL:", err); process.exit(2); });
