import { useEffect } from "react";

const matches = new Map<number, number>();
const coins = new Map<string, number>();

const bump = <K>(m: Map<K, number>, k: K, by: number) => {
  const n = (m.get(k) ?? 0) + by;
  if (n > 0) m.set(k, n);
  else m.delete(k);
};

/** Marks a live match, or every match of a coin, as on screen, so alerts about it stay quiet. */
export function useWatching(match: number | null | undefined, coin?: string | null) {
  useEffect(() => {
    if (match !== null && match !== undefined) bump(matches, match, 1);
    if (coin) bump(coins, coin, 1);
    return () => {
      if (match !== null && match !== undefined) bump(matches, match, -1);
      if (coin) bump(coins, coin, -1);
    };
  }, [match, coin]);
}

export const watching = (p: { id: number; a: string; b: string }) => matches.has(p.id) || coins.has(p.a) || coins.has(p.b);
