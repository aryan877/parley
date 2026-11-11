import { useEffect, useState } from "react";
import { type League, loadLeague } from "./data.ts";
import { type CoinInfo, type Match, fromCoin, fromEvidence } from "./model.ts";

/** A recorded league, ready to display: every match with its signed replies, and each coin's money over time. */
export interface Season {
  league: League;
  matches: Match[];
  coins: CoinInfo[];
  start: string;
  pot: string;
  coin(id: string): CoinInfo | undefined;
  /** The coin's treasury just before the given match, in yoctoNEAR. */
  treasuryBefore(id: string, matchId: number): string;
  /** The coin's moves, oldest first: "t" for trust, "b" for betray. */
  history(id: string): ("t" | "b")[];
  /** The coin's treasury after each match it played, starting with its opening treasury. */
  curve(id: string): number[];
  matchesOf(id: string): Match[];
}

function build(league: League): Season {
  const matches = league.evidence.map(fromEvidence);
  const coins = league.manifest.coins.map(fromCoin);
  const start = league.manifest.startTreasury;
  const index = new Map(matches.map((m, i) => [m.id, i]));
  const byCoin = new Map(coins.map((c) => [c.id, c]));
  return {
    league,
    matches,
    coins,
    start,
    pot: league.evidence[0]?.commonsBefore ?? league.manifest.overview.commons,
    coin: (id) => byCoin.get(id),
    treasuryBefore(id, matchId) {
      const series = league.stats.treasuryByParley[id];
      const i = index.get(matchId) ?? 0;
      return series?.[i] ?? start;
    },
    history(id) {
      return matches
        .filter((m) => m.settled && (m.a === id || m.b === id))
        .map((m) => ((m.a === id ? m.aMove : m.bMove) === "Cooperate" ? "t" : "b"));
    },
    curve(id) {
      let value = BigInt(start);
      const out = [Number(value / 10n ** 20n) / 10_000];
      for (const m of matches) {
        if (m.a !== id && m.b !== id) continue;
        value += BigInt(m.a === id ? m.aDelta : m.bDelta);
        out.push(Number(value / 10n ** 20n) / 10_000);
      }
      return out;
    },
    matchesOf: (id) => matches.filter((m) => m.a === id || m.b === id),
  };
}

let cached: Promise<Season> | null = null;

export function loadSeason(): Promise<Season> {
  cached ??= loadLeague("near-ai").then(build);
  return cached;
}

export function useSeason(): Season | null {
  const [season, setSeason] = useState<Season | null>(null);
  useEffect(() => {
    let live = true;
    loadSeason().then((s) => live && setSeason(s));
    return () => {
      live = false;
    };
  }, []);
  return season;
}
