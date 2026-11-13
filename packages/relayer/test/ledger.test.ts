import { expect, test } from "bun:test";
import { rulesHistory } from "@parley/sdk/src/chronicle.ts";
import type { LedgerEntry } from "@parley/sdk/src/ledger.ts";
import type { Coin } from "@parley/sdk/src/types.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FastTx, Ledger, balanceBooks, entriesOf, exactTimestamps, governanceFacts, governanceOf, openOrders, readTx, summarize } from "../src/ledger.ts";

const ARENA = "arena.test";
const NEAR = 10n ** 24n;
let counter = 0;

const event = (name: string, data: Record<string, unknown>) => `EVENT_JSON:${JSON.stringify({ standard: "parley", version: "1.0.0", event: name, data: [data] })}`;
const nanos = (block: number) => `${1_800_000_000_000 + block}123457`;
const base64 = (args: Record<string, unknown>) => Buffer.from(JSON.stringify(args)).toString("base64");

interface Step {
  from: string;
  to?: string;
  call?: string;
  args?: Record<string, unknown>;
  also?: [string, Record<string, unknown>][];
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
      block_timestamp: nanos(block + i),
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
            ...(s.call ? [{ FunctionCall: { method_name: s.call, args: base64(s.args ?? {}), deposit: String(s.deposit ?? 0n) } }] : []),
            ...(s.also ?? []).map(([method, args]) => ({ FunctionCall: { method_name: method, args: base64(args), deposit: "0" } })),
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

const launch = (from: string, id: string, constitution: string, block: number) =>
  fastTx(
    [{ from, call: "create_coin", args: { id, name: id.toUpperCase(), constitution, model: "m1" }, deposit: 2n * NEAR, logs: [event("coin_created", { coin: id, name: id.toUpperCase(), house: false, model: "m1", treasury: String(2n * NEAR) })] }],
    { block },
  );
const proposed = (coin: string, id: number, proposer: string, model = "m2") => event("amendment_proposed", { coin, id, proposer, model, ends_at: "1" });
const voted = (coin: string, id: number, voter: string, support: boolean) => event("vote_cast", { coin, id, voter, support, shares: "1" });

const governanceStory = () => [
  launch("alice.test", "owl", "Always cooperate.", 200),
  launch("bob.test", "fox", "Always defect.", 205),
  fastTx([{ from: "alice.test", call: "propose_amendment", args: { coin: "owl", constitution: "Defect against FOX.", model: "m2" }, logs: [proposed("owl", 1, "alice.test"), voted("owl", 1, "alice.test", true)] }], { block: 210 }),
  fastTx([{ from: "carol.test", call: "vote", args: { id: 1, support: false, shares: "1" }, logs: [voted("owl", 1, "carol.test", false)] }], { block: 215 }),
  fastTx([{ from: "mallory.test", call: "propose_amendment", args: { coin: "owl", constitution: "Pay mallory.", model: "m2" }, logs: [proposed("owl", 2, "mallory.test")], failed: true }], { block: 217 }),
  fastTx([{ from: "anyone.test", call: "finalize_amendment", args: { id: 1 }, logs: [event("amendment_finalized", { coin: "owl", id: 1, passed: true, yes: "9", no: "1" })] }], { block: 220 }),
  fastTx([{ from: "anyone.test", call: "enact_amendment", args: { id: 1 }, logs: [event("amendment_enacted", { coin: "owl", id: 1, constitution_version: 2 })] }], { block: 230 }),
  fastTx(
    [
      {
        from: "bob.test",
        call: "propose_amendment",
        args: { coin: "owl", constitution: "Trust FOX.", model: "m1" },
        also: [["propose_amendment", { coin: "fox", constitution: "Trust OWL.", model: "m1" }]],
        logs: [proposed("owl", 3, "bob.test", "m1"), proposed("fox", 4, "bob.test", "m1")],
      },
    ],
    { block: 240 },
  ),
  fastTx([{ from: "anyone.test", call: "finalize_amendment", args: { id: 3 }, logs: [event("amendment_finalized", { coin: "owl", id: 3, passed: true, yes: "5", no: "0" })] }], { block: 245 }),
  fastTx([{ from: "anyone.test", call: "enact_amendment", args: { id: 3 }, logs: [event("amendment_lapsed", { coin: "owl", id: 3 })] }], { block: 250 }),
  fastTx([{ from: "bob.test", call: "place_mint", deposit: NEAR, logs: [event("order_placed", { coin: "owl", account: "bob.test", kind: "Mint", amount: String(NEAR), epoch: 0 })] }], { block: 255 }),
];

const coinNow = (id: string, extra: Partial<Coin>): Coin => ({
  id,
  name: id.toUpperCase(),
  creator: "alice.test",
  house: false,
  constitution: "Always cooperate.",
  constitution_version: 1,
  model: "m1",
  treasury: String(2n * NEAR),
  total_shares: String(2n * NEAR),
  in_match: null,
  matches_played: 0,
  stats: { matches: 0, cooperated: 0, defected: 0, was_betrayed: 0, betrayed_other: 0 },
  created_at: nanos(200),
  token: null,
  idle_since: nanos(200),
  amendments: [],
  ...extra,
});

function expectOwlFacts(facts: ReturnType<typeof governanceFacts>, txs: FastTx[]) {
  const hash = (i: number) => txs[i]!.execution_outcome.id;
  expect(facts.created).toEqual({ constitution: "Always cooperate.", model: "m1", by: "alice.test", at: nanos(200), tx: hash(0) });
  expect(facts.proposals).toEqual({
    1: { coin: "owl", constitution: "Defect against FOX.", model: "m2", proposer: "alice.test", tx: hash(2) },
    3: { coin: "owl", constitution: "Trust FOX.", model: "m1", proposer: "bob.test", tx: hash(7) },
  });
  expect(facts.tallies).toEqual({ 1: { yes: "9", no: "1" }, 3: { yes: "5", no: "0" } });
  expect(facts.enactments).toEqual([{ coin: "owl", id: 1, version: 2, at: nanos(230), tx: hash(6) }]);
}

test("governance keeps the calls that carry constitutions and the events that decide them", () => {
  const txs = governanceStory();
  const records = txs.flatMap((t) => governanceOf(readTx(t, ARENA)));
  expect(records.map((r) => r.tx)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9].map((i) => txs[i]!.execution_outcome.id));
  expect(records[0]).toMatchObject({ block: 200, at: nanos(200), by: "alice.test", calls: [{ method: "create_coin", args: { id: "owl", constitution: "Always cooperate.", model: "m1" } }] });
  expect(records[3]!.calls).toEqual([{ method: "vote" }]);
  expect(records[3]!.events).toEqual([{ event: "vote_cast", data: { coin: "owl", id: 1, voter: "carol.test", support: false, shares: "1" } }]);
  expect(records.at(-1)!.events.map((e) => e.event)).toEqual(["amendment_lapsed"]);

  expectOwlFacts(governanceFacts(records, "owl"), txs);
  const fox = governanceFacts(records, "fox");
  expect([fox.created?.by, fox.created?.constitution, fox.proposals[4]?.constitution, fox.enactments]).toEqual(["bob.test", "Always defect.", "Trust OWL.", []]);
  expect(governanceFacts(records, "nobody")).toEqual({ created: null, proposals: {}, tallies: {}, enactments: [] });
});

