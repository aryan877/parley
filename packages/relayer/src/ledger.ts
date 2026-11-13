import type { Books, CoinMoney, GovernanceFacts, LedgerEntry, LedgerKind, LedgerPage, LedgerStatus, LedgerSummary, LedgerTotals } from "@parley/sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TX_API: Record<string, string> = { testnet: "https://tx.test.fastnear.com", mainnet: "https://tx.main.fastnear.com" };
const FORMAT = 2;
const PAGE = 200;
const BATCH = 20;
const SETTLE_BLOCKS = 20;
const STALE_BLOCKS = 3_600;
const PACE_MS = 250;
const POLL_MS = 60_000;
const RETRY_MS = 20_000;
const STORAGE_PER_BYTE = 10n ** 19n;
const RULE_CALLS = new Set(["create_coin", "create_house_coin", "propose_amendment"]);
const GOVERNANCE_EVENTS = new Set(["coin_created", "amendment_proposed", "vote_cast", "amendment_finalized", "amendment_enacted", "amendment_lapsed"]);

type Entry = Omit<LedgerEntry, "seq">;

interface Outcome {
  block_height: number;
  block_timestamp: number | string;
  index?: number;
  id: string;
  outcome: { logs: string[]; receipt_ids: string[]; status: Record<string, unknown> };
}

type Action = string | { FunctionCall?: { method_name: string; args?: string; deposit?: string }; Transfer?: { deposit?: string } };

/** JSON reviver that keeps FastNEAR's nanosecond `block_timestamp` numbers as exact strings. */
export const exactTimestamps = (key: string, value: unknown, context?: { source?: string }) =>
  key === "block_timestamp" && typeof value === "number" ? (context?.source ?? String(value)) : value;

export interface FastTx {
  execution_outcome: Outcome;
  receipts: {
    execution_outcome: Outcome;
    receipt: { receipt_id: string; predecessor_id: string; receiver_id: string; receipt: { Action?: { actions: Action[] } } };
  }[];
}

interface AccountRow {
  transaction_hash: string;
  tx_block_height: number;
}

export interface Call {
  method: string;
  /** Kept only for the calls that set a constitution. */
  args?: Record<string, unknown>;
}

export interface Receipt {
  block: number;
  at: number;
  /** Nanoseconds, as the chain reports them. */
  timestamp: string;
  order: number;
  predecessor: string;
  ok: boolean;
  logs: string[];
  deposit: bigint;
  transfer: bigint;
  calls: Call[];
}

export interface ChainTx {
  hash: string;
  receipts: Receipt[];
  complete: boolean;
}

