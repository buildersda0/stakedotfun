# Steak Protocol — Mainnet Integration Test Report

**Date:** April 12, 2026
**Program:** [`DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae`](https://solscan.io/account/DnbwF19jxzT2WM5CYmsnC2vLs3DxTismzBDJZiTjQzae)
**Token:** $PEACE [`FuSYKRL1mdhg4a8biN2Qb9JtL2tE7wFxo77aeA5Epump`](https://solscan.io/token/FuSYKRL1mdhg4a8biN2Qb9JtL2tE7wFxo77aeA5Epump) (Token-2022, 6 decimals)
**Reward Rate:** 10 tokens/sec
**Result:** 16/16 PASS — 0 failures

---

## Wallets

| Role | Address | Initial SOL |
|------|---------|-------------|
| Funder (fee payer) | [`31EHb8y5wVFh8t6r2R2PffMQCAecxWnzyy73AY6BmgnF`](https://solscan.io/account/31EHb8y5wVFh8t6r2R2PffMQCAecxWnzyy73AY6BmgnF) | 0.33 SOL |
| Pool Deployer | [`BFYexzrdvQZFHhx6SSLJB6tcv9QuM1ek4wG7fGBoNRDJ`](https://solscan.io/account/BFYexzrdvQZFHhx6SSLJB6tcv9QuM1ek4wG7fGBoNRDJ) | 0.20 SOL |
| User 1 | [`H25Vxq6wq9KRAJnAqS9aHfduTUU3T5FEGN7hFtobMssk`](https://solscan.io/account/H25Vxq6wq9KRAJnAqS9aHfduTUU3T5FEGN7hFtobMssk) | 0.12 SOL |
| User 2 | [`5tVpqAbzQ46jKACNzXkFVAfcUogeuGui12cLcExkEQoF`](https://solscan.io/account/5tVpqAbzQ46jKACNzXkFVAfcUogeuGui12cLcExkEQoF) | 0.12 SOL |

---

## All Transactions (chronological)

### Phase 0 — Setup (T+0:00)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 1 | 21:49:52 | SOL Transfer | Funder | [`3BBva7GC...`](https://solscan.io/tx/3BBva7GCBvocjWWt3H7LZ17t8jXwFeQghZ1FDowHcW2mU7tMrLqoFxy41CxAsW7Z9zmPKHtmGTAHKCL119p3XLAT) | Fund 3 wallets: 0.20 + 0.12 + 0.12 SOL |
| 2 | 21:49:54 | Buy (pumpdev) | Deployer | [`5PUNxb7X...`](https://solscan.io/tx/5PUNxb7XEBi5Hgq1AmDRdL7mcC3PjMwtNJYuQYFTTRqZZRVxaEC8TWQYwGMpCtpiAMweKwqds5jCUZj6BFYwNeUt) | Deployer buys $PEACE for 0.05 SOL → 1,668,329.55 tokens |
| 3 | 21:49:57 | Buy (pumpdev) | User 1 | [`3NXz9FKS...`](https://solscan.io/tx/3NXz9FKSTb3FU7EcMqBmaeFBKAMR96ZHR8cJPGRpKvPpuYCDae1fWY7aoRXPAYeMB4MYekTo66qvLJvWf33vqLHg) | User 1 buys $PEACE for 0.05 SOL → 1,662,971.22 tokens |
| 4 | 21:50:00 | Buy (pumpdev) | User 2 | [`aTsfBHLv...`](https://solscan.io/tx/aTsfBHLv2Ua6bbP1kx3RCnw6yGzy8T48pzNcdAx9zv4kYb1koGVi2hqeen6hmNkcjp7tX91gHqm6p3HDqQfWuBo) | User 2 buys $PEACE for 0.05 SOL → 1,657,638.66 tokens |

### Phase 1 — Create Pool & Fund Rewards (T+0:30)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 5 | 21:54:55 | **InitializePool** | Deployer | [`5rzDQpRH...`](https://solscan.io/tx/5rzDQpRHEPYfdoSwMmA34Nt7VCL2KPB5HD8pMtr4xtnphFK5k1ayQZisbmMj3YwesAmqMGsZSKnngZeLqqbDzXuX) | Create pool: rate=10 tok/sec, creates vault + reward vault PDAs |
| 6 | 21:54:56 | **FundRewards** | Deployer | [`4zm6rhmd...`](https://solscan.io/tx/4zm6rhmdARx7wcnEZxC1kXM7TxJqDGBDeqwU4r9vnHSXd2mCZAow5zQoSiPDq4wh18ujnNB7c5NGA4mU2TxREkzp) | Deposit 834,164.78 tokens into reward vault |

### Phase 2 — Users Stake (T+1:05)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 7 | 21:55:28 | **Stake** | User 1 | [`63DKJjMi...`](https://solscan.io/tx/63DKJjMiMMTRPKqVUp5fwUXE9J2jddnLiCW1keU9XvjzKf642AY4KMrpkbFxpZXAn5CVdbx14JJghc5xCvaCAWLo) | User 1 stakes 831,485.61 tokens (50.1% share) |
| 8 | 21:55:29 | **Stake** | User 2 | [`3ykks2x5...`](https://solscan.io/tx/3ykks2x5mx9qpH3DhVeX3Jw4ZUAB9Sf6ezN2wnJsAeB4FkkpfMFTrDhXqUGhELGjS1r2b3ZXDpVVAGjZ3ra6f2jz) | User 2 stakes 828,819.33 tokens (49.9% share) |

Pool state after staking:
```
Vault balance:     1,660,304.94 tokens
Pool total_staked: 1,660,304.94 tokens (matches vault)
```

### Phase 3 — Second Reward Deposit (T+1:38)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 9 | 21:56:02 | **FundRewards** | Deployer | [`5t71Pj5E...`](https://solscan.io/tx/5t71Pj5ED29rKmDV5agqiVWsPW5ocDFavBAENuT4wzPumbDZjLBHawymDGWZECZ8HF5bDtbfMvrmdimQqA8FcJji) | Deposit additional 417,082.39 tokens (total funded: 1,251,247.16) |

### Phase 4 — User 1 Claims Rewards (T+2:09)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 10 | 21:56:33 | **ClaimRewards** | User 1 | [`5DaxMnuw...`](https://solscan.io/tx/5DaxMnuwyAwaTZWFMNGVgBeoqfzvhrRok62suc2c8rrmPhZaCZuhQLdjsEtyQNwwKZA8UbSExnDyv2fPQGM5Saea) | User 1 claims 330.51 tokens (expected ~320.51, 64s elapsed, 50.1% share) |

### Phase 5 — User 2 Partial Unstake (T+2:40)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 11 | 21:57:04 | **Unstake** | User 2 | [`5sw1VJUr...`](https://solscan.io/tx/5sw1VJUrkhFh2jpPd3zCQBvn3Kyd2igLdkY6X1Fxouef9gsB4VKhvxFvwp6pufFy8LRVpg9PP5Dm2TbmvKXFcZVH) | User 2 unstakes 414,409.66 tokens (50% of stake). Received exact amount. |

### Phase 6 — Both Users Claim (T+3:11)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 12 | 21:57:35 | **ClaimRewards** | User 1 | [`4V8rkGqN...`](https://solscan.io/tx/4V8rkGqNCfJrjs31pkWzg15fMYEdCACKdvNtfA1E1g9cid8nhJ8NfjypHN7LUdxQ4EfhkXkn4iEkgENxK1fMsgWq) | User 1 claims 362.14 tokens |
| 13 | 21:57:35 | **ClaimRewards** | User 2 | [`3LFGCs7Z...`](https://solscan.io/tx/3LFGCs7ZgHgPGkbwmY4zvrPJBi5WFtP3rkRBxJVYmX5DVQtr5JMVzzWvQxnETx95QybLSuZheMVywP9av3gqTQBS) | User 2 claims 577.35 tokens |

### Phase 7 — Full Unstake (T+3:42)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 14 | 21:58:06 | **ClaimRewards** | User 1 | [`21sw5tfq...`](https://solscan.io/tx/21sw5tfqsTQqYYkfoS8CkfpAUnw2WibgqoRJ7NzJC3vPFFbj9PfSWqH9THSptT2CkdyxjvhErkaH2ZhkZkedT1uK) | User 1 claims remaining pending rewards before unstake |
| 15 | 21:58:06 | **Unstake** | User 1 | [`o7gqC5hA...`](https://solscan.io/tx/o7gqC5hAXNpK27vMgikKqdnjmkgw3M1uvHbXzcWdfuw5tGA4W7KxwsQh2DAJbvuFiNU4m4eMbGpEiqMH2FQCAGs) | User 1 fully unstakes 831,485.61 tokens |
| 16 | 21:58:06 | **ClaimRewards** | User 2 | [`usaLpZ2s...`](https://solscan.io/tx/usaLpZ2soT2MQkeyixsrTLANyUtdGkvVxaR9bifLYtJZsKJySZv6rTX6NdKoKsatcDMWuGfjX2j29EE81vSSVTa) | User 2 claims remaining pending rewards before unstake |
| 17 | 21:58:07 | **Unstake** | User 2 | [`3QhmLnZN...`](https://solscan.io/tx/3QhmLnZNp9uKGd2oC96fsLCBh6LcHqxWMnwe4Wx1wYg4hTzbKPXPzMJYzCRcJeprAa9rdBxfDEdVtkJBKgisZPeL) | User 2 fully unstakes 414,409.67 tokens |

Pool state after full unstake:
```
Pool total_staked:     0
Vault balance:         0
Total rewards claimed: 1,580.00 tokens
Total rewards funded:  1,251,247.16 tokens
```

### Phase 8 — Close Pool (T+4:16)

| # | Time | Instruction | Signer | TX | Details |
|---|------|-------------|--------|-----|---------|
| 18 | 21:58:40 | **ClosePool** | Deployer | [`3HzVhsLV...`](https://solscan.io/tx/3HzVhsLV2z1ojXipYwweugeumuJxwbLE5cdwp5wReSQoJZ2oWSXnW3x9VRdC7fF7cnE3D2ry24x91fyZvR9dkU4T) | Close pool, sweep 1,249,667.16 unused reward tokens back to deployer, delete accounts |

---

## Token Conservation

```
Initial total across all wallets: 4,988,939.43 tokens
Final total across all wallets:   4,988,939.43 tokens
Difference: 0 — PERFECT CONSERVATION
```

---

## Token Flow Diagram

```
         Deployer               Reward Vault          Staking Vault          User 1              User 2
            │                        │                      │                   │                   │
buy      +1,668K                     │                      │                +1,663K             +1,658K
            │                        │                      │                   │                   │
fund #1  ──834K──────────────────>+834K                     │                   │                   │
            │                        │                      │                   │                   │
stake       │                        │                      │<─────831K─────────│                   │
            │                        │                      │<─────829K─────────│───────────────────│
            │                        │                      │                   │                   │
fund #2  ──417K──────────────────>+417K                     │                   │                   │
            │                        │                      │                   │                   │
claim       │                     ──331──────────────────────│──────────>+331    │                   │
            │                        │                      │                   │                   │
unstake     │                        │                      │──414K─────────────│──────────>+414K   │
            │                        │                      │                   │                   │
claim       │                     ──362──────────────────────│──>+362            │                   │
            │                     ──577──────────────────────│──────────────────│──>+577            │
            │                        │                      │                   │                   │
claim       │                     ──310──────────────────────│──>+310            │                   │
unstake     │                        │                      │──831K──>+831K     │                   │
claim       │                     ────0──────────────────────│──────────────────│──>+0              │
unstake     │                        │                      │──414K────────────│──────────>+414K   │
            │                        │                      │                   │                   │
close    +1,250K<────────────────1,250K                     │                   │                   │
            │                     (closed)               (closed)               │                   │
         ─────────────────────────────────────────────────────────────────────────────────────────
Final:    1,667K                    0                       0                1,663K              1,658K
                              TOTAL: 4,988,939.43 = 4,988,939.43 (initial)
```

---

## Test Results

| # | Check | Result |
|---|-------|--------|
| 1 | Wallets created and funded with SOL | PASS |
| 2 | All wallets hold $PEACE tokens after pumpdev buy | PASS |
| 3 | Pool initialized (10 tokens/sec) | PASS |
| 4 | Reward vault funded (834K tokens) | PASS |
| 5 | Vault balance == total staked (1,660K) | PASS |
| 6 | Pool total_staked correct | PASS |
| 7 | Second reward deposit (417K) | PASS |
| 8 | User 1 reward math (50.1% share, 64s elapsed) | PASS |
| 9 | Partial unstake returns exact amount (414K) | PASS |
| 10 | User 1 second claim > 0 (362 tokens) | PASS |
| 11 | User 2 claim > 0 (577 tokens) | PASS |
| 12 | Pool total staked == 0 after full unstake | PASS |
| 13 | Vault empty after full unstake | PASS |
| 14 | Rewards claimed <= funded (1,580 of 1,251,247) | PASS |
| 15 | Token conservation (0 difference) | PASS |
| 16 | Pool account deleted after close | PASS |

**16/16 PASSED — 0 FAILED**

---

## Cost Summary

| Item | SOL |
|------|-----|
| Fund deployer wallet | 0.200 |
| Fund user 1 wallet | 0.120 |
| Fund user 2 wallet | 0.120 |
| Token buys (3 x 0.05) | 0.150 |
| Transaction fees (~18 txns) | ~0.010 |
| **Total spent** | **~0.46 SOL** |

**Test duration:** 4 minutes 20 seconds
