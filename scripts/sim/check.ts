import { type Coin, type Config, NETWORKS, type Overview, type Parley, formatNear, payoff, sharePrice, signed, stakeFor } from "@parley/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { houseConstitutions } from "./scenarios.ts";
import { LIVE_COMMONS, LIVE_GOVERNANCE, LIVE_RULES, MATCH_SECONDS, PAUSE_SECONDS } from "./season.ts";

const ROOT = join(import.meta.dir, "../..");
const WANT = 50;

interface Deployment {
  contractId: string;
  rpcUrl: string;
  owner: string;
}

class Rpc {
  private next = 0;

  constructor(private readonly urls: string[]) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    let last = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const url = this.urls[this.next % this.urls.length]!;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "sim", method, params }),
          signal: AbortSignal.timeout(20_000),
        });
        const body = (await res.text()) || "";
        if (res.status === 429 || res.status >= 500 || /rate limit|too many requests/i.test(body)) {
          last = `${url}: ${res.status} ${body.slice(0, 120)}`;
          this.next += 1;
          await Bun.sleep(Math.min(16_000, 500 * 2 ** attempt));
          continue;
        }
        const json = JSON.parse(body) as { result?: T & { error?: string }; error?: { message?: string; data?: unknown } };
        if (json.error) throw new Error(`${method}: ${json.error.message ?? ""} ${JSON.stringify(json.error.data ?? "")}`);
        if (json.result?.error) throw new Error(`${method}: ${json.result.error}`);
        return json.result as T;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`${method}:`)) throw error;
        last = `${url}: ${error instanceof Error ? error.message : String(error)}`;
        this.next += 1;
        await Bun.sleep(Math.min(16_000, 500 * 2 ** attempt));
      }
    }
    throw new Error(`no RPC answered: ${last}`);
  }

  async view<T>(contractId: string, method: string, args: Record<string, unknown>, block: number): Promise<T> {
    const result = await this.call<{ result: number[] }>("query", {
      request_type: "call_function",
      block_id: block,
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    return JSON.parse(Buffer.from(result.result).toString("utf8")) as T;
  }
}

const near = (y: bigint, digits = 5) => formatNear(y, digits);
const delta = (y: bigint) => `${y >= 0n ? "+" : ""}${formatNear(y, 5)}`;
const move = (m: Parley["a_move"]) => (m === "Cooperate" ? "trust" : m === "Defect" ? "betray" : "-");
const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

function configDiffs(config: Config): string[] {
  const want: Record<string, string> = {
    stake_bps: String(LIVE_RULES.stake_bps),
    min_treasury: LIVE_RULES.min_treasury.toString(),
    creation_fee: LIVE_RULES.creation_fee.toString(),
    rest_ns: LIVE_RULES.rest_ns.toString(),
    pair_rest_ns: LIVE_RULES.pair_rest_ns.toString(),
    order_timeout_ns: LIVE_RULES.order_timeout_ns.toString(),
    quorum_bps: String(LIVE_GOVERNANCE.quorum_bps),
    proposer_bps: String(LIVE_GOVERNANCE.proposer_bps),
    vote_period_ns: LIVE_GOVERNANCE.vote_period_ns.toString(),
    timelock_ns: LIVE_GOVERNANCE.timelock_ns.toString(),
  };
  return Object.entries(want)
    .filter(([key, value]) => String((config as unknown as Record<string, unknown>)[key]) !== value)
    .map(([key, value]) => `${key} is ${(config as unknown as Record<string, unknown>)[key]} on chain, ${value} in the simulation`);
}

export async function check(): Promise<boolean> {
  const deployment = JSON.parse(readFileSync(join(ROOT, "deployments/testnet.json"), "utf8")) as Deployment;
  const urls = [...new Set([process.env.PARLEY_RPC_URL, deployment.rpcUrl, "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com", NETWORKS.testnet.rpcUrl].filter((u): u is string => !!u))];
  const rpc = new Rpc(urls);
  const id = deployment.contractId;
  const head = await rpc.call<{ header: { height: number; timestamp_nanosec: string } }>("block", { finality: "final" });
  const block = head.header.height;
  const view = <T>(method: string, args: Record<string, unknown> = {}) => rpc.view<T>(id, method, args, block);

  const [config, overview] = await Promise.all([view<Config>("get_config"), view<Overview>("get_overview")]);
  const coins: Coin[] = [];
  for (let from = 0; ; from += 100) {
    const page = await view<Coin[]>("get_coins", { from_index: from, limit: 100 });
    coins.push(...page);
    if (page.length < 100) break;
  }
  const parleys: Parley[] = [];
  for (let from = 0; from < overview.parleys; from += 50) {
    parleys.push(...(await view<Parley[]>("get_parleys", { from_index: from, limit: 50 })));
  }

  console.log(`${id} at block ${block}: ${overview.parleys} Parleys, ${coins.length} coins, pot ${near(BigInt(overview.commons), 3)} NEAR`);
  const diffs = configDiffs(config);
  console.log(diffs.length ? `config differs from the simulation: ${diffs.join("; ")}` : "config: the same rules the simulation uses");
  console.log("");

  const names = new Map(coins.map((c) => [c.id, c.name]));
  const treasury = new Map(coins.map((c) => [c.id, BigInt(c.treasury)]));
  const fee = BigInt(config.creation_fee);
  let commonsAfter = BigInt(overview.commons);
  let pass = 0;
  let fail = 0;
  let stakesRebuilt = 0;
  const outcomes = new Map<string, number>();
  const checked: Parley[] = [];

  for (const p of parleys) {
    if (p.status !== "Settled") continue;
    const opened = BigInt(p.opened_at);
    const laterFees = fee * BigInt(coins.filter((c) => !c.house && BigInt(c.created_at) > opened).length);
    const recorded = { a: BigInt(p.a_delta), b: BigInt(p.b_delta), commons: BigInt(p.commons_delta) };
    const after = { a: treasury.get(p.a)!, b: treasury.get(p.b)! };
    const before = { a: after.a - recorded.a, b: after.b - recorded.b };
    treasury.set(p.a, before.a);
    treasury.set(p.b, before.b);
    const settledAt = commonsAfter - laterFees;
    const commonsBefore = settledAt - recorded.commons;
    commonsAfter -= recorded.commons;
    if (checked.length >= WANT) continue;
    checked.push(p);

    const stake = BigInt(p.stake);
    const want = payoff(stake, commonsBefore, p.a_move!, p.b_move!);
    const ok = signed(want.a) === p.a_delta && signed(want.b) === p.b_delta && signed(want.commons) === p.commons_delta;
    const rebuilt = stakeFor(config, before.a, before.b);
    const stakeNote =
      rebuilt === stake
        ? `stake = ${config.stake_bps / 100}% of ${near(before.a < before.b ? before.a : before.b)}`
        : "stake not rebuilt: a share order moved a treasury after this match";
    if (rebuilt === stake) stakesRebuilt += 1;
    const kind = `${move(p.a_move)}/${move(p.b_move)}`;
    outcomes.set(kind, (outcomes.get(kind) ?? 0) + 1);
    const pair = `${names.get(p.a) ?? p.a} / ${names.get(p.b) ?? p.b}`;
    const moved = `${delta(want.a)} ${delta(want.b)} pot ${delta(want.commons)}`;
    if (ok) {
      pass += 1;
      console.log(`PASS #${lpad(String(p.id), 4)}  ${pad(pair, 34)} ${pad(kind, 13)} stake ${near(stake)}  ${moved}  ${stakeNote}`);
    } else {
      fail += 1;
      console.log(`FAIL #${lpad(String(p.id), 4)}  ${pad(pair, 34)} ${pad(kind, 13)} stake ${near(stake)}  recomputed ${signed(want.a)} ${signed(want.b)} ${signed(want.commons)}, recorded ${p.a_delta} ${p.b_delta} ${p.commons_delta}`);
    }
  }

  const launched = coins.filter((c) => !c.house).length;
  const seed = commonsAfter - fee * BigInt(launched);
  const starts = checked.map((p) => Number(BigInt(p.opened_at) / 1_000_000_000n));
  const median = (list: number[]) => {
    const gaps = list.slice(0, -1).map((t, i) => t - list[i + 1]!).sort((x, y) => x - y);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
  };

  console.log("");
  console.log(`${pass} of ${checked.length} settled matches recompute exactly: both treasury changes and the pot change, to the yoctoNEAR.`);
  if (fail) console.log(`${fail} do not.`);
  console.log(`Outcomes: ${[...outcomes].map(([k, n]) => `${n} ${k}`).join(", ")}.`);
  console.log(
    `Stakes: ${stakesRebuilt} of ${checked.length} equal ${config.stake_bps / 100}% of the smaller treasury, rebuilt by walking back from today's treasuries through every later settlement. The Parley record stores the stake but not the treasuries, so a share order that filled in between breaks the walk for that coin.`,
  );
  console.log(
    `Pot: walking back through all ${parleys.filter((p) => p.status === "Settled").length} settlements and ${launched} launch fees gives ${near(seed, 3)} NEAR at deploy; the simulation starts from ${near(LIVE_COMMONS, 3)}.`,
  );
  console.log(
    `Pace: a match started every ${median(starts.slice(0, 11))} s over the latest 10 and every ${median(starts)} s over these ${checked.length} (medians); the simulation assumes ${MATCH_SECONDS + PAUSE_SECONDS} s.`,
  );

  const house = new Set(houseConstitutions().map((c) => c.id));
  const priceOf = (c: Coin) => sharePrice({ treasury: BigInt(c.treasury), shares: BigInt(c.total_shares) });
  const isHouse = (c: Coin) => house.has(c.id) && c.creator === deployment.owner;
  const listed = [...coins].sort((x, y) => Number(isHouse(y)) - Number(isHouse(x)) || priceOf(y) - priceOf(x));
  console.log("");
  console.log("Live share prices (treasury divided by shares; every coin launched at 1.000):");
  console.log(`${pad("coin", 18)}${lpad("rules", 6)}${lpad("treasury", 11)}${lpad("price", 8)}${lpad("since launch", 14)}${lpad("matches", 9)}${lpad("trusted", 9)}`);
  for (const c of listed) {
    const t = BigInt(c.treasury);
    const p = priceOf(c);
    const since = Number.isFinite(p) ? `${p >= 1 ? "+" : ""}${((p - 1) * 100).toFixed(1)}%` : "no shares";
    const trusted = c.stats.matches ? `${Math.round((100 * c.stats.cooperated) / c.stats.matches)}%` : "-";
    const label = `${c.name}${isHouse(c) ? "" : " *"}`;
    console.log(`${pad(label, 18)}${lpad(`v${c.constitution_version}`, 6)}${lpad(near(t, 3), 11)}${lpad(Number.isFinite(p) ? p.toFixed(3) : "-", 8)}${lpad(since, 14)}${lpad(String(c.stats.matches), 9)}${lpad(trusted, 9)}`);
  }
  console.log("* launched by a player");
  return fail === 0 && checked.length > 0;
}
