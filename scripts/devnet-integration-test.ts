import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Steak } from "../target/types/steak";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";

// ============================================================
// CONSTANTS
// ============================================================
const PROGRAM_ID = new PublicKey("DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae");
const TOKEN_DECIMALS = 6;
const ONE_TOKEN = 1_000_000;
const REWARD_TOLERANCE_PERCENT = 25;

const POOL1_REWARD_RATE = 10 * ONE_TOKEN; // 10 tokens/sec
const POOL2_REWARD_RATE = 5 * ONE_TOKEN;  // 5 tokens/sec

// ============================================================
// TYPES
// ============================================================
interface PoolCtx {
  mint: PublicKey;
  stakePool: PublicKey;
  vault: PublicKey;
  rewardVault: PublicKey;
  rewardRate: number;
  label: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

// ============================================================
// PDA HELPERS
// ============================================================
function findStakePoolPda(mint: PublicKey, auth: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake_pool"), mint.toBuffer(), auth.toBuffer()], PROGRAM_ID);
}
function findVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), pool.toBuffer()], PROGRAM_ID);
}
function findRewardVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), pool.toBuffer()], PROGRAM_ID);
}
function findUserStakePda(pool: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_stake"), pool.toBuffer(), user.toBuffer()], PROGRAM_ID);
}

// ============================================================
// LOGGING
// ============================================================
const results: TestResult[] = [];
const t0 = Date.now();

