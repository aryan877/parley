import { expect, test } from "bun:test";
import type { LedgerEntry } from "@parley/sdk/src/ledger.ts";
import { type FastTx, balanceBooks, entriesOf, openOrders, readTx, summarize } from "../src/ledger.ts";

const ARENA = "arena.test";
const NEAR = 10n ** 24n;
let counter = 0;

const event = (name: string, data: Record<string, unknown>) => `EVENT_JSON:${JSON.stringify({ standard: "parley", version: "1.0.0", event: name, data: [data] })}`;

interface Step {
  from: string;
  to?: string;
  call?: string;
  deposit?: bigint;
  transfer?: bigint;
  logs?: string[];
  failed?: boolean;
}

function fastTx(steps: Step[], { block = 100, dropLast = false } = {}): FastTx {
  const hash = `tx${++counter}`;
  const receipts = steps.map((s, i) => ({
    execution_outcome: {
      block_height: block + i,
      block_timestamp: String((1_800_000_000_000 + block + i) * 1_000_000),
      index: i,
      id: `${hash}-r${i}`,
      outcome: { logs: s.logs ?? [], receipt_ids: i + 1 < steps.length ? [`${hash}-r${i + 1}`] : [], status: s.failed ? { Failure: {} } : { SuccessValue: "" } },
    },
    receipt: {
      receipt_id: `${hash}-r${i}`,
      predecessor_id: s.from,
      receiver_id: s.to ?? ARENA,
      receipt: {
        Action: {
          actions: [
            ...(s.call ? [{ FunctionCall: { method_name: s.call, deposit: String(s.deposit ?? 0n) } }] : []),
            ...(s.transfer ? [{ Transfer: { deposit: String(s.transfer) } }] : []),
          ],
        },
      },
    },
  }));
  return {
    execution_outcome: { block_height: block, block_timestamp: String(block), id: hash, outcome: { logs: [], receipt_ids: [`${hash}-r0`], status: { SuccessReceiptId: `${hash}-r0` } } },
    receipts: dropLast ? receipts.slice(0, -1) : receipts,
  };
}

function ledgerOf(txs: FastTx[]): LedgerEntry[] {
  const orders = openOrders([]);
  let seq = 0;
  return txs.flatMap((t) => entriesOf(readTx(t, ARENA), orders).map((e) => ({ seq: ++seq, ...e })));
}

