import { type Stats, near, sharePrice } from "@parley/sdk";
import { type Fill, type Rules, type Settled, SimArena } from "./arena.ts";
import { seeded } from "./random.ts";
import type { Strategy } from "./strategies.ts";

export const SECOND = 1_000_000_000n;
export const MATCH_SECONDS = 150;
export const PAUSE_SECONDS = 300;
export const DAY_SECONDS = 86_400;
export const MATCHES_PER_DAY = DAY_SECONDS / (MATCH_SECONDS + PAUSE_SECONDS);
export const DAYS = 60;
export const CHECKPOINTS = [0, 10, 20, 30, 60];

const DAY = BigInt(DAY_SECONDS) * SECOND;
const MATCH = BigInt(MATCH_SECONDS) * SECOND;
const PAUSE = BigInt(PAUSE_SECONDS) * SECOND;
const START = 1_000_000n * SECOND;

export const LIVE_RULES: Rules = {
  stake_bps: 200,
  min_treasury: near("0.5"),
  creation_fee: near("0.1"),
  rest_ns: 20n * SECOND,
  pair_rest_ns: 60n * SECOND,
  order_timeout_ns: 60n * SECOND,
};
export const LIVE_GOVERNANCE = { quorum_bps: 2000, proposer_bps: 100, vote_period_ns: 120n * SECOND, timelock_ns: 240n * SECOND };
export const LIVE_COMMONS = near(4);
export const HOUSE_TREASURY = near(2);
export const OWNER = "parley-owner.testnet";

export interface CoinPlan {
  id: string;
  name: string;
  strategy: Strategy;
  treasury?: bigint;
  fee?: bigint;
  creator?: string;
  group?: string;
}

export interface Action {
  day: number;
  run(arena: SimArena, now: bigint, launch: (plans: CoinPlan[]) => void): void;
}

export interface Scenario {
  id: string;
  title: string;
  seed: number;
  rules?: Partial<Rules>;
  commons?: bigint;
  coins: CoinPlan[];
  actions?: Action[];
}

export interface CoinDay {
  treasury: bigint;
  shares: bigint;
  price: number;
  wins: number;
  matches: number;
  benchEvents: number;
  benched: boolean;
  version: number;
  stats: Stats;
}

export interface Day {
  day: number;
  commons: bigint;
  coins: Map<string, CoinDay>;
}

export interface Season {
  scenario: Scenario;
  rules: Rules;
  arena: SimArena;
  plans: CoinPlan[];
  days: Day[];
  log: (Settled & { day: number })[];
  fills: (Fill & { day: number })[];
}

export function play(scenario: Scenario): Season {
  const rules = { ...LIVE_RULES, ...scenario.rules };
  const arena = new SimArena(rules, scenario.commons ?? LIVE_COMMONS, seeded(scenario.seed));
  const plans: CoinPlan[] = [];
  const launcher = (now: bigint) => (list: CoinPlan[]) => {
    list.forEach((plan, i) => {
      const fee = plan.fee ?? rules.creation_fee;
      arena.launch(plan.creator ?? OWNER, plan.id, plan.name, plan.strategy, (plan.treasury ?? HOUSE_TREASURY) + fee, now + BigInt(i) * 2n * SECOND, fee);
      plans.push(plan);
    });
  };
  launcher(START)(scenario.coins);

  const days: Day[] = [];
  const log: Season["log"] = [];
  const fills: Season["fills"] = [];
  let next = START + PAUSE;
  for (let day = 0; day <= DAYS; day++) {
    const dayStart = START + BigInt(day) * DAY;
    for (const action of scenario.actions ?? []) {
      if (action.day === day) action.run(arena, dayStart, launcher(dayStart));
    }
    days.push(snapshot(arena, day));
    if (day === DAYS) break;
    const dayEnd = dayStart + DAY;
    while (next < dayEnd) {
      fills.push(...arena.fill(next).map((f) => ({ ...f, day })));
      const opened = arena.open(next);
      if (!opened) {
        next += PAUSE;
        continue;
      }
      const [a, b] = arena.decide(opened);
      const settledAt = next + MATCH;
      log.push({ ...arena.settle(opened, a, b, settledAt), day });
      fills.push(...arena.fill(settledAt).map((f) => ({ ...f, day })));
      if (arena.value() + arena.paidOut !== arena.paidIn) throw new Error(`${scenario.id}: value not conserved after match ${log.length}`);
      next = settledAt + PAUSE;
    }
  }
  return { scenario, rules, arena, plans, days, log, fills };
}

function snapshot(arena: SimArena, day: number): Day {
  const coins = new Map<string, CoinDay>();
  for (const c of arena.coins.values()) {
    coins.set(c.id, {
      treasury: c.treasury,
      shares: c.shares,
      price: sharePrice(c),
      wins: c.wins,
      matches: c.matchesPlayed,
      benchEvents: c.benchEvents,
      benched: c.treasury < arena.rules.min_treasury,
      version: c.version,
      stats: { ...c.stats },
    });
  }
  return { day, commons: arena.commons, coins };
}
