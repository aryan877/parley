import type { Coin, Parley } from "./types.ts";

export interface DiffPart {
  kind: "same" | "added" | "removed";
  text: string;
}

const DENIAL = /\b(i (promise|pledge|swear|commit to|guarantee) (you )?(nothing|no\b)|(no|make no|making no) (promises?|pledges?)|(don't|do not|never) trust me)/gi;
const QUOTED = /"[^"]*"|“[^”]*”/g;
const WILL = /\bi(?: will|'ll| shall| am going to|'m going to| promise to| pledge to| swear to| commit to|'m committing to| am committing to| choose to| intend to| plan to)\s+(?:(?:keep|keep on|continue|continue to|still|also|gladly|happily|truly|really|absolutely|definitely|again|always|plainly|honestly|to)\s+){0,3}(?:cooperat|trust)/gi;
const NOW = /\bi(?:'m| am) cooperating\b|\bi cooperate\b/gi;
const PLEDGE = /\b(?:i've|i have) changed\b|\b(?:you have my word|i give you my word|trust me)\b/i;
const CONDITION = /\b(?:if|when|whenever|while|unless|until|as long as)\b/i;
const LATER = /\b(?:next|future|later|tomorrow|someday|as far as)\b/i;
const THIS_ROUND = /\b(?:this (?:round|parley|match|time)|now|today|regardless)\b/i;

const sentenceAround = (text: string, at: number) => {
  const start = Math.max(text.lastIndexOf(".", at - 1), text.lastIndexOf("!", at - 1), text.lastIndexOf("?", at - 1)) + 1;
  const ends = [".", "!", "?"].map((c) => text.indexOf(c, at)).filter((i) => i >= 0);
  return { before: text.slice(start, at), after: text.slice(at, ends.length ? Math.min(...ends) : text.length) };
};

/** A talk line that says, in the speaker's own voice, that it will trust this round. Denials ("I promise nothing"), quoted words, conditions ("when I cooperate") and later rounds ("I'll cooperate next time") do not count. */
export function promises(text: string): boolean {
  const said = text.replace(QUOTED, " ").replace(DENIAL, " ");
  if (PLEDGE.test(said)) return true;
  for (const re of [WILL, NOW]) {
    for (const m of said.matchAll(re)) {
      const { before, after } = sentenceAround(said, m.index);
      if (!CONDITION.test(before) && (!LATER.test(after) || THIS_ROUND.test(after))) return true;
    }
  }
  return false;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Word-level diff of two texts: the longest common subsequence of words stays, everything else is added or removed. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = words(before);
  const b = words(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const width = y.length + 1;
  const lcs = new Uint16Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * width + j] = x[i] === y[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], word: string) => {
    const last = out.at(-1);
    if (last?.kind === kind) last.text += ` ${word}`;
    else out.push({ kind, text: word });
  };
  for (const w of a.slice(0, head)) push("same", w);
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      push("same", x[i]!);
      i++;
      j++;
    } else if (i < x.length && (j === y.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
      push("removed", x[i++]!);
    } else {
      push("added", y[j++]!);
    }
  }
  for (const w of a.slice(a.length - tail)) push("same", w);
  return out;
}

export interface Betrayal {
  match: number;
  by: string;
  from: string;
  /** yoctoNEAR the betrayer gained. */
  amount: string;
}

export interface Streak {
  a: string;
  b: string;
  length: number;
  /** The last match of the streak. */
  last: number;
  going: boolean;
}

export interface LastWords {
  match: number;
  text: string;
  /** Nanoseconds, when that match opened. */
  at: string;
}

export interface Records {
  betrayal: Betrayal | null;
  streak: Streak | null;
  richest: { coin: string; treasury: string } | null;
  improved: { coin: string; pct: number } | null;
  /** Each coin's last talk line in its latest finished match. */
  last: Record<string, LastWords>;
  /** Finished matches the records were read from. */
  matches: number;
}

/** Percent change of a coin's share price since launch, when shares start at 1 NEAR each. Null without shares. */
export function sinceLaunchPct(coin: Pick<Coin, "treasury" | "total_shares">): number | null {
  const shares = BigInt(coin.total_shares);
  if (shares === 0n) return null;
  return Number(((BigInt(coin.treasury) - shares) * 1_000_000n) / shares) / 10_000;
}

/** Arena records from finished matches and the coins as they stand now. */
export function arenaRecords(parleys: Parley[], coins: Coin[]): Records {
  const done = parleys.filter((p) => p.status !== "Open").sort((x, y) => x.id - y.id);
  let betrayal: Betrayal | null = null;
  let streak: Streak | null = null;
  const runs = new Map<string, { run: number; latest: number }>();
  const last: Record<string, LastWords> = {};
  let matches = 0;
  for (const p of done) {
    for (const side of ["A", "B"] as const) {
      const said = p.turns.filter((t) => t.side === side && t.kind === "Talk").at(-1);
      if (said) last[side === "A" ? p.a : p.b] = { match: p.id, text: said.text, at: p.opened_at };
    }
    if (p.status !== "Settled" || !p.a_move || !p.b_move) continue;
    matches++;
    if (p.a_move !== p.b_move) {
      const [by, from, gain] = p.a_move === "Defect" ? [p.a, p.b, p.a_delta] : [p.b, p.a, p.b_delta];
      if (BigInt(gain) > 0n && (!betrayal || BigInt(gain) > BigInt(betrayal.amount))) betrayal = { match: p.id, by, from, amount: BigInt(gain).toString() };
    }
    const [a, b] = p.a < p.b ? [p.a, p.b] : [p.b, p.a];
    const key = `${a} ${b}`;
    const pair = runs.get(key) ?? { run: 0, latest: 0 };
    pair.run = p.a_move === "Cooperate" && p.b_move === "Cooperate" ? pair.run + 1 : 0;
    pair.latest = p.id;
    runs.set(key, pair);
    if (pair.run > 0 && (!streak || pair.run >= streak.length)) streak = { a, b, length: pair.run, last: p.id, going: true };
  }
  if (streak) {
    const pair = runs.get(`${streak.a} ${streak.b}`);
    streak.going = pair?.latest === streak.last;
  }
  let richest: Records["richest"] = null;
  let improved: Records["improved"] = null;
  for (const c of coins) {
    if (!richest || BigInt(c.treasury) > BigInt(richest.treasury)) richest = { coin: c.id, treasury: c.treasury };
    const pct = sinceLaunchPct(c);
    if (pct !== null && (!improved || pct > improved.pct)) improved = { coin: c.id, pct };
  }
  return { betrayal, streak, richest, improved, last, matches };
}

export interface RulesVersion {
  version: number;
  constitution: string;
  model: string;
  /** Nanoseconds, when it took effect: the launch for version 1, the enactment after that. */
  at: string | null;
  /** The creator for version 1, the proposer after that. */
  by: string | null;
  /** Shares for and against, as counted when the vote closed. */
  yes: string | null;
  no: string | null;
  /** The launch or enactment transaction. */
  tx: string | null;
  amendment: number | null;
}

export interface RulesHistory {
  coin: string;
  versions: RulesVersion[];
  /** Every version from 1 to the current one is known, each later one with its enactment. */
  complete: boolean;
}

export interface GovernanceFacts {
  created: { constitution: string; model: string; by: string; at: string; tx: string } | null;
  proposals: Record<number, { coin: string; constitution: string; model: string; proposer: string; tx: string }>;
  tallies: Record<number, { yes: string; no: string }>;
  enactments: { coin: string; id: number; version: number; at: string; tx: string }[];
}

/** Every version of a coin's constitution, oldest first, from the coin as it stands and what its transactions recorded. */
export function rulesHistory(coin: Coin, facts: GovernanceFacts): RulesHistory {
  const versions = new Map<number, RulesVersion>();
  if (facts.created) {
    const c = facts.created;
    versions.set(1, { version: 1, constitution: c.constitution, model: c.model, at: c.at, by: c.by, yes: null, no: null, tx: c.tx, amendment: null });
  }
  for (const e of facts.enactments) {
    const p = facts.proposals[e.id];
    if (e.coin !== coin.id || !p || e.version > coin.constitution_version) continue;
    const tally = facts.tallies[e.id];
    versions.set(e.version, { version: e.version, constitution: p.constitution, model: p.model, at: e.at, by: p.proposer, yes: tally?.yes ?? null, no: tally?.no ?? null, tx: e.tx, amendment: e.id });
  }
  const now = versions.get(coin.constitution_version);
  if (!now || now.constitution !== coin.constitution) {
    versions.set(coin.constitution_version, {
      version: coin.constitution_version,
      constitution: coin.constitution,
      model: coin.model,
      at: coin.constitution_version === 1 ? coin.created_at : null,
      by: coin.constitution_version === 1 ? coin.creator : null,
      yes: null,
      no: null,
      tx: null,
      amendment: null,
    });
  }
  const list = [...versions.values()].sort((x, y) => x.version - y.version);
  return { coin: coin.id, versions: list, complete: list.length === coin.constitution_version && list.every((v) => v.version === 1 || v.tx !== null) };
}
