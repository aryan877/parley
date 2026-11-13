import { formatNear, near, worth } from "@parley/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PairCap } from "./arena.ts";
import { type Chart, lineChart } from "./chart.ts";
import {
  AMEND_DAY,
  CARTEL_SIZES,
  CARTEL_TREASURY,
  COPY_DRAWS,
  COPY_SHARES,
  DAY_CAPS,
  FARM_FEES,
  FARM_SIZES,
  FARM_TREASURIES,
  type Farm,
  type Fix,
  INVADERS,
  INVADE_DAY,
  LIFETIME_CAPS,
  REPUTATION,
  STAKES,
  WHALE,
  allTrust,
  amendment,
  fixedCartel,
  fixedHouse,
  governance,
  house8,
  houseConstitutions,
  invasion,
  newcomers,
  reputation,
  stakeSweep,
  sybil,
  whale,
} from "./scenarios.ts";
import {
  CHECKPOINTS,
  DAYS,
  type Day,
  LIVE_COMMONS,
  LIVE_GOVERNANCE,
  LIVE_RULES,
  MATCHES_PER_DAY,
  MATCH_SECONDS,
  PAUSE_SECONDS,
  type Season,
  SECOND,
  play,
} from "./season.ts";
import { CODE_WORD, cartel, farmer, handshake, trust, wary } from "./strategies.ts";

const nearText = (y: bigint, digits = 3) => formatNear(y, digits);
const plain = (y: bigint) => formatNear(y, 3).replace(/\.?0+$/, "");
const signedText = (y: bigint, digits = 3) => `${y >= 0n ? "+" : ""}${formatNear(y, digits)}`;
const priceText = (p: number) => (Number.isFinite(p) ? p.toFixed(3) : "-");
const pctText = (p: number) => `${p >= 0 ? "+" : ""}${(p * 100).toFixed(0)}%`;
const toNear = (y: bigint) => Number(y / 10n ** 15n) / 1e9;
const seconds = (ns: bigint) => Number(ns / SECOND);

const NUMERIC = /^([-+]?[\d.]+%?|-||\d+ of \d+|day \d+|never|[A-Z]+ [\d.]+)$/;

function table(head: string[], rows: string[][]): string {
  const align = head.map((_, i) => (i > 0 && rows.every((r) => NUMERIC.test(r[i] ?? "")) ? "---:" : "---"));
  return [head, align, ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

interface Row {
  label: string;
  plays: string;
  ids: string[];
}

function rows(season: Season, groups: string[] = []): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const plan of season.plans) {
    if (plan.group && groups.includes(plan.group)) {
      if (seen.has(plan.group)) continue;
      seen.add(plan.group);
      const members = season.plans.filter((p) => p.group === plan.group);
      out.push({ label: `${plan.group} x${members.length} (average)`, plays: plan.strategy.label, ids: members.map((p) => p.id) });
    } else {
      out.push({ label: plan.name, plays: plan.strategy.label, ids: [plan.id] });
    }
  }
  return out;
}

const present = (day: Day, row: Row) => row.ids.map((id) => day.coins.get(id)).filter((c) => c !== undefined);

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
}

const rowTreasury = (day: Day, row: Row) => {
  const coins = present(day, row);
  return coins.length ? coins.reduce((sum, c) => sum + c.treasury, 0n) / BigInt(coins.length) : null;
};
const rowPrice = (day: Day, row: Row) => average(present(day, row).map((c) => c.price));

function firstBenched(season: Season, row: Row): number | null {
  return season.days.find((d) => present(d, row).some((c) => c.benched))?.day ?? null;
}

function tables(season: Season, groups: string[] = []): string {
  const list = rows(season, groups);
  const day = (d: number) => season.days[d]!;
  const days = CHECKPOINTS.map((d) => `Day ${d}`);
  const treasury = table(
    ["Coin", "Plays as", ...days],
    list.map((r) => [r.label, r.plays, ...CHECKPOINTS.map((d) => (rowTreasury(day(d), r) === null ? "-" : nearText(rowTreasury(day(d), r)!)))]),
  );
  const price = table(
    ["Coin", ...days],
    list.map((r) => [r.label, ...CHECKPOINTS.map((d) => priceText(rowPrice(day(d), r)))]),
  );
  const record = table(
    ["Coin", ...CHECKPOINTS.slice(1).map((d) => `Wins by day ${d}`), "Bench events", "First benched"],
    list.map((r) => {
      const wins = CHECKPOINTS.slice(1).map((d) => {
        const coins = present(day(d), r);
        if (!coins.length) return "-";
        const w = average(coins.map((c) => c.wins));
        const m = average(coins.map((c) => c.matches));
        return `${Math.round(w)} of ${Math.round(m)}`;
      });
      const bench = present(day(DAYS), r).reduce((n, c) => n + c.benchEvents, 0);
      const first = firstBenched(season, r);
      return [r.label, ...wins, String(bench), first === null ? "never" : `day ${first}`];
    }),
  );
  const pot = CHECKPOINTS.map((d) => `day ${d}: ${nearText(day(d).commons)}`).join(", ");
  return [
    "Treasury in NEAR:",
    "",
    treasury,
    "",
    "Share price (treasury divided by shares; every coin launches at 1.000):",
    "",
    price,
    "",
    `Wins are matches where the coin's treasury went up. A bench event is a drop below the ${nearText(season.rules.min_treasury, 1)} NEAR minimum.`,
    "",
    record,
    "",
    `Pot (the commons) in NEAR: ${pot}.`,
  ].join("\n");
}

function priceSeries(season: Season, groups: string[] = [], muted: string[] = []): Chart["series"] {
  return rows(season, groups).map((r) => ({
    label: r.ids.length > 1 ? `${r.label.split(" ")[0]} (avg)` : r.label,
    values: season.days.map((d) => rowPrice(d, r)),
    muted: r.ids.some((id) => muted.includes(id)),
  }));
}

const price = (season: Season, id: string, d = DAYS) => season.days[d]!.coins.get(id)?.price ?? Number.NaN;
const treasuryOf = (season: Season, id: string, d = DAYS) => season.days[d]!.coins.get(id)?.treasury ?? 0n;

function frozenFrom(season: Season): number | null {
  let last = -1;
  for (const m of season.log) if (m.aDelta !== 0n || m.bDelta !== 0n) last = m.day;
  return last + 1 < DAYS ? last + 1 : null;
}

function potEmptyDay(season: Season, below = near("0.01")): number | null {
  return season.days.find((d) => d.commons < below)?.day ?? null;
}

const benchedAt = (season: Season, d = DAYS) => [...season.days[d]!.coins.entries()].filter(([, c]) => c.benched).map(([id]) => id);

function ranked(season: Season, ids: string[], d = DAYS): string[] {
  return [...ids].sort((a, b) => price(season, b, d) - price(season, a, d));
}

const nameOf = (season: Season, id: string) => season.plans.find((p) => p.id === id)?.name ?? id;

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

interface FarmResult {
  farm: Farm;
  season: Season;
  cost: bigint;
  value: (d: number) => bigint;
  profit: (d: number) => bigint;
  evenDay: number | null;
  houseBenched: number;
  farmBenched: number;
}

function runFarm(farm: Farm, scenario = sybil(farm)): FarmResult {
  const season = play(scenario);
  const fee = farm.fee ?? LIVE_RULES.creation_fee;
  const cost = BigInt(farm.size) * (farm.treasury + fee);
  const farmIds = season.plans.filter((p) => p.group === "FARM").map((p) => p.id);
  const value = (d: number) => farmIds.reduce((sum, id) => sum + worth(season.days[d]!.coins.get(id)!, season.days[d]!.coins.get(id)!.shares), 0n);
  const evenDay = season.days.find((d) => value(d.day) >= cost)?.day ?? null;
  const last = season.days[DAYS]!;
  const houseBenched = [...last.coins.entries()].filter(([id, c]) => !farmIds.includes(id) && c.benched).length;
  const farmBenched = farmIds.filter((id) => last.coins.get(id)!.benched).length;
  return { farm, season, cost, value, profit: (d) => value(d) - cost, evenDay, houseBenched, farmBenched };
}

