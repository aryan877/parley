import type { Order } from "@parley/sdk/src/types.ts";
import { useSyncExternalStore } from "react";

export interface Holding {
  /** Shares in yocto units, counting shares locked in a vote. */
  shares: string;
  order: Pick<Order, "kind" | "amount"> | null;
}

const KEY = "parley.held.";
const EMPTY: ReadonlyMap<string, Holding> = new Map();
const listeners = new Set<() => void>();
let owner: string | null = null;
let map: ReadonlyMap<string, Holding> = EMPTY;

function open(account: string) {
  if (owner === account) return;
  owner = account;
  try {
    map = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY + account) ?? "{}") as Record<string, Holding>));
  } catch {
    map = new Map();
  }
}

export function holdings(account: string): ReadonlyMap<string, Holding> {
  open(account);
  return map;
}

export function setHolding(account: string | null, coin: string, next: Holding | null) {
  if (!account) return;
  open(account);
  const before = map.get(coin);
  if (next && before && before.shares === next.shares && JSON.stringify(before.order) === JSON.stringify(next.order)) return;
  if (!next && !before) return;
  const copy = new Map(map);
  if (next) copy.set(coin, next);
  else copy.delete(coin);
  map = copy;
  try {
    localStorage.setItem(KEY + account, JSON.stringify(Object.fromEntries(copy)));
  } catch {}
  for (const l of listeners) l();
}

export const holds = (h: Holding | undefined) => !!h && (BigInt(h.shares) > 0n || h.order?.kind === "Mint");

export function useHoldingsOf(account: string | null): ReadonlyMap<string, Holding> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (account ? holdings(account) : EMPTY),
  );
}
