import { expect, test } from "bun:test";
import { Arena, TOKEN_DEPOSIT, type WalletCall, near } from "../src/index.ts";

const ARENA = "parley-live.testnet";

function signed(value: unknown) {
  const sent: WalletCall[] = [];
  const arena = new Arena({
    rpcUrl: "http://127.0.0.1:9",
    contractId: ARENA,
    wallet: {
      accountId: "alice.testnet",
      send: async (call) => {
        sent.push(call);
        return { status: { SuccessValue: value === undefined ? "" : btoa(JSON.stringify(value)) }, transaction: { hash: "tx" } };
      },
    },
  });
  return { arena, sent };
}

test("a coin's token lives under the arena account", () => {
  expect(signed(null).arena.tokenAccount("saint")).toBe("saint.parley-live.testnet");
});

test("creating a token pays 3 NEAR to the arena and returns the token account", async () => {
  const { arena, sent } = signed("saint.parley-live.testnet");
  const result = await arena.createToken("saint");
  expect(result).toEqual({ ok: true, hash: "tx", value: "saint.parley-live.testnet" });
  expect(sent[0]).toMatchObject({ receiverId: ARENA, methodName: "create_token", args: { coin: "saint" }, deposit: TOKEN_DEPOSIT });
  expect(TOKEN_DEPOSIT).toBe(near(3));
});

test("a token the arena could not deploy counts as a failure", async () => {
  const result = await signed(null).arena.createToken("saint");
  expect(result.ok).toBe(false);
  expect(result.hash).toBe("tx");
  expect(result.error).toContain("not created");
});

test("wrapping sends shares to the coin's token through the arena", async () => {
  const shares = near("1.5");
  const { arena, sent } = signed(shares.toString());
  expect((await arena.wrapShares("saint", shares)).ok).toBe(true);
  expect(sent[0]).toMatchObject({
    receiverId: ARENA,
    methodName: "transfer_shares_call",
    args: { coin: "saint", to: "saint.parley-live.testnet", shares: "1500000000000000000000000", msg: "" },
    deposit: 0n,
  });
});

test("shares the token sent back count as a failed wrap", async () => {
  const result = await signed("0").arena.wrapShares("saint", near(1));
  expect(result.ok).toBe(false);
  expect(result.error).toContain("went back");
});

test("unwrapping calls the token, not the arena, and needs the arena to release the shares", async () => {
  const token = "saint.parley-live.testnet";
  const done = signed(true);
  expect((await done.arena.unwrap(token, near(2))).ok).toBe(true);
  expect(done.sent[0]).toMatchObject({ receiverId: token, methodName: "unwrap", args: { amount: near(2).toString() }, deposit: 0n });
  const restored = await signed(false).arena.unwrap(token, near(2));
  expect(restored.ok).toBe(false);
  expect(restored.error).toContain("restored");
});

test("token transfers attach one yoctoNEAR and registrations pay storage on the token", async () => {
  const token = "saint.parley-live.testnet";
  const { arena, sent } = signed(undefined);
  await arena.sendTokens(token, "bob.testnet", near(1));
  await arena.registerForToken(token, "bob.testnet");
  expect(sent[0]).toMatchObject({ receiverId: token, methodName: "ft_transfer", args: { receiver_id: "bob.testnet", amount: near(1).toString() }, deposit: 1n });
  expect(sent[1]).toMatchObject({ receiverId: token, methodName: "storage_deposit", args: { account_id: "bob.testnet", registration_only: true } });
  expect(sent[1]!.deposit > 0n).toBe(true);
});

test("token reads go to the token contract", async () => {
  const { arena } = signed(undefined);
  const asked: { contractId: string; method: string; args: unknown }[] = [];
  Object.assign(arena.provider, {
    callFunction: async (q: { contractId: string; method: string; args: unknown }) => {
      asked.push(q);
      return q.method === "ft_metadata" ? { spec: "ft-1.0.0", name: "Parley SAINT", symbol: "SAINT", icon: null, decimals: 24 } : "7";
    },
  });
  const token = arena.tokenAccount("saint");
  expect(await arena.tokenBalance(token, "alice.testnet")).toBe("7");
  expect(await arena.tokenSupply(token)).toBe("7");
  expect((await arena.tokenMetadata(token)).symbol).toBe("SAINT");
  expect(asked.map((q) => [q.contractId, q.method])).toEqual([
    [token, "ft_balance_of"],
    [token, "ft_total_supply"],
    [token, "ft_metadata"],
  ]);
  expect(asked[0]!.args).toEqual({ account_id: "alice.testnet" });
});
