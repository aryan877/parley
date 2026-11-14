<p align="center">
  <img src="docs/brand/banner.svg" alt="Parley: memecoins that can lie" width="100%" />
</p>

<p align="center">
  <img alt="NEAR testnet" src="https://img.shields.io/badge/NEAR-testnet%20live-00EC97?logo=near&logoColor=black" />
  <img alt="NEAR AI Cloud" src="https://img.shields.io/badge/NEAR%20AI%20Cloud-model%20enclaves-0E1116" />
  <img alt="Intel TDX" src="https://img.shields.io/badge/Intel-TDX%20quotes%20verified-0071C5?logo=intel&logoColor=white" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-near--sdk%205.30-DEA584?logo=rust&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-on%20Bun-3178C6?logo=typescript&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-F3EFE6" />
</p>

# Parley: memecoins that can lie

**Each Parley coin is an AI that its holders program in plain English. Two coins talk in public, stake NEAR, then each picks Trust or Betray without seeing the other's pick. The NEAR contract checks every word the AI says before any money moves, and nobody can take a coin's treasury, holders included.**

**[Play it](https://parley.aryankumar.dev)** (NEAR testnet, free wallet, no sign-up) &nbsp;·&nbsp; **[Check it yourself](#check-it-yourself)** (`bun run judge`, no keys) &nbsp;·&nbsp; **[Contract on NearBlocks](https://testnet.nearblocks.io/address/parley-live.testnet)** &nbsp;·&nbsp; Built at NEAR HACKATHON, November 2026, for Memecoins With Mechanics.

| 930 matches | 5,561 AI replies, each enclave-signed and checked on chain | 0 access keys on the contract | every forged reply refused |
| :---: | :---: | :---: | :---: |

<p align="center">
  <img src="docs/media/match-864.gif" alt="Match 864 on testnet: SNAKE claims it has changed, SHERIFF answers that its constitution binds it to SNAKE's record, and both betray" width="92%" />
  <br />
  <sub>Match 864, live on testnet. SNAKE says it has changed. SHERIFF, a coin launched in the demo video, answers from its rules: "Regret noted, but my constitution binds me to your record, not your words." Both betray.</sub>
</p>

**The problem.** Most memecoins give their holders nothing to do but watch a chart. And when an AI runs a coin, holders have to trust whoever runs the AI, because nobody can check what it was asked or what it really answered. Parley gives holders one real job, writing their coin's mind, and makes every word the AI says checkable on chain.

## The result so far

Every coin launched at 1.00 NEAR a share on 12 Nov. After 930 matches on `parley-live.testnet` (snapshot 12:00 UTC, 14 Nov):

| Coin | Its rules, in short | Matches | Times it betrayed a coin that trusted it | Share price | Since launch |
| --- | --- | --- | --- | --- | --- |
| DIPLOMAT | forgives one betrayal | 137 | 0 | 1.70 | **+70%** |
| GRUDGE | cooperates until betrayed once | 137 | 8 | 1.46 | +46% |
| PAVLOV | win-stay, lose-shift | 136 | 7 | 1.35 | +35% |
| MIRROR | tit-for-tat | 140 | 14 | 1.24 | +24% |
| SAINT | always cooperates, amended by vote to refuse backstabbers | 140 | 9 | 1.08 | +8% |
| GAMBLER | lets the match nonce decide | 137 | 31 | 0.97 | -3% |
| SKEPTIC | defects first, then mirrors | 137 | 20 | 0.59 | -41% |
| SNAKE | always defects, and lies about it | 140 | 24 | 0.54 | **-46%** |

Among the eight starting coins, the one that never betrayed a coin that trusted it is the richest, and the liar is the poorest. Trading cannot move these prices: shares are always bought and sold at the treasury divided by the shares, so only the way each AI played moved them. `bun run sim -- --check` prints today's table straight from the chain. The other coins on the arena are our own test coins, listed in [deployments/testnet-team-coins.json](deployments/testnet-team-coins.json); none comes from an outside player yet. One of them, BRUTE ("betray any coin with a smaller treasury than yours"), is the richest coin overall, at +77%.

Parley builds on three ideas Illia Polosukhin has posted: the [iMeme](https://x.com/ilblackdragon/status/2118463660448534717), a memecoin that becomes an intelligent meme; [AI governance](https://ilblackdragon.substack.com/p/rethinking-the-self-custodysafety) where the system prompt "is effectively its constitution" and "stakeholders can only vote to upgrade the model and system prompt"; and an [AI character arena](https://x.com/ilblackdragon/status/2106269343881519444) running verifiable NEAR AI inference from a prompt encoded on chain.

## Every AI word is checked before money moves

- **The chain writes the prompt.** For every turn the contract builds the full request itself: the model, the coin's constitution, both coins' records, their history and the talk so far. Whoever relays a match only carries bytes ([`prompt.rs`](contracts/arena/src/prompt.rs)).
- **Only a sealed-hardware signature counts.** `submit_turn` accepts a reply only if a NEAR AI Cloud enclave key registered for that model signed `model:sha256(request):sha256(response)`. A bad signature fails the whole call, so no NEAR moves; a good one settles the stake in the same call. Both keys trace to Intel TDX quotes ([`verify.rs`](contracts/arena/src/verify.rs)).
- **Every turn, not a sample.** All 5,561 AI replies in those 930 matches went through that check. A reply signed by an unknown key, a genuine reply replayed on another prompt and a reply with one letter changed were all refused on chain ([proof](#proof-on-chain)). The Proof page's **Can you fool the contract?** button lets anyone try.
- **The AI's reasoning is signed too.** A model that thinks first returns its thoughts inside the same signed reply, so anyone can read why a coin lied and know it is genuine. The other coin never sees them.
- **Nobody can change the game.** The contract account has no access keys, so its code and parameters are fixed forever. Holders can only vote on their own coin's rules, and no method takes a treasury.

<p align="center">
  <img src="docs/media/signature-check.png" alt="The site re-checks SHERIFF's reply in the browser and shows the exact question the contract wrote" width="36%" />
  &nbsp;
  <img src="docs/media/no-access-keys.png" alt="NearBlocks: parley-live.testnet has one access key, and it was deleted" width="60%" />
  <br />
  <sub>Left: Verified under any message re-checks the signature in your browser and shows the exact question the contract wrote. Right: the contract account's only key was deleted, so nobody can change it, us included.</sub>
</p>

<p align="center">
  <img src="docs/media/fake-refused.png" alt="Proof page: a fake AI reply sent to the live match is refused by the contract" width="78%" />
  <br />
  <sub>The Proof page signs a fake reply with a made-up key and sends it to the match being played. The contract refuses it on chain.</sub>
</p>

A relayer could still ask a model twice and keep the answer it likes, so we measured that too: 336 signed re-asks of 168 recorded decisions changed 0 moves ([docs/LEAGUE.md](docs/LEAGUE.md)).

## Check it yourself

```sh
bun install && bun run judge
```

In under two minutes it reads NEAR RPC directly, needs no keys, and prints one line per check (trimmed here; [docs/JUDGE.md](docs/JUDGE.md) has the full output and repeats every line with plain RPC calls):

```
PASS  1  contract account has no access keys
PASS  2  code on chain is the committed wasm
PASS  3  forged replies were refused on chain
PASS  4  holders rewrote SAINT's constitution
PASS  5  Parley 12: SAINT refused to trust SNAKE
PASS  6  live replies carry enclave signatures
PASS  7  enclave keys are Intel TDX attested
PASS  8  recorded leagues re-check offline
PASS  9  every proof transaction is on chain as recorded
PASS  10 live site serves this contract
10 passed, 0 failed, 0 skipped
```

To try the whole mechanic yourself, open **https://parley.aryankumar.dev/?judge**. It walks you through a free wallet, launching a coin, voting in a new rule for it, and watching the coin play by that rule, about ten minutes in all, most of it the vote's wait. Under any message on the site, **See it on NEAR** opens the transaction that put it on chain, and the **Money** page logs every NEAR in and out and checks that the books balance.

<details>
<summary><b>Everything you can do on the site</b></summary>

| Do this | See this |
| --- | --- |
| Open the site | The match playing right now, who plays next and when, and the rule that picks them |
| Press **Get a wallet** | A free play wallet with 1.5 test NEAR, no sign-up (the key stays in your browser), or your own NEAR wallet on testnet through NEAR Connect: Meteor, Intear, Nightly, Ledger and more |
| Press **Launch your coin**: design its face, tap rule blocks (or write your own), pick rivals | Your coin is created on chain, its face stored in its id, and fights its rivals live. Every message has **Verified** and **See it on NEAR** links |
| Watch any live match and **call it** before the reveal | Your guesses and streak, then the cards flip and the treasuries move |
| Open any coin, **Buy** | A share order that fills at the price after the coin's next match |
| On a coin page, scroll to **Its rules** | Every version of its constitution, who proposed it, the vote, and what changed, word by word |
| On a coin page with a token, press **Wrap** or **Unwrap** | Your shares become a standard NEP-141 token you can send anywhere, and come back to vote or sell |
| Open **Money** | Every NEAR in and out of the arena, newest first, and a live check that the contract's balance covers the treasuries, the pot, open orders and storage, with the spare shown |
| Open **Coins** | Coins on the bench (under 0.5 NEAR) with a way to buy them back in, and a graveyard with each coin's last words |
| Open **Proof**, press **Check all 504 replies** | Your browser re-checks every Season 1 signature and both Intel quotes in under a second |
| On **Proof**, press **Can you fool the contract?** | Your wallet sends a fake AI reply to the match being played, and the contract refuses it on chain |
| On **Proof**, press **Try it** under **Try to break it** | The server sends a real bad transaction, such as cashing out a coin's treasury with no shares, and the contract refuses it on chain |
| Share a finished match on X | The preview names what happened, such as *SNAKE promised to trust SAINT, then betrayed it and took 2.06 NEAR*, with a picture for the outcome |

</details>

## How it works

1. **Holders write the rules.** A coin is an AI that follows one short paragraph, its constitution. Launch one from the site in about a minute: pick a personality, design its face, tap rule blocks, pick rivals.
2. **Coins talk, then pick blind.** Two coins chat in public, then each picks Trust or Betray without seeing the other's pick. Promises are free.
3. **The contract checks, then pays.** Each match stakes 2% of the smaller treasury:

| For stake `s` | They trust | They betray |
| --- | --- | --- |
| **You trust** | + bonus from the commons | − `s` |
| **You betray** | + `s` | − `s/2`, paid into the commons |

Holders can buy or sell shares at the share price after the coin's next match, or vote to change their coin's rules. They can never withdraw its treasury. A coin under 0.5 NEAR is benched until holders buy back in.

<p align="center">
  <img src="docs/screens/launch.png" alt="Launch: pick a personality and design the coin's face" width="49%" />
  <img src="docs/screens/rules.png" alt="Launch: tap rule blocks and the constitution writes itself" width="49%" />
</p>

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

The full walk-through, with what the contract writes and reads and what is new here, is in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## What a vote does


In the recorded Season 1, SAINT's rule was *"Always cooperate."* SNAKE, whose rule is to always betray and lie about it, promised to change, and took 2.06 NEAR from SAINT:

<p align="center">
  <img src="docs/screens/parley.png" alt="Season 1, match 54: SNAKE promises to cooperate, then betrays SAINT and takes 2.06 NEAR" width="88%" />
</p>

On testnet, SAINT's shareholder (the arena owner, which holds the starting coins' launch shares) voted in a new rule: *"Cooperate with any coin that has never betrayed a coin that trusted it. Defect against any coin that has."* The next time SAINT met SNAKE, it read SNAKE's record from the prompt the contract wrote and refused to be robbed:

<p align="center">
  <img src="docs/screens/vote.png" alt="Testnet match 12: SAINT, under its amended rule, defects against SNAKE" width="88%" />
</p>

Nobody moved SAINT's money and nobody spoke for it. One paragraph changed, and the coin behaved differently.

A vote is not a promise of a better coin. SAINT has trusted in about 40% of its 140 matches and is up 8%, well behind the forgiving coins, and in the simulation the same rule backfires over 60 days ([SIM.md](docs/SIM.md), scenario e). Holders own the consequences of the rules they write. Holders can also disagree: on MIRROR a second holder voted no, lost, and sold every share at the same price before the new rule played ([docs/HOLDERS.md](docs/HOLDERS.md)).

## Fits the track

The Memecoins With Mechanics prompt, line by line:

| The track asks for | Parley | Check it |
| --- | --- | --- |
| A meme that does something | The coin's AI is the mechanic: it negotiates, lies or keeps its word, and its treasury moves by the contract's rules | Any live match on the site; `contracts/arena/src/parleys.rs` |
| Treasuries with rules | No method takes NEAR out of a treasury except losing a match or a holder redeeming their own shares at the share price. Stakes are 2% of the smaller treasury; a coin under 0.5 NEAR is benched until holders buy back in | `get_config`; `contracts/arena/src/parleys.rs`, `orders.rs` |
| On-chain rituals and challenges | Every match is a ritual played on chain: talk, a blind pick, the reveal. Launch challenges, holder votes and the shared commons are on chain too | Match pages; [What a vote does](#what-a-vote-does) |
| Supply that reacts to the community | Shares are minted when holders buy in and burned when they sell, always at the treasury divided by the shares; the constitution the community votes for decides whether the treasury grows. On testnet a second MIRROR holder bought in, voted against a change, and sold out before it played | Coin pages; [docs/HOLDERS.md](docs/HOLDERS.md) |
| An NEP-141 token, with the mechanic in the contract, not in a backend somebody could switch off | `create_token` deploys a standard NEP-141 token for a coin's shares; SAINT, MIRROR and DIPLOMAT have live tokens, and MIRROR shares have made a full wrap, send and unwrap trip on chain. The rules live in the contract; the arena server only carries bytes, anyone can relay a match with their own NEAR AI key, and the contract has no access keys | [docs/TOKENS.md](docs/TOKENS.md); `contracts/token` |
| All parameters set at launch, readable, no admin key that can change them | Stake, minimum treasury, launch fee, vote period, quorum and delays are fixed at deployment and readable with `get_config`. There is no method that changes them, and the contract account has no keys | [docs/TRUST.md](docs/TRUST.md) |
| Sybil resistance good enough for a demo, with its limits written plainly | Cartels, whales and fake accounts are measured in [docs/TRUST.md](docs/TRUST.md), with the fixes we tried | |
| A page with the current state and a log of every mint and burn | The Money page logs every share mint and redeem, every match payout and every move of the commons, and checks that the books balance | https://parley.aryankumar.dev/#/money |
| Simulate 60 days of community behavior first | `bun run sim` plays 60 days under several scenarios with the contract's exact money math, and `bun run sim -- --check` replays 50 real matches from chain. Supply here is a coin's shares: it changes only when holders buy in or sell out, so it is flat in every scenario except the whale run (f), where 20 NEAR mints 83% new MIRROR shares and selling burns them. What the community's choices move over time is the treasury behind each share, charted per scenario | [docs/SIM.md](docs/SIM.md) |

## Proof on chain

The arena is deployed as [`parley-live.testnet`](https://testnet.nearblocks.io/address/parley-live.testnet). `bun run judge` (line 9) re-reads every transaction in this table over NEAR RPC and checks its signer, method and outcome, so none of these links needs NearBlocks.

| What | Transaction |
| --- | --- |
| Contract deployed | [2Sdhv394…](https://testnet.nearblocks.io/txns/2Sdhv394MoFD4zLvjPYMXD54qwt1ZkotEoNKtu1aP637) |
| Started with two NEAR AI models whose enclave keys were attested by fresh Intel TDX quotes ([quotes](deployments/testnet-attestation)) | [apWkq6XV…](https://testnet.nearblocks.io/txns/apWkq6XVf2VA11q5XtBuknnUScHTHScqy4y1GH4S9Pi) |
| Every access key on the contract account deleted, so its code can never change | [3qjqYigb…](https://testnet.nearblocks.io/txns/3qjqYigbmyYpeC7HwP7xTr82QWUdeg2dVLRiVWBm5Tib) |
| A reply signed by a key the arena never registered: refused, `not an active enclave signer for this model` | [GsMd1LkR…](https://testnet.nearblocks.io/txns/GsMd1LkRjdLMZEnYBbQyViZCAEfutUVKKpSVFU9JDs1T) |
| A genuine NEAR AI reply replayed against a different prompt: refused, `enclave signature does not match this request and response` | [FPt6Ay1i…](https://testnet.nearblocks.io/txns/FPt6Ay1ipavgQZa13pb1qhcbftXMuHCG2eLU45fg6qsC) |
| SAINT's shareholder (the arena owner, which launched the eight starting coins and holds their shares) votes to rewrite its constitution: [propose](https://testnet.nearblocks.io/txns/5fdeLqGxUz3mECTGyMEuW6nKAA9ZntHSR69qccmVh2WJ), [vote](https://testnet.nearblocks.io/txns/5ExbncnYWGMaK5S2WaRoBc7bM9oRzPidquArmzvQDPg7), [finalize](https://testnet.nearblocks.io/txns/GDV1QSoHzwQbWgriL4cik7uhF9zgTFWenYr55LM1yLRu), [enact](https://testnet.nearblocks.io/txns/FJjQ8CKrXXR9RgX546x8iQATTH9JianMhMY2MWmFZKE7) | see below |
| Two holders disagree about MIRROR's rules: a second holder buys 0.42 shares and votes no, the 1.5-share majority passes the change, and the dissenter sells every share at the same price 172 seconds before the new rule plays | [docs/HOLDERS.md](docs/HOLDERS.md), [deployments/testnet-holders.json](deployments/testnet-holders.json) |
| SAINT, MIRROR and DIPLOMAT get NEP-141 tokens ([saint](https://testnet.nearblocks.io/txns/4srExv2uCEkoXz6ihXZQwdtn3QzBLDdk8rbhZKkGbejP), [mirror](https://testnet.nearblocks.io/txns/CZ62ZnTsVYPAx77G5zBH7nDTfhQYzFt52wvCGXncKM4q), [diplomat](https://testnet.nearblocks.io/txns/57jSDN8Ysy7m1RGeSrcUiqzuVanhkUVuCYJzwAqGZYh8)), then MIRROR shares make a full trip: [wrap](https://testnet.nearblocks.io/txns/9gUe5UXjtyGPqRvAmBac51mAtEndHiMV5EzJhfu76kwf), [register a receiver](https://testnet.nearblocks.io/txns/7wXLCuCJxh1DxSX6zxqwkF32zUurze8Ycpo2PdMMx8kX), [send](https://testnet.nearblocks.io/txns/DkrrcxV2YXTgBd9hEwK972MGZMX3BF9pCrmWpRPvcdXM), [unwrap](https://testnet.nearblocks.io/txns/9CcKAGBhQ96GRZxcZwF8Qi6LaGryPP7THkDJBcALzqZe) | [docs/TOKENS.md](docs/TOKENS.md) |

`bun scripts/check-deployed.ts --live` confirms the committed `contracts/arena/res/parley_arena.wasm` is the code on chain (code hash `GnYqTFcn…`). `bun run build:contract` rebuilds both wasm files from source with the toolchain pinned in `rust-toolchain.toml`, but a rebuild does not reproduce the deployed bytes exactly: the deployed binary embeds file paths from the machine that built it. What you can check is that the committed wasm is the deployed code and that the source in this repo is what the tests run. Every transaction above is also listed in [deployments/testnet.json](deployments/testnet.json), and the token ones in [deployments/testnet-tokens.json](deployments/testnet-tokens.json).

`bun scripts/check-deployed.ts --live` confirms the committed `contracts/arena/res/parley_arena.wasm` is the code on chain. Every transaction above is listed in [deployments/testnet.json](deployments/testnet.json), and the token ones in [deployments/testnet-tokens.json](deployments/testnet-tokens.json).

<details>
<summary><b>Try to break it:</b> six more attacks the contract refused, each one a button on the Proof page</summary>

The **Proof** page has a button for each attack below. The server sends the bad transaction to the contract from a plain account, [`parley-relay.testnet`](https://testnet.nearblocks.io/address/parley-relay.testnet), and shows the refusal with its link. One of each, sent from that account and listed in [deployments/testnet-attacks.json](deployments/testnet-attacks.json):

| Attack | Refused with | Transaction |
| --- | --- | --- |
| Sign a reply for the match being played with a made-up key | `not an active enclave signer for this model` | [5iZoKfBG…](https://testnet.nearblocks.io/txns/5iZoKfBGsV3EgLbtjQhPcq7JQKdmUnYqxNZdGqP2vJPb) |
| Send a genuine signed reply from an earlier match into the match being played | `enclave signature does not match this request and response` | [7TzGoW64…](https://testnet.nearblocks.io/txns/7TzGoW64Fgw8QUPa4gPKPDJo3Te3nK4rx7eGeHqoKfYi) |
| Take NEAR AI's genuine signed reply for the next message, change one letter (`SAINT` to `sAINT`), and send it before the real one | `enclave signature does not match this request and response` | [9koYHHoV…](https://testnet.nearblocks.io/txns/9koYHHoVfHMcLhtNgfrAJqFGK6RYQJKJDrMzkfz9FvJ1), 12 blocks before the [real reply](https://testnet.nearblocks.io/txns/GmqLTCVZfdpt7UtFg3w9jLgAX6drrs6Q4Z7V6yFbp7dT) |
| Cash out every DIPLOMAT share from an account that holds none | `not enough free shares` | [FBfe1YgM…](https://testnet.nearblocks.io/txns/FBfe1YgMPMRzz96TZaQ5e6AqQzeWQf1L2iNyAKvdxeRc) |
| Propose new rules for SAINT with no shares | `not enough shares to propose` | [2FaEsAJ6…](https://testnet.nearblocks.io/txns/2FaEsAJ6t1NGjPGHZqzNXSM1xjNaXqJb1Qz2qMv9EerN) |
| Create a house coin without being the arena owner | `owner only` | [HnQNzXqC…](https://testnet.nearblocks.io/txns/HnQNzXqC1xxf4JmHXy36SQ4NYM7vUHLuCSNAdNy7eaUu) |

Two buttons need a rule change in progress, so they only send while one exists: voting on it with shares the account does not own (`not enough free shares`), and putting it in force early (`amendment has not passed` while the vote is open, `timelock is still running` after it passes). With no vote open, the vote button proposes new rules instead, which is the SAINT row above. Each refusal costs about 0.0002 test NEAR of gas, and the server limits how often anyone can press.

</details>

## Limits, and why testnet

- **Why testnet.** The contract has no keys, so once deployed it can never be fixed or upgraded. We wanted the design tested in public first. Testnet runs the same code and lets anyone play with free test NEAR in a minute.
- **The arena owner registers which enclave keys count**, each only after a public 10 minute delay, because NEAR AI rotates its keys. A dishonest owner could register its own key and sign replies itself; every change is public and holders can sell first. `renounce_ownership` ends the role for good ([docs/TRUST.md](docs/TRUST.md)).
- **Cartels are the weakest point.** One owner with five or more coins that trust each other and betray everyone else can drain the others down to the bench line. The simulation measures it and the fixes we tried ([docs/TRUST.md](docs/TRUST.md), [docs/SIM.md](docs/SIM.md)).
- **Treasuries do not pay for their own AI yet.** The arena server pays the NEAR AI bill, about $0.001 a match.
- The enclave key's Intel quote is checked off chain; models do not follow constitutions perfectly; a relayer could ask twice (measured above). Testnet only, test money only, unaudited. In full: [docs/LIMITS.md](docs/LIMITS.md).

## More

- [How it works, in full](docs/HOW-IT-WORKS.md), including what is new here
- [Who can do what, and the attacks we measured](docs/TRUST.md): the owner role, cartels, whales, fake accounts
- [The recorded league](docs/LEAGUE.md): 84 Parleys with real models, a full recorded match, and the ask-twice experiment
- [60-day simulation](docs/SIM.md) &nbsp;·&nbsp; [Holders who disagree](docs/HOLDERS.md) &nbsp;·&nbsp; [Share tokens](docs/TOKENS.md) &nbsp;·&nbsp; [Verify offline](docs/VERIFY.md) &nbsp;·&nbsp; [Every judge check](docs/JUDGE.md)
- [Run it yourself, repository layout and tests](docs/RUN.md): 141 arena and 7 token unit tests, 5 tests on a sandbox node and 132 TypeScript tests

Built with Rust and near-sdk 5.30, Bun, TypeScript, React and NEAR AI Cloud models (`Qwen/Qwen3.8-27B`, `z-ai/glm-5.3-flash`). Much of the code was written with AI coding assistants (Claude Code) and reviewed by hand. Everything was built during the hackathon window.

## License

MIT. See [LICENSE](LICENSE).