const story = () => [
  fastTx([{ from: "owner.test", transfer: 50n * NEAR }], { block: 10 }),
  fastTx([{ from: "owner.test", call: "new", deposit: 4n * NEAR }], { block: 20 }),
  fastTx([{ from: "alice.test", call: "create_coin", deposit: 21n * NEAR / 10n, logs: [event("coin_created", { coin: "owl", name: "OWL", house: false, model: "m", treasury: String(2n * NEAR) })] }], { block: 30 }),
  fastTx([{ from: "owner.test", call: "create_house_coin", deposit: 2n * NEAR, logs: [event("coin_created", { coin: "saint", name: "SAINT", house: true, model: "m", treasury: String(2n * NEAR) })] }], { block: 40 }),
  fastTx([{ from: "bob.test", call: "place_mint", deposit: NEAR, logs: [event("order_placed", { coin: "owl", account: "bob.test", kind: "Mint", amount: String(NEAR), epoch: 0 })] }], { block: 50 }),
  fastTx(
    [
      {
        from: "relayer.test",
        call: "submit_turn",
        logs: [
          event("parley_settled", { parley: 0, a: "owl", b: "saint", a_move: "Defect", b_move: "Cooperate", a_delta: `+${NEAR / 25n}`, b_delta: `-${NEAR / 25n}`, commons_delta: "+0" }),
        ],
      },
    ],
    { block: 60 },
  ),
  fastTx([{ from: "anyone.test", call: "fill_order", logs: [event("order_filled", { coin: "owl", account: "bob.test", kind: "mint", near: String(NEAR), shares: String((NEAR * 2n) / 3n) })] }], { block: 70 }),
  fastTx([{ from: "alice.test", call: "place_redeem", logs: [event("order_placed", { coin: "owl", account: "alice.test", kind: "Redeem", amount: String(NEAR), epoch: 1 })] }], { block: 80 }),
  fastTx([{ from: "alice.test", call: "cancel_order", logs: [event("order_cancelled", { coin: "owl", account: "alice.test" })] }, { from: ARENA, to: "alice.test", transfer: 0n }], { block: 90 }),
  fastTx([{ from: "carol.test", call: "place_mint", deposit: NEAR / 2n, logs: [event("order_placed", { coin: "owl", account: "carol.test", kind: "Mint", amount: String(NEAR / 2n), epoch: 1 })] }], { block: 100 }),
  fastTx([{ from: "anyone.test", call: "fill_order", logs: [event("order_returned", { coin: "owl", account: "carol.test" })] }, { from: ARENA, to: "carol.test", transfer: NEAR / 2n }], { block: 110 }),
  fastTx([{ from: "alice.test", call: "place_redeem", logs: [event("order_placed", { coin: "owl", account: "alice.test", kind: "Redeem", amount: String(NEAR / 2n), epoch: 1 })] }], { block: 120 }),
  fastTx([{ from: "anyone.test", call: "fill_order", logs: [event("order_filled", { coin: "owl", account: "alice.test", kind: "redeem", near: String((NEAR * 6n) / 10n), shares: String(NEAR / 2n) })] }], { block: 130 }),
  fastTx([{ from: "alice.test", call: "transfer_shares", logs: [event("shares_transferred", { coin: "owl", from: "alice.test", to: "dave.test", shares: String(NEAR / 10n) })] }], { block: 140 }),
  fastTx(
    [
      { from: "dave.test", call: "create_token", deposit: 3n * NEAR },
      { from: ARENA, call: "on_token_created", logs: [event("token_created", { coin: "owl", token: "owl.arena.test" })] },
    ],
    { block: 150 },
  ),
  fastTx([{ from: "mallory.test", call: "place_mint", deposit: NEAR, logs: [event("order_placed", { coin: "owl", account: "mallory.test", kind: "Mint", amount: String(NEAR), epoch: 1 })], failed: true }], { block: 160 }),
];

test("each event becomes an entry that says where the NEAR went", () => {
  const entries = ledgerOf(story());
  expect(entries.map((e) => e.kind)).toEqual(["received", "seeded", "launched", "launched", "buy", "match", "bought", "sell", "cancelled", "buy", "returned", "sell", "sold", "shares", "token"]);
  const launch = entries.find((e) => e.kind === "launched" && e.coins[0] === "owl")!;
  expect([launch.near, launch.fee, launch.pot, launch.shares, launch.wallets, launch.account]).toEqual([String(2n * NEAR), String(NEAR / 10n), String(NEAR / 10n), String(2n * NEAR), String(21n * NEAR / 10n), "alice.test"]);
  const house = entries.find((e) => e.kind === "launched" && e.coins[0] === "saint")!;
  expect([house.fee, house.shares, house.pot]).toEqual([undefined, "0", "0"]);
  const cancelled = entries.find((e) => e.kind === "cancelled")!;
  expect([cancelled.side, cancelled.shares, cancelled.near]).toEqual(["sell", String(NEAR), "0"]);
  const returned = entries.find((e) => e.kind === "returned")!;
  expect([returned.side, returned.near, returned.escrow, returned.wallets]).toEqual(["buy", String(NEAR / 2n), String(-NEAR / 2n), String(-NEAR / 2n)]);
  const token = entries.find((e) => e.kind === "token")!;
  expect([token.account, token.to, token.near, token.wallets]).toEqual(["dave.test", "owl.arena.test", String(3n * NEAR), "0"]);
  const match = entries.find((e) => e.kind === "match")!;
  expect([match.near, match.moves, match.parley, match.treasury]).toEqual([String(NEAR / 25n), ["Defect", "Cooperate"], 0, { owl: String(NEAR / 25n), saint: String(-NEAR / 25n) }]);
});

