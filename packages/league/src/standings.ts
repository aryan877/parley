import { prescribedMove } from "@parley/relayer/src/minds/scripted.ts";
import type { Coin, Move } from "@parley/sdk";
import type { ParleyEvidence } from "./fixtures.ts";

export interface Standing {
  id: string;
  name: string;
  treasury: string;
  change: string;
  played: number;
  cooperationRate: number;
  betrayed: number;
  betrayals: number;
  /** Decisions made, and how many of them were the move the house constitution prescribes. */
  prescribed: number;
  followed: number;
}

export interface LeagueStats {
  standings: Standing[];
  outcomes: { bothCooperate: number; oneDefects: number; bothDefect: number };
  cooperationByRound: number[];
  treasuryByParley: Record<string, string[]>;
  matrix: Record<string, Record<string, { played: number; cooperated: number }>>;
}

export function summarize(coins: Coin[], evidence: ParleyEvidence[], startTreasury: bigint, rounds: number): LeagueStats {
  const standings = coins
    .map((c) => ({
      id: c.id,
      name: c.name,
      treasury: c.treasury,
      change: (BigInt(c.treasury) - startTreasury).toString(),
      played: c.stats.matches,
      cooperationRate: c.stats.matches ? c.stats.cooperated / c.stats.matches : 0,
      betrayed: c.stats.was_betrayed,
      betrayals: c.stats.betrayed_other,
      prescribed: 0,
      followed: 0,
    }))
    .sort((x, y) => (BigInt(y.treasury) > BigInt(x.treasury) ? 1 : -1));

  const outcomes = { bothCooperate: 0, oneDefects: 0, bothDefect: 0 };
  const treasury = new Map(coins.map((c) => [c.id, startTreasury]));
  const treasuryByParley: Record<string, string[]> = Object.fromEntries(coins.map((c) => [c.id, [startTreasury.toString()]]));
  const matrix: LeagueStats["matrix"] = {};
  const perRound = Math.max(1, Math.ceil(evidence.length / rounds));
  const byRound: { c: number; n: number }[] = Array.from({ length: rounds }, () => ({ c: 0, n: 0 }));

  evidence.forEach(({ parley, turns }, i) => {
    turns.forEach((turn, t) => {
      if (parley.turns[t]?.kind !== "Decide") return;
      const expected = prescribedMove(turn.request);
      const standing = standings.find((s) => s.id === (t % 2 === 0 ? parley.a : parley.b));
      if (!expected || !standing) return;
      standing.prescribed++;
      const made = t % 2 === 0 ? parley.a_move : parley.b_move;
      if (made?.toUpperCase() === expected) standing.followed++;
    });

    const moves = [parley.a_move, parley.b_move] as Move[];
    const cooperations = moves.filter((m) => m === "Cooperate").length;
    if (cooperations === 2) outcomes.bothCooperate++;
    else if (cooperations === 1) outcomes.oneDefects++;
    else outcomes.bothDefect++;
    const round = byRound[Math.min(rounds - 1, Math.floor(i / perRound))]!;
    round.c += cooperations;
    round.n += 2;

    for (const [me, them, move, delta] of [
      [parley.a, parley.b, parley.a_move, parley.a_delta],
      [parley.b, parley.a, parley.b_move, parley.b_delta],
    ] as const) {
      treasury.set(me, (treasury.get(me) ?? 0n) + BigInt(delta));
      const cell = ((matrix[me] ??= {})[them] ??= { played: 0, cooperated: 0 });
      cell.played++;
      if (move === "Cooperate") cell.cooperated++;
    }
    for (const c of coins) treasuryByParley[c.id]!.push(treasury.get(c.id)!.toString());
  });

  return { standings, outcomes, cooperationByRound: byRound.map((r) => (r.n ? r.c / r.n : 0)), treasuryByParley, matrix };
}
