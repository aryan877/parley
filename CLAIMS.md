# Every claim, and how to check it

Each claim Parley makes in its README, with the kind of evidence behind it and the command or link that checks it. Live numbers grow after every match; the figures here are the README's snapshot from 14 Nov.

- **On chain now:** read from NEAR RPC when you run the command. No keys needed.
- **Offline:** re-checked from files committed in this repo, with no network.
- **Measured:** an experiment we ran, with its raw results committed so the check can be repeated.
- **Modeled:** a simulation using the contract's exact money math. It says what the rules do, not what people will do.

## The contract and its checks

| # | Claim | Evidence | Check it |
| --- | --- | --- | --- |
| 1 | The contract account has no access keys, so its code and parameters can never change | On chain now | `bun run judge` line 1; [NearBlocks keys page](https://testnet.nearblocks.io/address/parley-live.testnet#accesskeys); deletion tx [3qjqYigb…](https://testnet.nearblocks.io/txns/3qjqYigbmyYpeC7HwP7xTr82QWUdeg2dVLRiVWBm5Tib) |
| 2 | The code on chain is the committed `contracts/arena/res/parley_arena.wasm` | On chain now | `bun run judge` line 2; `bun scripts/check-deployed.ts --live` |
| 3 | The contract writes every prompt; a relayer only carries bytes | On chain now + source | `bun run judge` line 6 rebuilds each live request with `get_turn_request` at the block before the reply; [`prompt.rs`](contracts/arena/src/prompt.rs) |
| 4 | A reply counts only if an enclave key registered for that model signed `model:sha256(request):sha256(response)`; otherwise the whole call fails and no NEAR moves | Source + tests | [`verify.rs`](contracts/arena/src/verify.rs), [`parleys.rs`](contracts/arena/src/parleys.rs) `submit_turn`; `cargo test -p parley-arena --test sandbox` (forged replies on a real node) |
| 5 | Exactly two enclave keys are registered, never retired, and each traces to an Intel TDX quote that chains to Intel's root key | On chain now + offline | `bun run judge` line 7; quotes in [deployments/testnet-attestation](deployments/testnet-attestation) |
| 6 | A reply signed by an unknown key, a genuine reply replayed on another prompt, and a reply with one letter changed were all refused on chain | On chain now | `bun run judge` lines 3 and 9; [deployments/testnet-forgeries.json](deployments/testnet-forgeries.json), [deployments/testnet-attacks.json](deployments/testnet-attacks.json) |
| 7 | Three attacks that need no AI were refused on chain too: cashing out DIPLOMAT shares from an account that holds none, proposing new rules without shares, and creating a house coin without being the owner | On chain now | `bun run judge` line 9; [deployments/testnet-attacks.json](deployments/testnet-attacks.json); the Proof page's **Try it** buttons send new ones |
| 8 | Every proof transaction cited in the README happened as recorded: 41 transactions, with signer, method and outcome | On chain now | `bun run judge` line 9 |

## What has happened on testnet

| # | Claim | Evidence | Check it |
| --- | --- | --- | --- |
| 9 | 930 matches and 5,561 accepted AI replies by 12:00 UTC on 14 Nov, each enclave-signed and checked by the contract when it arrived | On chain now | `bun scripts/count.ts` prints today's totals; `bun run judge` line 6 re-verifies the latest replies' signatures |
| 10 | Among the eight starting coins, DIPLOMAT (never betrayed a coin that trusted it) is up 70% and SNAKE (always lies) is down 46% | On chain now | `bun run sim -- --check` prints today's share prices |
| 11 | Share prices move only with play: every recent match paid out exactly by the contract's rules, to the yoctoNEAR | On chain now | `bun run sim -- --check` recomputes the last 50 settled matches |
| 12 | Holders voted a new constitution into SAINT, and under it SAINT refused SNAKE in match 12 | On chain now | `bun run judge` lines 4 and 5 |
| 13 | Two holders disagreed on MIRROR's rules; the dissenter sold every share at the same price before the change played | On chain now | `bun run judge` line 9 ([deployments/testnet-holders.json](deployments/testnet-holders.json)); [docs/HOLDERS.md](docs/HOLDERS.md) |
| 14 | SAINT, MIRROR and DIPLOMAT have NEP-141 share tokens, and MIRROR shares made a full wrap, send and unwrap trip | On chain now | `bun run judge` line 9 ([deployments/testnet-tokens.json](deployments/testnet-tokens.json)); [docs/TOKENS.md](docs/TOKENS.md) |
| 15 | The live site serves this contract | On chain now | `bun run judge` line 10 |

## Recorded and measured

| # | Claim | Evidence | Check it |
| --- | --- | --- | --- |
| 16 | The recorded league's 504 replies re-check offline: every signature, every prompt rebuilt byte for byte, every treasury re-derived, both keys followed to Intel's root | Offline | `bun run verify`; `bun run judge` line 8; [docs/VERIFY.md](docs/VERIFY.md) |
| 17 | Asking a model twice did not change a move: 336 signed re-asks of 168 recorded decisions changed 0 moves | Measured | `bun scripts/reask.ts --verify` (offline, no key); [fixtures/near-ai-reask](fixtures/near-ai-reask); [docs/LEAGUE.md](docs/LEAGUE.md) |
| 18 | A model that thinks first returns its reasoning inside the same signed reply | Offline | any `fixtures/near-ai/parleys/*.json` from a thinking model; the sandbox test submits a 30 KB reasoning reply |
| 19 | 141 arena and 7 token unit tests, 5 tests on a sandbox node, 140 TypeScript tests, all passing | Offline | `cargo test -p parley-arena -p parley-token --lib`; `cargo test -p parley-arena --test sandbox`; `bun test` |

| 20 | On any stake, pot and pair of moves, play never creates or destroys NEAR, no coin loses more than its stake, and the pot never goes negative; buying in or selling out never lowers the share price for the other holders | Offline | `bun test packages/sdk/test/economy.property.test.ts` (10,000 random cases per property) |

## Modeled

| # | Claim | Evidence | Check it |
| --- | --- | --- | --- |
| 21 | Over 60 days, forgiving coins and coins that read the public record win at every stake size, and liars end on the bench | Modeled | `bun run sim`; [docs/SIM.md](docs/SIM.md) |
| 22 | One owner with five or more coins that trust each other can drain the others to the bench line; the launch fee does not stop it; the "first stone" rule cuts plain cartels but not split bait-and-clean ones | Modeled | `bun run sim`; [docs/SIM.md](docs/SIM.md) sections h and i; [docs/TRUST.md](docs/TRUST.md) |

## Not claimed

- **Mainnet.** Parley runs on NEAR testnet with test NEAR only.
- **Outside players.** Every coin beyond the eight starting coins is ours ([deployments/testnet-team-coins.json](deployments/testnet-team-coins.json)).
- **Treasuries paying for their own AI.** The arena server pays the NEAR AI bill, about $0.001 a match.
- **Cartel resistance.** Measured above, and unsolved.
- **Byte-identical rebuilds.** The committed wasm is the code on chain, but rebuilding it elsewhere gives different bytes.
- **Full attestation.** The Intel quote check stops at Intel's signature; it does not cover revocation lists or the enclave's software image.
- **Perfect rule-following.** Models do not always follow their constitution; the recorded league reports how often they did.
- **An audit.** The contract is unaudited.

Limits in full: [docs/LIMITS.md](docs/LIMITS.md).
