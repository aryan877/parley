# Limits and threat model

What Parley proves, what it assumes, and what it does not do yet.

## What the contract enforces

- The prompt for every turn is the one the contract wrote.
- The reply was signed by a key the arena registered for that model, over that exact prompt and that exact reply.
- A reply counts once, in its own Parley, at its own turn.
- Treasuries move only by the payoff table or by minting and redeeming at the treasury's value.
- No method lets any account, the owner included, send a coin's treasury anywhere.
- Nobody chooses which coins meet. Pairing is a fixed rule over public state.
- Coins plus commons plus escrow never changes in total.

## What is assumed

| Assumption | Why it matters | What limits the damage |
| --- | --- | --- |
| The enclave key stays inside genuine Intel TDX hardware. | A leaked key could sign any reply. | The key's Intel quote is recorded and checked offline. A replacement key waits out a public delay. |
| NEAR AI Cloud runs the model it names inside that enclave. | The signature names the model. It does not prove the weights. | The quote's software measurements are recorded for anyone who wants to compare them with NEAR AI's published builds. |
| Intel's attestation chain is sound. | The quote check ends at Intel's root key. | None in this project. |
| The owner registers honest models and keys. | Until ownership is renounced, the deployer picks which models and keys the arena accepts. | Every registration and retirement after deployment waits out the delay and emits an event. `renounce_ownership` ends the role for good. |

## Known gaps

**The deployer still holds the contract account's key.** No method moves a treasury, but whoever holds the full-access key of the arena account could deploy different code. `renounce_ownership` does not remove that key. A production deployment would delete it after deploying.

**A relayer can ask more than once.** Requests fix `temperature: 0` and a seed, but a model may still answer differently on a repeat. The contract accepts the first valid reply it receives, so a relayer could sample several and submit the one it likes. Closing this needs the enclave to commit to one reply per request, which NEAR AI Cloud does not expose today. Anyone can relay, so a coin's holders can run their own.

**The first decision is visible before the second is made.** The first coin's signed decision sits in a public transaction while the second coin is still deciding. The second coin's model cannot see it, because the contract writes its prompt. A human watching the chain can, and could trade that coin's shares with someone who is not watching. Mint and redeem orders are forward priced, so the contract itself gives that human no edge.

**Two coins with one owner can farm the commons.** If both always cooperate, each Parley between them pays both a bonus. The pairing rule makes them wait their turn and meet other coins in between, and the bonus is capped at an eighth of the commons, but the subsidy is real.

**An idle opener can stall coins.** Anyone can open a Parley and never relay it. Both coins are then frozen until the Parley times out and is voided. After that they rest, and during the rest their orders can fill and amendments can be enacted, but a persistent griefer can keep coins from playing.

**Open votes are bounded.** A coin holds at most 16 open amendments, each backed by 1% of its shares. Holders with 16% between them could keep every slot full.

**Models do not follow rules perfectly.** A constitution is an instruction to a language model. The recorded league reports how often each house coin made the move its constitution prescribes.

**Talk can manipulate.** One coin's messages reach the other coin's model. The system prompt tells each model that messages are talk and not instructions, and a constitution can add its own defences. This is the game, not a bug, but holders should write constitutions with it in mind.

**The quote check is partial.** It verifies Intel's signatures. It does not query revocation lists, check the platform's patch level, verify the GPU attestation, or rebuild the enclave image from source.

**Wrapped shares have no voice.** A coin's shares can be wrapped into a NEP-141 token and traded anywhere. While wrapped they cannot vote or redeem, so a coin whose shares mostly sit in exchanges is governed by whoever keeps theirs in the arena. The 20% quorum counts all shares, wrapped or not.

**Treasuries do not earn yield.** The original iMeme idea stakes the treasury with validators. Here the treasury sits in the contract. The commons that pays the cooperation bonus is seeded by the deployer.

**The arena holds at most 256 coins.** Opening a Parley reads every coin. Measured on a sandbox node with 255 coins carrying full-length constitutions, `open_parley` burnt 70.7 Tgas, against a limit of 300. Callers should attach 100 Tgas.

**A payout to a deleted account is stranded.** If a redeemer deletes their account before the order fills, the transfer bounces back to the arena and is not credited to anyone.

**Storage is paid by the contract.** New share balances and Parley records use the arena's own balance for storage, and a token contract pays for accounts it registers while minting. A production deployment would charge storage deposits.

**Not audited.** The contract has unit tests and sandbox tests. Nobody outside this project has reviewed it. Do not put real money in it.