interface Spread {
  avg: bigint;
  low: bigint;
  high: bigint;
  benched: number;
  pot: bigint;
}

const meanOf = (values: bigint[]) => values.reduce((x, y) => x + y, 0n) / BigInt(values.length);

function spread(runs: FarmResult[]): Spread {
  const profits = runs.map((r) => r.profit(DAYS));
  return {
    avg: meanOf(profits),
    low: profits.reduce((x, y) => (y < x ? y : x)),
    high: profits.reduce((x, y) => (y > x ? y : x)),
    benched: average(runs.map((r) => r.houseBenched)),
    pot: meanOf(runs.map((r) => r.season.days[DAYS]!.commons)),
  };
}

const cartelFarm = (size: number): Farm => ({ size, treasury: CARTEL_TREASURY });
const drawsFor = (fix: Fix) => (fix.copy && !(fix.copy === 1 && fix.learn === "start") ? COPY_DRAWS : COPY_DRAWS.slice(0, 1));
const cartelRuns = (fix: Fix): Spread[] => CARTEL_SIZES.map((size) => spread(drawsFor(fix).map((draw) => runFarm(cartelFarm(size), fixedCartel(size, { ...fix, draw })))));
const honestRuns = (fix: Fix): Spread[] => CARTEL_SIZES.map((size) => spread([runFarm(cartelFarm(size), newcomers(size, fix))]));

const COPY_ROWS: Fix[] = COPY_SHARES.flatMap((copy) => (copy === 0 ? [{ copy }] : (["daily", "start"] as const).map((learn) => ({ copy, learn }))));
const CODE_RULES = [
  { rule: handshake, by: "code word" },
  { rule: wary, by: "code word, unless it betrayed them" },
];

const avgText = (s: Spread) => signedText(s.avg, 2);
const spreadText = (s: Spread) => (s.low === s.high ? avgText(s) : `${avgText(s)} (${signedText(s.low, 2)} to ${signedText(s.high, 2)})`);
const countText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const benchText = (list: Spread[]) => list.map((s) => countText(s.benched)).join(" / ");
const resultsText = (list: Spread[]) => list.map(avgText).join(" / ");
const capText = (cap?: PairCap) => (!cap ? "none (live)" : cap.per === "day" ? `${cap.bps / 100}% of the pot a day` : `${plain(cap.amount)} NEAR in total`);
const copyText = (fix: Fix) => `${(fix.copy ?? 0) * 100}%`;
const learnText = (fix: Fix) => (!fix.copy ? "-" : fix.learn === "start" ? "before day 0" : "one a day from day 1");
const sameResults = (x: Spread[], y: Spread[]) => x.every((s, i) => s.avg === y[i]!.avg);

interface Section {
  lines: string[];
  charts: Record<string, string>;
  summary: string;
}

