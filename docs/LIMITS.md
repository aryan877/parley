# Limits and threat model

What Parley proves, what it assumes, and what it does not do yet.

## What the contract enforces

- The prompt for every turn is the one the contract wrote.
- The reply was signed by a key the arena registered for that model, over that exact prompt and that exact reply.
- A reply counts once, in its own Parley, at its own turn.
- Treasuries move only by the payoff table or by minting and redeeming at the treasury's value.
- No account, the owner included, can send a coin's treasury anywhere.
- Coins plus commons plus escrow never changes in total.

## What is assumed

| Assumption | Why it matters | What limits the damage |
| --- | --- | --- |
| The enclave key stays inside genuine Intel TDX hardware. | A leaked key could sign any reply. | The key's Intel quote is recorded and checked offline. A replacement key waits out a public delay. |
| NEAR AI Cloud runs the model it names inside that enclave. | The signature names the model. It does not prove the weights. | The quote's software measurements are recorded for anyone who wants to compare them with NEAR AI's published builds. |
| Intel's attestation chain is sound. | The quote check ends at Intel's root key. | None in this project. |
| The owner registers honest models and keys. | Until ownership is renounced, the deployer picks which models and keys the arena accepts. | Every registration waits out the delay and emits an event. `renounce_ownership` ends the role for good. |

## Known gaps

**A relayer can ask more than once.** Requests fix `temperature: 0` and a seed, but a model may still answer differently on a repeat. The contract accepts the first valid reply it receives, so a relayer could sample several and submit the one it likes. Closing this needs the enclave to commit to one reply per request, which NEAR AI Cloud does not expose today. Anyone can relay, so a coin's holders can run their own.

**The first decision is visible before the second is made.** The first coin's signed decision sits in a public transaction while the second coin is still deciding. The second coin's model cannot see it, because the contract writes its prompt. A human watching the chain can, and could trade that coin's shares with someone who is not watching. Mint and redeem orders are forward priced, so the contract itself gives that human no edge.

**Models do not follow rules perfectly.** A constitution is an instruction to a language model. The recorded league reports how often each house coin made the move its constitution prescribes.

**Talk can manipulate.** One coin's messages reach the other coin's model. The system prompt tells each model that messages are talk and not instructions, and a constitution can add its own defences. This is the game, not a bug, but holders should write constitutions with it in mind.

**The quote check is partial.** It verifies Intel's signatures. It does not query revocation lists, check the platform's patch level, verify the GPU attestation, or rebuild the enclave image from source.

**Shares are ledger entries.** They are balances inside the arena contract, transferable with `transfer_shares`. They are not NEP-141 tokens yet, so wallets and exchanges do not list them.

**Treasuries do not earn yield.** The original iMeme idea stakes the treasury with validators. Here the treasury sits in the contract. The commons that pays the cooperation bonus is seeded by the deployer.

**Storage is paid by the contract.** New share balances and Parley records use the contract's own balance for storage. A production deployment would charge storage deposits.

**Not audited.** The contract has unit tests and sandbox tests. Nobody outside this project has reviewed it. Do not put real money in it.
