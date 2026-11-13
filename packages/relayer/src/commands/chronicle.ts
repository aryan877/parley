import type { Arena, Coin, Parley } from "@parley/sdk";
import { type GovernanceFacts, type Records, arenaRecords, rulesHistory } from "@parley/sdk/src/chronicle.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const INDEXER: Record<string, string> = { testnet: "https://api-testnet.nearblocks.io", mainnet: "https://api.nearblocks.io" };
const GOVERNANCE = ["propose_amendment", "finalize_amendment", "enact_amendment"] as const;
const PAGE = 25;
const MAX_PAGES = 40;
const PARLEY_PAGE = 50;
const RECORDS_TTL = 20_000;
const COINS_TTL = 5000;
const INDEX_TTL = 30_000;
const GAP_MS = 7000;
const BACKOFF_MS = 65_000;
const PATIENCE_MS = 3000;

interface Fact {
  method: string;
  ok: boolean;
  at: string;
  args: Record<string, unknown>;
  events: { event: string; data: Record<string, unknown> }[];
}

interface Store {
  contract: string;
  txs: Record<string, Fact>;
  created: Record<string, string>;
}

interface IndexedReceipt {
  transaction_hash: string;
  receiver_account_id: string;
  outcome?: { status?: boolean };
  block?: { block_timestamp?: string };
}

interface ReceiptNode {
  receiver_account_id?: string;
  actions?: { args?: { method_name?: string; args_json?: Record<string, unknown> | null } | null }[];
  outcome?: { executor_account_id?: string; logs?: string[]; status?: boolean };
  block?: { block_timestamp?: string };
  receipts?: ReceiptNode[];
}

export type Told = { body: unknown; status?: number } | null;

/**
 * Arena history the contract does not keep in its state: records over every finished match, and every version
 * of a coin's constitution. Matches come from the contract's views; closed amendments only live in transactions,
 * so their text, proposer, tally and enactment are read from the explorer's index and kept on disk.
 */