function elapsed(): string {
  const ms = Date.now() - t0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `T+${m}:${s.toString().padStart(2, "0")}`;
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
function tok(n: number | bigint): string {
  return (Number(n) / ONE_TOKEN).toFixed(2);
}
async function wait(sec: number) {
  log(`Waiting ${sec}s...`);
  await new Promise(r => setTimeout(r, sec * 1000));
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Steak as Program<Steak>;
  const authority = provider.wallet as anchor.Wallet;
  const conn = provider.connection;

  console.log("============================================================");
  console.log("  STEAK COMPREHENSIVE DEVNET INTEGRATION TEST");
  console.log("============================================================");
  console.log(`Program:   ${program.programId.toBase58()}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Time:      ${new Date().toISOString()}\n`);

  // ========== PHASE 0: SETUP ==========
  section("PHASE 0: SETUP");

  // Create staker keypairs
  const stakerA = Keypair.generate();
  const stakerB = Keypair.generate();
  const stakerC = Keypair.generate();
  log(`Staker A: ${stakerA.publicKey.toBase58().slice(0, 12)}...`);
  log(`Staker B: ${stakerB.publicKey.toBase58().slice(0, 12)}...`);
  log(`Staker C: ${stakerC.publicKey.toBase58().slice(0, 12)}...`);

  // Fund stakers with SOL via system transfer (avoids airdrop rate limits)
  log("Funding stakers with SOL...");
  const fundTx = new Transaction();
  for (const kp of [stakerA, stakerB, stakerC]) {
    fundTx.add(SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: kp.publicKey,
      lamports: 0.15 * LAMPORTS_PER_SOL,
    }));
  }
  await provider.sendAndConfirm(fundTx);
  log("  Funded 0.15 SOL each");

  // Create 2 Token-2022 mints
  log("Creating Token-2022 mints...");
  const mint1 = await createMint(conn, authority.payer, authority.publicKey, null,
    TOKEN_DECIMALS, undefined, undefined, TOKEN_2022_PROGRAM_ID);
  const mint2 = await createMint(conn, authority.payer, authority.publicKey, null,
    TOKEN_DECIMALS, undefined, undefined, TOKEN_2022_PROGRAM_ID);
  log(`  Mint 1: ${mint1.toBase58()}`);
  log(`  Mint 2: ${mint2.toBase58()}`);

  // Derive pool PDAs
  const [pool1Pda] = findStakePoolPda(mint1, authority.publicKey);
  const [vault1] = findVaultPda(pool1Pda);
  const [rv1] = findRewardVaultPda(pool1Pda);
  const pool1: PoolCtx = { mint: mint1, stakePool: pool1Pda, vault: vault1, rewardVault: rv1, rewardRate: POOL1_REWARD_RATE, label: "Pool 1" };

  const [pool2Pda] = findStakePoolPda(mint2, authority.publicKey);
  const [vault2] = findVaultPda(pool2Pda);
  const [rv2] = findRewardVaultPda(pool2Pda);
  const pool2: PoolCtx = { mint: mint2, stakePool: pool2Pda, vault: vault2, rewardVault: rv2, rewardRate: POOL2_REWARD_RATE, label: "Pool 2" };

  // Create ATAs for authority + stakers for both mints
  log("Creating ATAs and minting tokens...");
  const authAta1 = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, mint1, authority.publicKey, false, "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID)).address;
  const authAta2 = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, mint2, authority.publicKey, false, "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID)).address;

  const atas: Map<string, PublicKey> = new Map(); // "stakerLabel:mintKey" -> ata
  for (const [label, kp] of [["A", stakerA], ["B", stakerB], ["C", stakerC]] as [string, Keypair][]) {
    for (const mint of [mint1, mint2]) {
      const ata = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, mint, kp.publicKey, false, "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID)).address;
      atas.set(`${label}:${mint.toBase58()}`, ata);
    }
  }

  // Wait for ATAs to confirm
  await new Promise(r => setTimeout(r, 2000));

  // Mint tokens
  const AUTH_MINT = 100_000_000;
  const STAKER_MINT = 500_000;
  for (const [mint, ata] of [[mint1, authAta1], [mint2, authAta2]] as [PublicKey, PublicKey][]) {
    await mintTo(conn, authority.payer, mint, ata, authority.publicKey, AUTH_MINT * ONE_TOKEN, [], undefined, TOKEN_2022_PROGRAM_ID);
  }
  for (const [label, kp] of [["A", stakerA], ["B", stakerB], ["C", stakerC]] as [string, Keypair][]) {
    for (const mint of [mint1, mint2]) {
      const ata = atas.get(`${label}:${mint.toBase58()}`)!;
      await mintTo(conn, authority.payer, mint, ata, authority.publicKey, STAKER_MINT * ONE_TOKEN, [], undefined, TOKEN_2022_PROGRAM_ID);
    }
  }
  const TOTAL_MINTED = BigInt((AUTH_MINT + 3 * STAKER_MINT) * ONE_TOKEN);
  log(`  Minted ${AUTH_MINT / 1e6}M to authority, ${STAKER_MINT / 1e3}K to each staker, per mint`);

  // Initialize pools
  log("Initializing pools...");
  for (const pool of [pool1, pool2]) {
    await program.methods.initializePool({ rewardRate: new BN(pool.rewardRate), rewardEndTime: new BN(0) })
      .accounts({ authority: authority.publicKey, stakeMint: pool.mint, stakePool: pool.stakePool, vault: pool.vault, rewardVault: pool.rewardVault, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
      .rpc();
    log(`  ${pool.label} initialized`);
  }

  // Fund reward vaults (50M each)
  const REWARD_FUND = 50_000_000;
  for (const [pool, ata] of [[pool1, authAta1], [pool2, authAta2]] as [PoolCtx, PublicKey][]) {
    await program.methods.fundRewards(new BN(REWARD_FUND * ONE_TOKEN))
      .accounts({ funder: authority.publicKey, stakePool: pool.stakePool, rewardVault: pool.rewardVault, funderTokenAccount: ata, stakeMint: pool.mint, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .rpc();
    log(`  ${pool.label} funded with ${REWARD_FUND / 1e6}M tokens`);
  }

  log("Setup complete!");

  // Helper: get token balance (with confirmed commitment)
  async function bal(ata: PublicKey): Promise<bigint> {
    return (await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  }

  // Helper: verify vault == sum of user stakes
  async function checkVaultInvariant(pool: PoolCtx, label: string) {
    await new Promise(r => setTimeout(r, 2000)); // wait for confirmation
    const vaultBal = await bal(pool.vault);
    const poolState = await program.account.stakePool.fetch(pool.stakePool);
    const poolTotal = BigInt(poolState.totalStaked.toString());
    const ok = vaultBal === poolTotal;
    check(`Vault invariant (${label})`, ok, `vault=${tok(vaultBal)} poolTotal=${tok(poolTotal)}`);
  }

  // ========== PHASE 1: T+0:30 ==========
  await wait(30);
  section("PHASE 1: Staker A stakes 50K, Staker B stakes 30K in Pool 1");

  const aAta1 = atas.get(`A:${mint1.toBase58()}`)!;
  const bAta1 = atas.get(`B:${mint1.toBase58()}`)!;
  const cAta2 = atas.get(`C:${mint2.toBase58()}`)!;

  await program.methods.stake(new BN(50_000 * ONE_TOKEN))
    .accounts({ user: stakerA.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerA.publicKey)[0], vault: pool1.vault, userTokenAccount: aAta1, stakeMint: mint1, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerA]).rpc();
  log("  Staker A staked 50K in Pool 1");

  await program.methods.stake(new BN(30_000 * ONE_TOKEN))
    .accounts({ user: stakerB.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerB.publicKey)[0], vault: pool1.vault, userTokenAccount: bAta1, stakeMint: mint1, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerB]).rpc();
  log("  Staker B staked 30K in Pool 1");

  await checkVaultInvariant(pool1, "Phase 1");

  // ========== PHASE 2: T+1:00 ==========
  await wait(30);
  section("PHASE 2: Staker C stakes 100K in Pool 2");

  await program.methods.stake(new BN(100_000 * ONE_TOKEN))
    .accounts({ user: stakerC.publicKey, stakePool: pool2.stakePool, userStake: findUserStakePda(pool2.stakePool, stakerC.publicKey)[0], vault: pool2.vault, userTokenAccount: cAta2, stakeMint: mint2, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerC]).rpc();
  log("  Staker C staked 100K in Pool 2");

  await checkVaultInvariant(pool2, "Phase 2");

  // ========== PHASE 3: T+1:30 ==========
  await wait(30);
  section("PHASE 3: Staker A claims rewards from Pool 1");

  const p1Before = await program.account.stakePool.fetch(pool1.stakePool);
  const aBalBefore = await bal(aAta1);

  await program.methods.claimRewards()
    .accounts({ user: stakerA.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerA.publicKey)[0], rewardVault: pool1.rewardVault, userTokenAccount: aAta1, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerA]).rpc();

  const aBalAfter = await bal(aAta1);
  const aReward = Number(aBalAfter - aBalBefore);
  const p1After = await program.account.stakePool.fetch(pool1.stakePool);
  const timeElapsed = p1After.lastUpdateTime.toNumber() - p1Before.lastUpdateTime.toNumber();
  // A has 50K/80K = 62.5% share
  const expectedA = Math.floor(POOL1_REWARD_RATE * timeElapsed * 50_000 / 80_000);
  const toleranceOk = Math.abs(aReward - expectedA) <= Math.max(expectedA * REWARD_TOLERANCE_PERCENT / 100, 2 * POOL1_REWARD_RATE);
  check("Staker A reward math", toleranceOk,
    `actual=${tok(aReward)} expected~=${tok(expectedA)} (${timeElapsed}s, A=62.5%)`);

  // ========== SECURITY CHECKS ==========
  section("SECURITY CHECKS");

  // 1. Unstake someone else's tokens
  try {
    await program.methods.unstake(new BN(ONE_TOKEN))
      .accounts({ user: stakerC.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerA.publicKey)[0], vault: pool1.vault, userTokenAccount: cAta2, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([stakerC]).rpc();
    check("Reject: unstake other's tokens", false, "EXPLOIT: succeeded!");
  } catch { check("Reject: unstake other's tokens", true, "Correctly rejected"); }

  // 2. Claim someone else's rewards
  try {
    await program.methods.claimRewards()
      .accounts({ user: stakerC.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerA.publicKey)[0], rewardVault: pool1.rewardVault, userTokenAccount: cAta2, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([stakerC]).rpc();
    check("Reject: claim other's rewards", false, "EXPLOIT: succeeded!");
  } catch { check("Reject: claim other's rewards", true, "Correctly rejected"); }

  // 3. Unstake more than staked
  try {
    await program.methods.unstake(new BN(999_999 * ONE_TOKEN))
      .accounts({ user: stakerA.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerA.publicKey)[0], vault: pool1.vault, userTokenAccount: aAta1, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .signers([stakerA]).rpc();
    check("Reject: unstake > staked", false, "EXPLOIT: succeeded!");
  } catch { check("Reject: unstake > staked", true, "Correctly rejected"); }

  // 4. Close pool with stakers
  try {
    await program.methods.closePool()
      .accounts({ authority: authority.publicKey, stakePool: pool1.stakePool, vault: pool1.vault, rewardVault: pool1.rewardVault, authorityTokenAccount: authAta1, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .rpc();
    check("Reject: close pool with stakers", false, "EXPLOIT: succeeded!");
  } catch { check("Reject: close pool with stakers", true, "Correctly rejected"); }

  // 5. Update pool as non-authority
  try {
    await program.methods.updatePool({ rewardRate: new BN(0), rewardEndTime: null, isActive: null })
      .accounts({ authority: stakerB.publicKey, stakePool: pool1.stakePool })
      .signers([stakerB]).rpc();
    check("Reject: non-authority update", false, "EXPLOIT: succeeded!");
  } catch { check("Reject: non-authority update", true, "Correctly rejected"); }

  // ========== PHASE 4: T+2:00 ==========
  await wait(30);
  section("PHASE 4: Staker B compounds +20K in Pool 1");

  await program.methods.stake(new BN(20_000 * ONE_TOKEN))
    .accounts({ user: stakerB.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerB.publicKey)[0], vault: pool1.vault, userTokenAccount: bAta1, stakeMint: mint1, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerB]).rpc();
  log("  Staker B compounded 20K (now 50K total)");

  await checkVaultInvariant(pool1, "Phase 4");

  // ========== PHASE 5: T+2:30 ==========
  await wait(30);
  section("PHASE 5: Staker A partially unstakes 25K from Pool 1");

  const aBalPre = await bal(aAta1);
  await program.methods.unstake(new BN(25_000 * ONE_TOKEN))
    .accounts({ user: stakerA.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerA.publicKey)[0], vault: pool1.vault, userTokenAccount: aAta1, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerA]).rpc();
  const aBalPost = await bal(aAta1);
  const unstakeReceived = Number(aBalPost - aBalPre);
  check("Partial unstake exact amount", unstakeReceived === 25_000 * ONE_TOKEN,
    `received=${tok(unstakeReceived)} expected=${tok(25_000 * ONE_TOKEN)}`);

  const aStake = await program.account.userStake.fetch(findUserStakePda(pool1.stakePool, stakerA.publicKey)[0]);
  check("Staker A remaining stake", aStake.stakedAmount.toNumber() === 25_000 * ONE_TOKEN,
    `remaining=${tok(aStake.stakedAmount.toNumber())}`);

  await checkVaultInvariant(pool1, "Phase 5");

  // ========== PHASE 6: T+3:00 ==========
  await wait(30);
  section("PHASE 6: Staker C claims rewards from Pool 2 (sole staker)");

  const p2Before = await program.account.stakePool.fetch(pool2.stakePool);
  const cBalBefore = await bal(cAta2);

  await program.methods.claimRewards()
    .accounts({ user: stakerC.publicKey, stakePool: pool2.stakePool, userStake: findUserStakePda(pool2.stakePool, stakerC.publicKey)[0], rewardVault: pool2.rewardVault, userTokenAccount: cAta2, stakeMint: mint2, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerC]).rpc();

  const cBalAfter = await bal(cAta2);
  const cReward = Number(cBalAfter - cBalBefore);
  const p2After = await program.account.stakePool.fetch(pool2.stakePool);
  const timeC = p2After.lastUpdateTime.toNumber() - p2Before.lastUpdateTime.toNumber();
  const expectedC = POOL2_REWARD_RATE * timeC; // 100% share
  const cOk = Math.abs(cReward - expectedC) <= Math.max(expectedC * REWARD_TOLERANCE_PERCENT / 100, 2 * POOL2_REWARD_RATE);
  check("Staker C reward math (sole staker)", cOk,
    `actual=${tok(cReward)} expected~=${tok(expectedC)} (${timeC}s, C=100%)`);

  // ========== PHASE 7: T+3:30 ==========
  await wait(30);
  section("PHASE 7: Staker B claims rewards from Pool 1");

  const bBalBefore = await bal(bAta1);
  await program.methods.claimRewards()
    .accounts({ user: stakerB.publicKey, stakePool: pool1.stakePool, userStake: findUserStakePda(pool1.stakePool, stakerB.publicKey)[0], rewardVault: pool1.rewardVault, userTokenAccount: bAta1, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([stakerB]).rpc();
  const bBalAfter = await bal(bAta1);
  const bReward = Number(bBalAfter - bBalBefore);
  check("Staker B reward non-zero", bReward > 0, `claimed=${tok(bReward)}`);

  // ========== PHASE 8: T+4:00 ==========
  await wait(30);
  section("PHASE 8: All stakers unstake everything");

  // Unstake all from Pool 1
  for (const [label, kp, ata] of [["A", stakerA, aAta1], ["B", stakerB, bAta1]] as [string, Keypair, PublicKey][]) {
    const [usPda] = findUserStakePda(pool1.stakePool, kp.publicKey);
    const us = await program.account.userStake.fetch(usPda);
    if (us.stakedAmount.toNumber() > 0) {
      try { await program.methods.claimRewards()
        .accounts({ user: kp.publicKey, stakePool: pool1.stakePool, userStake: usPda, rewardVault: pool1.rewardVault, userTokenAccount: ata, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
        .signers([kp]).rpc(); } catch {}
      await program.methods.unstake(us.stakedAmount)
        .accounts({ user: kp.publicKey, stakePool: pool1.stakePool, userStake: usPda, vault: pool1.vault, userTokenAccount: ata, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
        .signers([kp]).rpc();
      log(`  Staker ${label} fully unstaked from Pool 1`);
    }
  }

  // Unstake all from Pool 2
  {
    const [usPda] = findUserStakePda(pool2.stakePool, stakerC.publicKey);
    const us = await program.account.userStake.fetch(usPda);
    if (us.stakedAmount.toNumber() > 0) {
      try { await program.methods.claimRewards()
        .accounts({ user: stakerC.publicKey, stakePool: pool2.stakePool, userStake: usPda, rewardVault: pool2.rewardVault, userTokenAccount: cAta2, stakeMint: mint2, tokenProgram: TOKEN_2022_PROGRAM_ID })
        .signers([stakerC]).rpc(); } catch {}
      await program.methods.unstake(us.stakedAmount)
        .accounts({ user: stakerC.publicKey, stakePool: pool2.stakePool, userStake: usPda, vault: pool2.vault, userTokenAccount: cAta2, stakeMint: mint2, tokenProgram: TOKEN_2022_PROGRAM_ID })
        .signers([stakerC]).rpc();
      log("  Staker C fully unstaked from Pool 2");
    }
  }

  const p1Final = await program.account.stakePool.fetch(pool1.stakePool);
  const p2Final = await program.account.stakePool.fetch(pool2.stakePool);
  check("Pool 1 total staked == 0", p1Final.totalStaked.toNumber() === 0, `${tok(p1Final.totalStaked.toNumber())}`);
  check("Pool 2 total staked == 0", p2Final.totalStaked.toNumber() === 0, `${tok(p2Final.totalStaked.toNumber())}`);

  // ========== PHASE 9: T+4:30 ==========
  await wait(30);
  section("PHASE 9: Final balance verification");

  // Vault empty checks
  const v1Bal = await bal(pool1.vault);
  const v2Bal = await bal(pool2.vault);
  check("Pool 1 vault empty", v1Bal === BigInt(0), `vault=${tok(v1Bal)}`);
  check("Pool 2 vault empty", v2Bal === BigInt(0), `vault=${tok(v2Bal)}`);

  // Rewards claimed < funded
  check("Pool 1 claimed <= funded",
    p1Final.totalRewardsClaimed.toNumber() <= p1Final.totalRewardsFunded.toNumber(),
    `claimed=${tok(p1Final.totalRewardsClaimed.toNumber())} funded=${tok(p1Final.totalRewardsFunded.toNumber())}`);
  check("Pool 2 claimed <= funded",
    p2Final.totalRewardsClaimed.toNumber() <= p2Final.totalRewardsFunded.toNumber(),
    `claimed=${tok(p2Final.totalRewardsClaimed.toNumber())} funded=${tok(p2Final.totalRewardsFunded.toNumber())}`);

  // Token conservation per mint
  for (const [label, mint, authAta, vaultPda, rvPda] of [
    ["Mint 1", mint1, authAta1, pool1.vault, pool1.rewardVault],
    ["Mint 2", mint2, authAta2, pool2.vault, pool2.rewardVault],
  ] as [string, PublicKey, PublicKey, PublicKey, PublicKey][]) {
    let total = BigInt(0);
    // Authority balance
    total += await bal(authAta);
    // Staker balances
    for (const l of ["A", "B", "C"]) {
      const a = atas.get(`${l}:${mint.toBase58()}`);
      if (a) try { total += await bal(a); } catch {}
    }
    // Vault + reward vault
    try { total += await bal(vaultPda); } catch {}
    try { total += await bal(rvPda); } catch {}
    check(`Token conservation (${label})`, total === TOTAL_MINTED,
      `actual=${tok(total)} expected=${tok(TOTAL_MINTED)}`);
  }

  // ========== PHASE 10: T+5:00 ==========
  await wait(30);
  section("PHASE 10: Close both pools");

  await program.methods.closePool()
    .accounts({ authority: authority.publicKey, stakePool: pool1.stakePool, vault: pool1.vault, rewardVault: pool1.rewardVault, authorityTokenAccount: authAta1, stakeMint: mint1, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .rpc();
  log("  Pool 1 closed");

  await program.methods.closePool()
    .accounts({ authority: authority.publicKey, stakePool: pool2.stakePool, vault: pool2.vault, rewardVault: pool2.rewardVault, authorityTokenAccount: authAta2, stakeMint: mint2, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .rpc();
  log("  Pool 2 closed");

  // Wait for close txs to confirm
  await new Promise(r => setTimeout(r, 3000));

  // Verify accounts deleted
  for (const [label, pda] of [["Pool 1", pool1.stakePool], ["Pool 2", pool2.stakePool]] as [string, PublicKey][]) {
    let closed = false;
    try { await program.account.stakePool.fetch(pda); }
    catch (e: any) { closed = true; }
    check(`${label} account deleted`, closed, closed ? "Deleted" : "Still exists!");
  }

  // ========== SUMMARY ==========
  console.log("\n" + "=".repeat(60));
  console.log("  FINAL SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`  Total checks: ${results.length}`);
  console.log(`  Passed:       ${passed}`);
  console.log(`  Failed:       ${failed}\n`);

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
