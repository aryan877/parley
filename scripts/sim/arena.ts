import { type Economics, type Move, type Stats, fillMint, fillRedeem, launch, payoff, stakeFor } from "@parley/sdk";
import { type Random, nonce } from "./random.ts";
import type { Seen, Strategy } from "./strategies.ts";

export interface Rules extends Economics {
  rest_ns: bigint;
  pair_rest_ns: bigint;
  order_timeout_ns: bigint;
}

export interface SimCoin {
  id: string;
  name: string;
  creator: string;
  strategy: Strategy;
  version: number;
  treasury: bigint;
  shares: bigint;
  createdAt: bigint;
  idleSince: bigint;
  busy: boolean;
  matchesPlayed: number;
  stats: Stats;
  wins: number;
  benchEvents: number;
}

export interface Opened {
  a: string;
  b: string;
  stake: bigint;
  nonce: string;
  openedAt: bigint;
}

export interface Settled extends Opened {
  aMove: Move;
  bMove: Move;
  aDelta: bigint;
  bDelta: bigint;
  commonsDelta: bigint;
  settledAt: bigint;
}

interface Pair {
  outcomes: [Move, Move][];
  lastMet: bigint;
}

interface Order {
  coin: string;
  account: string;
  kind: "Mint" | "Redeem";
  amount: bigint;
  minOut: bigint;
  placedAt: bigint;
  epoch: number;
}

export type Fill =
  | { coin: string; account: string; kind: "Mint"; near: bigint; shares: bigint }
  | { coin: string; account: string; kind: "Redeem"; near: bigint; shares: bigint }
  | { coin: string; account: string; kind: "Returned" };

const HISTORY_LEN = 8;
const FIRST_TRIES = 4;

const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
const minus = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const order = (x: bigint, y: bigint) => (x < y ? -1 : x > y ? 1 : 0);
const text = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

interface Partner {
  lastMet: bigint;
  coin: SimCoin;
}

const rank = (x: Partner, y: Partner) => order(x.lastMet, y.lastMet) || order(x.coin.idleSince, y.coin.idleSince) || text(x.coin.id, y.coin.id);

export class SimArena {
  readonly coins = new Map<string, SimCoin>();
  private readonly pairs = new Map<string, Pair>();
  private readonly holders = new Map<string, Map<string, bigint>>();
  private orders: Order[] = [];
  commons: bigint;
  escrow = 0n;
  paidIn: bigint;
  paidOut = 0n;

  constructor(
    readonly rules: Rules,
    commons: bigint,
    private readonly random: Random,
  ) {
    this.commons = commons;
    this.paidIn = commons;
  }

  launch(creator: string, id: string, name: string, strategy: Strategy, deposit: bigint, now: bigint, fee = this.rules.creation_fee): SimCoin {
    if (this.coins.has(id)) throw new Error(`coin id taken: ${id}`);
    const made = launch({ min_treasury: this.rules.min_treasury, creation_fee: fee }, deposit);
    const coin: SimCoin = {
      id,
      name,
      creator,
      strategy,
      version: 1,
      treasury: made.treasury,
      shares: made.shares,
      createdAt: now,
      idleSince: now,
      busy: false,
      matchesPlayed: 0,
      stats: { matches: 0, cooperated: 0, defected: 0, was_betrayed: 0, betrayed_other: 0 },
      wins: 0,
      benchEvents: 0,
    };
    this.coins.set(id, coin);
    this.holders.set(id, new Map([[creator, made.shares]]));
    this.commons += made.fee;
    this.paidIn += deposit;
    return coin;
  }

  coin(id: string): SimCoin {
    const coin = this.coins.get(id);
    if (!coin) throw new Error(`no such coin: ${id}`);
    return coin;
  }

  amend(id: string, strategy: Strategy) {
    const coin = this.coin(id);
    if (coin.busy) throw new Error("coin is in a Parley");
    coin.strategy = strategy;
    coin.version += 1;
  }

  sharesOf(coin: string, account: string): bigint {
    return this.holders.get(coin)?.get(account) ?? 0n;
  }

  value(): bigint {
    let sum = this.commons + this.escrow;
    for (const coin of this.coins.values()) sum += coin.treasury;
    return sum;
  }

  open(now: bigint, between?: [string, string]): Opened | null {
    if (between) return this.start(this.coin(between[0]), this.coin(between[1]), now);
    const restedBy = minus(now, this.rules.rest_ns);
    const apartBy = minus(now, this.rules.pair_rest_ns);
    const rested = [...this.coins.values()]
      .filter((c) => !c.busy && c.treasury >= this.rules.min_treasury && c.idleSince <= restedBy)
      .sort((x, y) => order(x.idleSince, y.idleSince) || text(x.id, y.id));
    for (const first of rested.slice(0, FIRST_TRIES)) {
      let best: Partner | null = null;
      for (const coin of rested) {
        if (coin.id === first.id) continue;
        const together = max(first.createdAt, coin.createdAt);
        const lastMet = max(this.pairs.get(pairKey(first.id, coin.id))?.lastMet ?? 0n, together);
        if (lastMet > apartBy) continue;
        const candidate = { lastMet, coin };
        if (!best || rank(candidate, best) < 0) best = candidate;
      }
      if (best) return this.start(first, best.coin, now);
    }
    return null;
  }

  private start(a: SimCoin, b: SimCoin, now: bigint): Opened {
    if (a.busy || b.busy) throw new Error("coin is already in a Parley");
    if (a.treasury < this.rules.min_treasury || b.treasury < this.rules.min_treasury) throw new Error("treasury below min_treasury");
    a.busy = true;
    b.busy = true;
    return { a: a.id, b: b.id, stake: stakeFor(this.rules, a.treasury, b.treasury), nonce: nonce(this.random), openedAt: now };
  }

