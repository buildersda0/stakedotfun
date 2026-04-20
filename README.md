# Steak Protocol

Open-source Solana staking program powering [stake.fun](https://stake.fun) — the staking layer for pump.fun meme coins.

**Program ID (mainnet + devnet):** [`DNKutNU2kSDyssGvn9DdKD9NQWPqGX6wXV2zeTjXeXyU`](https://solscan.io/account/DNKutNU2kSDyssGvn9DdKD9NQWPqGX6wXV2zeTjXeXyU)

This repository contains the full source of the on-chain program so anyone can audit the contract that holds their stake. It is published for transparency.

---

## What it does

One deployment, unlimited pools. Any pump.fun Token-2022 mint can have a staking pool created against it. Stakers deposit tokens, accrue rewards at a fixed rate, and claim or unstake at will.

- **Fixed-APR reward model** — constant tokens/sec, paid pro-rata to current stakers.
- **Permissionless pools** — anyone can create a pool for any Token-2022 mint.
- **Non-custodial** — stakers keep PDA-owned token accounts; the program only moves funds on signed instructions.
- **Pause / resume** — pool authority can pause rewards without locking principal; stake/unstake stay open.

## Instructions

| Instruction | Signer | Purpose |
|---|---|---|
| `initialize_pool` | Pool authority | Create a stake pool + vault + reward vault for a given mint. |
| `fund_rewards` | Anyone | Deposit tokens into the reward vault. |
| `stake` | User | Lock tokens in the pool vault, start earning. |
| `unstake` | User | Withdraw some/all of your staked balance. |
| `claim_rewards` | User | Pull accrued rewards from the reward vault. |
| `update_pool` | Pool authority | Pause/resume, adjust reward rate. |
| `close_pool` | Pool authority | Close the pool once all stake is withdrawn. |

See [`DOCS.md`](./DOCS.md) for detailed instruction-level docs, PDA seeds, and account layouts.

## Tests

- `tests/steak.ts` — local Anchor test suite.
- `scripts/devnet-integration-test.ts` — end-to-end devnet run.
- `scripts/mainnet-integration-test.ts` — end-to-end mainnet run.

Most recent mainnet verification: [`MAINNET_TEST_REPORT.md`](./MAINNET_TEST_REPORT.md) — 16 / 16 passing with linked on-chain transactions.

## Build

Requires Anchor `0.29.0`, Solana CLI, and Rust.

```bash
anchor build
anchor test
```

To run against devnet:

```bash
anchor deploy --provider.cluster devnet
```

## License

MIT. Use at your own risk — this is unaudited software deployed on mainnet.
