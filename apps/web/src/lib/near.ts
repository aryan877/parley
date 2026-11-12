import type { Amendment, Coin, Order, Parley } from "@parley/sdk/src/types.ts";
import { useSyncExternalStore } from "react";

interface Chain {
  network: string;
  rpcUrl: string;
  contractId: string;
}

export interface VoteLock {
  locked: string;
  ballots: { amendment_id: number; shares: string; support: boolean }[];
}

const BACKUP: Record<string, string[]> = { testnet: ["https://rpc.testnet.near.org"] };

class Refused extends Error {}

async function post(url: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "parley", method: "query", params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`NEAR answered ${res.status}`);
  const body = (await res.json()) as { result?: Record<string, unknown> & { error?: string }; error?: unknown };
  if (body.error) {
    const text = JSON.stringify(body.error);
    if (/CONTRACT_EXECUTION_ERROR|UNKNOWN_ACCOUNT|NO_CONTRACT_CODE|panicked|MethodResolveError/i.test(text)) throw new Refused(text);
    throw new Error(text);
  }
  if (!body.result) throw new Error("NEAR sent an empty answer");
  if (body.result.error) throw new Refused(String(body.result.error));
  return body.result;
}

let trouble = false;
const listeners = new Set<() => void>();

function setTrouble(next: boolean) {
  if (trouble === next) return;
  trouble = next;
  for (const l of listeners) l();
}

/** True while reads from NEAR keep failing. The page keeps showing the last numbers it read. */
export function useNearTrouble(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => trouble,
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One RPC query with backoff. Busy public RPCs answer 429, which browsers often report as a failed fetch. */
export async function query<T>(chain: Chain, params: Record<string, unknown>): Promise<T> {
  const urls = [chain.rpcUrl, ...(BACKUP[chain.network] ?? []).filter((u) => u !== chain.rpcUrl)];
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait(500 * 2 ** attempt + Math.random() * 400);
    const url = (attempt >= 2 && urls[1]) || urls[0]!;
    try {
      const result = await post(url, params);
      setTrouble(false);
      return result as T;
    } catch (error) {
      if (error instanceof Refused) {
        setTrouble(false);
        throw error;
      }
      last = error;
    }
  }
  setTrouble(true);
  throw last;
}

export async function view<T>(chain: Chain, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await query<{ result: number[] }>(chain, {
    request_type: "call_function",
    finality: "optimistic",
    account_id: chain.contractId,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

interface Entry {
  value?: unknown;
  has: boolean;
  at: number;
  flight?: Promise<unknown>;
  token?: object;
}

const cache = new Map<string, Entry>();
const keyOf = (chain: Chain, method: string, args: Record<string, unknown>) => `${chain.contractId} ${method} ${JSON.stringify(args)}`;

/** A view call shared by every component: one request in flight per key, and answers reused for `ttl` ms. */
export function cached<T>(chain: Chain, method: string, args: Record<string, unknown>, ttl: number): Promise<T> {
  const key = keyOf(chain, method, args);
  let entry = cache.get(key);
  if (!entry) cache.set(key, (entry = { has: false, at: 0 }));
  if (entry.has && Date.now() - entry.at < ttl) return Promise.resolve(entry.value as T);
  if (entry.flight) return entry.flight as Promise<T>;
  const token = {};
  const e = entry;
  e.token = token;
  e.flight = view<T>(chain, method, args)
    .then((value) => {
      if (e.token === token) Object.assign(e, { value, has: true, at: Date.now() });
      return value;
    })
    .finally(() => {
      if (e.token === token) e.flight = undefined;
    });
  return e.flight as Promise<T>;
}

/** The last answer read for this call, however old, or undefined. */
export function peek<T>(chain: Chain | null | undefined, method: string, args: Record<string, unknown>): T | undefined {
  if (!chain) return undefined;
  const entry = cache.get(keyOf(chain, method, args));
  return entry?.has ? (entry.value as T) : undefined;
}

/** Makes the next read of these views go to the chain. Last answers stay available to `peek`. */
export function forget(chain: Chain, ...methods: string[]) {
  for (const [key, entry] of cache) {
    const [contract, method] = key.split(" ");
    if (contract !== chain.contractId || (methods.length && !methods.includes(method!))) continue;
    entry.at = 0;
    entry.flight = undefined;
    entry.token = undefined;
  }
}

const COINS = { limit: 100 };
const page = (from = 0, limit = 50) => ({ from_index: from, limit });

export const reads = {
  coins: (c: Chain) => cached<Coin[]>(c, "get_coins", COINS, 4000),
  peekCoins: (c: Chain | null | undefined) => peek<Coin[]>(c, "get_coins", COINS),
  coin: (c: Chain, coin: string) => cached<Coin | null>(c, "get_coin", { coin }, 4000),
  /** Newest first. */
  recent: (c: Chain) => cached<Parley[]>(c, "get_parleys", page(), 4000),
  peekRecent: (c: Chain | null | undefined) => peek<Parley[]>(c, "get_parleys", page()),
  parley: (c: Chain, id: number) => cached<Parley | null>(c, "get_parley", { id }, 3000),
  shares: (c: Chain, coin: string, account: string) => cached<string>(c, "get_shares", { coin, account }, 4000),
  vote: (c: Chain, coin: string, account: string) => cached<VoteLock | null>(c, "get_vote", { coin, account }, 4000),
  order: (c: Chain, coin: string, account: string) => cached<Order | null>(c, "get_order", { coin, account }, 4000),
  amendments: (c: Chain, coin: string) => cached<Amendment[]>(c, "get_amendments", { coin }, 4000),
};

/** Up to 50 matches with ids below `before`, newest first. A match opened since `newest` only shortens the page. */
export async function parleysBefore(chain: Chain, before: number, newest: number): Promise<Parley[]> {
  if (before <= 0) return [];
  const list = await cached<Parley[]>(chain, "get_parleys", page(Math.max(0, newest + 1 - before)), 60_000);
  return list.filter((p) => p.id < before);
}
