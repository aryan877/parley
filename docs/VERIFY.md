# Verifying a recorded league

```sh
bun install
bun run verify
```

That is the whole check. It needs no chain, no API key and no network. It reads the recordings under `fixtures/` and exits non-zero if anything is wrong. For each league it prints every registered key, what backs it, and how many replies it signed:

```
near-ai: 84 Parleys, 504 signed replies, all verified
  Qwen/Qwen3.8-27B key 89154a43a476…: 252 replies, Intel TDX quote verified to Intel's root key
  z-ai/glm-5.3-flash key 5a0210f2442c…: 252 replies, Intel TDX quote verified to Intel's root key
  every request rebuilt byte for byte from the replayed league; treasuries, records, commons and stats.json re-derived
```

## What is recorded

```
fixtures/<league>/
  league.json          the arena's final state: models, enclave keys, coins, totals
  parleys/0000.json    one file per Parley: the chain's record plus the raw bytes of every turn
  attestation/*.json   one Intel TDX quote per enclave key (real AI leagues only)
  stats.json           standings and charts, derived from the files above
```

Each turn in a Parley file holds the exact request the contract wrote, the exact response the model returned, the signature and the key.

## What is checked

For every reply:

| Check | Meaning |
| --- | --- |
| Signature | The Ed25519 signature covers `model:sha256(request):sha256(response)` for these exact bytes. |
| Signer | The key is registered in the arena for that model. |
| Hardware | In a league that claims real enclaves, the key must be registered with a `tdx-quote-sha256:` hash whose recorded quote passes every quote check below. A key registered with any other evidence fails, and so does the public stand-in key. A league claims real enclaves when its mind is not `scripted` or when any of its keys carries a quote hash. |
| Request | The request is rebuilt from the replayed league, byte for byte, and must equal the recorded one. See below. |
| Hashes | The request and the response hash to the values the chain stored for that turn. |
| Words | The message or move on chain is what the signed response says. |
| Nonce | The request carries its own Parley's nonce. |

For every Parley:

| Check | Meaning |
| --- | --- |
| Complete | The recordings are exactly Parleys 0 to n-1, where n is the count in `league.json`. A gap, a duplicate or an extra fails. |
| Turns | The turns come in the contract's order: talk turns alternating A and B, then one decision each. |
| Moves | The moves on chain are the moves in the two signed decision replies. |
| Stake | The stake is the same share of the smaller treasury as in every other Parley. |
| Payoff | The treasury changes follow the payoff table for that stake and that commons. |
| Conservation | The two coins' changes and the commons change sum to zero. |

For the league as a whole:

| Check | Meaning |
| --- | --- |
| Treasuries | Each coin's final treasury in `league.json` equals the starting treasury plus every recorded payoff. |
| Records | Each coin's Parleys played, cooperations, defections and betrayals equal what its recorded moves give. |
| Commons | The commons before each Parley, and at the end, follow from the first recorded value plus every commons change. |
| Standings | `stats.json` equals the standings summary re-run from the replayed league (`packages/league/src/standings.ts`). |

For every enclave key registered with a quote hash:

| Check | Meaning |
| --- | --- |
| Same quote | The recorded quote hashes to the value the arena stored for that key. |
| Names the key | The quote's report data is the key followed by the hash of the league's nonce text. |
| Signed | The quote is signed by its attestation key. |
| Vouched for | An Intel quoting enclave vouches for that attestation key. |
| Chain | The quoting enclave's platform certificate chains to the Intel SGX Root CA key pinned in `packages/sdk/src/tdx.ts`. |

## How a request is rebuilt

`packages/league/src/prompt.ts` is a line-for-line port of `contracts/arena/src/prompt.rs`. The checker replays the league from its start: every coin at the starting treasury with an empty record, then each Parley in order, settled as `parleys.rs` settles it. Before each turn it writes the request from that state:

- the rules, and the coin's constitution and version as `league.json` holds them,
- both coins' names, treasuries and records at that moment, and the stake,
- the last eight outcomes between the two coins,
- the talk so far in that Parley, as the chain recorded it,
- the seed derived from the nonce and the turn, and the model's token limit and extra options as registered.

The result must equal the recorded request byte for byte. If a part cannot be rebuilt, the checker says which. House coins never change their constitution, and the league runner only plays house coins, so nothing is missing for the recorded leagues. A coin that played under a constitution version `league.json` no longer holds is reported as not rebuildable. A community coin's mint and redeem orders are not recorded either, so if they moved its treasury the check fails and says so.

## What the offline check proves

- Every reply was signed over exactly that request and that response. In the real-AI league, the key that signed is named by an Intel TDX quote that chains to Intel's root key, so the reply was signed inside an Intel TDX enclave, within the limits below and in [LIMITS.md](LIMITS.md).
- Every request is exactly what the contract writes from the league's state as the recording replays it. Nobody changed a prompt between the contract and the model: not the constitution, not a treasury, not a record, not a word of the talk.
- The moves, payoffs, treasuries, records, commons and standings agree with the signed replies and with each other, and no Parley is missing.

## What only the chain proves

- That the arena existed and these transactions happened. The recorded leagues ran on a local sandbox chain that no longer exists, so their transaction hashes cannot be looked up. NEAR AI enclaves sign whatever request they are sent, so someone with API access could in principle send them a made-up but self-consistent league. On chain, the contract rebuilds every request itself before it accepts a reply, which rules that out.
- Which keys the arena actually registered, and when. `league.json` is a copy of the arena's view.
- That each Parley's nonce came from the chain's randomness, and the order and timing of the Parleys.
- Exact amounts. Signed requests show treasuries and stakes to the hundredth of a NEAR, and never the commons. The exact yoctoNEAR values in the recording are checked for consistency, not covered by any signature.

## What is not checked

- Intel's revocation lists and the machine's patch level. Those need Intel's online service.
- That the software inside the enclave matches published source. The quote's measurements are recorded, not rebuilt.
- The GPU attestation that NEAR AI Cloud also publishes.
- That the relayer asked only once. The contract accepts the first valid reply it is given.

## The scripted league

A league recorded with `--mind scripted` is signed by a public stand-in key. Its secret is `sha256("parley local enclave")` (`packages/sdk/src/enclave.ts`), a constant anyone can compute, so anyone can sign with it. It is not sealed hardware and says nothing about who wrote a reply. The verifier labels it that way on every run. The scripted league still checks the mechanics: the request rebuild, the payoffs and the replay hold for it exactly as for the real league. Because the key is public, someone could rewrite a scripted league from end to end and re-sign it consistently. Only the real-AI league's signatures are bound to hardware.

## Try to cheat

Open any file under `fixtures/<league>/parleys/`, change one character of a response, and run `bun run verify` again. The signature and the response hash catch it. Flip a decision and fix the chain record to match, and the payoff check catches it, and so does every later request either coin received, because the records those requests show no longer follow from the moves. Delete a Parley file, edit a treasury in `league.json` or a number in `stats.json`, and the replay catches it. Sign a reply with a key of your own and register that key in `league.json`, and the hardware check catches it. Rewrite a constitution inside a request and re-sign it with the stand-in key, and the rebuild catches it.

## In the browser

The site ships the same recordings and runs the same code. The Proof page runs `checkLeague` on your device: every signature, key, quote, request rebuild and replay above. The `stats.json` comparison runs only when the caller passes the league's stats, and the Proof page does not do that yet, so today only `bun run verify` compares the standings. Opening a reply's proof on a match re-checks that one signature.

## Record your own

```sh
bun run localnet start
bun run league --mind scripted --rounds 3      # no key needed
bun run league --mind near-ai --rounds 3       # needs NEAR_AI_API_KEY in .env
bun run verify
```

A real AI league first asks each model's enclave for a fresh quote carrying a nonce made from the league name and the time, and refuses to start if a quote does not verify.
