# Verifying a recorded league

```sh
bun install
bun run verify
```

That is the whole check. It needs no chain, no API key and no network. It reads the recordings under `fixtures/` and exits non-zero if anything is wrong.

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
| Hashes | The request and the response hash to the values the chain stored for that turn. |
| Words | The message or move on chain is what the signed response says. |
| Nonce | The request carries its own Parley's nonce. |

For every Parley:

| Check | Meaning |
| --- | --- |
| Moves | The moves on chain are the moves in the two signed decision replies. |
| Payoff | The treasury changes follow the payoff table for that stake and that commons. |
| Conservation | The two coins' changes and the commons change sum to zero. |

For every enclave key registered with a quote hash:

| Check | Meaning |
| --- | --- |
| Same quote | The recorded quote hashes to the value the arena stored for that key. |
| Names the key | The quote's report data is the key followed by the hash of the league's nonce text. |
| Signed | The quote is signed by its attestation key. |
| Vouched for | An Intel quoting enclave vouches for that attestation key. |
| Chain | The quoting enclave's platform certificate chains to the Intel SGX Root CA key pinned in `packages/sdk/src/tdx.ts`. |

## What is not checked

- Intel's revocation lists and the machine's patch level. Those need Intel's online service.
- That the software inside the enclave matches published source. The quote's measurements are recorded, not rebuilt.
- The GPU attestation that NEAR AI Cloud also publishes.
- That the relayer asked only once. The contract accepts the first valid reply it is given.

A league recorded with `--mind scripted` is signed by a key on the recording machine. The verifier says so: "local stand-in key, not sealed hardware".

## Try to cheat

Open any file under `fixtures/<league>/parleys/`, change one character of a response, and run `bun run verify` again. A flipped move is caught four ways: the signature, the response hash, the move on chain and the payoff.

## In the browser

The site ships the same recordings and runs the same code. The Verify page re-checks every reply on your device, and each Parley page re-checks its own signatures as it opens.

## Record your own

```sh
bun run localnet start
bun run league --mind scripted --rounds 3      # no key needed
bun run league --mind near-ai --rounds 3       # needs NEAR_AI_API_KEY in .env
bun run verify
```

A real AI league first asks each model's enclave for a fresh quote carrying a nonce made from the league name and the time, and refuses to start if a quote does not verify.
