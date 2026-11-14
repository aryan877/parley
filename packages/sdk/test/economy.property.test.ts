import { describe, expect, test } from "bun:test";
import { MIN_SHARES, fillMint, fillRedeem, payoff, stakeFor } from "../src/economy.ts";
import type { Move } from "../src/types.ts";

/**
 * Properties of the money math that must hold for every input, checked on 10,000 seeded random cases each.
 * The functions are the TypeScript mirror of the contract (see economy.ts), pinned case by case in economy.test.ts.
 */
const CASES = 10_000;
const NEAR = 10n ** 24n;
const MOVES: Move[] = ["Cooperate", "Defect"];

function seeded(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const big = (lo: bigint, hi: bigint) => {
    const span = hi - lo + 1n;
    let r = 0n;
    for (let i = 0; i < 4; i++) r = (r << 32n) | BigInt(Math.floor(next() * 4294967296));
    return lo + (r % span);
  };
  const pick = <T>(xs: T[]) => xs[int(0, xs.length - 1)]!;
  return { int, big, pick };
}

describe("payoff, for every stake, pot and pair of moves", () => {
  test("play creates and destroys nothing: the two coins and the pot change by amounts that sum to zero", () => {
    const r = seeded(1);
    for (let i = 0; i < CASES; i++) {
      const d = payoff(r.big(0n, 1000n * NEAR), r.big(0n, 1000n * NEAR), r.pick(MOVES), r.pick(MOVES));
      expect(d.a + d.b + d.commons).toBe(0n);
    }
  });

  test("no coin loses more than the stake, and the pot never goes below zero", () => {
    const r = seeded(2);
    for (let i = 0; i < CASES; i++) {
      const stake = r.big(0n, 1000n * NEAR);
      const commons = r.big(0n, 1000n * NEAR);
      const d = payoff(stake, commons, r.pick(MOVES), r.pick(MOVES));
      expect(d.a >= -stake && d.b >= -stake).toBe(true);
      expect(commons + d.commons >= 0n).toBe(true);
    }
  });

  test("a trust bonus is at most half the stake and an eighth of the pot, paid equally to both", () => {
    const r = seeded(3);
    for (let i = 0; i < CASES; i++) {
      const stake = r.big(0n, 1000n * NEAR);
      const commons = r.big(0n, 1000n * NEAR);
      const d = payoff(stake, commons, "Cooperate", "Cooperate");
      expect(d.a).toBe(d.b);
      expect(d.a >= 0n && d.a <= stake / 2n && d.a <= commons / 8n).toBe(true);
    }
  });

  test("betraying a coin that trusts you takes exactly its stake, and mutual betrayal pays half of each stake into the pot", () => {
    const r = seeded(4);
    for (let i = 0; i < CASES; i++) {
      const stake = r.big(0n, 1000n * NEAR);
      const commons = r.big(0n, 1000n * NEAR);
      expect(payoff(stake, commons, "Defect", "Cooperate")).toEqual({ a: stake, b: -stake, commons: 0n });
      const both = payoff(stake, commons, "Defect", "Defect");
      expect(both.a).toBe(-(stake / 2n));
      expect(both.commons).toBe(2n * (stake / 2n));
    }
  });

  test("a stake is a share of the smaller treasury, so no match can take a treasury below zero", () => {
    const r = seeded(5);
    for (let i = 0; i < CASES; i++) {
      const a = r.big(0n, 1000n * NEAR);
      const b = r.big(0n, 1000n * NEAR);
      const stakeBps = r.int(1, 10_000);
      const stake = stakeFor({ stake_bps: stakeBps }, a, b);
      expect(stake <= (a < b ? a : b)).toBe(true);
      const d = payoff(stake, r.big(0n, 1000n * NEAR), r.pick(MOVES), r.pick(MOVES));
      expect(a + d.a >= 0n && b + d.b >= 0n).toBe(true);
    }
  });
});

describe("share orders, for every treasury, supply and order size", () => {
  const coin = (r: ReturnType<typeof seeded>) => {
    const shares = r.big(MIN_SHARES, 1000n * NEAR);
    return { treasury: r.big(1n, 1000n * NEAR), shares };
  };
  const notDiluted = (before: { treasury: bigint; shares: bigint }, after: { treasury: bigint; shares: bigint }) =>
    after.treasury * before.shares >= before.treasury * after.shares;

  test("buying in never lowers the share price for the holders already there", () => {
    const r = seeded(6);
    let filled = 0;
    for (let i = 0; i < CASES; i++) {
      const before = coin(r);
      const fill = fillMint({ min_treasury: NEAR }, before, r.big(1n, 100n * NEAR));
      if (!fill.filled) continue;
      filled++;
      expect(notDiluted(before, fill)).toBe(true);
    }
    expect(filled).toBeGreaterThan(CASES / 2);
  });

  test("selling out never lowers the share price for the holders who stay, and pays at most what the shares are worth", () => {
    const r = seeded(7);
    let filled = 0;
    for (let i = 0; i < CASES; i++) {
      const before = coin(r);
      const fill = fillRedeem(before, r.big(1n, before.shares));
      if (!fill.filled) continue;
      filled++;
      expect(fill.payout * before.shares <= fill.sold * before.treasury).toBe(true);
      expect(fill.treasury >= 0n).toBe(true);
      expect(fill.shares === 0n || fill.shares >= MIN_SHARES).toBe(true);
      if (fill.shares > 0n) expect(notDiluted(before, fill)).toBe(true);
    }
    expect(filled).toBeGreaterThan(CASES / 2);
  });

  test("buying in and selling straight back never returns more NEAR than was paid", () => {
    const r = seeded(8);
    for (let i = 0; i < CASES; i++) {
      const before = coin(r);
      const amount = r.big(1n, 100n * NEAR);
      const bought = fillMint({ min_treasury: NEAR }, before, amount);
      if (!bought.filled) continue;
      const sold = fillRedeem(bought, bought.minted);
      if (sold.filled) expect(sold.payout <= amount).toBe(true);
    }
  });
});
