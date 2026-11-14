import { near } from "@parley/sdk";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PairCap } from "./arena.ts";
import { seeded } from "./random.ts";
import type { CoinPlan, Scenario } from "./season.ts";
import { type Strategy, betray, cartel, clique, copying, farmer, forgiving, grudge, grudger, pavlov, random, skeptic, titForTat, trust } from "./strategies.ts";

const ROOT = join(import.meta.dir, "../..");

const HOUSE_STRATEGIES: Record<string, Strategy> = {
  diplomat: forgiving,
  gambler: random,
  grudge,
  mirror: titForTat,
  pavlov,
  saint: trust,
  skeptic,
  snake: betray,
};

export interface Constitution {
  id: string;
  name: string;
  text: string;
  strategy: Strategy;
}

export function houseConstitutions(dir = join(ROOT, "constitutions")): Constitution[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const id = file.replace(/\.md$/, "");
      const [title = "", ...body] = readFileSync(join(dir, file), "utf8").trim().split("\n");
      const strategy = HOUSE_STRATEGIES[id];
      if (!strategy) throw new Error(`constitutions/${file} has no strategy in the simulation; add one to HOUSE_STRATEGIES`);
      return { id, name: title.replace(/^#\s*/, ""), text: body.join("\n").trim(), strategy };
    });
}

export interface Amendment {
  coin: string;
  constitution: string;
}

export const amendment = (): Amendment => JSON.parse(readFileSync(join(ROOT, "deployments/testnet-amendment.json"), "utf8")) as Amendment;

const house = (): CoinPlan[] => houseConstitutions().map((c) => ({ id: c.id, name: c.name, strategy: c.strategy }));

function crowd(prefix: string, count: number, strategy: Strategy, extra: Partial<CoinPlan> = {}): CoinPlan[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    name: `${prefix.toUpperCase()}${i + 1}`,
    strategy,
    group: prefix.toUpperCase(),
    ...extra,
  }));
}

export const WHALE = { coin: "mirror", buy: near(20), buyDay: 10, sellDay: 30 };
export const AMEND_DAY = 20;
export const INVADE_DAY = 10;
export const INVADERS = 8;

export const house8: Scenario = { id: "house", title: "The eight house coins", seed: 1, coins: house() };

export const allTrust: Scenario = { id: "trust", title: "Everyone trusts", seed: 2, coins: crowd("dove", 8, trust) };

export const invasion: Scenario = {
  id: "invasion",
  title: "SNAKE invasion",
  seed: 1,
  coins: house(),
  actions: [{ day: INVADE_DAY, run: (_arena, _now, launch) => launch(crowd("viper", INVADERS, betray, { creator: "invader.testnet" })) }],
};

export const REPUTATION = [
  { id: "record", label: "public record grudgers", strategy: grudger },
  { id: "memory", label: "pair memory grudgers", strategy: grudge },
  { id: "naive", label: "always trust", strategy: trust },
] as const;

export const reputation = (honest: (typeof REPUTATION)[number]): Scenario => ({
  id: `reputation-${honest.id}`,
  title: `Reputation: ${honest.label} against liars`,
  seed: 4,
  coins: [...crowd(honest.id, 6, honest.strategy), ...crowd("liar", 6, betray)],
});

export const governance: Scenario = {
  id: "amendment",
  title: "SAINT amended mid-season",
  seed: 1,
  coins: house(),
  actions: [{ day: AMEND_DAY, run: (arena) => arena.amend("saint", grudger) }],
};

export const whale: Scenario = {
  id: "whale",
  title: "A whale buys into MIRROR, then leaves",
  seed: 1,
  coins: house(),
  actions: [
    { day: WHALE.buyDay, run: (arena, now) => arena.placeMint("whale.testnet", WHALE.coin, WHALE.buy, now) },
    { day: WHALE.sellDay, run: (arena, now) => arena.placeRedeem("whale.testnet", WHALE.coin, arena.sharesOf(WHALE.coin, "whale.testnet"), now) },
  ],
};

