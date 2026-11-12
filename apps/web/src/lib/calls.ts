import type { Move } from "@parley/sdk/src/types.ts";
import { useSyncExternalStore } from "react";
import type { Side } from "./model.ts";

export interface Guess {
  A?: Move;
  B?: Move;
  scored?: boolean;
}

export interface Calls {
  right: number;
  total: number;
  streak: number;
  best: number;
  matches: Record<string, Guess>;
}

const KEY = "parley.calls";
const KEEP = 200;
const empty: Calls = { right: 0, total: 0, streak: 0, best: 0, matches: {} };
const listeners = new Set<() => void>();

function read(): Calls {
  try {
    return { ...empty, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Calls>) };
  } catch {
    return empty;
  }
}

let state = read();

function write(next: Calls) {
  const keys = Object.keys(next.matches);
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete next.matches[k];
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  for (const notify of listeners) notify();
}

window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  state = read();
  for (const notify of listeners) notify();
});

/** Records the viewer's guess for one coin. A match already scored keeps its guesses. */
export function callMove(key: string, side: Side, move: Move) {
  const guess = state.matches[key] ?? {};
  if (guess.scored) return;
  write({ ...state, matches: { ...state.matches, [key]: { ...guess, [side]: move } } });
}

/** Scores the guesses for a revealed match once: each guessed coin is one call. */
export function scoreCalls(key: string, a: Move, b: Move) {
  const guess = state.matches[key];
  if (!guess || guess.scored || (!guess.A && !guess.B)) return;
  let { right, total, streak, best } = state;
  for (const [side, actual] of [["A", a], ["B", b]] as const) {
    const g = guess[side];
    if (!g) continue;
    total++;
    if (g === actual) {
      right++;
      streak++;
      best = Math.max(best, streak);
    } else streak = 0;
  }
  write({ right, total, streak, best, matches: { ...state.matches, [key]: { ...guess, scored: true } } });
}

export function useCalls(): Calls {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => state,
  );
}