  decide(opened: Opened): [Move, Move] {
    const a = this.coin(opened.a);
    const b = this.coin(opened.b);
    return [a.strategy.decide(this.seen(a, b, opened.nonce)), b.strategy.decide(this.seen(b, a, opened.nonce))];
  }

  private seen(me: SimCoin, them: SimCoin, parleyNonce: string): Seen {
    const low = me.id < them.id;
    const outcomes = this.pairs.get(pairKey(me.id, them.id))?.outcomes ?? [];
    return {
      me: { id: me.id, creator: me.creator, record: { ...me.stats } },
      them: { id: them.id, creator: them.creator, record: { ...them.stats } },
      history: outcomes.map(([l, h]) => (low ? { mine: l, theirs: h } : { mine: h, theirs: l })),
      nonce: parleyNonce,
    };
  }

  settle(opened: Opened, aMove: Move, bMove: Move, now: bigint): Settled {
    const a = this.coin(opened.a);
    const b = this.coin(opened.b);
    const delta = payoff(opened.stake, this.commons, aMove, bMove);
    this.setTreasury(a, a.treasury + delta.a);
    this.setTreasury(b, b.treasury + delta.b);
    this.commons += delta.commons;
    for (const [coin, mine, theirs, gain] of [
      [a, aMove, bMove, delta.a],
      [b, bMove, aMove, delta.b],
    ] as const) {
      coin.busy = false;
      coin.idleSince = now;
      coin.matchesPlayed += 1;
      coin.stats.matches += 1;
      if (mine === "Cooperate") coin.stats.cooperated += 1;
      else coin.stats.defected += 1;
      if (mine === "Cooperate" && theirs === "Defect") coin.stats.was_betrayed += 1;
      if (mine === "Defect" && theirs === "Cooperate") coin.stats.betrayed_other += 1;
      if (gain > 0n) coin.wins += 1;
    }
    const key = pairKey(a.id, b.id);
    const pair = this.pairs.get(key) ?? { outcomes: [], lastMet: 0n };
    pair.outcomes.push(a.id < b.id ? [aMove, bMove] : [bMove, aMove]);
    if (pair.outcomes.length > HISTORY_LEN) pair.outcomes.shift();
    pair.lastMet = now;
    this.pairs.set(key, pair);
    return { ...opened, aMove, bMove, aDelta: delta.a, bDelta: delta.b, commonsDelta: delta.commons, settledAt: now };
  }

  placeMint(account: string, coin: string, amount: bigint, now: bigint, minShares = 0n) {
    if (amount <= 0n) throw new Error("attach NEAR to mint");
    this.place({ coin, account, kind: "Mint", amount, minOut: minShares, placedAt: now, epoch: this.coin(coin).matchesPlayed });
    this.escrow += amount;
    this.paidIn += amount;
  }

  placeRedeem(account: string, coin: string, shares: bigint, now: bigint, minNear = 0n) {
    const balance = this.sharesOf(coin, account);
    if (shares <= 0n || shares > balance) throw new Error("not enough free shares");
    this.setShares(coin, account, balance - shares);
    this.place({ coin, account, kind: "Redeem", amount: shares, minOut: minNear, placedAt: now, epoch: this.coin(coin).matchesPlayed });
  }

  private place(o: Order) {
    if (this.orders.some((x) => x.coin === o.coin && x.account === o.account)) throw new Error("you already have an open order on this coin");
    this.orders.push(o);
  }

  fill(now: bigint): Fill[] {
    const done: Fill[] = [];
    const waiting: Order[] = [];
    for (const o of this.orders) {
      const c = this.coin(o.coin);
      const due = c.matchesPlayed > o.epoch || now >= o.placedAt + this.rules.order_timeout_ns;
      if (c.busy || !due) waiting.push(o);
      else done.push(this.fillOne(c, o, now));
    }
    this.orders = waiting;
    return done;
  }

  private fillOne(c: SimCoin, o: Order, now: bigint): Fill {
    if (o.kind === "Mint") {
      const r = fillMint(this.rules, c, o.amount, o.minOut);
      this.escrow -= o.amount;
      if (!r.filled) {
        this.paidIn -= o.amount;
        return { coin: o.coin, account: o.account, kind: "Returned" };
      }
      if (r.requeued) c.idleSince = now;
      c.treasury = r.treasury;
      c.shares = r.shares;
      this.setShares(o.coin, o.account, this.sharesOf(o.coin, o.account) + r.minted);
      return { coin: o.coin, account: o.account, kind: "Mint", near: o.amount, shares: r.minted };
    }
    const r = fillRedeem(c, o.amount, o.minOut);
    if (!r.filled) {
      this.setShares(o.coin, o.account, this.sharesOf(o.coin, o.account) + o.amount);
      return { coin: o.coin, account: o.account, kind: "Returned" };
    }
    if (r.kept > 0n) this.setShares(o.coin, o.account, this.sharesOf(o.coin, o.account) + r.kept);
    this.setTreasury(c, r.treasury);
    c.shares = r.shares;
    this.paidOut += r.payout;
    return { coin: o.coin, account: o.account, kind: "Redeem", near: r.payout, shares: r.sold };
  }

  private setShares(coin: string, account: string, amount: bigint) {
    const book = this.holders.get(coin) ?? new Map<string, bigint>();
    if (amount === 0n) book.delete(account);
    else book.set(account, amount);
    this.holders.set(coin, book);
  }

  private setTreasury(coin: SimCoin, treasury: bigint) {
    if (coin.treasury >= this.rules.min_treasury && treasury < this.rules.min_treasury) coin.benchEvents += 1;
    coin.treasury = treasury;
  }
}
