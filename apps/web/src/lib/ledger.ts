import type { LedgerEntry, LedgerKind, LedgerPage, LedgerSummary } from "@parley/sdk/src/ledger.ts";
import { YOCTO } from "@parley/sdk/src/units.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ARENA_API } from "./live.ts";
import { fmtNear } from "./model.ts";

export type { LedgerEntry, LedgerSummary };

export const GROUPS: { id: string; label: string; kinds: LedgerKind[] }[] = [
  { id: "all", label: "Everything", kinds: [] },
  { id: "launches", label: "Launches", kinds: ["launched"] },
  { id: "trades", label: "Buys and sells", kinds: ["buy", "sell", "bought", "sold", "cancelled", "returned"] },
  { id: "matches", label: "Matches", kinds: ["match"] },
  { id: "shares", label: "Shares sent", kinds: ["shares", "token"] },
  { id: "contract", label: "Into the contract", kinds: ["seeded", "received"] },
];

type Answer<T> = { ok: true; body: T } | { ok: false; offline: boolean; error: string | null };

async function ask<T>(path: string): Promise<Answer<T>> {
  try {
    const res = await fetch(`${ARENA_API}${path}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, body: (await res.json()) as T };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, offline: false, error: body?.error ?? null };
  } catch {
    return { ok: false, offline: true, error: null };
  }
}

const query = (coin: string | null, kinds: LedgerKind[], before: number | null, limit: number) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (coin) q.set("coin", coin);
  if (kinds.length) q.set("kind", kinds.join(","));
  if (before !== null) q.set("before", String(before));
  return `/api/ledger?${q}`;
};

export function useLedgerSummary(every = 30_000) {
  const [state, setState] = useState<{ summary: LedgerSummary | null; problem: string | null; ready: boolean }>({ summary: null, problem: null, ready: false });
  useEffect(() => {
    let live = true;
    const load = () =>
      ask<LedgerSummary>("/api/ledger/summary").then((a) => {
        if (!live) return;
        if (a.ok) setState({ summary: a.body, problem: null, ready: true });
        else setState((s) => ({ summary: s.summary, problem: a.offline ? "offline" : (a.error ?? "unavailable"), ready: true }));
      });
    load();
    const timer = setInterval(load, every);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [every]);
  return state;
}

export function useLedger(coin: string | null, kinds: LedgerKind[], limit = 40, every = 30_000) {
  const key = `${coin ?? ""}|${kinds.join(",")}|${limit}`;
  const [state, setState] = useState<{ key: string; entries: LedgerEntry[]; next: number | null; ready: boolean; problem: string | null }>({ key, entries: [], next: null, ready: false, problem: null });
  const [paging, setPaging] = useState(false);
  const current = useRef(key);
  current.current = key;

  useEffect(() => {
    let live = true;
    setState({ key, entries: [], next: null, ready: false, problem: null });
    const load = () =>
      ask<LedgerPage>(query(coin, kinds, null, limit)).then((a) => {
        if (!live) return;
        if (!a.ok) return setState((s) => ({ ...s, ready: true, problem: a.offline ? "offline" : (a.error ?? "unavailable") }));
        setState((s) => {
          const fresh = a.body.entries;
          const oldest = fresh.at(-1)?.seq ?? Infinity;
          const kept = s.key === key ? s.entries.filter((e) => e.seq < oldest) : [];
          return { key, entries: [...fresh, ...kept], next: kept.length ? s.next : a.body.next, ready: true, problem: null };
        });
      });
    load();
    const timer = setInterval(load, every);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [key, every]);

  const more = useCallback(async () => {
    if (state.next === null || paging) return;
    setPaging(true);
    const asked = state.key;
    const a = await ask<LedgerPage>(query(coin, kinds, state.next, limit));
    setPaging(false);
    if (!a.ok || current.current !== asked) return;
    setState((s) => {
      const seen = new Set(s.entries.map((e) => e.seq));
      return { ...s, entries: [...s.entries, ...a.body.entries.filter((e) => !seen.has(e.seq))], next: a.body.next };
    });
  }, [state.next, state.key, paging, coin, kinds, limit]);

  return { entries: state.key === key ? state.entries : [], next: state.next, ready: state.ready && state.key === key, problem: state.problem, more, paging };
}

export const amount = (yocto: string | bigint) => fmtNear(yocto, (BigInt(yocto) < 0n ? -BigInt(yocto) : BigInt(yocto)) < YOCTO ? 4 : 2);

const n = (yocto: string) => `${amount(yocto)} NEAR`;
const sh = (units: string) => fmtNear(units);

export function describe(e: LedgerEntry, name: (id: string) => string, contractId?: string): string {
  const who = e.account ?? "Someone";
  const coin = name(e.coins[0] ?? "");
  switch (e.kind) {
    case "seeded":
      return `The pot started with ${n(e.near)}, sent by ${who} when the contract was set up.`;
    case "launched":
      if (BigInt(e.shares) === 0n) return `${who} launched the house coin ${coin} with ${n(e.near)}.`;
      return `${who} launched ${coin} with ${n(e.near)} and got ${sh(e.shares)} shares.${e.fee ? ` The ${n(e.fee)} launch fee went to the pot.` : ""}`;
    case "buy":
      return `${who} put in ${n(e.near)} to buy ${coin}. It is held until ${coin}'s next match.`;
    case "sell":
      return `${who} put up ${sh(e.shares)} ${coin} shares to sell after its next match.`;
    case "bought":
      return `${who} got ${sh(e.shares)} new ${coin} shares. Their ${n(e.near)} went into ${coin}'s treasury.`;
    case "sold":
      return `${who} sold ${sh(e.shares)} ${coin} shares. ${coin}'s treasury paid out ${n(e.near)} and the shares are gone.`;
    case "cancelled":
      return e.side === "buy" ? `${who} cancelled a buy of ${coin}. The ${n(e.near)} went back.` : `${who} cancelled a sale of ${coin}. The ${sh(e.shares)} shares went back.`;
    case "returned":
      return e.side === "buy"
        ? `A buy of ${coin} could not fill at ${who}'s price. The ${n(e.near)} went back.`
        : `A sale of ${coin} could not fill at ${who}'s price. The ${sh(e.shares)} shares went back.`;
    case "match": {
      const [a = "", b = ""] = e.coins;
      const [am, bm] = e.moves ?? ["", ""];
      const each = n(String(BigInt(e.near) / 2n));
      if (am === "Cooperate" && bm === "Cooperate") return `${name(a)} and ${name(b)} both trusted. Each got ${each} from the pot.`;
      if (am === "Defect" && bm === "Defect") return `${name(a)} and ${name(b)} both betrayed. Each paid ${each} into the pot.`;
      const [taker, loser] = am === "Defect" ? [a, b] : [b, a];
      return `${name(taker)} betrayed ${name(loser)} and took ${n(e.near)} from its treasury.`;
    }
    case "shares": {
      const token = contractId ? `${e.coins[0]}.${contractId}` : null;
      if (e.to === token) return `${who} wrapped ${sh(e.shares)} ${coin} shares into its NEAR token, so they can be traded anywhere.`;
      if (e.account === token) return `${e.to} unwrapped ${sh(e.shares)} ${coin} shares from its NEAR token.`;
      return `${who} sent ${sh(e.shares)} ${coin} shares to ${e.to ?? "another account"}.`;
    }
    case "token":
      return `${who} paid ${n(e.near)} to make ${coin}'s shares a NEAR token. It went to the new token account ${e.to ?? ""}.`;
    case "received":
      return e.account === "system" ? `NEAR returned ${n(e.near)} of unused gas to the contract.` : `${who} sent ${n(e.near)} straight to the contract.`;
  }
}

export function headline(e: LedgerEntry): string {
  if (BigInt(e.near) > 0n) return n(e.near);
  if (BigInt(e.shares) > 0n) return `${sh(e.shares)} shares`;
  return "";
}

export function when(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
