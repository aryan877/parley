# Run it yourself


You need [Bun](https://bun.sh). Rust is only needed to rebuild or test the contract.

### 1. Check the live deployment (no key, about a minute)

```sh
bun install
bun run judge
```

Ten PASS lines read from NEAR RPC. [JUDGE.md](JUDGE.md) explains each one.

### 2. Simulate 60 days (no chain, no key, about 25 seconds)

```sh
bun run sim                 # writes docs/SIM.md and the charts in docs/sim/
bun run sim -- --check      # recomputes the last 50 settled matches on testnet exactly, then prints today's share prices
```

### 3. Verify the recorded leagues (no chain, no key, about 2 seconds)

```sh
bun install
bun run verify
```

```
near-ai: 84 Parleys, 504 signed replies, all verified
  Qwen/Qwen3.8-27B key 89154a43a476…: 252 replies, Intel TDX quote verified to Intel's root key
  z-ai/glm-5.3-flash key 5a0210f2442c…: 252 replies, Intel TDX quote verified to Intel's root key
  every request rebuilt byte for byte from the replayed league; treasuries, records, commons and stats.json re-derived
```

Now open any file in `fixtures/near-ai/parleys/`, change one letter, and run it again. Deleting a file, editing a total, adding an unquoted key or rewriting a prompt all fail too. See [VERIFY.md](VERIFY.md).

### 4. Run the site against a local chain (no key, about 5 minutes)

```sh
bun run localnet start                       # downloads the NEAR sandbox node on first use
bun run deploy:local --community             # fresh arena with the eight starting coins
bun run relayer serve --port 8787 --autoplay # live arena API: plays matches nonstop
bun run web                                  # http://localhost:5180
```

Without `NEAR_AI_API_KEY`, rule-based stand-ins play the starting coins and the site says so ("practice mode"). With the key in `.env`, deploy with `--mind near-ai` and the real models play. If port 8787 is taken, pick another and build the site with `VITE_ARENA_API=http://localhost:<port>`.

### 5. Play a league from the terminal

```sh
bun run league --mind scripted --rounds 1 --name mine   # about 4 minutes
bun run verify mine
bun run league --mind near-ai --rounds 1 --name mine-ai  # needs NEAR_AI_API_KEY
```

Before a real-AI league starts, the runner asks each model's enclave for a fresh Intel TDX quote and refuses to continue if it does not verify.

### 6. Watch holders govern a coin

```sh
bun run relayer govern
```

A coin launches, loses, a holder buys in at a forward price, wraps shares into the coin's NEP-141 token and sends some away, the constitution is amended by vote, a dissenter sells during the timelock, and the coin plays under its new rules. Each step prints what the contract allowed and what it refused.

### 7. Deploy your own testnet arena

```sh
bun scripts/deploy-testnet.ts        # deploys, attests the models, creates the coins, deletes the contract's keys
PARLEY_NETWORK=testnet bun run relayer serve --autoplay --static apps/web/dist
```

Agents can read [`/llms.txt`](https://parley.aryankumar.dev/llms.txt) for the contract methods and API. The scripts used for the proof above are `scripts/forge-testnet.ts`, `scripts/amend-testnet.ts`, `scripts/tokens-testnet.ts`, `scripts/reask.ts` and `scripts/check-deployed.ts`.

## Repository

```
contracts/arena      the contract: coins, shares, votes, Parleys, signature checks
contracts/token      NEP-141 token the arena deploys for a coin's shares
packages/sdk         typed client, reply verification, Intel TDX quote verifier
packages/relayer     courier between contract and model, live arena server, deploys
packages/league      round-robin runner, evidence files, offline verifier, prompt rebuild
apps/web             the site: live arena, launch, trade, vote, replays, in-browser verification
constitutions        the eight house constitutions
scripts              testnet deploy and proof scripts, the judge check, the simulation
deployments          the testnet deployment, its attestation quotes and proof transactions
fixtures             recorded leagues and re-asks with every request, reply, signature and quote
docs                 how it works, how to verify, limits
```

## Built with

Rust and [near-sdk](https://github.com/near/near-sdk-rs) 5.30, [cargo-near](https://github.com/near/cargo-near), near-sandbox and near-api for contract tests, [Bun](https://bun.sh), TypeScript, React 18, Vite, [motion](https://motion.dev), [NEAR Connect](https://github.com/azbang/near-connect) for wallets, Inter, Bricolage Grotesque, Instrument Serif and JetBrains Mono fonts, NEAR AI Cloud models (`Qwen/Qwen3.8-27B`, `z-ai/glm-5.3-flash`). Much of the code was written with AI coding assistants (Claude Code) and reviewed by hand. Everything was built during the hackathon window.

## Tests

```sh
cargo test -p parley-arena -p parley-token --lib   # contract unit tests
cargo test -p parley-arena --test sandbox          # contract on a real sandbox node (needs cargo-near)
bun test                                           # SDK, relayer, league and verifier
```

141 arena and 7 token unit tests, 5 tests on a sandbox node (a full Parley, forged replies, real NEAR payouts, a 30 KB reasoning reply, wrapping shares into NEP-141 and back), and 132 TypeScript tests, including every forgery class the verifier must catch, the ported money math pinned to the contract, the ledger replay and the attack lab.
