import { type Records, type RulesHistory, arenaRecords } from "@parley/sdk/src/chronicle.ts";
import type { Coin } from "@parley/sdk/src/types.ts";
import { useEffect, useMemo, useState } from "react";
import { askArena, useLiveArena } from "./live.ts";
import { msOf } from "./time.ts";

export type { DiffPart, Records, RulesHistory, RulesVersion } from "@parley/sdk/src/chronicle.ts";
export { wordDiff } from "@parley/sdk/src/chronicle.ts";

const RECORDS_EVERY = 30_000;
const HISTORY_EVERY = 15_000;
const HISTORY_TRIES = 12;

const getJson = <T>(path: string) => askArena<T>(path).then((a) => (a.ok ? a.body : null));

let served: { at: number; body: Records | null } | null = null;
let serving: Promise<Records | null> | null = null;

function loadRecords(): Promise<Records | null> {
  if (served && Date.now() - served.at < RECORDS_EVERY - 1000) return Promise.resolve(served.body);
  serving ??= getJson<Records>("/api/records")
    .then((body) => {
      served = { at: Date.now(), body: body ?? served?.body ?? null };
      return served.body;
    })
    .finally(() => (serving = null));
  return serving;
}

export interface RecordsView extends Records {
  /** "all" when the arena server read every match; "recent" when only the newest matches were at hand. */
  scope: "all" | "recent";
}

/** Arena records over every match from the arena server, or over the newest matches when it has none. Coin records always use the coins as they stand now. */
export function useRecords(): RecordsView | null {
  const { info, coins, parleys } = useLiveArena(10_000);
  const [all, setAll] = useState<Records | null>(() => served?.body ?? null);
  useEffect(() => {
    if (!info) return;
    let live = true;
    const load = () => loadRecords().then((r) => live && r && setAll(r));
    load();
    const timer = setInterval(load, RECORDS_EVERY);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [info]);
  return useMemo(() => {
    if (!coins) return all ? { ...all, scope: "all" } : null;
    const now = arenaRecords(all ? [] : parleys, coins);
    if (!all) return { ...now, scope: "recent" };
    return { ...all, richest: now.richest ?? all.richest, improved: now.improved ?? all.improved, scope: "all" };
  }, [all, coins, parleys]);
}

/** A chain time in nanoseconds as a short local date, such as "Nov 12, 3:41 PM". */
export const chainDate = (ns: string) => new Date(msOf(ns)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** How long ago a chain time in nanoseconds was, in rough plain words. */
export function chainAgo(ns: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - msOf(ns)) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

const histories = new Map<string, RulesHistory>();

/** Every version of a coin's rules. Asks again for a while when the arena server has not read every version yet. */
export function useRulesHistory(coin: Coin): { history: RulesHistory | null; loading: boolean } {
  const key = `${coin.id}:${coin.constitution_version}`;
  const [history, setHistory] = useState<RulesHistory | null>(() => histories.get(key) ?? null);
  const [loading, setLoading] = useState(!histories.get(key)?.complete);
  useEffect(() => {
    if (histories.get(key)?.complete) return;
    let live = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const found = await getJson<RulesHistory>(`/api/history/${coin.id}`);
      if (!live) return;
      if (found) {
        histories.set(key, found);
        setHistory(found);
      }
      if (found?.complete || ++tries >= HISTORY_TRIES || (!found && tries >= 2)) setLoading(false);
      else timer = setTimeout(load, HISTORY_EVERY);
    };
    setHistory(histories.get(key) ?? null);
    setLoading(true);
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, coin.id]);
  return { history, loading };
}