export function chronicle(owner: Arena, network: string, file: string): (path: string) => Promise<Told> {
  const contract = owner.contractId;
  const base = INDEXER[network] ?? null;
  let loaded: Store | null = null;
  try {
    if (existsSync(file)) loaded = JSON.parse(readFileSync(file, "utf8")) as Store;
  } catch {}
  const store: Store = loaded?.contract === contract ? loaded : { contract, txs: {}, created: {} };
  const save = () => writeFileSync(file, JSON.stringify(store));

  const parleys = new Map<number, Parley>();
  let complete = 0;
  let records: { at: number; body: Records & { scope: "all" } } | null = null;
  let warming: Promise<void> | null = null;
  let coinsAt = 0;
  let coins: Promise<Coin[]> | null = null;
  let indexedAt = 0;
  let indexing: Promise<void> | null = null;
  const looked = new Map<string, number>();

  const allCoins = () => {
    if (!coins || Date.now() - coinsAt > COINS_TTL) {
      coinsAt = Date.now();
      coins = owner.coins().catch((error) => {
        coinsAt = 0;
        throw error;
      });
    }
    return coins;
  };

  async function loadParleys() {
    const { parleys: count } = await owner.overview();
    for (let from = 0; from < count; from += PARLEY_PAGE) {
      const page = await owner.parleys(from, PARLEY_PAGE);
      for (const p of page) parleys.set(p.id, p);
      while (parleys.has(complete) && parleys.get(complete)!.status !== "Open") complete++;
      const oldest = page.at(-1)?.id ?? 0;
      if (!page.length || oldest <= complete) break;
    }
    records = { at: Date.now(), body: { ...arenaRecords([...parleys.values()], await allCoins()), scope: "all" } };
  }

  const refreshRecords = () => {
    warming ??= loadParleys()
      .catch((error) => console.error("records:", error instanceof Error ? error.message : error))
      .finally(() => (warming = null));
    return warming;
  };

  let line: Promise<unknown> = Promise.resolve();
  let nextCall = 0;
  /** One explorer call at a time, spaced out, waiting out a rate limit twice before giving up. */
  function indexer<T>(path: string): Promise<T> {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        await Bun.sleep(Math.max(0, nextCall - Date.now()));
        nextCall = Date.now() + GAP_MS;
        const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
        if (res.status === 429 && attempt < 2) {
          nextCall = Date.now() + BACKOFF_MS;
          continue;
        }
        if (!res.ok) throw new Error(`index answered ${res.status}`);
        return (await res.json()) as T;
      }
    };
    const result = line.then(run, run);
    line = result.catch(() => {});
    return result;
  }

  async function facts(hash: string): Promise<Fact> {
    const { data } = await indexer<{ data: ReceiptNode | null }>(`/v3/txns/${hash}/receipts`);
    const fact: Fact = { method: "", ok: false, at: "0", args: {}, events: [] };
    const walk = (node: ReceiptNode) => {
      if (node.receiver_account_id === contract) {
        const call = node.actions?.find((a) => a.args?.method_name)?.args;
        if (call && !fact.method) {
          fact.method = call.method_name ?? "";
          fact.args = call.args_json ?? {};
          fact.ok = node.outcome?.status === true;
          fact.at = node.block?.block_timestamp ?? "0";
        }
      }
      if (node.outcome?.executor_account_id === contract) {
        for (const log of node.outcome.logs ?? []) {
          if (!log.startsWith("EVENT_JSON:")) continue;
          try {
            const event = JSON.parse(log.slice(11)) as { standard?: string; event: string; data?: Record<string, unknown>[] };
            if (event.standard === "parley") for (const data of event.data ?? []) fact.events.push({ event: event.event, data });
          } catch {}
        }
      }
      for (const child of node.receipts ?? []) walk(child);
    };
    if (data) walk(data);
    return fact;
  }

  /** Reads new governance transactions, newest first until a page is all known, then fills them in oldest first. */
  async function index() {
    for (const method of GOVERNANCE) {
      const fresh: string[] = [];
      let next: string | undefined;
      for (let n = 0; n < MAX_PAGES; n++) {
        const page = await indexer<{ data?: IndexedReceipt[]; meta?: { next_page?: string } }>(
          `/v3/accounts/${contract}/receipts?method=${method}&limit=${PAGE}${next ? `&next=${encodeURIComponent(next)}` : ""}`,
        );
        const rows = (page.data ?? []).filter((r) => r.receiver_account_id === contract);
        const unknown = rows.filter((r) => !store.txs[r.transaction_hash] && !fresh.includes(r.transaction_hash));
        fresh.push(...unknown.map((r) => r.transaction_hash));
        next = page.meta?.next_page;
        if (!unknown.length || !next || (page.data ?? []).length < PAGE) break;
      }
      for (const hash of fresh.reverse()) {
        store.txs[hash] = await facts(hash);
        save();
      }
    }
  }

  const refreshIndex = () => {
    if (!base) return Promise.resolve();
    if (Date.now() - indexedAt < INDEX_TTL) return indexing ?? Promise.resolve();
    indexedAt = Date.now();
    indexing ??= index()
      .catch((error) => console.error("rules history:", error instanceof Error ? error.message : error))
      .finally(() => (indexing = null));
    return indexing;
  };

  /** Finds the launch transaction of a coin: the create_coin call in the block the coin records as its creation. */
  async function findLaunch(coin: Coin) {
    const page = await indexer<{ data?: IndexedReceipt[] }>(`/v3/accounts/${contract}/receipts?method=create_coin&limit=5&before_ts=${BigInt(coin.created_at) + 1n}`);
    for (const r of page.data ?? []) {
      if (r.receiver_account_id !== contract || r.block?.block_timestamp !== coin.created_at) continue;
      const fact = store.txs[r.transaction_hash] ?? (await facts(r.transaction_hash));
      store.txs[r.transaction_hash] = fact;
      if (fact.ok && fact.args.id === coin.id) {
        store.created[coin.id] = r.transaction_hash;
        break;
      }
    }
    save();
  }

  const looking = new Map<string, Promise<void>>();
  const lookLaunch = (coin: Coin) => {
    if (!base || store.created[coin.id]) return Promise.resolve();
    if (Date.now() - (looked.get(coin.id) ?? 0) < INDEX_TTL) return looking.get(coin.id) ?? Promise.resolve();
    looked.set(coin.id, Date.now());
    const work = findLaunch(coin)
      .catch((error) => console.error("launch lookup:", error instanceof Error ? error.message : error))
      .finally(() => looking.delete(coin.id));
    looking.set(coin.id, work);
    return work;
  };

  function launch(coin: Coin): GovernanceFacts["created"] {
    const hash = store.created[coin.id];
    const fact = hash ? store.txs[hash] : undefined;
    if (!hash || !fact) return null;
    return { constitution: String(fact.args.constitution ?? ""), model: String(fact.args.model ?? coin.model), by: coin.creator, at: coin.created_at, tx: hash };
  }

  function governance(): Omit<GovernanceFacts, "created"> {
    const out: Omit<GovernanceFacts, "created"> = { proposals: {}, tallies: {}, enactments: [] };
    for (const [tx, fact] of Object.entries(store.txs)) {
      if (!fact.ok) continue;
      for (const { event, data } of fact.events) {
        const id = Number(data.id);
        if (event === "amendment_proposed" && fact.method === "propose_amendment") {
          out.proposals[id] = { coin: String(data.coin), constitution: String(fact.args.constitution ?? ""), model: String(data.model ?? fact.args.model ?? ""), proposer: String(data.proposer), tx };
        } else if (event === "amendment_finalized") {
          out.tallies[id] = { yes: String(data.yes ?? "0"), no: String(data.no ?? "0") };
        } else if (event === "amendment_enacted") {
          out.enactments.push({ coin: String(data.coin), id, version: Number(data.constitution_version), at: fact.at, tx });
        }
      }
    }
    return out;
  }

  async function history(id: string): Promise<Told> {
    const coin = (await allCoins()).find((c) => c.id === id) ?? (await owner.coin(id));
    if (!coin) return { body: { error: "No such coin." }, status: 404 };
    if (coin.constitution_version === 1) return { body: rulesHistory(coin, { created: null, proposals: {}, tallies: {}, enactments: [] }) };
    const known = governance();
    const covered = new Set(known.enactments.filter((e) => e.coin === id && known.proposals[e.id]).map((e) => e.version));
    const gaps = Array.from({ length: coin.constitution_version - 1 }, (_, i) => i + 2).some((v) => !covered.has(v));
    await Promise.race([Promise.all([gaps ? refreshIndex() : null, lookLaunch(coin)]), Bun.sleep(PATIENCE_MS)]);
    return { body: rulesHistory(coin, { created: launch(coin), ...governance() }) };
  }

  void refreshRecords();

  return async (path) => {
    if (path === "/api/records") {
      if (!records || Date.now() - records.at > RECORDS_TTL) void refreshRecords();
      return records ? { body: records.body } : { body: { error: "The arena's records are still loading." }, status: 503 };
    }
    const rules = path.match(/^\/api\/history\/([a-z0-9]{2,20})$/);
    if (rules) return history(rules[1]!);
    return null;
  };
}
