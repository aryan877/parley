# Judge PARLEY from a terminal

```sh
bun install
bun run judge
```

One command, no keys, no account, about a minute. It reads NEAR testnet over plain JSON-RPC, re-checks the recorded leagues offline, and prints one `PASS` or `FAIL` line per claim with the transaction hashes behind it. It exits non-zero if any line fails. Nothing depends on NearBlocks.

```
PARLEY judge: parley-live.testnet on NEAR testnet, read from https://test.rpc.fastnear.com and https://archival-rpc.testnet.fastnear.com

PASS  1  contract account has no access keys              0 keys at block 277581867; removed by tx 3qjqYigbmyYpeC7HwP7xTr82QWUdeg2dVLRiVWBm5Tib
         rpc: query view_access_key_list parley-live.testnet
PASS  2  code on chain is the committed wasm              code_hash GnYqTFcntLA9XgZxVp59NBLdcH9bWsYRotseRWPPAyDu = sha256 of contracts/arena/res/parley_arena.wasm
         rpc: query view_account parley-live.testnet
PASS  3  forged replies were refused on chain             2 of 2 submit_turn calls on Parley 11 failed with the recorded error
         GsMd1LkRjdLMZEnYBbQyViZCAEfutUVKKpSVFU9JDs1T  a key the arena never registered: "not an active enclave signer for this model"
         FPt6Ay1ipavgQZa13pb1qhcbftXMuHCG2eLU45fg6qsC  a genuine enclave reply replayed on a new prompt: "enclave signature does not match this request and response"
         rpc: tx <hash> sender parley-relay.testnet
PASS  4  holders rewrote SAINT's constitution             4 of 4 steps succeeded, enacted as v2; get_coin saint: rules v2, the voted text
         propose   5fdeLqGxUz3mECTGyMEuW6nKAA9ZntHSR69qccmVh2WJ  propose_amendment succeeded
         vote yes  5ExbncnYWGMaK5S2WaRoBc7bM9oRzPidquArmzvQDPg7  vote succeeded
         finalize  GDV1QSoHzwQbWgriL4cik7uhF9zgTFWenYr55LM1yLRu  finalize_amendment succeeded
         enact     FJjQ8CKrXXR9RgX546x8iQATTH9JianMhMY2MWmFZKE7  enact_amendment succeeded
         rpc: tx <hash> sender parley-owner.testnet; query call_function get_coin {"coin":"saint"}
PASS  5  Parley 12: SAINT refused to trust SNAKE          SAINT on rules v2 chose Defect, SNAKE chose Defect. SAINT said: "SNAKE, your record shows you have betrayed coins that trusted y…"
         rpc: query call_function get_parley {"id":12}
PASS  6  live replies carry enclave signatures            18 of 18 replies in Parleys 819, 818, 817 verified
         Parley 819 moonpie9309b6547fuh vs diplomat: 6 of 6
         Parley 818 nightowl03a4530wgy vs diplomat: 6 of 6
         Parley 817 martyrmoon03348004hc vs brutek81b: 6 of 6
         tx hashes from parley.aryankumar.dev/api/match/<id>; request = get_turn_request at the block before each reply ran; reply, signature, key = submit_turn arguments
         rpc: tx FWNyduAXvNeHbroMfNZCr8Xj6AEMi7RQaf7DPTrj9Ds1 sender parley-owner.testnet; block <receipt block_hash>; get_turn_request {"id":819} at block_id = prev_hash
PASS  7  enclave keys are Intel TDX attested              2 of 2 keys in get_models match a recorded quote that names the key and chains to Intel's root key
         Qwen/Qwen3.8-27B 89154a43a476…  Intel TDX quote verified to Intel's root key
         z-ai/glm-5.3-flash 5a0210f2442c…  Intel TDX quote verified to Intel's root key
         rpc: query call_function get_models; quotes in deployments/testnet-attestation
PASS  8  recorded leagues re-check offline                near-ai: 84 Parleys, 504 replies (Intel TDX keys); scripted: 84 Parleys, 504 replies (public stand-in key, not hardware)
         signatures, Intel quotes, every request byte, payoffs, treasuries and standings re-derived, no network
         rpc: none, offline: bun run verify
PASS  9  every proof transaction is on chain as recorded  41 of 41 transactions in deployments/*.json found on chain with the recorded signer, method and outcome
         testnet.json: 12 of 12
         testnet-forgeries.json: 2 of 2
         testnet-amendment.json: 4 of 4
         testnet-attacks.json: 6 of 6
         testnet-holders.json: 10 of 10
         testnet-tokens.json: 7 of 7
         rpc: tx <hash> <signer> for every hash; refusals must fail with the recorded error, everything else must succeed
PASS  10  live site serves this contract                   https://parley.aryankumar.dev/api/arena reports testnet parley-live.testnet, 820 Parleys

10 passed, 0 failed, 0 skipped in 59.7s. Every line can be repeated with plain RPC calls: docs/JUDGE.md
```

