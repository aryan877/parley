# Coin tokens

Every Parley coin has shares. Shares live inside the arena contract, `parley-live.testnet`. That is where they vote on the coin's rules, and where they are bought and sold at the price after the coin's next match. To the rest of NEAR, though, a share is only a row in the arena's table. A wallet cannot show it and another app cannot take it.

A coin's token closes that gap. It is a standard NEP-141 fungible token with its own contract at `<coin>.parley-live.testnet`. Every token is backed by one share, which the token contract holds in the arena.

| | A share | A token |
| --- | --- | --- |
| Lives in | the arena contract | the coin's token contract |
| Votes on the coin's rules | yes | no |
| Sells back for NEAR | yes, after the next match | no, unwrap it first |
| Moves to any account or app | only inside the arena | yes, with `ft_transfer` or `ft_transfer_call` |
| Shows in a NEAR wallet | no | yes, with 24 decimals like the shares |

## Create, wrap, send, unwrap

| Step | Call | What happens |
| --- | --- | --- |
| Create | `create_token({ coin })` on the arena, with 3 NEAR | The arena creates `<coin>.parley-live.testnet` and deploys the token code it carries, so nobody can swap in other code. Anyone may pay, once per coin. The 3 NEAR stays on the token account and pays for its storage. House coins cannot have one. |
| Wrap | `transfer_shares_call({ coin, to: "<coin>.parley-live.testnet", shares, msg: "" })` on the arena | The arena moves your shares to the token contract and tells it. The token mints the same amount to you and registers you for free. |
| Send | `ft_transfer({ receiver_id, amount })` on the token, with 1 yoctoNEAR | Standard NEP-141. The receiver must be registered first with `storage_deposit`, which anyone can pay for. |
| Unwrap | `unwrap({ amount })` on the token | The token burns your tokens and the arena hands the shares back to you. If the arena refuses, the token gives the tokens back. |

Shares held in an open vote or a sell order cannot be wrapped. Wrapped shares do not vote, yet the 20% quorum still counts them, as [LIMITS.md](LIMITS.md) says.

## On the site

A coin page has a token panel under the rules and the buy panel. It shows the token account with an explorer link, how much is wrapped in all, and how much you hold. Holders get Wrap and Unwrap, each with an amount and a max button.

When a coin has no token yet, the panel explains the 3 NEAR cost and shows a Create button only to a wallet holding at least 3.1 NEAR (3 for the token, the rest for gas). Play wallets get 1.5 test NEAR, so the panel asks them to connect their own NEAR wallet rather than offer a transaction that would fail.

## Live tokens

| Coin | Token | Created in |
| --- | --- | --- |
| SAINT | [`saint.parley-live.testnet`](https://testnet.nearblocks.io/address/saint.parley-live.testnet) | [4srExv2u…](https://testnet.nearblocks.io/txns/4srExv2uCEkoXz6ihXZQwdtn3QzBLDdk8rbhZKkGbejP) |
| MIRROR | [`mirror.parley-live.testnet`](https://testnet.nearblocks.io/address/mirror.parley-live.testnet) | [CZ62ZnTs…](https://testnet.nearblocks.io/txns/CZ62ZnTsVYPAx77G5zBH7nDTfhQYzFt52wvCGXncKM4q) |
| DIPLOMAT | [`diplomat.parley-live.testnet`](https://testnet.nearblocks.io/address/diplomat.parley-live.testnet) | [57jSDN8Y…](https://testnet.nearblocks.io/txns/57jSDN8Ysy7m1RGeSrcUiqzuVanhkUVuCYJzwAqGZYh8) |

These are the coins with the longest record on the live arena. When the tokens were made, SAINT and MIRROR had played 110 matches each and DIPLOMAT 108, and SAINT's holders had already rewritten its rules once. All three token accounts run code hash `3gty4LrDKFkn839upBvMYnxo8yCXZ4LH2BxeV8o5W7t5`, the sha256 of the committed `contracts/token/res/parley_token.wasm`.

## One full round trip

The arena owner, `parley-owner.testnet`, held 2 MIRROR shares. It wrapped one, sent a quarter of a token to another account, and unwrapped half.

| Step | Transaction |
| --- | --- |
| Wrap 1 MIRROR share into 1 MIRROR | [9gUe5UXj…](https://testnet.nearblocks.io/txns/9gUe5UXjtyGPqRvAmBac51mAtEndHiMV5EzJhfu76kwf) |
| Register `parley-relay.testnet` on the MIRROR token | [7wXLCuCJ…](https://testnet.nearblocks.io/txns/7wXLCuCJxh1DxSX6zxqwkF32zUurze8Ycpo2PdMMx8kX) |
| Send 0.25 MIRROR to `parley-relay.testnet` | [DkrrcxV2…](https://testnet.nearblocks.io/txns/DkrrcxV2YXTgBd9hEwK972MGZMX3BF9pCrmWpRPvcdXM) |
| Unwrap 0.5 MIRROR back into shares | [9CcKAGBh…](https://testnet.nearblocks.io/txns/9CcKAGBhQ96GRZxcZwF8Qi6LaGryPP7THkDJBcALzqZe) |

Afterwards the owner holds 1.5 MIRROR shares in the arena and 0.25 MIRROR tokens, and `parley-relay.testnet` holds 0.25 MIRROR. The token contract holds exactly 0.5 MIRROR shares in the arena (`get_shares` for `mirror.parley-live.testnet`), which matches the token's `ft_total_supply` of 0.5.

`scripts/tokens-testnet.ts` sent these seven transactions and recorded them in [deployments/testnet-tokens.json](../deployments/testnet-tokens.json). It skips every step that file already lists, so running it again sends nothing:

```sh
PARLEY_OWNER_KEY_FILE=<owner key file> bun scripts/tokens-testnet.ts
```
