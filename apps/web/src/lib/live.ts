import { Arena } from "@parley/sdk/src/arena.ts";
import type { Coin, Config, Model, Overview, Parley, SignedReply } from "@parley/sdk/src/types.ts";
import { useEffect, useRef, useState } from "react";
import { type Match, fromParley } from "./model.ts";

export const ARENA_API: string = import.meta.env.VITE_ARENA_API ?? "http://localhost:8787";

export interface ArenaInfo {
  network: string;
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

type LiveEvent =
  | { type: "hello"; current: { parley: Parley; turns: Evidence[] } | null; queue: number }
  | { type: "opened"; parley: Parley; reason: string }
  | { type: "turn"; parley: Parley; turn: Evidence }
  | { type: "settled"; parley: Parley }
  | { type: "idle"; reason: string };

let info: Promise<ArenaInfo | null> | null = null;

export function loadArenaInfo(): Promise<ArenaInfo | null> {
  info ??= fetch(`${ARENA_API}/api/arena`, { signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? (r.json() as Promise<ArenaInfo>) : null))
    .catch(() => null);
  return info;
}

export function useArenaInfo(): { info: ArenaInfo | null; ready: boolean } {
  const [state, setState] = useState<{ info: ArenaInfo | null; ready: boolean }>({ info: null, ready: false });
  useEffect(() => {
    let live = true;
    loadArenaInfo().then((i) => live && setState({ info: i, ready: true }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export const readArena = (i: ArenaInfo) => new Arena({ rpcUrl: i.rpcUrl, contractId: i.contractId });

/** Live coins and recent matches, refreshed every few seconds. */
export function useLiveArena(every = 5000) {
  const { info: arenaInfo, ready } = useArenaInfo();
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [parleys, setParleys] = useState<Parley[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!arenaInfo) return;
    const arena = readArena(arenaInfo);
    let live = true;
    const load = async () => {
      const [c, p] = await Promise.all([arena.coins(), arena.parleys(0, 50)]);
      if (live) {
        setCoins(c);
        setParleys(p);
      }
    };
    load().catch(() => {});
    const timer = setInterval(() => load().catch(() => {}), every);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [arenaInfo, every, tick]);
  return { info: arenaInfo, ready, coins, parleys, refresh: () => setTick((t) => t + 1) };
}

/** The match the arena is playing right now, turn by turn as the chain accepts each signed reply. */
export function useLiveMatch(filter?: (p: Parley) => boolean) {
  const [match, setMatch] = useState<Match | null>(null);
  const [idle, setIdle] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const turns = useRef<Evidence[]>([]);
  const keep = useRef(filter);
  keep.current = filter;
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    loadArenaInfo().then((i) => {
      if (!i || closed) return;
      source = new EventSource(`${ARENA_API}/api/live`);
      listen(source);
    });
    return () => {
      closed = true;
      source?.close();
    };
  }, []);

  function listen(source: EventSource) {
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
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
    };
  }
  return { match, idle, connected };
}

/** A finished live match with the signed replies the arena server kept, when it played it. */
export async function loadLiveMatch(i: ArenaInfo, id: number): Promise<Match | null> {
  const parley = await readArena(i).parley(id);
  if (!parley) return null;
  const kept = await fetch(`${ARENA_API}/api/match/${id}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ turns: Evidence[] }>) : null))
    .catch(() => null);
  return fromParley(parley, kept?.turns ?? []);
}
