import type { Coin, Config, Model, Overview, Parley, SignedReply } from "@parley/sdk/src/types.ts";
import { useEffect, useRef, useState } from "react";
import { type Match, fromParley } from "./model.ts";
import { forget, reads } from "./near.ts";

const configured = (import.meta.env.VITE_ARENA_API as string | undefined)?.trim().replace(/\/+$/, "");

/** An explicit build-time URL wins; a production build without one talks to the site's own origin. */
export const ARENA_API: string = configured || (import.meta.env.PROD ? window.location.origin : "http://localhost:8787");

export interface ArenaInfo {
  network: "local" | "testnet" | (string & {});
  /** Explorer prefix for a transaction hash, such as https://testnet.nearblocks.io/txns/, or null. */
  explorerTx?: string | null;
  rpcUrl: string;
  contractId: string;
  autoplay: boolean;
  overview: Overview;
  config: Config;
  models: Model[];
}

export interface Evidence {
  index: number;
  model: string;
  request: string;
  reply: SignedReply;
  txHash: string;
}

export type LiveEvent =
  | { type: "hello"; current: { parley: Parley; turns: Evidence[] } | null; queue: number }
  | { type: "opened"; parley: Parley; reason: string }
  | { type: "turn"; parley: Parley; turn: Evidence }
  | { type: "settled"; parley: Parley }
  | { type: "idle"; reason: string };

let info: Promise<ArenaInfo | null> | null = null;

async function fetchArenaInfo(): Promise<ArenaInfo | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    const found = await fetch(`${ARENA_API}/api/arena`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? (r.json() as Promise<ArenaInfo>) : null))
      .catch(() => null);
    if (found) return found;
  }
  return null;
}

let known: ArenaInfo | null | undefined;

export function loadArenaInfo(): Promise<ArenaInfo | null> {
  info ??= fetchArenaInfo().then((found) => {
    known = found;
    if (!found) setTimeout(() => (info = null), 15_000);
    return found;
  });
  return info;
}

export function useArenaInfo(): { info: ArenaInfo | null; ready: boolean } {
  const [state, setState] = useState<{ info: ArenaInfo | null; ready: boolean }>(() => (known === undefined ? { info: null, ready: false } : { info: known, ready: true }));
  useEffect(() => {
    let live = true;
    loadArenaInfo().then((i) => live && setState((s) => (s.ready && s.info === i ? s : { info: i, ready: true })));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export const txLink = (i: ArenaInfo | null | undefined, hash?: string | null) => (i?.explorerTx && hash ? `${i.explorerTx}${hash}` : null);

export function accountLink(i: ArenaInfo | null | undefined, account: string): string | null {
  if (!i?.explorerTx) return null;
  try {
    return `${new URL(i.explorerTx).origin}/address/${account}`;
  } catch {
    return null;
  }
}

export const networkName = (i: ArenaInfo | null | undefined) => (i?.network === "testnet" ? "NEAR testnet" : i?.network === "local" ? "a local test chain" : `NEAR ${i?.network ?? ""}`.trim());

/** Live coins and the newest 50 matches, refreshed every few seconds. A failed read keeps the last good answer. */
export function useLiveArena(every = 5000) {
  const { info: arenaInfo, ready } = useArenaInfo();
  const [coins, setCoins] = useState<Coin[] | null>(() => reads.peekCoins(arenaInfo) ?? null);
  const [parleys, setParleys] = useState<Parley[]>(() => reads.peekRecent(arenaInfo) ?? []);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!arenaInfo) return;
    let live = true;
    const load = () => {
      reads.coins(arenaInfo).then((c) => live && setCoins(c), () => {});
      reads.recent(arenaInfo).then((p) => live && setParleys(p), () => {});
    };
    load();
    const timer = setInterval(load, every);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [arenaInfo, every, tick]);
  return {
    info: arenaInfo,
    ready,
    coins,
    parleys,
    refresh: () => {
      if (arenaInfo) forget(arenaInfo, "get_coins", "get_parleys");
      setTick((t) => t + 1);
    },
  };
}

interface LiveListener {
  event(event: LiveEvent): void;
  status?(connected: boolean): void;
}

const listeners = new Set<LiveListener>();
let source: EventSource | null = null;
let opening = false;
let connected = false;
let closing: ReturnType<typeof setTimeout> | undefined;
let latest: { current: { parley: Parley; turns: Evidence[] } | null; queue: number } | null = null;

function remember(event: LiveEvent) {
  if (event.type === "hello") latest = { current: event.current, queue: event.queue };
  else if (!latest) return;
  else if (event.type === "opened") latest.current = { parley: event.parley, turns: [] };
  else if (event.type === "turn") {
    const kept = latest.current?.parley.id === event.parley.id ? latest.current.turns.filter((t) => t.index !== event.turn.index) : [];
    latest.current = { parley: event.parley, turns: [...kept, event.turn] };
  } else if (event.type === "settled") latest.current = null;
}

function setConnected(next: boolean) {
  connected = next;
  for (const l of [...listeners]) l.status?.(next);
}

function openLive() {
  if (source || opening) return;
  opening = true;
  loadArenaInfo().then((i) => {
    opening = false;
    if (!i || !listeners.size || source) return;
    const es = new EventSource(`${ARENA_API}/api/live`);
    source = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      remember(event);
      for (const l of [...listeners]) l.event(event);
    };
  });
}