export interface Farm {
  size: number;
  treasury: bigint;
  fee?: bigint;
  independent?: boolean;
  strategy?: Strategy;
}

const FARMER = "farmer.testnet";
export const FARM_SIZES = [5, 10, 20, 40];
export const FARM_TREASURIES = [near("0.5"), near("0.6")];
export const FARM_FEES = [0n, near("0.1"), near("0.5"), near(1), near(2)];

export const sybil = (farm: Farm): Scenario => ({
  id: `sybil-${farm.size}`,
  title: `${farm.size} farm coins`,
  seed: 7,
  coins: [
    ...house(),
    ...crowd("farm", farm.size, farm.strategy ?? farmer, { treasury: farm.treasury, fee: farm.fee }).map((c) => ({ ...c, creator: farm.independent ? `${c.id}.testnet` : FARMER })),
  ],
});

export const STAKES = [50, 100, 200, 500, 1000, 2000];

export const stakeSweep = (stake_bps: number): Scenario => ({
  id: `stake-${stake_bps}`,
  title: `The eight house coins at a ${stake_bps / 100}% stake`,
  seed: 1,
  rules: { stake_bps },
  coins: house(),
});

export const CARTEL_SIZES = [5, 10, 20];
export const CARTEL_TREASURY = near("0.6");
export const COPY_SHARES = [0, 0.25, 0.5, 1];
export const COPY_DRAWS = [1, 2, 3, 4, 5];
export const DAY_CAPS: PairCap[] = [100, 25, 5].map((bps) => ({ per: "day", bps }));
export const LIFETIME_CAPS: PairCap[] = ["0.5", "0.1", "0.02"].map((amount) => ({ per: "pair", amount: near(amount) }));

export type Learn = "start" | "daily";

export interface Fix {
  anonymous?: boolean;
  cap?: PairCap;
  cartel?: Strategy;
  copy?: number;
  learn?: Learn;
  draw?: number;
  firstStone?: boolean;
}

export function copiers(share: number, draw = COPY_DRAWS[0]!): string[] {
  const ids = houseConstitutions().map((c) => c.id);
  const random = seeded(draw);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids.slice(0, Math.round(share * ids.length));
}

const rulesOf = (fix: Fix) => ({ anonymous: fix.anonymous, pair_cap: fix.cap, first_stone: fix.firstStone });

export const fixedHouse = (fix: Fix): Scenario => ({ ...house8, id: "fix-house", rules: rulesOf(fix) });

export const fixedCartel = (size: number, fix: Fix): Scenario => ({
  ...sybil({ size, treasury: CARTEL_TREASURY, strategy: fix.cartel ?? cartel }),
  id: `fix-cartel-${size}`,
  rules: rulesOf(fix),
  actions: copiers(fix.copy ?? 0, fix.draw).map((id, k) => ({
    day: fix.learn === "start" ? 0 : k + 1,
    run: (arena) => arena.amend(id, copying(arena.coin(id).strategy)),
  })),
});

export const BAIT_SIZES = [10, 20, 40];
export const BAIT_SHARES = [0.1, 0.25, 0.5, 0.75];

/** A cartel split into bait coins, which betray every outsider, and clean coins, which trust their own and never betray an outsider first. */
export const splitCartel = (size: number, share: number, fix: Fix): Scenario => {
  const base = fixedCartel(size, fix);
  const bait = Math.max(1, Math.round(share * size));
  return {
    ...base,
    id: `split-cartel-${size}-${bait}`,
    coins: base.coins.map((c) => (c.group === "FARM" ? { ...c, strategy: Number(c.id.slice("farm".length)) <= bait ? cartel : clique } : c)),
  };
};

export const newcomers = (size: number, fix: Fix): Scenario => ({
  ...sybil({ size, treasury: CARTEL_TREASURY, strategy: grudge, independent: true }),
  id: `fix-newcomers-${size}`,
  rules: rulesOf(fix),
});
