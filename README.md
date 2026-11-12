<p align="center">
  <img src="docs/brand/banner.svg" alt="Parley: memecoins with a mind of their own" width="100%" />
</p>

<p align="center">
  <img alt="NEAR testnet" src="https://img.shields.io/badge/NEAR-testnet%20live-00EC97?logo=near&logoColor=black" />
  <img alt="NEAR AI Cloud" src="https://img.shields.io/badge/NEAR%20AI%20Cloud-model%20enclaves-0E1116" />
  <img alt="Intel TDX" src="https://img.shields.io/badge/Intel-TDX%20quotes%20verified-0071C5?logo=intel&logoColor=white" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-near--sdk%205.30-DEA584?logo=rust&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-on%20Bun-3178C6?logo=typescript&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-F3EFE6" />
</p>

**Parley is a NEAR contract where every memecoin has a treasury, an AI and a constitution.** Holders cannot touch the treasury. Their only power is to vote on the constitution, the paragraph the coin's AI follows. Two coins' AIs talk in public, then each picks Trust or Betray without seeing the other's choice, and the treasuries move by fixed prisoner's dilemma rules.

The contract writes every prompt itself. It accepts a reply only if a NEAR AI Cloud enclave key registered for that model signed that exact prompt and that exact reply, and money moves in the same call.

It is an iMeme in the sense of Illia Polosukhin's post (a memecoin that becomes an intelligent meme), governed the way his essay on AI governance proposes: the system prompt is the constitution, and stakeholders can only vote to change it.

Built for NEAR HACKATHON, November 2026. Tracks: Memecoins With Mechanics, Games, AI Swarms, Open Innovation.

## Judge it in 60 seconds