test("a failed receipt adds nothing and an incomplete transaction is flagged", () => {
  const failed = readTx(fastTx([{ from: "x.test", call: "place_mint", deposit: NEAR, logs: [event("order_placed", { coin: "owl", account: "x.test", kind: "Mint", amount: String(NEAR) })], failed: true }]), ARENA);
  expect(entriesOf(failed, openOrders([]))).toEqual([]);
  expect(readTx(fastTx([{ from: "a.test", call: "fill_order" }, { from: ARENA, to: "a.test", transfer: NEAR }], { dropLast: true }), ARENA).complete).toBe(false);
  expect(readTx(fastTx([{ from: "a.test", call: "fill_order" }, { from: ARENA, to: "a.test", transfer: NEAR }]), ARENA).complete).toBe(true);
});

test("totals add up every flow, per coin and overall", () => {
  const { totals, coins, pot, escrow } = summarize(ledgerOf(story()));
  expect(totals.launched).toBe(String(4n * NEAR));
  expect(totals.bought).toBe(String(NEAR));
  expect(totals.intoTreasuries).toBe(String(5n * NEAR));
  expect(totals.soldOut).toBe(String((NEAR * 6n) / 10n));
  expect(totals.potIn).toEqual({ seed: String(4n * NEAR), fees: String(NEAR / 10n), matches: "0" });
  expect(totals.taken).toBe(String(NEAR / 25n));
  expect([totals.escrowIn, totals.escrowFilled, totals.escrowRefunded]).toEqual([String((NEAR * 3n) / 2n), String(NEAR), String(NEAR / 2n)]);
  expect(totals.received).toBe(String(50n * NEAR));
  expect(totals.tokens).toBe(String(3n * NEAR));
  expect([pot, escrow]).toEqual([4n * NEAR + NEAR / 10n, 0n]);
  const owl = coins.find((c) => c.id === "owl")!;
  expect(owl.treasury).toBe(String(2n * NEAR + NEAR / 25n + NEAR - (NEAR * 6n) / 10n));
  expect(owl.shares).toBe(String(2n * NEAR + (NEAR * 2n) / 3n - NEAR / 2n));
  expect([owl.won, owl.lost, owl.matches]).toEqual([String(NEAR / 25n), "0", 1]);
});

test("open orders rebuilt from entries match the ones tracked while reading", () => {
  const txs = story().slice(0, 10);
  const tracked = openOrders([]);
  const entries = txs.flatMap((t, i) => entriesOf(readTx(t, ARENA), tracked).map((e) => ({ seq: i, ...e })));
  expect(openOrders(entries)).toEqual(tracked);
  expect([...tracked.keys()]).toEqual(["owl\ncarol.test"]);
});

test("the books balance when the contract holds what it owes plus storage, and the replay lands on its numbers", () => {
  const entries = ledgerOf(story());
  const flows = summarize(entries);
  const owl = flows.coins.find((c) => c.id === "owl")!;
  const coins = [
    { id: "owl", name: "OWL", treasury: owl.treasury, total_shares: owl.shares },
    { id: "saint", name: "SAINT", treasury: String(2n * NEAR - NEAR / 25n), total_shares: "0" },
  ];
  const owed = BigInt(owl.treasury) + BigInt(coins[1]!.treasury) + flows.pot;
  const account = { amount: String(owed + 20n * NEAR + 7n * NEAR), locked: "0", storage_usage: 2_000_000 };
  const books = balanceBooks({ block: 1_000, at: 0 }, account, { commons: String(flows.pot), escrow: "0" }, coins, entries);
  expect(books.storage).toBe(String(20n * NEAR));
  expect(books.owed).toBe(String(owed));
  expect(books.spare).toBe(String(7n * NEAR));
  expect(books.balanced).toBe(true);
  expect(books.replay).toEqual({ matches: true, entries: entries.length, differences: [] });

  const short = balanceBooks({ block: 1_000, at: 0 }, { ...account, amount: String(owed) }, { commons: String(flows.pot), escrow: "0" }, coins, entries);
  expect(short.balanced).toBe(false);
  expect(short.spare).toBe(String(-20n * NEAR));

  const early = balanceBooks({ block: 65, at: 0 }, account, { commons: String(flows.pot), escrow: String(NEAR) }, coins, entries);
  expect(early.replay.matches).toBe(false);
  expect(early.replay.differences.map((d) => d.what)).toContain("OWL treasury");
});