function fixes(a: Season, houseIds: string[]): Section {
  const ten = CARTEL_SIZES.indexOf(10);
  const today = cartelRuns({});
  const unnamed = cartelRuns({ anonymous: true });
  const coded = CODE_RULES.map(({ rule, by }) => ({ by, rows: COPY_ROWS.map((fix) => ({ fix, result: cartelRuns({ anonymous: true, cartel: rule, ...fix }) })) }));
  const pick = (rule: number, copy: number, learn?: Fix["learn"]) => coded[rule]!.rows.find((r) => r.fix.copy === copy && r.fix.learn === learn)!.result;
  const honestToday = honestRuns({});
  const capped = [...DAY_CAPS, ...LIFETIME_CAPS].map((cap) => ({ cap, cartel: cartelRuns({ cap }), honest: honestRuns({ cap }), house: play(fixedHouse({ cap })) }));
  const capAt = (cap: PairCap) => capped.find((c) => c.cap === cap)!;
  const hidden = play(fixedHouse({ anonymous: true }));
  const BOTH_CAPS = [DAY_CAPS[1]!, LIFETIME_CAPS[1]!];
  const BOTH_ROWS: Fix[] = [{ copy: 0 }, { copy: 0.5, learn: "daily" }, { copy: 1, learn: "daily" }, { copy: 1, learn: "start" }];
  const both = BOTH_CAPS.flatMap((cap) =>
    BOTH_ROWS.map((fix) => {
      const [x, y] = CODE_RULES.map(({ rule }) => cartelRuns({ anonymous: true, cap, cartel: rule, ...fix }));
      return { cap, fix, result: x!.map((s, i) => (y![i]!.avg > s.avg ? y![i]! : s)) };
    }),
  );
  const bothAt = (cap: PairCap, copy: number, learn?: Fix["learn"]) => both.find((r) => r.cap === cap && r.fix.copy === copy && r.fix.learn === learn)!.result;

  const pairs = (n: number) => (n * (n - 1)) / 2;
  const stopped = (list: Spread[]) => CARTEL_SIZES.filter((_, i) => list[i]!.avg <= 0n);
  const sizesText = (sizes: number[]) => (sizes.length ? list(sizes.map(String)) : "none");
  const houseTreasury = (season: Season, id: string) => season.days[DAYS]!.coins.get(id)!.treasury;
  const hiddenSame = houseIds.every((id) => houseTreasury(hidden, id) === houseTreasury(a, id));
  const best = ranked(a, houseIds)[0]!;
  const mildest = capped[0]!;
  const tightDay = capAt(DAY_CAPS.at(-1)!);
  const midPair = capAt(LIFETIME_CAPS[1]!);
  const tightPair = capAt(LIFETIME_CAPS.at(-1)!);
  const naive = (copy: number) => pick(0, copy, "daily")[ten]!;
  const lateAll = pick(1, 1, "daily");
  const earlyAll = pick(1, 1, "start");
  const earlyIsHonest = sameResults(earlyAll, honestToday);
  const bothLate = bothAt(LIFETIME_CAPS[1]!, 1, "daily");
  const bothEarly = bothAt(LIFETIME_CAPS[1]!, 1, "start");
  const last = CARTEL_SIZES.length - 1;

  const farm10 = cartelFarm(10);
  const lines = [
    { label: "today", scenario: fixedCartel(10, {}) },
    { label: "hidden, late copy", scenario: fixedCartel(10, { anonymous: true, cartel: wary, copy: 1, learn: "daily" }) },
    { label: "hidden, early copy", scenario: fixedCartel(10, { anonymous: true, cartel: wary, copy: 1, learn: "start" }) },
    { label: `${plain((LIFETIME_CAPS[1] as { amount: bigint }).amount)} NEAR pair cap`, scenario: fixedCartel(10, { cap: LIFETIME_CAPS[1] }) },
    { label: "cap, early copy", scenario: fixedCartel(10, { anonymous: true, cartel: wary, copy: 1, learn: "start", cap: LIFETIME_CAPS[1] }) },
  ].map(({ label, scenario }) => {
    const r = runFarm(farm10, scenario);
    return { label, values: r.season.days.map((d) => toNear(r.value(d.day))), cost: r.cost };
  });
  const charts = {
    "fixes.svg": lineChart({
      title: "Candidate fixes against a 10-coin cartel",
      subtitle: "NEAR the cartel's coins could redeem, names hidden or trust bonus capped per pair",
      unit: "NEAR",
      series: lines.map(({ label, values }) => ({ label, values })),
      reference: { y: toNear(lines[0]!.cost), label: "cartel paid in" },
    }),
  };

  const summary = `Cartel fixes for a next deployment: hiding rival names does not stop a cartel on its own, because its coins can greet each other with a code word in public talk. If outside coins copy the code word only after the cartel has betrayed them, a cartel that refuses coins that betrayed it still ends ${resultsText(lateAll)} NEAR with 5, 10 and 20 coins; only if every outside coin knows the code word before day 0 does it fall to ${resultsText(earlyAll)}, ${earlyIsHonest ? "exactly" : "about"} what honest newcomers earn. A per-pair cap on the trust bonus removes the profit only when it is tight (${capText(tightPair.cap)} per pair stops all three sizes), still lets the cartel bench ${benchText(tightPair.cartel)} of 8 outside coins, and with no cartel at all leaves ${nearText(tightPair.house.days[DAYS]!.commons, 1)} NEAR stuck in the pot and ${benchedAt(tightPair.house).length} of 8 house coins benched.`;

  const out: string[] = [
    "## (h) Fixes for the cartel, for a future contract",
    "",
    `The live contract is locked, so this section tests changes a next deployment could make, under the setup of (g): the eight house coins and a cartel of ${list(CARTEL_SIZES.map(String))} coins with ${nearText(CARTEL_TREASURY, 1)} NEAR each and one owner, live rules otherwise, seed 7. The cartel's result is what its coins could redeem on day 60 minus everything it paid in. As a yardstick, the last row of the first table gives the same number of coins with separate owners that betray only a coin that betrayed them (honest newcomers).`,
    "",
    "### 1. Hide the rival's name",
    "",
    `The prompt would show the rival's record, treasury and the pair's history, but not its name. A cartel can still recognise its own coins if they say a code word in talk ("${CODE_WORD}"). Talk is public, so outside coins can copy it. The table varies how many of the eight house coins copy the code word and when they learn it: "before day 0" means they say it from their first match; "one a day from day 1" means one more copier starts each day. Copiers keep their own rule for the move. Which house coins copy is drawn ${COPY_DRAWS.length} times with fixed seeds; cells show the average with the lowest and highest draw in brackets.`,
    "",
    "Two code-word rules for the cartel: trust any coin that says the code word, or trust a coin that says it unless that coin betrayed it in their last eight meetings (the pair history the prompt keeps showing).",
    "",
    table(
      ["Cartel trusts", "Outside coins that copy", "They learn it", ...CARTEL_SIZES.map((n) => `${n} coins, day 60`), "Outside coins benched (5 / 10 / 20)"],
      [
        ["its own names (today)", "-", "-", ...today.map(spreadText), benchText(today)],
        ["its own names, with names hidden", "-", "-", ...unnamed.map(spreadText), benchText(unnamed)],
        ...coded.flatMap(({ by, rows }) => rows.map(({ fix, result }) => [by, copyText(fix), learnText(fix), ...result.map(spreadText), benchText(result)])),
        ["no cartel: separate owners, betray a coin that betrayed them", "-", "-", ...honestToday.map(spreadText), benchText(honestToday)],
      ],
    ),
    "",
    "### 2. Cap the trust bonus one pair can draw",
    "",
    `When two coins both trust, each takes the smaller of half the stake and an eighth of the pot. A cap limits what one pair of coins can take from the pot in total, either per day as a share of the pot at that moment, or over its whole life. Names stay visible and the cartel trusts its own coins by name, as in (g).`,
    "",
    table(
      ["Cap per pair", ...CARTEL_SIZES.map((n) => `Cartel, ${n} coins`), "Outside coins benched (5 / 10 / 20)", "Pot, day 60 (10 coins)", "Honest newcomers (5 / 10 / 20)"],
      [
        [capText(), ...today.map(avgText), benchText(today), nearText(today[ten]!.pot, 2), resultsText(honestToday)],
        ...capped.map((c) => [capText(c.cap), ...c.cartel.map(avgText), benchText(c.cartel), nearText(c.cartel[ten]!.pot, 2), resultsText(c.honest)]),
      ],
    ),
    "",
    "### 3. Both together",
    "",
    "Names hidden and a cap per pair. The cartel uses whichever of the two code-word rules pays it more in each cell.",
    "",
    table(
      ["Cap per pair", "Outside coins that copy", "They learn it", ...CARTEL_SIZES.map((n) => `${n} coins, day 60`), "Outside coins benched (5 / 10 / 20)"],
      both.map(({ cap, fix, result }) => [capText(cap), copyText(fix), learnText(fix), ...result.map(spreadText), benchText(result)]),
    ),
    "",
    "![Fixes](sim/fixes.svg)",
    "",
    "### Honest play under each fix",
    "",
    "The eight house coins alone, as in (a), with each fix. Share prices on day 60:",
    "",
    table(
      ["Rules", ...houseIds.map((id) => nameOf(a, id)), "Benched", "Pot, day 60"],
      [
        { label: "today", season: a },
        { label: "names hidden", season: hidden },
        ...capped.map((c) => ({ label: `cap ${capText(c.cap)}`, season: c.house })),
      ].map(({ label, season }) => [label, ...houseIds.map((id) => priceText(price(season, id))), String(benchedAt(season).length), nearText(season.days[DAYS]!.commons, 2)]),
    ),
    "",
    "What happened:",
    "",
    `- Hiding names breaks today's rule: coins told to trust their owner's other coins can no longer find them, and the 10-coin cartel ends ${avgText(unnamed[ten]!)}. A code word puts it straight back: with no outside coin copying it, the cartel ends ${resultsText(pick(1, 0))} for 5, 10 and 20 coins, ${sameResults(pick(1, 0), today) ? "exactly as today" : `against ${resultsText(today)} today`}.`,
    `- Copying beats a cartel that trusts anyone who says the code word: with a quarter of the house coins copying it over time, the 10-coin cartel averages ${avgText(naive(0.25))}; with all of them, ${avgText(naive(1))}.`,
    `- It does not beat a cartel that also refuses any coin that betrayed it. A house coin that learns the code word after the cartel has betrayed it has usually betrayed back by then, and the pair history the prompt shows marks it. With every house coin copying over time, that cartel still ends ${resultsText(lateAll)} and benches ${benchText(lateAll)} of 8.`,
    `- Copying works only if outside coins know the code word before they first meet the cartel. Then the cartel ends ${resultsText(earlyAll)}, ${earlyIsHonest ? "exactly" : "close to"} what honest newcomers earn (${resultsText(honestToday)}), and benches ${benchText(earlyAll)} outside coins, ${sameResults(earlyAll, honestToday) && earlyAll.every((s, i) => s.benched === honestToday[i]!.benched) ? "the same as honest newcomers" : `against ${benchText(honestToday)} for honest newcomers`}. At that point it is no longer a cartel: it trusts every coin that has not betrayed it.`,
    `- A cartel can also make the code word harder to copy, for example by tying it to the match nonce through a table only its owner knows. The table above then measures how much of that table has leaked. The model also ignores weaker ways to recognise a member, such as its treasury or record in the prompt.`,
    `- With no cartel, hiding names ${hiddenSame ? "changes nothing here: no house strategy reads names, and the eight house coins end exactly as in (a)" : "changes the house results"}. Real models do read names (SNAKE's name says what it does), so they would lose that hint and rely on the record.`,
    `- A cap per pair binds a big cartel last. ${list(CARTEL_SIZES.map((n) => `${n} coins have ${pairs(n)} pairs of their own`))}, against ${pairs(houseIds.length)} among the eight house coins, and every pair gets its own allowance.`,
    `- Caps that follow the pot are too loose: at ${capText(tightDay.cap)} per pair the cartel ends ${resultsText(tightDay.cartel)}. Lifetime caps stop it only when tight: cartels of ${sizesText(stopped(capAt(LIFETIME_CAPS[0]!).cartel))} coins stop paying at ${capText(LIFETIME_CAPS[0])}, of ${sizesText(stopped(midPair.cartel))} at ${capText(midPair.cap)} (20 coins still end ${avgText(midPair.cartel[last]!)}), and of ${sizesText(stopped(tightPair.cartel))} at ${capText(tightPair.cap)}.`,
    `- A cap removes the profit, not the damage. At ${capText(tightPair.cap)} per pair the cartel still benches ${benchText(tightPair.cartel)} of the 8 outside coins; their NEAR ends in the pot (${nearText(tightPair.cartel[ten]!.pot, 2)} NEAR on day 60 with 10 coins), where capped pairs cannot win it back. A griefer can do this for about ${nearText(-tightPair.cartel[0]!.avg, 1)} NEAR.`,
    `- The cost to honest play is large. Every mutual betrayal still pays into the pot, but coins that trust each other can no longer win it back. With the eight house coins alone, ${nameOf(a, best)} ends at ${priceText(price(midPair.house, best))} under a ${capText(midPair.cap)} cap against ${priceText(price(a, best))} today, ${benchedAt(midPair.house).length} coins are benched instead of ${benchedAt(a).length}, and ${nearText(midPair.house.days[DAYS]!.commons, 2)} NEAR is left in the pot. The mildest cap tried, ${capText(mildest.cap)}, costs little (${nameOf(a, best)} ${priceText(price(mildest.house, best))}) but does not slow the cartel.`,
    `- Honest newcomers pay for tight caps too: at ${capText(tightPair.cap)} per pair, 5, 10 and 20 of them end ${resultsText(tightPair.honest)} against ${resultsText(honestToday)} today.`,
    `- Together, with copiers who learn over time, hiding names adds little to the ${capText(midPair.cap)} cap: ${resultsText(bothLate)} against ${resultsText(midPair.cartel)} for the cap alone. If every outside coin copies from day 0, the result is ${resultsText(bothEarly)}${sameResults(bothEarly, midPair.honest) ? ", exactly what honest newcomers earn under the same cap" : `, against ${resultsText(midPair.honest)} for honest newcomers under the same cap`}.`,
    "",
    "What each fix needs in a future contract:",
    "",
    "- **Names hidden.** `prompt.rs` `build_request` writes the rival's name in three places: \"Opponent is ...\", the speaker label on each line of talk, and \"Write your next public message to ...\". All three would use a fixed word such as \"your opponent\" instead, while the rival's record, treasury, stake and the pair's history stay. That changes the request format, so `PROTOCOL` is bumped, `packages/league/src/prompt.ts` changes in step, and the fixtures are recorded again. The simulation models it in `SimArena`'s view of the rival, which then carries no id or owner.",
    "- **Cap per pair.** `PairRecord` gains `drawn`, the trust bonus the pair has taken, and for a daily cap the day it was counted in; `Config` gains the cap. In `settle`, the pair record is read before the payout and the Cooperate/Cooperate bonus becomes the smallest of half the stake, an eighth of the pot and half of what the pair has left under its cap; `drawn` grows by both bonuses. Betrayals pay exactly as today. The simulation applies this in `SimArena.capped` on top of the unchanged `payoff` from `economy.ts`.",
    "- **Both.** The two changes are independent and need nothing extra.",
    "",
  ];
  return { lines: out, charts, summary };
}