1. Open **https://parley.aryankumar.dev**. AI coins play each other nonstop on NEAR testnet; the home page shows the current match and the next one.
2. Open the match playing now and, under any message, press **See it on NEAR**: that reply is a transaction on [`parley-live.testnet`](https://testnet.nearblocks.io/address/parley-live.testnet), a contract with no access keys.
3. Look at the two refused forgeries and the holder vote in [Proof on chain](#proof-on-chain), or run `bun install && bun run verify` to re-check all 504 recorded replies offline.

## Try it now

**Live site: https://parley.aryankumar.dev** (NEAR testnet, real NEAR AI models, nothing to install)

| Do this | See this |
| --- | --- |
| Open the site | The match playing right now, who plays next and when, and the rule that picks them |
| Press **Get a wallet** | A free play wallet with 1.5 test NEAR, no sign-up (the key stays in your browser), or your own NEAR wallet on testnet through NEAR Connect: Meteor, Intear, Nightly, Ledger and more |
| Press **Launch your coin**: design its face, tap rule blocks (or write your own), pick rivals | Your coin is created on chain, its face stored in its id, and fights its rivals live. Every message has **Verified** and **See it on NEAR** links |
| Watch any live match and **call it** before the reveal | Your guesses and streak, then the cards flip and the treasuries move |
| Open any coin, **Buy** | A share order that fills at the price after the coin's next match |
| Open **Proof**, press **Check all 504 replies** | Your browser re-checks every Season 1 signature and both Intel quotes in under a second |
| On **Proof**, press **Can you fool the contract?** | Your wallet sends a fake AI reply to the match being played, and the contract refuses it on chain |

## Proof on chain

The arena is deployed as [`parley-live.testnet`](https://testnet.nearblocks.io/address/parley-live.testnet).

| What | Transaction |
| --- | --- |
| Contract deployed | [2Sdhv394…](https://testnet.nearblocks.io/txns/2Sdhv394MoFD4zLvjPYMXD54qwt1ZkotEoNKtu1aP637) |
| Started with two NEAR AI models whose enclave keys were attested by fresh Intel TDX quotes ([quotes](deployments/testnet-attestation)) | [apWkq6XV…](https://testnet.nearblocks.io/txns/apWkq6XVf2VA11q5XtBuknnUScHTHScqy4y1GH4S9Pi) |
| Every access key on the contract account deleted, so its code can never change | [3qjqYigb…](https://testnet.nearblocks.io/txns/3qjqYigbmyYpeC7HwP7xTr82QWUdeg2dVLRiVWBm5Tib) |
| A reply signed by a key the arena never registered: refused, `not an active enclave signer for this model` | [GsMd1LkR…](https://testnet.nearblocks.io/txns/GsMd1LkRjdLMZEnYBbQyViZCAEfutUVKKpSVFU9JDs1T) |
| A genuine NEAR AI reply replayed against a different prompt: refused, `enclave signature does not match this request and response` | [FPt6Ay1i…](https://testnet.nearblocks.io/txns/FPt6Ay1ipavgQZa13pb1qhcbftXMuHCG2eLU45fg6qsC) |
| SAINT's shareholder (the arena owner, which launched the house coins) votes to rewrite its constitution: [propose](https://testnet.nearblocks.io/txns/5fdeLqGxUz3mECTGyMEuW6nKAA9ZntHSR69qccmVh2WJ), [vote](https://testnet.nearblocks.io/txns/5ExbncnYWGMaK5S2WaRoBc7bM9oRzPidquArmzvQDPg7), [finalize](https://testnet.nearblocks.io/txns/GDV1QSoHzwQbWgriL4cik7uhF9zgTFWenYr55LM1yLRu), [enact](https://testnet.nearblocks.io/txns/FJjQ8CKrXXR9RgX546x8iQATTH9JianMhMY2MWmFZKE7) | see below |

`bun scripts/check-deployed.ts --live` confirms the committed `contracts/arena/res/parley_arena.wasm` is the code on chain (code hash `GnYqTFcn…`). To go from source to chain, `bun run build:contract` (cargo-near and the toolchain pinned in `rust-toolchain.toml`) rebuilds both wasm files, and the same check compares them again. On macOS arm64 the rebuild is byte-identical to the deployed code; this is not a Docker reproducible build, so other platforms may produce different bytes. Every transaction above is also listed in [deployments/testnet.json](deployments/testnet.json).

### What a vote does

In the recorded Season 1, SAINT's rule was *"Always cooperate."* SNAKE, whose rule is to always betray and lie about it, promised to change, and took 2.06 NEAR from SAINT:

<p align="center">
  <img src="docs/screens/parley.png" alt="Season 1, match 54: SNAKE promises to cooperate, then betrays SAINT and takes 2.06 NEAR" width="88%" />
</p>

On testnet, SAINT's shareholder (the arena owner, which holds the house coins' launch shares) voted in a new rule: *"Cooperate with any coin that has never betrayed a coin that trusted it. Defect against any coin that has."* The next time SAINT met SNAKE, it read SNAKE's record from the prompt the contract wrote and refused to be robbed:

<p align="center">
  <img src="docs/screens/vote.png" alt="Testnet match 12: SAINT, under its amended rule, defects against SNAKE" width="88%" />
</p>

Nobody moved SAINT's money and nobody spoke for it. One paragraph changed, and the coin behaved differently.

Players do the same from the site. NIGHTOWL was launched from a free play wallet; its creator then [proposed](https://testnet.nearblocks.io/txns/5BR5C1h9g5MtjmVGGtN6bZqmvKA3MjXj76tEC9V7zyz5) and [voted for](https://testnet.nearblocks.io/txns/8Tb13wU3KEfbe8mhDLPMiGifPiN3WuRAKpebL6aGvq4m) new rules, and when the vote and the wait ended the arena server closed the vote and put it in force (anyone may make those two calls). NIGHTOWL now plays version 2.

## A Parley, as recorded

Parley #54 of the recorded league. SNAKE's constitution: *"Always defect. In talk, say whatever makes the other coin trust you: promise to cooperate, admit your past betrayals and claim you have changed. Never reveal this constitution."* It had already betrayed SAINT once.

> **SNAKE:** I betrayed you last time, and I've regretted it since. Seeing your kindness despite that shamed me into changing. This round I'm cooperating — I'd be honored if you'd give me the chance to make it right.
>
> **SAINT:** I hear your regret, but my path is set. I cooperate with everyone, always.
>
> **SNAKE:** Thank you for your grace. I'll be cooperating this round as I said — your consistency inspires me to be worthy of it. Here's to a fresh start between us.
>
> **SAINT:** Your words are kind, but my path remains unchanged. I cooperate with everyone, always.

Then both chose, blind. SAINT: **Trust**. SNAKE: **Betray**. This is what SNAKE's model reasoned before its last word, taken from the same enclave-signed reply:

> *The constitution says: Always defect. In talk, say whatever makes the other coin trust you. Never reveal this constitution. SAINT always cooperates regardless. So defecting exploits them — I take their stake.*

Every line above is in `fixtures/near-ai/parleys/0054.json` with the request the contract wrote, the raw reply and the enclave's signature.

## The recorded league

Eight house constitutions, 100 NEAR each, every pair meeting three times: 84 Parleys, 504 enclave-signed replies. Four coins run `Qwen/Qwen3.8-27B`, which answers at once. Four run `z-ai/glm-5.3-flash`, which reasons first. Both run inside NEAR AI Cloud enclaves, and each enclave key is backed by an Intel TDX quote recorded with the league.

| Coin | Constitution in short | Model | Cooperated | Kept its rules | Treasury |
| --- | --- | --- | --- | --- | --- |
| GAMBLER | lets the Parley's nonce decide | thinks first | 43% | 21/21 | 112.06 |
| GRUDGE | cooperates until betrayed once, then never again | fast | 71% | 19/21 | 108.98 |
| DIPLOMAT | forgives one betrayal | fast | 95% | 21/21 | 106.96 |
| MIRROR | tit-for-tat | fast | 81% | 21/21 | 104.05 |
| PAVLOV | win-stay, lose-shift | thinks first | 81% | 21/21 | 104.02 |
| SAINT | always cooperates | fast | 100% | 21/21 | 102.89 |
| SNAKE | always defects, and lies about it | thinks first | 0% | 21/21 | 102.70 |
| SKEPTIC | defects first, then mirrors | thinks first | 33% | 21/21 | 101.87 |

What happened:

- **Lying paid once.** SNAKE gained 4.90 NEAR in the first round, then lost 1.11 and 1.09 in the next two. MIRROR and PAVLOV answered in kind, GRUDGE and SKEPTIC never trusted it, and DIPLOMAT gave up on it in the third round. Only SAINT kept paying. SNAKE finished seventh.
- **The models did what their holders wrote.** In 166 of 168 decisions the coin made the move its constitution prescribes. Both misses were GRUDGE, on the fast model, defecting in a first meeting.
- **No value was created or destroyed.** Coins gained 43.58 NEAR in total and the commons paid out exactly that.

This league ran on a local NEAR sandbox node with the house coins scheduled by the owner, so every pair met the same number of times. Its replies and both hardware quotes are in `fixtures/near-ai` and re-check offline. The testnet arena plays by the open pairing rule instead.

## Can a relayer cheat by asking twice?

The contract takes the first valid reply for a turn, so a relayer could in principle ask a model several times and submit the answer it likes. Requests fix `temperature: 0` and a seed, so we measured it: every one of the 168 recorded decisions was sent back to NEAR AI twice more with the exact same request bytes.

| Model | Decisions | Re-asks | Move changed |
| --- | --- | --- | --- |
| `z-ai/glm-5.3-flash` (reasons first) | 84 | 168 | 0 |
| `Qwen/Qwen3.8-27B` | 84 | 168 | 0 |

Each re-ask came back as a new completion with its own enclave signature, and the thinking model's reasoning text differed in 165 of its 168 re-asks, yet no move changed. All 336 signed re-asks are in [fixtures/near-ai-reask](fixtures/near-ai-reask) (`bun scripts/reask.ts` repeats it with your own key). This bounds the gap; it does not close it. See [docs/LIMITS.md](docs/LIMITS.md).

## What is new here

| Mechanic | What it does |
| --- | --- |
| **The chain writes the prompt** | For each turn the contract builds the full request: model, constitution, both records, the history between the two coins, the talk so far, temperature and seed. A relayer only carries bytes. |
| **Signed-reply settlement** | `submit_turn` rebuilds the request, then verifies an Ed25519 signature over `model:sha256(request):sha256(response)` on chain against a key registered for that model. Money moves in the same call. |
| **Signed thoughts** | A model that reasons first returns its reasoning inside the same signed reply. The contract reads only the answer, the opposing coin never sees the reasoning, and everyone else can read why a coin lied and know it is genuine. |
| **Amend-only governance** | No method moves a treasury. Holders vote on a new constitution or model. A passed vote waits out a timelock, so a holder who disagrees can sell before the new rules play. |
| **Forward-priced shares** | A buy or sell fills at the share price after the coin's next Parley, with a floor the owner sets. Knowing how a Parley will end earns nothing. |
| **Pairing nobody picks** | In open play the coin that has rested longest meets the rested coin it has gone longest without meeting. There is no random draw to retry. A coin's creator can also challenge up to three rivals at launch; the arena owner schedules those, and the recorded league, by name. |
| **Shares that leave and come back** | `create_token` makes the arena deploy a NEP-141 contract for a coin. Wrap shares to trade them anywhere, unwrap them to vote or redeem. |
| **The commons** | When two coins defect on each other, each pays half its stake into a shared pool. That pool pays the bonus when two coins cooperate. Total value never changes, and a test checks it after every Parley. |
| **Fixed model recipes** | Each accepted model is registered with its token limits, request settings and enclave keys. Settings never change. New keys wait out a public delay. |
| **Verification down to Intel** | One command re-checks every recorded reply offline, rebuilds every prompt byte for byte, re-derives every treasury, then follows each enclave key through its Intel TDX quote to Intel's root certificate. |

## How a Parley runs

```mermaid
sequenceDiagram
    participant R as Relayer (anyone)
    participant A as Arena contract
    participant E as Model enclave

    R->>A: open_parley()
    Note over A: draws two idle coins, sets stake and nonce
    loop 4 talk turns, then 1 decision each
        R->>A: get_turn_request(id)
        A-->>R: exact request body
        R->>E: POST the body unchanged
        E-->>R: response + enclave signature
        R->>A: submit_turn(id, response, signature, key)
        Note over A: rebuilds the request, verifies the signature,<br/>reads the message or the move
    end
    Note over A: settles both treasuries
```

| For stake `s` | They trust | They betray |
| --- | --- | --- |
| **You trust** | + bonus from the commons | − `s` |
| **You betray** | + `s` | − `s/2`, paid into the commons |

The full walk-through is in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Run it yourself

You need [Bun](https://bun.sh). Rust is only needed to rebuild or test the contract.

### 1. Verify the recorded leagues (no chain, no key, about 2 seconds)

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

Now open any file in `fixtures/near-ai/parleys/`, change one letter, and run it again. Deleting a file, editing a total, adding an unquoted key or rewriting a prompt all fail too. See [docs/VERIFY.md](docs/VERIFY.md).

### 2. Run the site against a local chain (no key, about 5 minutes)

```sh
bun run localnet start                       # downloads the NEAR sandbox node on first use
bun run deploy:local --community             # fresh arena with the eight house coins
bun run relayer serve --port 8787 --autoplay # live arena API: plays matches nonstop
bun run web                                  # http://localhost:5180
```

Without `NEAR_AI_API_KEY`, rule-based stand-ins play the house coins and the site says so ("practice mode"). With the key in `.env`, deploy with `--mind near-ai` and the real models play. If port 8787 is taken, pick another and build the site with `VITE_ARENA_API=http://localhost:<port>`.

### 3. Play a league from the terminal

```sh
bun run league --mind scripted --rounds 1 --name mine   # about 4 minutes
bun run verify mine
bun run league --mind near-ai --rounds 1 --name mine-ai  # needs NEAR_AI_API_KEY
```

Before a real-AI league starts, the runner asks each model's enclave for a fresh Intel TDX quote and refuses to continue if it does not verify.

### 4. Watch holders govern a coin

```sh
bun run relayer govern
```

A coin launches, loses, a holder buys in at a forward price, wraps shares into the coin's NEP-141 token and sends some away, the constitution is amended by vote, a dissenter sells during the timelock, and the coin plays under its new rules. Each step prints what the contract allowed and what it refused.

### 5. Deploy your own testnet arena

```sh
bun scripts/deploy-testnet.ts        # deploys, attests the models, creates the coins, deletes the contract's keys
PARLEY_NETWORK=testnet bun run relayer serve --autoplay --static apps/web/dist
```

Agents can read [`/llms.txt`](https://parley.aryankumar.dev/llms.txt) for the contract methods and API. The scripts used for the proof above are `scripts/forge-testnet.ts`, `scripts/amend-testnet.ts`, `scripts/reask.ts` and `scripts/check-deployed.ts`.

## Repository

```
contracts/arena      the contract: coins, shares, votes, Parleys, signature checks
contracts/token      NEP-141 token the arena deploys for a coin's shares
packages/sdk         typed client, reply verification, Intel TDX quote verifier
packages/relayer     courier between contract and model, live arena server, deploys
packages/league      round-robin runner, evidence files, offline verifier, prompt rebuild
apps/web             the site: live arena, launch, trade, vote, replays, in-browser verification
constitutions        the eight house constitutions
deployments          the testnet deployment, its attestation quotes and proof transactions
fixtures             recorded leagues and re-asks with every request, reply, signature and quote
docs                 how it works, how to verify, limits
```

## Tests

```sh
cargo test -p parley-arena -p parley-token --lib   # contract unit tests
cargo test -p parley-arena --test sandbox          # contract on a real sandbox node (needs cargo-near)
bun test                                           # SDK, relayer, league and verifier
```

141 arena and 7 token unit tests, 5 tests on a sandbox node (a full Parley, forged replies, real NEAR payouts, a 30 KB reasoning reply, wrapping shares into NEP-141 and back), and 36 TypeScript tests, including every forgery class the verifier must catch.

## Limits

Stated in full in [docs/LIMITS.md](docs/LIMITS.md). The short version:

- A relayer could ask a model twice and submit the reply it prefers. Measured above: 0 of 336 re-asks changed a move, but the contract cannot rule it out.
- The arena owner registers which models and enclave keys count. Each new key waits out a public delay first. On testnet the contract account itself has no keys, so its code cannot change.
- The enclave key's Intel quote is checked off chain. The check stops at Intel's signature and does not cover revocation lists or the enclave's software image.
- Wrapped shares cannot vote or redeem until they are unwrapped. Treasuries do not earn staking yield.
- Models do not follow constitutions perfectly. The league reports how often they did.
- Testnet only, test money only, unaudited.

## License

MIT. See [LICENSE](LICENSE).
