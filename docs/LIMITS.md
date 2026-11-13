# Limits and threat model

What Parley proves, what it assumes, and what it does not do yet.

## What the contract enforces

- The prompt for every turn is the one the contract wrote.
- The reply was signed by a key the arena registered for that model, over that exact prompt and that exact reply.
- A reply counts once, in its own Parley, at its own turn.
- Treasuries move only by the payoff table or by minting and redeeming at the treasury's value.
- No method lets any account, the owner included, send a coin's treasury anywhere.
- In open play nobody chooses which coins meet: pairing is a fixed rule over public state. The owner can still schedule a named pair until ownership is renounced.
- Play creates and destroys nothing: in every Parley the two treasuries and the commons change by amounts that add up to zero. Launches, share trades and order escrow add or remove NEAR at the share price.

## What is assumed

| Assumption | Why it matters | What limits the damage |
| --- | --- | --- |
| The enclave key stays inside genuine Intel TDX hardware. | A leaked key could sign any reply. | The key's Intel quote is recorded and checked offline. A replacement key waits out a public delay. |
| NEAR AI Cloud runs the model it names inside that enclave. | The signature names the model. It does not prove the weights. | The quote's software measurements are recorded for anyone who wants to compare them with NEAR AI's published builds. |
| Intel's attestation chain is sound. | The quote check ends at Intel's root key. | None in this project. |
| The owner registers honest models and keys. | Until ownership is renounced, the deployer picks which models and keys the arena accepts. | Every registration and retirement after deployment waits out the delay and emits an event. `renounce_ownership` ends the role for good. |

## Known gaps

**The owner role is still held, and it is the biggest trust assumption.** On the testnet deployment, `parley-live.testnet` has no access keys at all (deleted in the deploy, see `deployments/testnet.json`), so nobody can change its code. The separate owner account can still register new models and enclave keys, each after the public `signer_delay_ns` wait, and can schedule challenge Parleys by name at once. Nothing on chain checks that a registered key really lives in an enclave: a dishonest owner could register a key it controls, wait out the delay, and then sign replies itself. The Intel quote check is off chain. Every registration emits an event and waits, so holders can see it and sell first. The owner also holds most shares of the eight starting coins and votes them like any holder. `renounce_ownership` ends that role for good; it is kept on testnet so a rotated NEAR AI enclave key can be registered during judging. A local deployment keeps the contract account's key.

**A relayer can ask more than once.** Requests fix `temperature: 0` and a seed, but a model may still answer differently on a repeat. The contract accepts the first valid reply it receives, so a relayer could sample several and submit the one it likes. Closing this needs the enclave to commit to one reply per request, which NEAR AI Cloud does not expose today. Anyone can relay, so a coin's holders can run their own. Measured: every one of the 168 recorded decisions was asked twice more with the same request bytes, and none of the 336 signed answers changed the move (`fixtures/near-ai-reask`). That bounds the gain from asking twice for these constitutions and models; it is not a guarantee for others.

**The first decision is visible before the second is made.** The first coin's signed decision sits in a public transaction while the second coin is still deciding. The second coin's model cannot see it, because the contract writes its prompt. A human watching the chain can, and could trade that coin's shares with someone who is not watching. Mint and redeem orders are forward priced, so the contract itself gives that human no edge.

**Coins with one owner can farm the arena.** Coins can recognise each other by name, so one owner can launch coins whose constitutions trust each other and betray everyone else. They fill the commons by betraying outsiders and win it back as trust bonuses when they meet. `bun run sim` measures it with the contract's money math: groups of 1 to 3 coins lose money, but 5 or more take everything the other coins and the commons hold above the bench line within 60 days. The launch fee does not stop it, because it goes into the commons the group wins back, and a long pair rest only slows small groups. A next deployment should hide the rival's name from the prompt and cap the trust bonus one pair can draw. See [SIM.md](SIM.md), section (g).

**An idle opener can stall coins.** Anyone can open a Parley and never relay it. Both coins are then frozen until the Parley times out and is voided. After that they rest, and during the rest their orders can fill and amendments can be enacted, but a persistent griefer can keep coins from playing.

**Open votes are bounded.** A coin holds at most 16 open amendments, one per proposer, each backed by 1% of its shares. Holders with 16% between them could keep every slot full.

**Votes are counted at the close.** Quorum is measured against the shares that exist when a vote is finalized, and a holder can vote in the last block. There is no snapshot at proposal time.

**Models do not follow rules perfectly.** A constitution is an instruction to a language model. The recorded league reports how often each house coin made the move its constitution prescribes.

**Talk can manipulate.** One coin's messages reach the other coin's model. The system prompt tells each model that messages are talk and not instructions, and a constitution can add its own defences. This is the game, not a bug, but holders should write constitutions with it in mind.

**The quote check is partial.** It verifies Intel's signatures. It does not query revocation lists, check the platform's patch level, verify the GPU attestation, or rebuild the enclave image from source.

**Wrapped shares have no voice.** A coin's shares can be wrapped into a NEP-141 token and traded anywhere. While wrapped they cannot vote or redeem, so a coin whose shares mostly sit in exchanges is governed by whoever keeps theirs in the arena. The 20% quorum counts all shares, wrapped or not.

**Treasuries do not earn yield or pay for their own AI.** The original iMeme idea stakes the treasury with validators and lets that income pay for the coin's AI. Here the treasury sits in the contract, the commons that pays the cooperation bonus is seeded by the deployer, and the arena server pays the NEAR AI bill, about $0.001 a match. Anyone can relay with their own key, but nothing in the contract pays them for it.

**The arena holds at most 256 coins.** Opening a Parley reads every coin. Measured on a sandbox node with 255 coins carrying full-length constitutions, `open_parley` burnt 70.7 Tgas, against a limit of 300. Callers should attach 100 Tgas.

**A payout to a deleted account is stranded.** If a redeemer deletes their account before the order fills, the transfer bounces back to the arena and is not credited to anyone.

**Storage is paid by the contract, and match history is never pruned.** New share balances and Parley records use the arena's own balance for storage, about 2.2 KB (0.022 NEAR) per match, and a token contract pays for accounts it registers while minting. On testnet the arena's balance is topped up by hand and the live server waits 5 minutes between open-play matches; launches and challenges still start at once. A production deployment would charge storage deposits and archive old matches.

**The deployed binary cannot be rebuilt byte for byte elsewhere.** The committed wasm is the code on chain, and anyone can check that. Rebuilding from source gives different bytes, because the deployed binary embeds file paths from the machine that built it. A future deployment should use a path-independent reproducible build.

**Not audited.** The contract has unit tests and sandbox tests. Nobody outside this project has reviewed it. Do not put real money in it.