function decodeArgs(base64: string | undefined): Record<string, unknown> | undefined {
  try {
    const args = JSON.parse(Buffer.from(base64 ?? "", "base64").toString("utf8")) as unknown;
    return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function readTx(raw: FastTx, contractId: string): ChainTx {
  const ids = new Set(raw.receipts.map((r) => r.receipt.receipt_id));
  const spawned = [raw.execution_outcome, ...raw.receipts.map((r) => r.execution_outcome)].flatMap((o) => o.outcome.receipt_ids);
  const receipts = raw.receipts
    .filter((r) => r.receipt.receiver_id === contractId)
    .map((r): Receipt => {
      let deposit = 0n;
      let transfer = 0n;
      const calls: Call[] = [];
      for (const action of r.receipt.receipt.Action?.actions ?? []) {
        if (typeof action === "string") continue;
        if (action.FunctionCall) {
          const method = action.FunctionCall.method_name;
          deposit += BigInt(action.FunctionCall.deposit ?? 0);
          calls.push(RULE_CALLS.has(method) ? { method, args: decodeArgs(action.FunctionCall.args) } : { method });
        }
        if (action.Transfer) transfer += BigInt(action.Transfer.deposit ?? 0);
      }
      const o = r.execution_outcome;
      const status = o.outcome.status;
      return {
        block: o.block_height,
        at: Math.floor(Number(o.block_timestamp) / 1e6),
        timestamp: String(o.block_timestamp),
        order: o.index ?? 0,
        predecessor: r.receipt.predecessor_id,
        ok: "SuccessValue" in status || "SuccessReceiptId" in status,
        logs: o.outcome.logs,
        deposit,
        transfer,
        calls,
      };
    })
    .sort((x, y) => x.block - y.block || x.order - y.order);
  return { hash: raw.execution_outcome.id, receipts, complete: spawned.every((id) => ids.has(id)) };
}

type EventData = Record<string, string | number | boolean | null | undefined>;

function events(logs: string[]): { event: string; data: EventData }[] {
  return logs.flatMap((log) => {
    if (!log.startsWith("EVENT_JSON:")) return [];
    try {
      const body = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard?: string; event?: string; data?: unknown };
      if (body.standard !== "parley" || !body.event || !Array.isArray(body.data)) return [];
      return (body.data as EventData[]).map((data) => ({ event: body.event!, data }));
    } catch {
      return [];
    }
  });
}

interface Fields {
  coins?: string[];
  account?: string | null;
  to?: string;
  near?: bigint;
  shares?: bigint;
  side?: "buy" | "sell";
  parley?: number;
  moves?: [string, string];
  fee?: bigint;
  treasury?: Record<string, bigint>;
  pot?: bigint;
  escrow?: bigint;
  wallets?: bigint;
}

function make(tx: string, r: Receipt, kind: LedgerKind, f: Fields): Entry {
  const entry: Entry = {
    at: r.at,
    block: r.block,
    tx,
    kind,
    coins: f.coins ?? [],
    account: f.account ?? null,
    near: String(f.near ?? 0n),
    shares: String(f.shares ?? 0n),
    treasury: Object.fromEntries(Object.entries(f.treasury ?? {}).map(([coin, delta]) => [coin, String(delta)])),
    pot: String(f.pot ?? 0n),
    escrow: String(f.escrow ?? 0n),
    wallets: String(f.wallets ?? 0n),
  };
  if (f.to) entry.to = f.to;
  if (f.side) entry.side = f.side;
  if (f.parley !== undefined) entry.parley = f.parley;
  if (f.moves) entry.moves = f.moves;
  if (f.fee) entry.fee = String(f.fee);
  return entry;
}

const abs = (n: bigint) => (n < 0n ? -n : n);
const orderKey = (coin: string, account: string) => `${coin}\n${account}`;

type OpenOrders = Map<string, { kind: "Mint" | "Redeem"; amount: bigint }>;

export function entriesOf(tx: ChainTx, orders: OpenOrders): Entry[] {
  const out: Entry[] = [];
  let tokenPayment: { payer: string; deposit: bigint } | null = null;
  for (const r of tx.receipts) {
    if (!r.ok) continue;
    if (r.transfer > 0n) out.push(make(tx.hash, r, "received", { account: r.predecessor, near: r.transfer, wallets: r.transfer }));
    if (r.calls.some((c) => c.method === "new") && r.deposit > 0n) out.push(make(tx.hash, r, "seeded", { account: r.predecessor, near: r.deposit, pot: r.deposit, wallets: r.deposit }));
    if (r.calls.some((c) => c.method === "create_token")) tokenPayment = { payer: r.predecessor, deposit: r.deposit };
    for (const { event, data } of events(r.logs)) {
      const text = (key: string) => String(data[key] ?? "");
      const amount = (key: string) => BigInt(String(data[key] ?? 0));
      const coin = text("coin");
      const account = text("account");
      if (event === "coin_created") {
        const treasury = amount("treasury");
        const fee = data.house !== true && r.deposit > treasury ? r.deposit - treasury : 0n;
        const shares = data.house === true ? 0n : treasury;
        out.push(make(tx.hash, r, "launched", { coins: [coin], account: r.predecessor, near: treasury, shares, fee, treasury: { [coin]: treasury }, pot: fee, wallets: treasury + fee }));
      } else if (event === "order_placed") {
        const placed = amount("amount");
        const kind = data.kind === "Mint" ? "Mint" : "Redeem";
        orders.set(orderKey(coin, account), { kind, amount: placed });
        out.push(
          kind === "Mint"
            ? make(tx.hash, r, "buy", { coins: [coin], account, near: placed, escrow: placed, wallets: placed })
            : make(tx.hash, r, "sell", { coins: [coin], account, shares: placed }),
        );
      } else if (event === "order_filled") {
        orders.delete(orderKey(coin, account));
        const near = amount("near");
        const shares = amount("shares");
        out.push(
          data.kind === "mint"
            ? make(tx.hash, r, "bought", { coins: [coin], account, near, shares, treasury: { [coin]: near }, escrow: -near })
            : make(tx.hash, r, "sold", { coins: [coin], account, near, shares, treasury: { [coin]: -near }, wallets: -near }),
        );
      } else if (event === "order_cancelled" || event === "order_returned") {
        const order = orders.get(orderKey(coin, account));
        orders.delete(orderKey(coin, account));
        const kind = event === "order_cancelled" ? "cancelled" : "returned";
        out.push(
          order?.kind === "Mint"
            ? make(tx.hash, r, kind, { coins: [coin], account, side: "buy", near: order.amount, escrow: -order.amount, wallets: -order.amount })
            : make(tx.hash, r, kind, { coins: [coin], account, side: "sell", shares: order?.amount ?? 0n }),
        );
      } else if (event === "parley_settled") {
        const [a, b] = [text("a"), text("b")];
        const [da, db, dc] = [amount("a_delta"), amount("b_delta"), amount("commons_delta")];
        out.push(
          make(tx.hash, r, "match", {
            coins: [a, b],
            parley: Number(data.parley),
            moves: [text("a_move"), text("b_move")],
            near: (abs(da) + abs(db) + abs(dc)) / 2n,
            treasury: { [a]: da, [b]: db },
            pot: dc,
          }),
        );
      } else if (event === "shares_transferred") {
        out.push(make(tx.hash, r, "shares", { coins: [coin], account: text("from"), to: text("to"), shares: amount("shares") }));
      } else if (event === "token_created") {
        out.push(make(tx.hash, r, "token", { coins: [coin], account: tokenPayment?.payer ?? null, to: text("token"), near: tokenPayment?.deposit ?? 0n }));
      }
    }
  }
  return out;
}

export interface GovernanceRecord {
  tx: string;
  block: number;
  /** Nanoseconds of the block that ran the receipt. */
  at: string;
  /** The account that made the call. */
  by: string;
  calls: Call[];
  events: { event: string; data: EventData }[];
}

export function governanceOf(tx: ChainTx): GovernanceRecord[] {
  return tx.receipts.flatMap((r) => {
    const found = r.ok ? events(r.logs).filter((e) => GOVERNANCE_EVENTS.has(e.event)) : [];
    return found.length ? [{ tx: tx.hash, block: r.block, at: r.timestamp, by: r.predecessor, calls: r.calls, events: found }] : [];
  });
}

/** One coin's launch, proposals, closing tallies and enactments, joining each event to the call that carried its text. */
export function governanceFacts(records: Iterable<GovernanceRecord>, coin: string): GovernanceFacts {
  const facts: GovernanceFacts = { created: null, proposals: {}, tallies: {}, enactments: [] };
  for (const r of records) {
    const args = (methods: string[], key: string) => r.calls.find((c) => methods.includes(c.method) && c.args?.[key] === coin)?.args;
    for (const { event, data } of r.events) {
      if (data.coin !== coin) continue;
      const id = Number(data.id);
      if (event === "coin_created") {
        const call = args(["create_coin", "create_house_coin"], "id");
        if (call) facts.created = { constitution: String(call.constitution ?? ""), model: String(call.model ?? data.model ?? ""), by: r.by, at: r.at, tx: r.tx };
      } else if (event === "amendment_proposed") {
        const call = args(["propose_amendment"], "coin");
        if (call) facts.proposals[id] = { coin, constitution: String(call.constitution ?? ""), model: String(data.model ?? call.model ?? ""), proposer: String(data.proposer ?? r.by), tx: r.tx };
      } else if (event === "amendment_finalized") {
        facts.tallies[id] = { yes: String(data.yes ?? "0"), no: String(data.no ?? "0") };
      } else if (event === "amendment_enacted") {
        facts.enactments.push({ coin, id, version: Number(data.constitution_version), at: r.at, tx: r.tx });
      }
    }
  }
  return facts;
}

export function openOrders(entries: Iterable<LedgerEntry>): OpenOrders {
  const orders: OpenOrders = new Map();
  for (const e of entries) {
    const coin = e.coins[0] ?? "";
    const key = orderKey(coin, e.account ?? "");
    if (e.kind === "buy") orders.set(key, { kind: "Mint", amount: BigInt(e.near) });
    else if (e.kind === "sell") orders.set(key, { kind: "Redeem", amount: BigInt(e.shares) });
    else if (e.kind === "bought" || e.kind === "sold" || e.kind === "cancelled" || e.kind === "returned") orders.delete(key);
  }
  return orders;
}

interface Tally {
  launched: bigint;
  bought: bigint;
  sold: bigint;
  won: bigint;
  lost: bigint;
  minted: bigint;
  burned: bigint;
  matches: number;
  treasury: bigint;
}

export function summarize(entries: readonly LedgerEntry[], upTo = Infinity): { totals: LedgerTotals; coins: CoinMoney[]; pot: bigint; escrow: bigint } {
  const t = { launched: 0n, bought: 0n, sold: 0n, fees: 0n, taken: 0n, seed: 0n, potFromMatches: 0n, potOut: 0n, escrowIn: 0n, escrowFilled: 0n, escrowRefunded: 0n, tokens: 0n, received: 0n, minted: 0n, burned: 0n, matches: 0 };
  const coins = new Map<string, Tally>();
  const coin = (id: string) => {
    let c = coins.get(id);
    if (!c) coins.set(id, (c = { launched: 0n, bought: 0n, sold: 0n, won: 0n, lost: 0n, minted: 0n, burned: 0n, matches: 0, treasury: 0n }));
    return c;
  };
  let pot = 0n;
  let escrow = 0n;
  for (const e of entries) {
    if (e.block > upTo) continue;
    const near = BigInt(e.near);
    const shares = BigInt(e.shares);
    pot += BigInt(e.pot);
    escrow += BigInt(e.escrow);
    for (const [id, delta] of Object.entries(e.treasury)) coin(id).treasury += BigInt(delta);
    const first = e.coins[0] ?? "";
    switch (e.kind) {
      case "seeded":
        t.seed += near;
        break;
      case "launched":
        t.launched += near;
        t.fees += BigInt(e.fee ?? 0);
        t.minted += shares;
        coin(first).launched += near;
        coin(first).minted += shares;
        break;
      case "buy":
        t.escrowIn += near;
        break;
      case "bought":
        t.bought += near;
        t.escrowFilled += near;
        t.minted += shares;
        coin(first).bought += near;
        coin(first).minted += shares;
        break;
      case "sold":
        t.sold += near;
        t.burned += shares;
        coin(first).sold += near;
        coin(first).burned += shares;
        break;
      case "cancelled":
      case "returned":
        t.escrowRefunded += near;
        break;
      case "match": {
        t.matches += 1;
        const dc = BigInt(e.pot);
        if (dc > 0n) t.potFromMatches += dc;
        else t.potOut += -dc;
        const [a, b] = e.moves ?? ["", ""];
        if (a !== b) t.taken += near;
        for (const [id, value] of Object.entries(e.treasury)) {
          const delta = BigInt(value);
          const c = coin(id);
          c.matches += 1;
          if (delta > 0n) c.won += delta;
          else c.lost += -delta;
        }
        break;
      }
      case "token":
        t.tokens += near;
        break;
      case "received":
        t.received += near;
        break;
    }
  }
  const s = String;
  return {
    totals: {
      intoTreasuries: s(t.launched + t.bought),
      launched: s(t.launched),
      bought: s(t.bought),
      soldOut: s(t.sold),
      fees: s(t.fees),
      taken: s(t.taken),
      potIn: { seed: s(t.seed), fees: s(t.fees), matches: s(t.potFromMatches) },
      potOut: s(t.potOut),
      escrowIn: s(t.escrowIn),
      escrowFilled: s(t.escrowFilled),
      escrowRefunded: s(t.escrowRefunded),
      tokens: s(t.tokens),
      received: s(t.received),
      sharesMinted: s(t.minted),
      sharesBurned: s(t.burned),
      matches: t.matches,
    },
    coins: [...coins].map(([id, c]) => ({
      id,
      launched: s(c.launched),
      bought: s(c.bought),
      sold: s(c.sold),
      won: s(c.won),
      lost: s(c.lost),
      sharesMinted: s(c.minted),
      sharesBurned: s(c.burned),
      matches: c.matches,
      treasury: s(c.treasury),
      shares: s(c.minted - c.burned),
    })),
    pot,
    escrow,
  };
}

interface ContractCoin {
  id: string;
  name: string;
  treasury: string;
  total_shares: string;
}

export function balanceBooks(
  at: { block: number; at: number },
  account: { amount: string; locked: string; storage_usage: number },
  overview: { commons: string; escrow: string },
  coins: ContractCoin[],
  entries: readonly LedgerEntry[],
  perByte = STORAGE_PER_BYTE,
): Books {
  const balance = BigInt(account.amount) + BigInt(account.locked);
  const storage = BigInt(account.storage_usage) * perByte;
  const treasuries = coins.reduce((n, c) => n + BigInt(c.treasury), 0n);
  const pot = BigInt(overview.commons);
  const escrow = BigInt(overview.escrow);
  const owed = treasuries + pot + escrow;
  const spare = balance - owed - storage;
  const replayed = summarize(entries, at.block);
  const differences: Books["replay"]["differences"] = [];
  const differ = (what: string, events: bigint, contract: bigint) => events !== contract && differences.push({ what, events: String(events), contract: String(contract) });
  const byId = new Map(replayed.coins.map((c) => [c.id, c]));
  for (const c of coins) {
    const r = byId.get(c.id);
    differ(`${c.name} treasury`, BigInt(r?.treasury ?? 0), BigInt(c.treasury));
    differ(`${c.name} shares`, BigInt(r?.shares ?? 0), BigInt(c.total_shares));
    byId.delete(c.id);
  }
  for (const r of byId.values()) differ(`${r.id} treasury`, BigInt(r.treasury), 0n);
  differ("pot", replayed.pot, pot);
  differ("open buy orders", replayed.escrow, escrow);
  return {
    block: at.block,
    at: at.at,
    balance: String(balance),
    storageBytes: account.storage_usage,
    storage: String(storage),
    treasuries: String(treasuries),
    pot: String(pot),
    escrow: String(escrow),
    owed: String(owed),
    spare: String(spare),
    balanced: spare >= 0n,
    replay: { matches: differences.length === 0, entries: entries.filter((e) => e.block <= at.block).length, differences },
  };
}

function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

class Refused extends Error {}

interface Cursor {
  format: number;
  height: number;
  seen: string[];
  txs: number;
  through: { block: number; at: number } | null;
  unread: string[];
  books: Books | null;
}

export interface LedgerOptions {
  dir: string;
  network: string;
  contractId: string;
  rpcUrl: string;
  /** Overrides the FastNEAR transaction API for the network. */
  txApi?: string;
}

export class Ledger {
  readonly entries: LedgerEntry[] = [];
  private readonly governed: GovernanceRecord[] = [];
  private readonly api: string | null;
  private readonly file: string;
  private readonly governanceFile: string;
  private readonly cursorFile: string;
  private readonly known = new Set<string>();
  private readonly governedTxs = new Set<string>();
  private orders: OpenOrders = new Map();
  private cursor: Cursor = { format: FORMAT, height: 0, seen: [], txs: 0, through: null, unread: [], books: null };
  private caughtUp = false;
  private error: string | null = null;
  private last = 0;
  private perByte: bigint | null = null;
  private cached: { size: number; flows: ReturnType<typeof summarize> } | null = null;

  constructor(private readonly options: LedgerOptions) {
    this.api = options.txApi ?? process.env.PARLEY_TX_API ?? TX_API[options.network] ?? null;
    this.file = join(options.dir, `ledger-${options.contractId}.jsonl`);
    this.governanceFile = join(options.dir, `ledger-${options.contractId}-governance.jsonl`);
    this.cursorFile = join(options.dir, `ledger-${options.contractId}.json`);
    if (existsSync(this.cursorFile)) {
      const saved = JSON.parse(readFileSync(this.cursorFile, "utf8")) as Partial<Cursor>;
      if (saved.format === FORMAT) this.cursor = { ...this.cursor, ...saved };
    }
    for (const entry of readLines<LedgerEntry>(this.file)) {
      if (entry.seq > (this.entries.at(-1)?.seq ?? 0)) this.entries.push(entry);
    }
    this.governed.push(...readLines<GovernanceRecord>(this.governanceFile));
    for (const e of this.entries) this.known.add(e.tx);
    for (const r of this.governed) this.governedTxs.add(r.tx);
    this.orders = openOrders(this.entries);
  }

  start(): void {
    if (!this.api) return;
    void (async () => {
      for (;;) {
        const wait = await this.pass().then(
          () => POLL_MS,
          (error) => {
            this.error = error instanceof Error ? error.message : String(error);
            return RETRY_MS;
          },
        );
        await Bun.sleep(wait);
      }
    })();
  }

  /** Reads every transaction up to a settled block. True when nothing was left waiting. */
  async pass(): Promise<boolean> {
    if (!this.api) throw new Error(`no transaction index for ${this.options.network}`);
    mkdirSync(this.options.dir, { recursive: true });
    const head = await this.get<{ latest_block_height: number }>(`${this.api}/status`);
    const top = await this.blockAt(head.latest_block_height - SETTLE_BLOCKS);
    let resume: string | undefined;
    for (;;) {
      const page = await this.post<{ account_txs?: AccountRow[]; resume_token?: string | null }>(`${this.api}/v0/account`, {
        account_id: this.options.contractId,
        desc: false,
        limit: PAGE,
        from_tx_block_height: this.cursor.height,
        ...(resume ? { resume_token: resume } : {}),
      });
      const rows = page.account_txs ?? [];
      const todo = rows.filter((row) => row.tx_block_height <= top.block && !(row.tx_block_height === this.cursor.height && this.cursor.seen.includes(row.transaction_hash)));
      for (let i = 0; i < todo.length; i += BATCH) {
        if (!(await this.read(todo.slice(i, i + BATCH), top.block))) {
          this.caughtUp = false;
          return false;
        }
      }
      if (rows.length < PAGE || !page.resume_token || rows.some((row) => row.tx_block_height > top.block)) break;
      resume = page.resume_token;
    }
    this.cursor.through = top;
    this.caughtUp = true;
    this.error = null;
    this.cursor.books = await this.check(top).catch((error) => {
      this.error = `books check: ${error instanceof Error ? error.message : error}`;
      return this.cursor.books;
    });
    this.save();
    return true;
  }

  private async read(rows: AccountRow[], top: number): Promise<boolean> {
    const found = await this.post<{ transactions?: FastTx[] }>(`${this.api}/v0/transactions`, { tx_hashes: rows.map((r) => r.transaction_hash) });
    const byHash = new Map((found.transactions ?? []).map((t) => [t.execution_outcome.id, t]));
    const fresh: Entry[] = [];
    const governance: GovernanceRecord[] = [];
    let ok = true;
    for (const row of rows) {
      const raw = byHash.get(row.transaction_hash);
      const tx = raw ? readTx(raw, this.options.contractId) : null;
      if (!tx?.complete && top - row.tx_block_height < STALE_BLOCKS) {
        ok = false;
        break;
      }
      if (!tx) this.cursor.unread.push(row.transaction_hash);
      else {
        if (!this.known.has(tx.hash)) fresh.push(...entriesOf(tx, this.orders));
        if (!this.governedTxs.has(tx.hash)) governance.push(...governanceOf(tx));
      }
      if (row.tx_block_height > this.cursor.height) this.cursor = { ...this.cursor, height: row.tx_block_height, seen: [] };
      this.cursor.seen.push(row.transaction_hash);
      this.cursor.txs += 1;
    }
    this.commit(fresh, governance);
    return ok;
  }

  private commit(fresh: Entry[], governance: GovernanceRecord[]): void {
    let seq = this.entries.at(-1)?.seq ?? 0;
    const numbered = fresh.map((e) => ({ seq: ++seq, ...e }));
    if (numbered.length) appendFileSync(this.file, numbered.map((e) => JSON.stringify(e)).join("\n") + "\n");
    for (const e of numbered) {
      this.entries.push(e);
      this.known.add(e.tx);
    }
    if (governance.length) appendFileSync(this.governanceFile, governance.map((r) => JSON.stringify(r)).join("\n") + "\n");
    for (const r of governance) {
      this.governed.push(r);
      this.governedTxs.add(r.tx);
    }
    this.save();
  }

  private save(): void {
    const tmp = `${this.cursorFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cursor));
    renameSync(tmp, this.cursorFile);
  }

  private async check(top: { block: number; at: number }): Promise<Books> {
    const id = this.options.contractId;
    const view = async <T>(method: string, args: Record<string, unknown> = {}) => {
      const r = await this.rpc<{ result: number[] }>("query", { request_type: "call_function", block_id: top.block, account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    this.perByte ??= await this.rpc<{ runtime_config?: { storage_amount_per_byte?: string } }>("EXPERIMENTAL_protocol_config", { finality: "final" })
      .then((c) => BigInt(c.runtime_config?.storage_amount_per_byte ?? STORAGE_PER_BYTE))
      .catch(() => STORAGE_PER_BYTE);
    const account = await this.rpc<{ amount: string; locked: string; storage_usage: number }>("query", { request_type: "view_account", block_id: top.block, account_id: id });
    const overview = await view<{ commons: string; escrow: string }>("get_overview");
    const coins: ContractCoin[] = [];
    for (let from = 0; ; from += 100) {
      const page = await view<ContractCoin[]>("get_coins", { from_index: from, limit: 100 });
      coins.push(...page);
      if (page.length < 100) break;
    }
    return balanceBooks(top, account, overview, coins, this.entries, this.perByte);
  }

  /** The newest block at or below `height`; heights with no block are skipped. */
  private async blockAt(height: number): Promise<{ block: number; at: number }> {
    for (let h = height; h > height - 20; h--) {
      const block = await this.rpc<{ header: { height: number; timestamp_nanosec: string } }>("block", { block_id: h }).catch((error) => {
        if (error instanceof Refused) return null;
        throw error;
      });
      if (block) return { block: block.header.height, at: Math.floor(Number(block.header.timestamp_nanosec) / 1e6) };
    }
    throw new Error(`no block found below ${height}`);
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const body = await this.post<{ result?: T; error?: { cause?: { name?: string }; data?: string; message?: string } }>(this.options.rpcUrl, { jsonrpc: "2.0", id: "ledger", method, params });
    if (body.error) {
      const why = `${body.error.cause?.name ?? ""} ${typeof body.error.data === "string" ? body.error.data : body.error.message ?? ""}`.trim();
      if (/TOO_MANY_REQUESTS|rate limit/i.test(why)) throw new Error(why);
      throw new Refused(why);
    }
    return body.result as T;
  }

  private get<T>(url: string): Promise<T> {
    return this.request<T>(url);
  }

  private post<T>(url: string, body: unknown): Promise<T> {
    return this.request<T>(url, body);
  }

  private async request<T>(url: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + PACE_MS - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      this.last = Date.now();
      let delay = 1000 * 2 ** attempt;
      try {
        const res = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) {
          const parsed = JSON.parse(await res.text(), exactTimestamps) as T & { error?: { cause?: { name?: string } } };
          if (parsed?.error?.cause?.name !== "TOO_MANY_REQUESTS") return parsed;
        } else {
          if (res.status !== 429 && res.status < 500) throw new Refused(`${new URL(url).host} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
          delay = Math.max(delay, Number(res.headers.get("retry-after")) * 1000 || 0);
        }
      } catch (error) {
        if (error instanceof Refused || attempt >= 5) throw error;
      }
      if (attempt >= 5) throw new Error(`${new URL(url).host} kept refusing`);
      await Bun.sleep(delay);
    }
  }

  status(): LedgerStatus {
    return {
      contractId: this.options.contractId,
      network: this.options.network,
      block: this.cursor.through?.block ?? this.cursor.height,
      at: this.cursor.through?.at ?? this.entries.at(-1)?.at ?? 0,
      txs: this.cursor.txs,
      entries: this.entries.length,
      caughtUp: this.caughtUp,
      unread: this.cursor.unread,
      error: this.error,
    };
  }

  page(params: URLSearchParams): LedgerPage {
    const coin = params.get("coin");
    const kinds = params.get("kind")?.split(",").filter(Boolean) ?? [];
    const before = Number(params.get("before")) || Infinity;
    const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
    const entries: LedgerEntry[] = [];
    let more = false;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.seq >= before || (coin && !e.coins.includes(coin)) || (kinds.length && !kinds.includes(e.kind))) continue;
      if (entries.length === limit) {
        more = true;
        break;
      }
      entries.push(e);
    }
    return { entries, next: more ? entries.at(-1)!.seq : null, status: this.status() };
  }

  governance(coin: string): GovernanceFacts {
    return governanceFacts(this.governed, coin);
  }

  summary(): LedgerSummary {
    if (this.cached?.size !== this.entries.length) this.cached = { size: this.entries.length, flows: summarize(this.entries) };
    return { status: this.status(), totals: this.cached.flows.totals, coins: this.cached.flows.coins, books: this.cursor.books };
  }

  respond(url: URL): [unknown, number] | null {
    if (url.pathname !== "/api/ledger" && url.pathname !== "/api/ledger/summary") return null;
    if (!this.api) return [{ error: "The money log reads NEAR testnet or mainnet. This arena runs on a local chain." }, 503];
    return url.pathname === "/api/ledger" ? [this.page(url.searchParams), 200] : [this.summary(), 200];
  }
}
