import { describe, expect, test } from "bun:test";
import { MIN_SHARES, U128_MAX, bps, fillMint, fillRedeem, launch, mulDiv, payoff, signed, stakeFor, worth } from "../src/economy.ts";
import type { Move } from "../src/types.ts";

const NEAR = 10n ** 24n;
const RULES = { stake_bps: 200, min_treasury: NEAR, creation_fee: 0n };
const C: Move = "Cooperate";
const D: Move = "Defect";

describe("math.rs", () => {
  test("small_values", () => {
    expect(mulDiv(6n, 7n, 3n)).toBe(14n);
    expect(mulDiv(10n, 10n, 3n)).toBe(33n);
    expect(mulDiv(0n, U128_MAX, 5n)).toBe(0n);
  });

  test("wide_product", () => {
    const a = 5_000_000n * NEAR;
    const b = 3_000_000n * NEAR;
    const d = 7_000_000n * NEAR;
    const got = mulDiv(a, b, d);
    const expected = (a / 7n) * 3n;
    expect(got >= expected && got - expected < 10n).toBe(true);
    expect(mulDiv(U128_MAX, U128_MAX, U128_MAX)).toBe(U128_MAX);
    expect(mulDiv(U128_MAX, 2n, 4n)).toBe(U128_MAX / 2n);
  });

  test("matches_native_when_no_overflow", () => {
    for (const [a, b, d] of [
      [123456789n, 987654321n, 1000n],
      [1n << 60n, 1n << 60n, 12345n],
      [99n, 1n, 100n],
    ] as const) {
      expect(mulDiv(a, b, d)).toBe((a * b) / d);
    }
  });

  test("overflow and zero divisor panic as in Rust", () => {
    expect(() => mulDiv(U128_MAX, 2n, 1n)).toThrow("mul_div overflow");
    expect(() => mulDiv(1n, 1n, 0n)).toThrow("division by zero");
  });

  test("basis_points", () => {
    expect(bps(10_000n, 200)).toBe(200n);
    expect(bps(1n, 200)).toBe(0n);
  });
});

describe("parleys.rs settle, with the contract tests' 100 and 50 NEAR coins and a 40 NEAR commons", () => {
  const stake = stakeFor(RULES, 100n * NEAR, 50n * NEAR);
  const commons = 40n * NEAR;

  test("opening_freezes_both_coins_and_sets_the_stake", () => {
    expect(stake).toBe(NEAR);
  });

  test("both_cooperate_pays_a_bonus_from_the_commons", () => {
    expect(payoff(stake, commons, C, C)).toEqual({ a: NEAR / 2n, b: NEAR / 2n, commons: -NEAR });
    expect(signed(-NEAR)).toBe(`-${NEAR}`);
  });

  test("a_lone_defector_takes_the_stake and the_first_mover_can_defect_too", () => {
    expect(payoff(stake, commons, C, D)).toEqual({ a: -NEAR, b: NEAR, commons: 0n });
    expect(payoff(stake, commons, D, C)).toEqual({ a: NEAR, b: -NEAR, commons: 0n });
  });

  test("both_defect_pays_the_commons", () => {
    expect(payoff(stake, commons, D, D)).toEqual({ a: -NEAR / 2n, b: -NEAR / 2n, commons: NEAR });
  });

  test("an_empty_commons_pays_no_bonus", () => {
    expect(payoff(stake, 0n, C, C)).toEqual({ a: 0n, b: 0n, commons: 0n });
  });

  test("the bonus is capped at an eighth of the commons", () => {
    expect(payoff(stake, 2n * NEAR, C, C).a).toBe(NEAR / 4n);
  });

  test("it_is_a_true_prisoners_dilemma", () => {
    const temptation = payoff(stake, commons, D, C).a;
    const reward = payoff(stake, commons, C, C).a;
    const punishment = payoff(stake, commons, D, D).a;
    const sucker = payoff(stake, commons, C, D).a;
    expect(temptation > reward && reward > punishment && punishment > sucker).toBe(true);
    expect(2n * reward > temptation + sucker).toBe(true);
  });

  test("value_is_conserved for odd stakes and every outcome", () => {
    for (const s of [0n, 1n, 7n, 21341621618748045666977n])
      for (const pot of [0n, 9n, 3n * NEAR])
        for (const a of [C, D])
          for (const b of [C, D]) {
            const p = payoff(s, pot, a, b);
            expect(p.a + p.b + p.commons).toBe(0n);
            expect(pot + p.commons >= 0n).toBe(true);
          }
  });

  test("signed writes a plus sign for zero and gains", () => {
    expect(signed(0n)).toBe("+0");
    expect(signed(5n)).toBe("+5");
  });
});

describe("matches recorded on parley-live.testnet", () => {
  const pot = 3n * NEAR;
  const recorded: [string, Move, Move, string, string, string][] = [
    ["21341621618748045666976", D, D, "-10670810809374022833488", "-10670810809374022833488", "+21341621618748045666976"],
    ["18061275079454117603027", D, D, "-9030637539727058801513", "-9030637539727058801513", "+18061275079454117603026"],
    ["21343755994347480415017", C, C, "+10671877997173740207508", "+10671877997173740207508", "-21343755994347480415016"],
    ["28115319654189495669948", C, D, "-28115319654189495669948", "+28115319654189495669948", "+0"],
    ["17891323968923921347800", D, C, "+17891323968923921347800", "-17891323968923921347800", "+0"],
  ];

  test("Parleys 674, 671, 668, 666 and 639 settle to the recorded deltas", () => {
    for (const [stake, a, b, da, db, dc] of recorded) {
      const p = payoff(BigInt(stake), pot, a, b);
      expect([signed(p.a), signed(p.b), signed(p.commons)]).toEqual([da, db, dc]);
    }
  });

  test("Parley 674's stake is 2% of MARTYRMOONPIE77's treasury before it", () => {
    expect(stakeFor(RULES, 1369486044091431889475606n, 1067081080937402283348816n)).toBe(21341621618748045666976n);
  });
});