const SHORT ={ record: "record grudgers", memory: "memory grudgers", naive: "trusting" } as const;

export interface Report {
  markdown: string;
  charts: Record<string, string>;
  summary: string[];
}

export function buildReport(): Report {
  const charts: Record<string, string> = {};
  const constitutions = houseConstitutions();
  const houseIds = constitutions.map((c) => c.id);
  const a = play(house8);
  const b = play(allTrust);
  const c = play(invasion);
  const d = REPUTATION.map((honest) => ({ honest, season: play(reputation(honest)) }));
  const e = play(governance);
  const f = play(whale);
  const sweep = STAKES.map((bps) => ({ bps, season: play(stakeSweep(bps)) }));
  const probe = { size: 10, treasury: near("0.6") };
  const strategies: { label: string; farm: Farm }[] = [
    { label: `${cartel.label} (one owner)`, farm: { ...probe, strategy: cartel } },
    { label: `${farmer.label} (one owner)`, farm: { ...probe, strategy: farmer } },
    { label: `${trust.label} (one owner)`, farm: { ...probe, strategy: trust } },
    { label: `${cartel.label}, but each coin has its own owner`, farm: { ...probe, strategy: cartel, independent: true } },
  ];
  const byStrategy = strategies.map((s) => ({ ...s, result: runFarm(s.farm) }));
  const bySize = [1, 2, 3, ...FARM_SIZES].flatMap((size) => FARM_TREASURIES.map((treasury) => runFarm({ size, treasury, strategy: cartel })));
  const byFee = [...FARM_FEES, near(5)].map((fee) => runFarm({ ...probe, fee, strategy: cartel }));
  const RESTS = [60, 6 * 3600, 86_400, 3 * 86_400];
  const byRest = RESTS.flatMap((rest) =>
    [5, 10, 20].map((size) => {
      const farm: Farm = { size, treasury: probe.treasury, strategy: cartel };
      const scenario = { ...sybil(farm), rules: { pair_rest_ns: BigInt(rest) * SECOND } };
      const season = play(scenario);
      const cost = BigInt(size) * (farm.treasury + LIVE_RULES.creation_fee);
      let value = 0n;
      for (const p of season.plans) if (p.group === "FARM") value += season.days[DAYS]!.coins.get(p.id)!.treasury;
      return { rest, size, profit: value - cost, matches: season.log.length };
    }),
  );

  const md: string[] = [];
  const out = (...lines: string[]) => md.push(...lines);

  const top = ranked(a, houseIds);
  const one = (id: string): Row => ({ label: id, plays: "", ids: [id] });
  const snakeBenched = firstBenched(a, one("snake"));
  const cGainers = houseIds.filter((id) => !benchedAt(c).includes(id) && price(c, id) > price(a, id) + 0.01);
  const aBenched = benchedAt(a);
  const aFrozen = frozenFrom(a);
  const aPotEmpty = potEmptyDay(a);
  const bGain = average([...b.days[DAYS]!.coins.values()].map((x) => x.price - 1));
  const bPotEmpty = potEmptyDay(b);
  const vipers = c.plans.filter((p) => p.group === "VIPER").map((p) => p.id);
  const viperLoss = vipers.reduce((sum, id) => sum + (treasuryOf(c, id, INVADE_DAY) - treasuryOf(c, id)), 0n);
  const vipersBenchedDay = c.days.find((day) => day.day >= INVADE_DAY && vipers.every((id) => day.coins.get(id)?.benched))?.day ?? null;
  const cHouseBenched = benchedAt(c).filter((id) => houseIds.includes(id));
  const groupPrice = (season: Season, prefix: string, dd = DAYS) => average(season.plans.filter((p) => p.id.startsWith(prefix)).map((p) => price(season, p.id, dd)));
  const groupBetrayed = (season: Season, prefix: string) =>
    season.plans.filter((p) => p.id.startsWith(prefix)).reduce((n, p) => n + season.days[DAYS]!.coins.get(p.id)!.stats.was_betrayed, 0);
  const liarsBenchedDay = (season: Season) =>
    season.days.find((day) => season.plans.filter((p) => p.id.startsWith("liar")).every((p) => day.coins.get(p.id)!.benched))?.day ?? null;
  const dRecord = d.find((x) => x.honest.id === "record")!.season;
  const dMemory = d.find((x) => x.honest.id === "memory")!.season;
  const dNaive = d.find((x) => x.honest.id === "naive")!.season;
  const naiveLiarsBenched = benchedAt(dNaive).filter((id) => id.startsWith("liar")).length;
  const naiveBenched = benchedAt(dNaive).filter((id) => id.startsWith("naive")).length;
  const amendedRivals = houseIds.filter((id) => id !== "saint" && e.days[AMEND_DAY]!.coins.get(id)!.stats.betrayed_other > 0);
  const WHY: Record<string, string> = { snake: "by rule", gambler: "by chance", skeptic: "at first meetings" };
  const retaliators = amendedRivals.filter((id) => !(id in WHY));
  const saintAfter = (() => {
    const s20 = e.days[AMEND_DAY]!.coins.get("saint")!.stats;
    const s60 = e.days[DAYS]!.coins.get("saint")!.stats;
    return { trusted: s60.cooperated - s20.cooperated, played: s60.matches - s20.matches };
  })();
  const whaleMint = f.fills.find((x) => x.account === "whale.testnet" && x.kind === "Mint");
  const whaleRedeem = f.fills.find((x) => x.account === "whale.testnet" && x.kind === "Redeem");
  if (!whaleMint || whaleMint.kind !== "Mint" || !whaleRedeem || whaleRedeem.kind !== "Redeem") throw new Error("the whale's orders did not fill");
  const whaleDayAfterMint = f.days[WHALE.buyDay + 1]!.coins.get(WHALE.coin)!;
  const whaleStake = whaleMint.shares * 10_000n / whaleDayAfterMint.shares;
  const whaleProfit = whaleRedeem.near - whaleMint.near;
  const others = houseIds.filter((id) => id !== WHALE.coin);
  const othersMoved = others.filter((id) => treasuryOf(f, id) !== treasuryOf(a, id));
  const avgStake = (season: Season, from: number, to: number) => {
    const stakes = season.log.filter((m) => m.day >= from && m.day < to && (m.a === WHALE.coin || m.b === WHALE.coin)).map((m) => m.stake);
    return stakes.length ? stakes.reduce((x, y) => x + y, 0n) / BigInt(stakes.length) : 0n;
  };
  const strongest = byStrategy[0]!.result;
  const leaders = [...new Set(sweep.map(({ season }) => ranked(season, houseIds)[0]!))];
  const benchGroups: { ids: string[]; stakes: number[] }[] = [];
  for (const { bps, season } of sweep) {
    const ids = benchedAt(season);
    const same = benchGroups.find((g) => g.ids.join() === ids.join());
    if (same) same.stakes.push(bps);
    else benchGroups.push({ ids, stakes: [bps] });
  }
  const feeFirst = byFee[0]!;
  const feeLast = byFee.at(-1)!;
  const sizeAt = (size: number, treasury: bigint) => bySize.find((r) => r.farm.size === size && r.farm.treasury === treasury)!;
  const feeGap = feeLast.profit(DAYS) - feeFirst.profit(DAYS);
  const feeFlat = feeGap < near("0.05") && feeGap > -near("0.05");
  const smallLosers = bySize.filter((r) => r.profit(DAYS) < 0n && r.farm.treasury === probe.treasury).map((r) => r.farm.size);
  const smallestWinner = bySize.filter((r) => r.profit(DAYS) > 0n && r.farm.treasury === probe.treasury).map((r) => r.farm.size)[0];

  const fixed = fixes(a, houseIds);
  const summary = [
    `The eight house coins: ${nameOf(a, top[0]!)} ends day 60 at ${priceText(price(a, top[0]!))} and ${nameOf(a, top.at(-1)!)} at ${priceText(price(a, top.at(-1)!))}. ${aBenched.length} coins (${list(aBenched.map((id) => nameOf(a, id)))}) are benched by day 60. The pot is below 0.01 NEAR from day ${aPotEmpty}${aFrozen === null ? "" : ` and no treasury moves after day ${aFrozen}`}.`,
    `Everyone trusts: the ${nearText(b.days[0]!.commons, 1)} NEAR pot is shared out by day ${bPotEmpty}, every coin gains about ${pctText(bGain)}, and then nothing moves for the rest of the season.`,
    `SNAKE invasion: ${INVADERS} always-betray coins arriving on day ${INVADE_DAY} lose ${nearText(viperLoss, 2)} NEAR between them and are all benched by day ${vipersBenchedDay}. They also bench ${list(cHouseBenched.map((id) => nameOf(c, id)))}, while ${list(cGainers.map((id) => nameOf(c, id)))} end higher than without them.`,
    `Reputation: grudgers that read the public record end at ${priceText(groupPrice(dRecord, "record"))} against ${priceText(groupPrice(dRecord, "liar"))} for liars, and are betrayed ${groupBetrayed(dRecord, "record")} times in total against ${groupBetrayed(dMemory, "memory")} for grudgers that only remember their own meetings. Coins that always trust are all benched, and ${naiveLiarsBenched} of the 6 liars with them.`,
    `SAINT's real amendment, applied on day ${AMEND_DAY}: SAINT ends at ${priceText(price(e, "saint"))} with it and ${priceText(price(a, "saint"))} without it. By day ${AMEND_DAY}, ${amendedRivals.length === houseIds.length - 1 ? "every other house coin" : `${amendedRivals.length} of the ${houseIds.length - 1} other house coins`} had betrayed a trusting coin at least once, so the new rule tells SAINT to betray ${amendedRivals.length === houseIds.length - 1 ? "all of them" : "most of them"}.`,
    `Whale: ${plain(WHALE.buy)} NEAR into MIRROR buys ${(Number(whaleStake) / 100).toFixed(0)}% of its shares; redeemed on day ${WHALE.sellDay} it returns ${nearText(whaleRedeem.near)} NEAR (${signedText(whaleProfit)}). Stakes are 2% of the smaller treasury, so the bigger MIRROR cannot raise what it puts at risk against small coins.`,
    `Sybil: a group of ${smallestWinner} or more coins that trust each other and betray everyone else ends 60 days ${signedText(strongest.profit(DAYS), 2)} NEAR up, which is everything the house coins and the pot held above the bench line. The launch fee does not stop it, because the fee goes into the pot the group wins back: ${signedText(feeFirst.profit(DAYS), 2)} NEAR with no fee, ${signedText(feeLast.profit(DAYS), 2)} NEAR with a ${plain(feeLast.farm.fee!)} NEAR fee per coin. The same coins without each other lose ${nearText(-byStrategy[3]!.result.profit(DAYS), 2)} NEAR.`,
    fixed.summary,
    `Stake size: ${leaders.length === 1 ? `${nameOf(a, leaders[0]!)} leads at every stake from ${sweep[0]!.bps / 100}% to ${sweep.at(-1)!.bps / 100}%` : `the leader changes with the stake (${list(leaders.map((id) => nameOf(a, id)))})`}. A bigger stake mostly gets the losers benched sooner (first bench on day ${firstBenchDay(sweep.at(-1)!.season)} at ${sweep.at(-1)!.bps / 100}%, day ${firstBenchDay(sweep[0]!.season) ?? "never"} at ${sweep[0]!.bps / 100}%).`,
  ];

  out(
    "# PARLEY simulation",
    "",
    "`bun run sim` plays the arena's money rules for 60 days under seven scenarios and a stake sweep, and writes this page and the charts in `docs/sim/`. It needs no keys and no network, uses fixed seeds, and gives the same numbers on every run. `bun run sim -- --check` compares the same math with the last 50 settled matches on `parley-live.testnet`.",
    "",
    "**This simulation models strategies, not the language model.** Each constitution is replaced by a small function that always makes the move the constitution prescribes. Real coins are run by models that talk, read each other and sometimes slip (in the recorded league, 166 of 168 decisions followed the constitution). Here nobody is persuaded by talk and nobody slips.",
    "",
    "## In short",
    "",
    ...summary.map((s) => `- ${s}`),
    "",
    "## Setup",
    "",
    table(
      ["Setting", "Value", "Where it comes from"],
      [
        ["Stake", `${LIVE_RULES.stake_bps / 100}% of the smaller treasury`, "`stake_bps` on parley-live.testnet"],
        ["Minimum treasury", `${nearText(LIVE_RULES.min_treasury, 1)} NEAR; below it a coin is never drawn (benched)`, "`min_treasury`"],
        ["Launch fee", `${nearText(LIVE_RULES.creation_fee, 1)} NEAR, paid into the pot`, "`creation_fee`"],
        ["Pot at deploy", `${plain(LIVE_COMMONS)} NEAR, plus every launch fee`, "the init deposit in `scripts/deploy-testnet.ts`"],
        ["Coins", "2 NEAR treasury each, one share per yoctoNEAR, so every price starts at 1.000", "the house launches on testnet"],
        ["Rest and pair rest", `${seconds(LIVE_RULES.rest_ns)} s and ${seconds(LIVE_RULES.pair_rest_ns)} s`, "`rest_ns`, `pair_rest_ns`"],
        ["Order timeout", `${seconds(LIVE_RULES.order_timeout_ns)} s`, "`order_timeout_ns`"],
        ["One day", `${MATCHES_PER_DAY} matches: one match at a time, about ${MATCH_SECONDS / 60} minutes each, then a ${PAUSE_SECONDS} s pause`, "the live arena's pace"],
        ["Season", `${DAYS} days, ${DAYS * MATCHES_PER_DAY} matches`, ""],
      ],
    ),
    "",
    "Pairing is `open_parley` ported line by line: the rested coin that has waited longest goes first and meets the rested coin it has gone longest without meeting, with ties broken by how long that coin has waited and then by id. At this pace every coin is always rested and every pair has always waited out the pair rest, so the rule reduces to that line. Left out: challenge matches the owner schedules on request, matches that time out, and models without a working enclave key.",
    "",
    "Share orders are forward priced as `fill_order` does it: an order is due after the coin's next match or after the order timeout, and fills at the price at that moment. The simulation fills due orders at every match boundary, as the live server does.",
    "",
    "Moves come from these strategies. A strategy sees what the contract's prompt shows: both coins' public records and the last eight meetings between the two.",
    "",
    table(
      ["Strategy", "Move"],
      [
        ["always trust", "trust"],
        ["always betray", "betray"],
        ["tit for tat", "trust first, then copy the other coin's last move against it"],
        ["betray first, then tit for tat", "betray at a first meeting, then copy"],
        ["win-stay, lose-shift", "trust first; repeat its own last move if the other coin trusted, switch if it betrayed"],
        ["betray forever after one betrayal (pair history)", "betray if the other coin betrayed it in any of the last eight meetings"],
        ["forgive once", "betray only if the other coin betrayed it in both of the last two meetings"],
        ["coin flip on the nonce", "trust if the last hex digit of the match nonce is 0 to 7"],
        ["betray backstabbers (public record)", "betray if the other coin's record shows it ever betrayed a trusting coin"],
        ["trust own coins, else betray backstabbers", "trust coins with the same owner, else as above"],
        ["trust own coins, betray all others", "trust coins with the same owner, betray every other coin"],
      ],
    ),
    "",
    "The house constitutions map to strategies like this:",
    "",
    table(
      ["Coin", "Constitution (first sentence)", "Strategy"],
      constitutions.map((x) => [x.name, x.text.split(". ")[0]!.replace(/\.$/, ""), x.strategy.label]),
    ),
    "",
    "### Ported math",
    "",
    "The money rules live in `packages/sdk/src/economy.ts`, in BigInt yoctoNEAR with the contract's rounding. `packages/sdk/test/economy.test.ts` pins them to the contract's own Rust tests and to matches recorded on chain; `scripts/sim/sim.test.ts` pins the pairing.",
    "",
    table(
      ["TypeScript", "Contract"],
      [
        ["`mulDiv`, `bps`", "`math.rs` `mul_div`, `bps`"],
        ["`stakeFor`", "`parleys.rs` `start_parley`"],
        ["`payoff`, `signed`", "`parleys.rs` `settle`, `signed`"],
        ["`launch`", "`coins.rs` `create_coin`"],
        ["`fillMint`, `fillRedeem`", "`orders.rs` `fill_order`"],
        ["`SimArena.open`", "`parleys.rs` `open_parley`"],
        ["`SimArena.settle`", "`parleys.rs` `settle` (stats, pair history of eight, rest times)"],
      ],
    ),
    "",
    "Every match also checks that coins plus pot plus escrow equals everything paid in minus everything paid out.",
    "",
  );

  charts["house.svg"] = lineChart({
    title: "The eight house coins",
    subtitle: "Share price over 60 days, live rules",
    unit: "price",
    series: priceSeries(a),
    reference: { y: 1, label: "launch" },
  });
  out(
    "## (a) The eight house coins",
    "",
    "The eight constitutions in `constitutions/`, launched with 2 NEAR each into a 4.8 NEAR pot, as on testnet. SAINT keeps its first rule, \"Always cooperate\"; scenario (e) adds the amendment.",
    "",
    "![House coins](sim/house.svg)",
    "",
    tables(a),
    "",
    "What happened:",
    "",
    `- ${nameOf(a, top[0]!)} (${constitutions.find((x) => x.id === top[0])!.strategy.label}) finishes first at ${priceText(price(a, top[0]!))}, then ${list(top.slice(1, 3).map((id) => `${nameOf(a, id)} ${priceText(price(a, id))}`))}.`,
    `- ${list(aBenched.map((id) => `${nameOf(a, id)} (day ${firstBenched(a, one(id))})`))} are benched. A benched coin cannot play again unless someone buys shares.`,
    `- SNAKE gains early against coins that trust strangers, then every coin that remembers stops trusting it. ${snakeBenched === null ? `It ends at ${priceText(price(a, "snake"))}.` : `It falls below the minimum on day ${snakeBenched}.`}`,
    `- The pot pays the trust bonus and is refilled only when two coins betray each other. Once the betrayers are benched, the remaining coins only trust each other, the pot runs dry (below 0.01 NEAR from day ${aPotEmpty}), and${aFrozen === null ? " treasuries barely move after that." : ` from day ${aFrozen} no treasury moves at all.`}`,
    "",
  );

  charts["pot.svg"] = lineChart({
    title: "The pot",
    subtitle: "Commons in NEAR over 60 days",
    unit: "NEAR",
    series: [
      { label: "house coins", values: a.days.map((x) => toNear(x.commons)) },
      { label: "everyone trusts", values: b.days.map((x) => toNear(x.commons)) },
      { label: "SNAKE invasion", values: c.days.map((x) => toNear(x.commons)) },
    ],
  });
  out(
    "## (b) Everyone trusts",
    "",
    "Eight coins that always trust, 2 NEAR each, the same 4.8 NEAR pot.",
    "",
    "![Pot](sim/pot.svg)",
    "",
    tables(b),
    "",
    "What happened:",
    "",
    `- Each trusting match pays both coins the smaller of half the stake and an eighth of the pot. ${MATCHES_PER_DAY} matches a day empty the pot by day ${bPotEmpty}.`,
    `- Every coin gains about ${pctText(bGain)} and then stops. Nothing refills the pot, because nobody betrays.`,
    "- Trust by itself creates no value. The bonus is a share of the pot, and the pot only grows from launch fees and from coins that betray each other.",
    "",
  );

  charts["invasion.svg"] = lineChart({
    title: "SNAKE invasion",
    subtitle: `${INVADERS} always-betray coins arrive on day ${INVADE_DAY}`,
    unit: "price",
    series: priceSeries(c, ["VIPER"], vipers),
    markers: [{ x: INVADE_DAY, label: "invasion" }],
    reference: { y: 1, label: "launch" },
  });
  out(
    "## (c) SNAKE invasion",
    "",
    `The eight house coins as in (a). On day ${INVADE_DAY}, one account launches ${INVADERS} more coins (VIPER1 to VIPER${INVADERS}) that always betray, with 2 NEAR each.`,
    "",
    "![Invasion](sim/invasion.svg)",
    "",
    tables(c, ["VIPER"]),
    "",
    "What happened:",
    "",
    `- The invaders take stakes from coins that trust strangers, then meet retaliation and each other. Between them they lose ${nearText(viperLoss, 2)} of the ${plain(BigInt(INVADERS) * near(2))} NEAR they started with, and all are benched by day ${vipersBenchedDay}.`,
    `- Mutual betrayal pays into the pot, and the pot pays the coins that keep trusting each other. ${list(cGainers.map((id) => `${nameOf(c, id)} (${priceText(price(c, id))} against ${priceText(price(a, id))} in (a))`))} end higher than without the invasion.`,
    `- Coins that trust too easily pay for the invasion: ${list(cHouseBenched.map((id) => nameOf(c, id)))} end benched.`,
    "",
  );

  charts["reputation.svg"] = lineChart({
    title: "Reputation against liars",
    subtitle: "Average share price of six honest coins and six liars, three separate runs",
    unit: "price",
    series: d.flatMap(({ honest, season }) => [
      { label: SHORT[honest.id], values: season.days.map((x) => groupPrice(season, honest.id, x.day)) },
      { label: `liars vs ${SHORT[honest.id].split(" ")[0]}`, values: season.days.map((x) => groupPrice(season, "liar", x.day)) },
    ]),
    reference: { y: 1, label: "launch" },
  });
  out(
    "## (d) Reputation: does honesty pay?",
    "",
    "Six honest coins against six liars that always betray, 2 NEAR each. Three runs with the same seed, changing only what the honest coins do:",
    "",
    "- **public record grudgers** betray any coin whose public record shows it betrayed a trusting coin (the contract writes both records into every prompt);",
    "- **pair memory grudgers** betray a coin only after it betrayed them;",
    "- **always trust** coins never betray.",
    "",
    "![Reputation](sim/reputation.svg)",
    "",
    table(
      ["Honest coins", "Honest price, day 10", "Honest price, day 60", "Liar price, day 60", "Times honest coins were betrayed", "Liars all benched", "Pot, day 60"],
      d.map(({ honest, season }) => [
        honest.label,
        priceText(groupPrice(season, honest.id, 10)),
        priceText(groupPrice(season, honest.id)),
        priceText(groupPrice(season, "liar")),
        String(groupBetrayed(season, honest.id)),
        liarsBenchedDay(season) === null ? "never" : `day ${liarsBenchedDay(season)}`,
        nearText(season.days[DAYS]!.commons),
      ]),
    ),
    "",
    "Full tables for the public record run:",
    "",
    tables(dRecord, ["RECORD", "LIAR"]),
    "",
    "What happened:",
    "",
    `- Honesty with a memory pays. Both kinds of grudger end near ${priceText(groupPrice(dRecord, "record"))} and every liar is benched by day ${Math.max(liarsBenchedDay(dRecord) ?? 0, liarsBenchedDay(dMemory) ?? 0)}.`,
    `- The public record makes it cheaper. A liar's first betrayal is visible to every coin, so the record grudgers are betrayed ${groupBetrayed(dRecord, "record")} times in total; grudgers that only remember their own meetings must each be betrayed by each liar once, ${groupBetrayed(dMemory, "memory")} times in total.`,
    `- Honesty without memory does not pay. ${naiveBenched} of the 6 trusting coins are robbed until benched, then the liars bleed each other into the pot: ${naiveLiarsBenched} of them end benched${naiveLiarsBenched === 5 ? " and the last has nobody left to play" : ""}. ${nearText(dNaive.days[DAYS]!.commons, 2)} NEAR sits in a pot that no coin can win back.`,
    "",
  );

  const amend = amendment();
  charts["amendment.svg"] = lineChart({
    title: "SAINT amended on day 20",
    subtitle: "SAINT's share price with and without the real testnet amendment",
    unit: "price",
    series: [
      { label: "SAINT, unchanged", values: a.days.map((x) => x.coins.get("saint")!.price) },
      { label: "SAINT, amended", values: e.days.map((x) => x.coins.get("saint")!.price) },
    ],
    markers: [{ x: AMEND_DAY, label: "amendment" }],
    reference: { y: 1, label: "launch" },
  });
  out(
    "## (e) Governance mid-season",
    "",
    `The eight house coins as in (a). On day ${AMEND_DAY}, SAINT's holders replace "Always cooperate" with the amendment passed on testnet: "${amend.constitution.split(" In talk")[0]}" In the simulation that is the public record grudger.`,
    "",
    "![Amendment](sim/amendment.svg)",
    "",
    tables(e),
    "",
    "What happened:",
    "",
    `- SAINT ends at ${priceText(price(e, "saint"))} with the amendment and ${priceText(price(a, "saint"))} without it.`,
    `- The rule reads the lifetime record, and that record counts retaliation. By day ${AMEND_DAY}, ${list(amendedRivals.map((id) => nameOf(e, id)))} had each betrayed a trusting coin at least once: ${[
      ...Object.entries(WHY).filter(([id]) => amendedRivals.includes(id)).map(([id, why]) => `${nameOf(e, id)} ${why}`),
      ...(retaliators.length ? [`${list(retaliators.map((id) => nameOf(e, id)))} while answering a betrayal`] : []),
    ].join("; ")}. From day ${AMEND_DAY} SAINT trusted in ${saintAfter.trusted} of its ${saintAfter.played} matches.`,
    `- Betraying the coins that copy its moves turns SAINT's matches into mutual betrayals, which cost it half the stake each time. ${firstBenched(e, one("saint")) === null ? "" : `It is benched on day ${firstBenched(e, one("saint"))}.`}`,
    `- A rule that reads "betrayed a coin that trusted it" should say how far back to look, or whose betrayals count.`,
    "",
  );

  charts["whale.svg"] = lineChart({
    title: "A whale in MIRROR",
    subtitle: `MIRROR's share price with and without a ${plain(WHALE.buy)} NEAR buy on day ${WHALE.buyDay}, sold on day ${WHALE.sellDay}`,
    unit: "price",
    series: [
      { label: "MIRROR, no whale", values: a.days.map((x) => x.coins.get(WHALE.coin)!.price) },
      { label: "MIRROR, whale", values: f.days.map((x) => x.coins.get(WHALE.coin)!.price) },
    ],
    markers: [
      { x: WHALE.buyDay, label: "buy" },
      { x: WHALE.sellDay, label: "sell" },
    ],
    reference: { y: 1, label: "launch" },
  });
  out(
    "## (f) Whale",
    "",
    `The eight house coins as in (a). On day ${WHALE.buyDay} one account places a ${plain(WHALE.buy)} NEAR mint on MIRROR, ${(toNear(WHALE.buy) / toNear(treasuryOf(a, WHALE.coin, WHALE.buyDay))).toFixed(1)} times MIRROR's treasury that day. On day ${WHALE.sellDay} it redeems every share.`,
    "",
    "![Whale](sim/whale.svg)",
    "",
    table(
      ["", "NEAR", "Shares", "Price"],
      [
        [`Mint, day ${WHALE.buyDay}`, nearText(whaleMint.near), nearText(whaleMint.shares), priceText(Number((whaleMint.near * 1_000_000n) / whaleMint.shares) / 1e6)],
        [`Redeem, day ${WHALE.sellDay}`, nearText(whaleRedeem.near), nearText(whaleRedeem.shares), priceText(Number((whaleRedeem.near * 1_000_000n) / whaleRedeem.shares) / 1e6)],
        ["Whale's result", signedText(whaleProfit), "", pctText(Number(whaleProfit) / Number(whaleMint.near))],
      ],
    ),
    "",
    tables(f),
    "",
    "What happened:",
    "",
    `- MIRROR is not playing when the order is placed, so the mint fills at MIRROR's price once the ${seconds(LIVE_RULES.order_timeout_ns)} s order timeout has passed. The whale pays exactly what a share is worth and nobody's shares are diluted. It holds ${(Number(whaleStake) / 100).toFixed(1)}% of MIRROR.`,
    `- A stake is 2% of the smaller treasury, so a ${nearText(whaleDayAfterMint.treasury, 1)} NEAR MIRROR still puts only 2% of its opponent's treasury at risk. MIRROR's average stake was ${nearText(avgStake(a, WHALE.buyDay, WHALE.sellDay), 4)} NEAR without the whale and ${nearText(avgStake(f, WHALE.buyDay, WHALE.sellDay), 4)} NEAR with it. ${othersMoved.length === 0 ? "The other seven coins end exactly where they ended in (a)." : `Of the other seven coins, ${list(othersMoved.map((id) => nameOf(f, id)))} end differently from (a).`}`,
    `- The flip side: the whale's NEAR mostly sits idle, so MIRROR's gains are spread over many more shares. MIRROR's price on day ${WHALE.sellDay} is ${priceText(price(f, WHALE.coin, WHALE.sellDay))} with the whale and ${priceText(price(a, WHALE.coin, WHALE.sellDay))} without it. The original holders keep everything they had; they just earn less while the whale is in.`,
    `- Limit: with ${(Number(whaleStake) / 100).toFixed(0)}% of the shares the whale could pass an amendment alone (quorum is ${LIVE_GOVERNANCE.quorum_bps / 100}% of shares and yes must beat no). The timelock (${seconds(LIVE_GOVERNANCE.timelock_ns)} s on testnet) is longer than a vote period plus two order timeouts, so any holder who disagrees can redeem at full value before the new rule plays. A whale can change what a coin does; it cannot take the other holders' NEAR.`,
    "",
  );

  charts["sybil.svg"] = lineChart({
    title: "A farm of 10 coins with one owner",
    subtitle: "NEAR held by the farm, by the eight house coins and in the pot (the farm trusts its own coins, betrays all others)",
    unit: "NEAR",
    series: [
      { label: "farm (10 coins)", values: strongest.season.days.map((x) => toNear(strongest.value(x.day))) },
      { label: "house coins", values: strongest.season.days.map((x) => toNear(houseIds.reduce((s, id) => s + x.coins.get(id)!.treasury, 0n))) },
      { label: "pot", values: strongest.season.days.map((x) => toNear(x.commons)) },
    ],
    reference: { y: toNear(strongest.cost), label: "farm paid in" },
  });
  out(
    "## (g) Sybil: many small coins farming the pot",
    "",
    `One account launches many small coins next to the eight house coins and tries to come out ahead. Coins can recognise each other by name, so a constitution can say "trust FARM1 to FARM${probe.size}". The farm's result is what its coins could redeem on day 60 minus everything it paid in, launch fees included.`,
    "",
    `Which strategy makes a farm pay, ${probe.size} coins with ${nearText(probe.treasury, 1)} NEAR each:`,
    "",
    table(
      ["Farm coins play", "Paid in", "Result, day 10", "Result, day 60", "House coins benched", "Farm coins benched"],
      byStrategy.map(({ label, result }) => [label, nearText(result.cost, 2), signedText(result.profit(10), 2), signedText(result.profit(DAYS), 2), `${result.houseBenched} of 8`, `${result.farmBenched} of ${probe.size}`]),
    ),
    "",
    "![Sybil](sim/sybil.svg)",
    "",
    "Farm size, coins that trust each other and betray all others, live rules:",
    "",
    table(
      ["Coins", "Treasury each", "Paid in", "Result, day 10", "Result, day 60", "Farm coins benched"],
      bySize.map((r) => [String(r.farm.size), nearText(r.farm.treasury, 1), nearText(r.cost, 2), signedText(r.profit(10), 2), signedText(r.profit(DAYS), 2), `${r.farmBenched} of ${r.farm.size}`]),
    ),
    "",
    `Launch fee, ${probe.size} coins with ${nearText(probe.treasury, 1)} NEAR each (the house coins keep the 0.1 NEAR fee they paid):`,
    "",
    table(
      ["Fee per coin", "Paid in", "Result, day 10", "Result, day 60", "Breaks even"],
      byFee.map((r) => [plain(r.farm.fee!), nearText(r.cost, 2), signedText(r.profit(10), 2), signedText(r.profit(DAYS), 2), r.evenDay === null ? "never" : `day ${r.evenDay}`]),
    ),
    "",
    "Pair rest (how long two coins wait before they can meet again), coins with 0.6 NEAR each:",
    "",
    table(
      ["Pair rest", ...[5, 10, 20].map((n) => `${n} coins, day 60`)],
      RESTS.map((rest) => [rest < 3600 ? `${rest} s (live)` : rest < 86_400 ? `${rest / 3600} hours` : `${rest / 86_400} day${rest > 86_400 ? "s" : ""}`, ...byRest.filter((r) => r.rest === rest).map((r) => signedText(r.profit, 2))]),
    ),
    "",
    "What happened:",
    "",
    `- A farm pays when its coins trust each other. Betraying outsiders fills the pot through mutual betrayals and takes stakes from trusting coins; the farm's own coins meet each other often and win the pot back as trust bonuses. ${probe.size} such coins end ${signedText(strongest.profit(DAYS), 2)} NEAR up and bench ${strongest.houseBenched} of the 8 house coins. The same ${probe.size} coins with separate owners, which do not trust each other, end ${signedText(byStrategy[3]!.result.profit(DAYS), 2)}.`,
    `- Size: ${list(smallLosers.map(String))} coin farms lose money because they rarely meet each other. From ${smallestWinner} coins up the farm takes everything the other coins and the pot hold above the bench line, about ${nearText(strongest.profit(DAYS), 1)} NEAR here, and more coins only make it faster.`,
    `- Minimum treasury: coins launched at exactly ${nearText(LIVE_RULES.min_treasury, 1)} NEAR are benched by their first loss, which costs small farms their start (5 coins: ${signedText(sizeAt(5, LIVE_RULES.min_treasury).profit(DAYS), 2)} NEAR at ${nearText(LIVE_RULES.min_treasury, 1)} against ${signedText(sizeAt(5, probe.treasury).profit(DAYS), 2)} at ${nearText(probe.treasury, 1)}). ${nearText(probe.treasury - LIVE_RULES.min_treasury, 1)} NEAR of headroom per coin is enough to avoid it.`,
    `- Launch fee: it does not make the farm unprofitable. The fee goes into the pot, and the farm wins the pot. ${feeFlat ? `The day-60 result is ${signedText(feeLast.profit(DAYS), 2)} NEAR with no fee and with a ${plain(feeLast.farm.fee!)} NEAR fee per coin` : `Raising it from 0 to ${plain(feeLast.farm.fee!)} NEAR per coin moves the day-60 result from ${signedText(feeFirst.profit(DAYS), 2)} to ${signedText(feeLast.profit(DAYS), 2)} NEAR`}; the fee only delays break-even, from day ${feeFirst.evenDay} to day ${feeLast.evenDay}.`,
    `- Pair rest does not stop it either once the farm has enough pairs: with ${probe.size} coins, a ${RESTS.at(-2)! / 86_400}-day pair rest still leaves ${signedText(byRest.find((r) => r.rest === RESTS.at(-2) && r.size === probe.size)!.profit, 2)} NEAR.`,
    "- This is the sybil limit of the design: coins that agree to trust each other can drain a shared pot and the coins around them. The live contract has no defence against it beyond the coins' own constitutions; a coin whose rule ignores the public record is the easiest prey.",
    "",
  );

  out(...fixed.lines);
  Object.assign(charts, fixed.charts);

  out(
    "## Stake size sweep",
    "",
    "The eight house coins as in (a), with only the stake changed. The contract accepts 0.01% to 20%; testnet uses 2%.",
    "",
    table(
      ["Stake", "Pot, day 10", "First coin benched", "Benched by day 60", "SNAKE, day 60", "Best coin, day 60", "No treasury moves after"],
      sweep.map(({ bps, season }) => {
        const best = ranked(season, houseIds)[0]!;
        const frozen = frozenFrom(season);
        const first = firstBenchDay(season);
        return [
          `${bps / 100}%`,
          nearText(season.days[10]!.commons),
          first === null ? "never" : `day ${first}`,
          String(benchedAt(season).length),
          priceText(price(season, "snake")),
          `${nameOf(season, best)} ${priceText(price(season, best))}`,
          frozen === null ? "-" : `day ${frozen}`,
        ];
      }),
    ),
    "",
    "What happened:",
    "",
    `- ${leaders.length === 1 ? `${nameOf(a, leaders[0]!)} leads at every stake size.` : `The leader changes with the stake: ${list(leaders.map((id) => nameOf(a, id)))}.`} The stake mostly sets the speed.`,
    `- Benched by day 60: ${benchGroups.map(({ ids, stakes }) => `${ids.length ? list(ids.map((id) => nameOf(a, id))) : "none"} at ${list(stakes.map((x) => `${x / 100}%`))}`).join("; ")}.`,
    `- The pot on day 10 holds ${nearText(sweep[0]!.season.days[10]!.commons, 2)} NEAR at ${sweep[0]!.bps / 100}% and ${nearText(sweep.at(-1)!.season.days[10]!.commons, 2)} NEAR at ${sweep.at(-1)!.bps / 100}%: bigger stakes pay the trust bonus out faster.`,
    "",
    "## What the simulation leaves out",
    "",
    "- Language models. Real coins talk, can be persuaded and sometimes make the other move. The live arena's results therefore differ from scenario (a).",
    "- Player coins. The live arena has more than the eight house coins, so each coin plays less often than here.",
    "- Challenge matches scheduled by the owner, voided matches and enclave key changes.",
    "- Trading on the coins' share tokens outside the arena; only mint and redeem orders are modelled.",
    "",
  );

  return { markdown: md.join("\n"), charts, summary };
}

function firstBenchDay(season: Season): number | null {
  return season.days.find((d) => [...d.coins.values()].some((c) => c.benched))?.day ?? null;
}

export function writeReport(root: string): Report {
  const report = buildReport();
  const dir = join(root, "docs/sim");
  mkdirSync(dir, { recursive: true });
  for (const [file, svg] of Object.entries(report.charts)) writeFileSync(join(dir, file), svg);
  writeFileSync(join(root, "docs/SIM.md"), report.markdown);
  return report;
}
