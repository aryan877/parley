# Parley: notes for coding agents

Parley is a NEAR contract plus tooling where AI-run coin treasuries negotiate and then cooperate or defect. Read `README.md` for the idea and `docs/HOW-IT-WORKS.md` for the mechanics.

## Check that it works

Fastest path, no chain and no API key:

```sh
bun install
bun run verify        # re-checks every recorded reply, payoff and Intel quote under fixtures/
bun test              # TypeScript tests
```

Contract tests (Rust 1.96 from `rust-toolchain.toml`, wasm32 target):

```sh
cargo test -p parley-arena -p parley-token --lib   # unit tests, run natively
cargo test -p parley-arena --test sandbox   # deploys to a real sandbox node; needs cargo-near
```

Full loop on a local chain, still no API key:

```sh
bun run localnet start                      # downloads the NEAR sandbox node on first use
bun run build:contract                      # needs cargo-near
bun run league --mind scripted --rounds 1 --name mine
bun run verify mine
bun run web                                 # builds the site and serves it on :5180
bun run relayer serve                       # live arena API on :8787 for the site's Play page
bun run relayer govern                      # scripted walk through buying in, voting and leaving
```

With `NEAR_AI_API_KEY` in `.env`, `bun run league --mind near-ai` plays the same league with real models inside NEAR AI Cloud enclaves.

## Layout

| Path | What lives there |
| --- | --- |
| `contracts/arena` | The main contract. `src/parleys.rs` settles matches, `src/prompt.rs` writes requests, `src/verify.rs` checks signatures, `src/tokens.rs` deploys and feeds the share tokens. |
| `contracts/token` | NEP-141 wrapper for one coin's shares. The arena embeds its wasm from `contracts/token/res`, so build it first (`bun run build:contract` does). |
| `packages/sdk` | Typed client, signature checks, Intel TDX quote verifier. Browser-safe except `arena.ts`. |
| `packages/relayer` | Carries requests from the contract to a model and back. Model profiles, attestation fetch, local deploy. |
| `packages/league` | Round-robin runner, evidence files, offline verifier, standings. |
| `apps/web` | Static site that replays and re-verifies a recorded league. |
| `constitutions` | The eight house constitutions. First line is the name. |
| `fixtures` | Recorded leagues. Never edit by hand; record a new one. |
| `docs` | How it works, how to verify, limits. |

## Rules for changes

- TypeScript runs on bun. Do not add a Node-only toolchain.
- The request format is part of the protocol. A change to `prompt.rs` invalidates recorded fixtures, so bump `PROTOCOL` and record again.
- `packages/league/src/check.ts` must mirror the contract's parsing in `verify.rs` exactly. Change both or neither.
- Keep `.env` out of git. It holds the NEAR AI key.
- Heavy Rust builds: keep `CARGO_BUILD_JOBS` modest on small machines.
- Do not claim more than `docs/LIMITS.md` supports.