describe("coins.rs create_coin", () => {
  test("the_creation_fee_goes_to_the_commons", () => {
    expect(launch({ min_treasury: NEAR, creation_fee: 2n * NEAR }, 12n * NEAR)).toEqual({ treasury: 10n * NEAR, shares: 10n * NEAR, fee: 2n * NEAR });
  });

  test("the_fee_comes_on_top_of_the_minimum_treasury", () => {
    expect(() => launch({ min_treasury: NEAR, creation_fee: 2n * NEAR }, 2n * NEAR)).toThrow("deposit below min_treasury plus the creation fee");
    expect(() => launch({ min_treasury: NEAR, creation_fee: 0n }, NEAR / 2n)).toThrow();
  });

  test("creator_gets_one_share_per_yocto", () => {
    expect(launch(RULES, 100n * NEAR)).toEqual({ treasury: 100n * NEAR, shares: 100n * NEAR, fee: 0n });
  });
});

describe("orders.rs fill_order", () => {
  const coin = (treasury: bigint, shares: bigint) => ({ treasury, shares });

  test("a_mint_fills_at_the_price_after_the_next_parley", () => {
    const lost = payoff(stakeFor(RULES, 100n * NEAR, 100n * NEAR), 40n * NEAR, C, D);
    const saint = coin(100n * NEAR + lost.a, 100n * NEAR);
    expect(saint.treasury).toBe(98n * NEAR);
    const fill = fillMint(RULES, saint, 10n * NEAR);
    expect(fill).toEqual({ filled: true, minted: mulDiv(10n * NEAR, 100n * NEAR, 98n * NEAR), treasury: 108n * NEAR, shares: 100n * NEAR + 10204081632653061224489795n, requeued: false });
  });

  test("a_winning_coin_costs_the_late_buyer_more", () => {
    const fill = fillMint(RULES, coin(102n * NEAR, 100n * NEAR), 10n * NEAR);
    expect(fill.filled && fill.minted < 10n * NEAR).toBe(true);
  });

  test("redeeming_pays_the_holders_share_of_the_treasury", () => {
    const fill = fillRedeem(coin(102n * NEAR, 100n * NEAR), 25n * NEAR);
    expect(fill).toEqual({ filled: true, payout: (102n * NEAR) / 4n, sold: 25n * NEAR, kept: 0n, treasury: 102n * NEAR - (102n * NEAR) / 4n, shares: 75n * NEAR });
  });

  test("a_mint_below_the_buyers_minimum_is_returned", () => {
    expect(fillMint(RULES, coin(102n * NEAR, 100n * NEAR), 10n * NEAR, 10n * NEAR)).toEqual({ filled: false });
  });

  test("a_redeem_below_the_sellers_minimum_is_returned", () => {
    expect(fillRedeem(coin(98n * NEAR, 100n * NEAR), 50n * NEAR, 50n * NEAR)).toEqual({ filled: false });
  });

  test("a_mint_that_would_buy_no_share_is_returned", () => {
    expect(fillMint(RULES, coin(102n * NEAR, 100n * NEAR), 1n)).toEqual({ filled: false });
  });

  test("a_redeem_cannot_leave_a_sliver_of_shares", () => {
    const first = fillRedeem(coin(100n * NEAR, 100n * NEAR), 100n * NEAR - 1n);
    if (!first.filled) throw new Error("expected a fill");
    expect(first.kept).toBe(MIN_SHARES - 1n);
    expect(first.shares).toBe(MIN_SHARES);
    expect(first.treasury).toBe(MIN_SHARES);
    expect(1n + first.kept).toBe(MIN_SHARES);
    const second = fillRedeem(coin(first.treasury, first.shares), MIN_SHARES);
    expect(second.filled && [second.treasury, second.shares]).toEqual([0n, 0n]);
  });

  test("the_share_price_cannot_be_inflated_against_a_buyer", () => {
    const won = payoff(stakeFor(RULES, 100n * NEAR, 100n * NEAR), 40n * NEAR, D, C);
    let evil = coin(100n * NEAR + won.a, 100n * NEAR);
    const drained = fillRedeem(evil, 100n * NEAR - 1n);
    if (!drained.filled) throw new Error("expected a fill");
    evil = coin(drained.treasury, drained.shares);
    for (let i = 0n; i < 8n; i++) {
      const dust = fillMint(RULES, evil, 1n << i);
      if (dust.filled) evil = coin(dust.treasury, dust.shares);
    }
    const victim = fillMint(RULES, evil, 10n * NEAR);
    if (!victim.filled) throw new Error("expected a fill");
    expect(worth(coin(victim.treasury, victim.shares), victim.minted) > 10n * NEAR - 1_000n).toBe(true);
  });

  test("a coin below the minimum goes to the back of the line when bought back in", () => {
    const fill = fillMint(RULES, coin(NEAR / 2n, NEAR / 2n), 5n * NEAR);
    expect(fill.filled && fill.requeued).toBe(true);
  });
});
