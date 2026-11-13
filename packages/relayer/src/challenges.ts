import type { Coin } from "@parley/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const COIN_PER_DAY = 3;
export const IP_PER_DAY = 9;
export const MAX_QUEUE = 12;
const DAY_MS = 86_400_000;
const LAUNCH_MS = 3_600_000;

export interface Challenge {
  a: string;
  b: string;
  by: string;
  ip: string;
  at: number;
  /** A new coin's first challenges count toward its own limit, not its rivals'. */
  launch?: boolean;
  played?: boolean;
  since?: number;
}

export type Entrant = Pick<Coin, "id" | "name" | "created_at">;

/** Whether a coin has an amendment being voted on or waiting out its timelock. */
export type Held = (coin: string) => Promise<boolean>;

export interface Refusal {
  refusal: string;
  retryAt?: number;
}

export interface Booked {
  queued: Challenge[];
  /** Why the request, or the part of it left out, was refused. */
  refusal: string | null;
  retryAt?: number;
}

const heldText = (name: string): Refusal => ({ refusal: `${name} has a rule change in progress, so it can't be challenged until the vote and safety wait are over.` });

function soon(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "in a minute";
  if (minutes < 90) return `in ${minutes} minutes`;
  return `in about ${Math.round(minutes / 60)} hours`;
}

/** The challenge line plus the last day of challenges, kept on disk so limits survive a restart. */
export class Challenges {
  private list: Challenge[];

  constructor(
    private readonly file: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    const saved = file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Challenge>[]) : [];
    const at = now();
    this.list = saved.map((c) => ({ ...c, by: c.by ?? c.a, ip: c.ip ?? "?", at: c.at ?? at }) as Challenge);
  }

  get queue(): Challenge[] {
    return this.list.filter((c) => !c.played);
  }

  /** The queue in the order it will play: challenges waiting on a rule change go last. */
  line(held: (coin: string) => boolean): { a: string; b: string; held?: boolean }[] {
    const all = this.queue.map(({ a, b }) => (held(a) || held(b) ? { a, b, held: true } : { a, b }));
    return [...all.filter((c) => !c.held), ...all.filter((c) => c.held)];
  }

  async book(coin: Entrant, rivals: Entrant[], ip: string, held: Held): Promise<Booked> {
    const changing = await Promise.all([coin, ...rivals].map((c) => held(c.id)));
    const busy = new Set([coin, ...rivals].filter((_, i) => changing[i]).map((c) => c.id));
    const now = this.now();
    this.prune(now);
    if (this.queue.length + rivals.length > MAX_QUEUE) return { queued: [], refusal: "The arena is busy. Try again in a minute." };
    const launch = now - Number(BigInt(coin.created_at) / 1_000_000n) < LAUNCH_MS && !this.list.some((c) => c.by === coin.id);
    const refused = (busy.has(coin.id) ? heldText(coin.name) : null) ?? this.ipFull(ip) ?? this.coinFull(coin);
    if (refused) return { queued: [], ...refused };
    const queued: Challenge[] = [];
    let skipped: Refusal | null = null;
    for (const rival of rivals) {
      const full = this.ipFull(ip) ?? this.coinFull(coin);
      if (full) {
        skipped ??= full;
        break;
      }
      const problem = busy.has(rival.id) ? heldText(rival.name) : launch ? null : this.coinFull(rival);
      if (problem) {
        skipped ??= problem;
        continue;
      }
      const pair = queued.length % 2 === 0 ? { a: coin.id, b: rival.id } : { a: rival.id, b: coin.id };
      const challenge: Challenge = { ...pair, by: coin.id, ip, at: now, ...(launch ? { launch } : {}) };
      this.list.push(challenge);
      queued.push(challenge);
    }
    if (queued.length) this.save();
    return { queued, refusal: null, ...skipped };
  }

  /** The first queued challenge whose coins have no rule change in progress. From here on it counts as played. */
  async take(held: Held): Promise<Challenge | undefined> {
    this.prune(this.now());
    const asked = new Map<string, Promise<boolean>>();
    const busy = (coin: string) => asked.get(coin) ?? asked.set(coin, held(coin)).get(coin)!;
    for (const challenge of this.queue) {
      if ((await busy(challenge.a)) || (await busy(challenge.b))) continue;
      challenge.played = true;
      this.save();
      return challenge;
    }
    return undefined;
  }

  /** Puts a challenge that could not start back at the end of the line. */
  later(challenge: Challenge, since: number) {
    this.list = [...this.list.filter((c) => c !== challenge), { ...challenge, played: false, since }];
    this.save();
  }

  private counted(coin: string): Challenge[] {
    return this.list.filter((c) => (c.a === coin || c.b === coin) && (!c.launch || c.by === coin));
  }

  private full(entries: Challenge[], cap: number, text: (when: string) => string): Refusal | null {
    if (entries.length < cap) return null;
    const retryAt = entries.map((c) => c.at).sort((x, y) => x - y)[entries.length - cap]! + DAY_MS;
    return { refusal: text(soon(retryAt - this.now())), retryAt };
  }

  private coinFull(coin: Entrant): Refusal | null {
    return this.full(this.counted(coin.id), COIN_PER_DAY, (when) => `A coin gets ${COIN_PER_DAY} challenge matches a day, and ${coin.name} has used its ${COIN_PER_DAY}. It can be challenged again ${when}.`);
  }

  private ipFull(ip: string): Refusal | null {
    return this.full(
      this.list.filter((c) => c.ip === ip),
      IP_PER_DAY,
      (when) => `Each address can send ${IP_PER_DAY} challenge matches a day, and yours has sent ${IP_PER_DAY}. You can send more ${when}.`,
    );
  }

  private prune(now: number) {
    this.list = this.list.filter((c) => now - c.at < DAY_MS);
  }

  private save() {
    if (this.file) writeFileSync(this.file, JSON.stringify(this.list));
  }
}