## Where the facts come from

| Source | Used for |
| --- | --- |
| `https://test.rpc.fastnear.com` | Current contract state: keys, code hash, coins, Parleys, models |
| `https://archival-rpc.testnet.fastnear.com`, then `https://archival-rpc.testnet.near.org` | Transactions, and contract state at past blocks. Regular nodes drop blocks older than a few epochs. |
| `https://parley.aryankumar.dev/api/match/<id>`, or `https://tx.test.fastnear.com` when the site is down | Only the hashes of recent turn transactions. Every byte the check uses is then read again from RPC. |
| This repo | The committed wasm, the proof transactions in `deployments/`, the Intel quotes in `deployments/testnet-attestation/`, the recorded leagues in `fixtures/` |

A node that answers HTTP 429, times out or no longer has a block hands the call to the next URL. Later rounds wait 0.5, 1 and 2 seconds first.

`--matches 10` checks the 10 latest settled Parleys on line 6 instead of 3. `--site <url>` points lines 6 and 9 at another copy of the site.

## Repeating each line by hand

Every call below is a plain NEAR JSON-RPC POST. Run them from the repo root after `bun install`, with `curl`, `jq` and `python3`:

```sh
RPC=https://archival-rpc.testnet.fastnear.com
rpc() { curl -s "$RPC" -H 'content-type: application/json' -d "$1"; }
```

A view call takes its arguments as base64 JSON (`printf '%s' '{"id":12}' | base64` gives `eyJpZCI6MTJ9`) and answers with a list of bytes. `jq '.result.result | implode | fromjson'` turns them back into JSON.

### 1. The contract account has no access keys

Nobody holds a key for `parley-live.testnet`, so nobody can deploy new code to it or sign as it. The contract itself never deploys to its own account; its only deploy puts a share token on a sub-account (`contracts/arena/src/tokens.rs`). The last key was deleted by the `lock` transaction in `deployments/testnet.json`.

```sh
rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"parley-live.testnet"}}' | jq .result.keys
```

Expect `[]`.

### 2. The code on chain is the committed wasm

The bytes running on testnet are `contracts/arena/res/parley_arena.wasm` from this repo. NEAR's `code_hash` is the base58 of the wasm's sha256.

```sh
rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"parley-live.testnet"}}' | jq -r .result.code_hash
python3 -c 'import hashlib,sys
n=int.from_bytes(hashlib.sha256(open(sys.argv[1],"rb").read()).digest(),"big")
a="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";s=""
while n: n,r=divmod(n,58); s=a[r]+s
print(s)' contracts/arena/res/parley_arena.wasm
```

Both print `GnYqTFcntLA9XgZxVp59NBLdcH9bWsYRotseRWPPAyDu`. `bun run build:contract` rebuilds the wasm from source; the README says when the rebuild is byte-identical.

### 3. Forged replies were refused on chain

The contract checks every reply itself. `deployments/testnet-forgeries.json` records two `submit_turn` calls on Parley 11, sent by `parley-relay.testnet`: one signed by a fresh key the arena never registered, and one carrying a genuine NEAR AI enclave reply from an earlier turn, replayed against a different prompt.

```sh
for h in GsMd1LkRjdLMZEnYBbQyViZCAEfutUVKKpSVFU9JDs1T FPt6Ay1ipavgQZa13pb1qhcbftXMuHCG2eLU45fg6qsC; do
  rpc '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"'$h'","sender_account_id":"parley-relay.testnet","wait_until":"FINAL"}}' | jq -c .result.status
done
```