test("rules history from the ledger names the launch and each enacted version", () => {
  const txs = governanceStory();
  const records = txs.flatMap((t) => governanceOf(readTx(t, ARENA)));
  const owl = rulesHistory(coinNow("owl", { constitution: "Defect against FOX.", constitution_version: 2, model: "m2" }), governanceFacts(records, "owl"));
  expect(owl.complete).toBe(true);
  expect(owl.versions.map((v) => [v.version, v.constitution, v.by, v.at, v.yes, v.no, v.tx, v.amendment])).toEqual([
    [1, "Always cooperate.", "alice.test", nanos(200), null, null, txs[0]!.execution_outcome.id, null],
    [2, "Defect against FOX.", "alice.test", nanos(230), "9", "1", txs[6]!.execution_outcome.id, 1],
  ]);
  const fox = rulesHistory(coinNow("fox", { creator: "bob.test", constitution: "Always defect.", created_at: nanos(205) }), governanceFacts(records, "fox"));
  expect(fox.versions).toEqual([{ version: 1, constitution: "Always defect.", model: "m1", at: nanos(205), by: "bob.test", yes: null, no: null, tx: txs[1]!.execution_outcome.id, amendment: null }]);
});

test("nanosecond timestamps keep every digit", () => {
  const raw = '{"block_timestamp":1794453229022794331,"block_height":277305087}';
  expect(JSON.parse(raw, exactTimestamps)).toEqual({ block_timestamp: "1794453229022794331", block_height: 277305087 });
  expect(String((JSON.parse(raw) as { block_timestamp: number }).block_timestamp)).not.toBe("1794453229022794331");
});

test("the ledger keeps governance on disk, and one from before governance reads every transaction again without repeating entries", async () => {
  const txs = governanceStory();
  const height = (t: FastTx) => t.execution_outcome.block_height;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = (req.method === "POST" ? await req.json() : {}) as { from_tx_block_height?: number; tx_hashes?: string[]; method?: string; params?: { block_id?: number } };
      const out =
        path === "/status"
          ? { latest_block_height: 1_000 }
          : path === "/v0/account"
            ? { account_txs: txs.filter((t) => height(t) >= body.from_tx_block_height!).map((t) => ({ transaction_hash: t.execution_outcome.id, tx_block_height: height(t) })), resume_token: null }
            : path === "/v0/transactions"
              ? { transactions: txs.filter((t) => body.tx_hashes!.includes(t.execution_outcome.id)) }
              : body.method === "block"
                ? { result: { header: { height: body.params!.block_id, timestamp_nanosec: nanos(980) } } }
                : { error: { message: "not served here" } };
      return new Response(JSON.stringify(out).replace(/"block_timestamp":"(\d+)"/g, '"block_timestamp":$1'), { headers: { "content-type": "application/json" } });
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "parley-ledger-"));
  const open = () => new Ledger({ dir, network: "testnet", contractId: ARENA, rpcUrl: `http://localhost:${server.port}/rpc`, txApi: `http://localhost:${server.port}` });
  try {
    const first = open();
    expect(await first.pass()).toBe(true);
    expect(first.status()).toMatchObject({ txs: txs.length, entries: 3, block: 980 });
    expectOwlFacts(first.governance("owl"), txs);

    expectOwlFacts(open().governance("owl"), txs);

    const cursorFile = join(dir, `ledger-${ARENA}.json`);
    const { format: _, ...before } = JSON.parse(readFileSync(cursorFile, "utf8")) as Record<string, unknown>;
    writeFileSync(cursorFile, JSON.stringify(before));
    rmSync(join(dir, `ledger-${ARENA}-governance.jsonl`));
    const upgraded = open();
    expect(upgraded.governance("owl").created).toBeNull();
    expect(await upgraded.pass()).toBe(true);
    expect(upgraded.status()).toMatchObject({ txs: txs.length, entries: 3 });
    expect(upgraded.entries).toEqual(first.entries);
    expectOwlFacts(upgraded.governance("owl"), txs);
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
