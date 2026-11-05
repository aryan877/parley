import type { LeagueManifest, LeagueStats, ParleyEvidence } from "@parley/league/src/browser.ts";
import type { Attestation } from "@parley/relayer/src/attestation.ts";
import { useEffect, useState, useSyncExternalStore } from "react";

export interface LeagueEntry {
  name: string;
  mind: string;
  parleys: number;
  recordedAt: string;
  network: string;
}

export interface League {
  entry: LeagueEntry;
  manifest: LeagueManifest;
  stats: LeagueStats;
  evidence: ParleyEvidence[];
  attestations: Attestation[];
  all: LeagueEntry[];
}

const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  if (!cache.has(path)) cache.set(path, fetch(`./data/${path}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(path)))));
  return cache.get(path) as Promise<T>;
}

export async function loadLeague(name?: string): Promise<League> {
  const index = await get<LeagueEntry[]>("index.json");
  const entry = index.find((l) => l.name === name) ?? index[0];
  if (!entry) throw new Error("no recorded league");
  const [manifest, stats, evidence, attestations] = await Promise.all([
    get<LeagueManifest>(`${entry.name}/league.json`),
    get<LeagueStats>(`${entry.name}/stats.json`),
    get<ParleyEvidence[]>(`${entry.name}/evidence.json`),
    get<Attestation[]>(`${entry.name}/attestation.json`),
  ]);
  return { entry, manifest, stats, evidence, attestations, all: index };
}

const STORED = "parley.league";
const listeners = new Set<() => void>();
let chosen = sessionStorage.getItem(STORED) ?? undefined;

export function chooseLeague(name: string) {
  chosen = name;
  sessionStorage.setItem(STORED, name);
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useLeague() {
  const name = useSyncExternalStore(subscribe, () => chosen);
  const [state, setState] = useState<{ league?: League; error?: string }>({});
  useEffect(() => {
    let live = true;
    loadLeague(name).then(
      (league) => live && setState({ league }),
      (error: Error) => live && setState({ error: error.message }),
    );
    return () => {
      live = false;
    };
  }, [name]);
  return state;
}

export const near = (yocto: string | bigint, digits = 2) => {
  const v = BigInt(yocto);
  const abs = v < 0n ? -v : v;
  const scaled = abs / 10n ** BigInt(24 - digits);
  const whole = scaled / 10n ** BigInt(digits);
  const frac = (scaled % 10n ** BigInt(digits)).toString().padStart(digits, "0");
  return `${v < 0n ? "−" : ""}${whole}${digits ? `.${frac}` : ""}`;
};

export const signedNear = (yocto: string) => (BigInt(yocto) > 0n ? `+${near(yocto)}` : near(yocto));
export const short = (hex: string, n = 6) => `${hex.slice(0, n)}…${hex.slice(-4)}`;