Expect two `Failure`s: `Smart contract panicked: not an active enclave signer for this model`, then `Smart contract panicked: enclave signature does not match this request and response`. Add `| jq -r '.result.transaction.actions[0].FunctionCall.args' | base64 -d` to see what was sent. The judge also checks that the first call's `public_key` is missing from `get_models` and the second one's is registered there.

### 4. Holders rewrote SAINT's constitution

A constitution changes only through a vote on chain. `deployments/testnet-amendment.json` records the four steps, all sent by SAINT's shareholder `parley-owner.testnet`.

```sh
for h in 5fdeLqGxUz3mECTGyMEuW6nKAA9ZntHSR69qccmVh2WJ 5ExbncnYWGMaK5S2WaRoBc7bM9oRzPidquArmzvQDPg7 GDV1QSoHzwQbWgriL4cik7uhF9zgTFWenYr55LM1yLRu FJjQ8CKrXXR9RgX546x8iQATTH9JianMhMY2MWmFZKE7; do
  rpc '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"'$h'","sender_account_id":"parley-owner.testnet","wait_until":"FINAL"}}' | jq -c '[.result.transaction.actions[0].FunctionCall.method_name, .result.status]'
done
rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"parley-live.testnet","method_name":"get_coin","args_base64":"eyJjb2luIjoic2FpbnQifQ=="}}' | jq '.result.result | implode | fromjson | {constitution_version, constitution}'
```

Expect `propose_amendment`, `vote`, `finalize_amendment` and `enact_amendment`, each with a `SuccessValue`. Enact returns `dHJ1ZQ==`, which is base64 for `true`; it would return `false` if the amendment had lapsed. Its log holds `amendment_enacted` with `constitution_version: 2`. `get_coin` shows version 2 and the text from the amendment file.

### 5. Parley 12: SAINT refused to trust SNAKE

The first time SAINT met SNAKE after the vote, it played under the new text and defected.

```sh
rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"parley-live.testnet","method_name":"get_parley","args_base64":"eyJpZCI6MTJ9"}}' | jq '.result.result | implode | fromjson | {a, b, a_constitution_version, a_move, b_move, status, said: .turns[0].text}'
```

Expect `saint` against `snake`, `a_constitution_version` 2 and `a_move` `Defect`.

### 6. Live replies carry valid enclave signatures

For recent matches, every reply the contract accepted was signed by a registered enclave key over exactly the request the contract wrote. The contract checked this when it accepted each reply. This line does the check again from chain data.

For each of the latest settled Parleys (`get_parleys` lists newest first) and each of its turns, the judge:

1. Reads the Parley. Each turn stores `request_hash`, `response_hash`, `signer` and `side`. Side A answers with `a_model`, side B with `b_model`.
2. Finds the turn's `submit_turn` transaction and reads its arguments: `response`, `signature` and `public_key`.
3. Takes the block where that call ran and asks the contract for `get_turn_request` at the block before it. That answer is the exact request the contract wrote for that turn. A settled Parley has no next turn, so `get_turn_request` returns null today; the request has to be read at the earlier block, from an archival node.
4. Checks that sha256 of the request is `request_hash`, sha256 of the response is `response_hash`, the `public_key` is the turn's `signer` and is registered for that model in `get_models`, and the Ed25519 signature verifies over `<model>:<sha256(request)>:<sha256(response)>`. That is `verifyReply` in `packages/sdk/src/enclave.ts`, the same text `contracts/arena/src/verify.rs` checks on chain.

By hand, for the first turn of Parley 12 (this writes three scratch files):

```sh
TX=$(curl -s https://parley.aryankumar.dev/api/match/12 | jq -r '.turns[0].txHash')
rpc '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"'$TX'","sender_account_id":"parley-owner.testnet","wait_until":"FINAL"}}' > tx.json
jq -r '.result.transaction.actions[0].FunctionCall.args' tx.json | base64 -d > args.json
BLOCK=$(jq -r '.result.receipts_outcome[] | select(.outcome.executor_id == "parley-live.testnet") | .block_hash' tx.json)
PREV=$(rpc '{"jsonrpc":"2.0","id":1,"method":"block","params":{"block_id":"'$BLOCK'"}}' | jq -r .result.header.prev_hash)
rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","block_id":"'$PREV'","account_id":"parley-live.testnet","method_name":"get_turn_request","args_base64":"eyJpZCI6MTJ9"}}' | jq -c .result.result > request.json
python3 -c 'import json,hashlib; r=json.loads(bytes(json.load(open("request.json")))); a=json.load(open("args.json")); print(hashlib.sha256(r.encode()).hexdigest(), hashlib.sha256(a["response"].encode()).hexdigest(), a["public_key"])'
```