/** One shared /api/live stream for the whole page. A late subscriber first gets a hello with the match in play. */
export function subscribeLive(listener: LiveListener): () => void {
  clearTimeout(closing);
  listeners.add(listener);
  if (source) {
    listener.status?.(connected);
    if (latest) listener.event({ type: "hello", current: latest.current, queue: latest.queue });
  } else openLive();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    closing = setTimeout(() => {
      if (listeners.size) return;
      source?.close();
      source = null;
      latest = null;
      connected = false;
    }, 3000);
  };
}

/** The match the arena is playing right now, turn by turn as the chain accepts each signed reply. */
export function useLiveMatch(filter?: (p: Parley) => boolean) {
  const [match, setMatch] = useState<Match | null>(null);
  const [idle, setIdle] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const turns = useRef<Evidence[]>([]);
  const keep = useRef(filter);
  keep.current = filter;
  useEffect(
    () =>
      subscribeLive({
        status: setLive,
        event(event) {
          const wanted = (p: Parley) => !keep.current || keep.current(p);
          if (event.type === "hello") {
            if (event.current && wanted(event.current.parley)) {
              turns.current = event.current.turns;
              setMatch(fromParley(event.current.parley, turns.current));
            }
          } else if (event.type === "opened") {
            if (!wanted(event.parley)) return;
            turns.current = [];
            setIdle(null);
            setMatch(fromParley(event.parley));
          } else if (event.type === "turn") {
            if (!wanted(event.parley)) return;
            turns.current = [...turns.current.filter((t) => t.index !== event.turn.index), event.turn];
            setMatch(fromParley(event.parley, turns.current));
          } else if (event.type === "settled") {
            if (!wanted(event.parley)) return;
            setMatch(fromParley(event.parley, turns.current));
          } else if (event.type === "idle") {
            setIdle(event.reason);
          }
        },
      }),
    [],
  );
  return { match, idle, connected: live };
}

/** A finished live match with the signed replies the arena server kept, when it played it. */
export async function loadLiveMatch(i: ArenaInfo, id: number): Promise<Match | null> {
  const parley = await reads.parley(i, id);
  if (!parley) return null;
  const kept = await fetch(`${ARENA_API}/api/match/${id}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ turns: Evidence[] }>) : null))
    .catch(() => null);
  return fromParley(parley, kept?.turns ?? []);
}

export interface Schedule {
  now: number;
  autoplay: boolean;
  pauseMs: number;
  current: { id: number; a: string; b: string; turns: number; since: number } | null;
  lastEnded: number;
  queue: { a: string; b: string }[];
  next: { a: string; b: string; at: number; why: "challenge" | "rule" } | null;
}

/** What the arena is playing now and what it will play next, refreshed every two seconds. */
export function useSchedule(every = 5000): { schedule: Schedule | null; skew: number } {
  const [state, setState] = useState<{ schedule: Schedule | null; skew: number }>({ schedule: null, skew: 0 });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    loadArenaInfo().then((i) => {
      if (!i || !live) return;
      const load = () =>
        fetch(`${ARENA_API}/api/schedule`)
          .then((r) => (r.ok ? (r.json() as Promise<Schedule>) : null))
          .then((s) => s && live && setState({ schedule: s, skew: Date.now() - s.now }))
          .catch(() => {});
      load();
      timer = setInterval(load, every);
    });
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [every]);
  return state;
}