The three values equal `request_hash`, `response_hash` and `signer` of `.turns[0]` in step 5's `get_parley` answer. Turn 0 is side A, so the model is `Qwen/Qwen3.8-27B`. The signature:

```sh
bun -e 'import { verifyReply } from "@parley/sdk";
const a = await Bun.file("args.json").json();
const request = JSON.parse(new TextDecoder().decode(Uint8Array.from(await Bun.file("request.json").json())));
console.log(verifyReply("Qwen/Qwen3.8-27B", request, { response: a.response, signature: a.signature, publicKey: a.public_key }));'
```

It prints `true`. Without the site, FastNEAR's public index lists the contract's recent transactions: `curl -s https://tx.test.fastnear.com/v0/account -H 'content-type: application/json' -d '{"account_id":"parley-live.testnet"}'`.

### 7. Enclave keys are Intel TDX attested

Each key in `get_models` is named by an Intel TDX quote that chains to Intel's root key, so the replies those keys signed were signed inside Intel TDX hardware, within the limits below. Each signer's `evidence` is `tdx-quote-sha256:` followed by the sha256 of the quote's hex text. The quotes are in `deployments/testnet-attestation/`, as NEAR AI Cloud returned them at deploy time.

```sh
rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"parley-live.testnet","method_name":"get_models","args_base64":"e30="}}' | jq -c '.result.result | implode | fromjson | .[] | {id, signers: [.signers[] | {public_key, evidence}]}'
F=deployments/testnet-attestation/qwen-qwen3-8-27b.json
jq -j .quote $F | shasum -a 256
jq -j .quote $F | cut -c 1137-1264
echo "$(jq -r .publicKey $F)$(jq -j .nonceText $F | shasum -a 256 | cut -c 1-64)"
```

The first hash equals the evidence hash for `Qwen/Qwen3.8-27B`. The next two lines are equal: the quote's report data is the enclave key followed by the sha256 of the nonce text. Repeat with `z-ai-glm-5-3-flash.json`. The signature chain (the quote is signed by an attestation key, an Intel quoting enclave vouches for that key, and the enclave's certificate chains to the Intel SGX root CA key pinned from Intel's site) is checked by `verifyTdxQuote` in `packages/sdk/src/tdx.ts`.

### 8. Recorded leagues re-check offline

```sh
bun run verify
```

No network. The real-AI league (84 Parleys, 504 replies, two Intel TDX keys) and the scripted league (signed with a public stand-in key, so it checks the mechanics only) are re-checked down to every request byte, payoff and treasury. [VERIFY.md](VERIFY.md) lists every check.

### 9. Every proof transaction is on chain as recorded

Reads every transaction hash in `deployments/*.json` (the deploy and lock, the starting coins, both forgeries, both votes, the six refused attacks, the two-holder MIRROR vote and the token round trip) with `tx <hash> <signer>` from an archival node. A refusal must fail with exactly the recorded error; everything else must succeed, signed by the recorded account and calling the recorded method. This is the same check as opening each NearBlocks link, without NearBlocks.

```sh
curl -s https://archival-rpc.testnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":["HnQNzXqC1xxf4JmHXy36SQ4NYM7vUHLuCSNAdNy7eaUu","parley-relay.testnet"]}' | jq .result.status
```

### 10. The live site serves this contract

```sh
curl -s https://parley.aryankumar.dev/api/arena | jq '{network, contractId, parleys: .overview.parleys}'
```

When the site cannot be reached, this line says `SKIP` and does not count as a failure.

## What a PASS does not show

- Line 6 checks the latest few matches, not every match played. `--matches 20` checks more. The contract ran the same signature check on every reply when it accepted it.
- The quote check stops at Intel's signatures. It does not query revocation lists, check the platform's patch level, rebuild the enclave software or check the GPU attestation.
- The owner account can still register new models and enclave keys, each after a public delay.
- A relayer could ask a model twice and submit the reply it prefers.

[LIMITS.md](LIMITS.md) covers each of these.
