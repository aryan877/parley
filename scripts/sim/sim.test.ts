import { describe, expect, test } from "bun:test";
import { type Rules, SimArena } from "./arena.ts";
import { seeded } from "./random.ts";
import { house8, houseConstitutions } from "./scenarios.ts";
import { DAYS, MATCHES_PER_DAY, play } from "./season.ts";
import { forgiving, grudger, pavlov, random, skeptic, titForTat, trust, type Seen } from "./strategies.ts";

const NEAR = 10n ** 24n;
const MINUTE = 60n * 1_000_000_000n;
const TEST_RULES: Rules = { stake_bps: 200, min_treasury: NEAR, creation_fee: 0n, rest_ns: 0n, pair_rest_ns: 0n, order_timeout_ns: 60n * MINUTE };

function world(rules: Partial<Rules> = {}) {
  const arena = new SimArena({ ...TEST_RULES, ...rules }, 40n * NEAR, seeded(1));
  let now = 1_000n * MINUTE;
  return {
    arena,
    now: () => now,
    wait: (ns: bigint) => {
      now += ns;
    },
    coin: (id: string, near: bigint, creator = "alice.near") => arena.launch(creator, id, id.toUpperCase(), trust, near * NEAR, now),
    cooperate: (opened: NonNullable<ReturnType<SimArena["open"]>>) => arena.settle(opened, "Cooperate", "Cooperate", now),
  };
}

describe("pairing mirrors the contract's open_parley tests", () => {
  test("the_coin_that_rested_longest_goes_first", () => {
    const w = world();
    for (const id of ["cc", "aa", "bb"]) {
      w.coin(id, 10n);
      w.wait(MINUTE);
    }
    const p = w.arena.open(w.now())!;
    expect([p.a, p.b]).toEqual(["cc", "aa"]);
  });

  test("pairing_takes_turns_and_spreads_opponents", () => {
    const w = world();
    for (const id of ["aa", "bb", "cc", "dd", "ee"]) {
      w.coin(id, 10n);
      w.wait(MINUTE);
    }
    const met = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const p = w.arena.open(w.now())!;
      expect(p.a).not.toBe(p.b);
      met.add([p.a, p.b].sort().join(" "));
      w.cooperate(p);
      w.wait(MINUTE);
    }
    expect(met.size).toBe(10);
    for (const c of w.arena.coins.values()) expect(c.matchesPlayed >= 7 && c.matchesPlayed <= 9).toBe(true);
  });

  test("two_coins_cannot_meet_again_straight_away, then a_pair_meets_again_once_it_has_waited", () => {
    const w = world({ rest_ns: MINUTE, pair_rest_ns: 30n * MINUTE });
    w.coin("aa", 100n, "mallory.near");
    w.coin("bb", 100n, "mallory.near");
    w.wait(30n * MINUTE);
    w.cooperate(w.arena.open(w.now())!);
    w.wait(29n * MINUTE);
    expect(w.arena.open(w.now())).toBeNull();
    w.wait(MINUTE);
    expect(w.arena.open(w.now())).not.toBeNull();
  });

  test("a_new_coin_cannot_jump_the_line", () => {
    const w = world({ rest_ns: MINUTE, pair_rest_ns: 30n * MINUTE });
    for (const id of ["aa", "bb", "cc"]) w.coin(id, 100n);
    w.wait(30n * MINUTE);
    w.coin("sniper", 100n, "mallory.near");
    w.wait(2n * MINUTE);
    const p = w.arena.open(w.now())!;
    expect([p.a, p.b]).not.toContain("sniper");
  });

  test("the_next_coin_in_line_goes_first_when_the_first_has_no_partner", () => {
    const w = world({ rest_ns: MINUTE, pair_rest_ns: 30n * MINUTE });
    for (const id of ["aa", "bb", "cc", "dd"]) w.coin(id, 100n);
    w.wait(30n * MINUTE);
    for (const b of ["bb", "cc", "dd"]) w.cooperate(w.arena.open(w.now(), ["aa", b])!);
    w.wait(2n * MINUTE);
    const p = w.arena.open(w.now())!;
    expect([p.a, p.b]).not.toContain("aa");
  });

  test("a_coin_that_buys_its_way_back_in_goes_to_the_back_of_the_line", () => {
    const w = world({ rest_ns: 5n * MINUTE });
    w.coin("switch", 2n, "mallory.near");
    w.wait(MINUTE);
    w.coin("saint", 100n);
    w.coin("snake", 100n, "bob.near");
    w.arena.placeRedeem("mallory.near", "switch", (3n * NEAR) / 2n, w.now());
    w.arena.placeMint("mallory2.near", "switch", 5n * NEAR, w.now());
    w.wait(60n * MINUTE);
    expect(w.arena.fill(w.now()).map((f) => f.kind)).toEqual(["Redeem", "Mint"]);
    expect(w.arena.coin("switch").idleSince).toBe(w.now());
    const p = w.arena.open(w.now())!;
    expect([p.a, p.b]).not.toContain("switch");
  });

  test("a coin below the minimum treasury is never drawn", () => {
    const w = world();
    w.coin("aa", 10n);
    w.coin("bb", 10n);
    w.coin("cc", 10n);
    w.arena.coin("cc").treasury = NEAR - 1n;
    for (let i = 0; i < 6; i++) {
      const p = w.arena.open(w.now())!;
      expect([p.a, p.b]).not.toContain("cc");
      w.cooperate(p);
      w.wait(MINUTE);
    }
  });
});

describe("strategies", () => {
  const seen = (history: [string, string][], over: Partial<Seen> = {}): Seen => ({
    me: { id: "me", creator: "a", record: { matches: 0, cooperated: 0, defected: 0, was_betrayed: 0, betrayed_other: 0 } },
    them: { id: "them", creator: "b", record: { matches: 0, cooperated: 0, defected: 0, was_betrayed: 0, betrayed_other: 0 } },
    history: history.map(([mine, theirs]) => ({ mine: mine === "C" ? "Cooperate" : "Defect", theirs: theirs === "C" ? "Cooperate" : "Defect" })),
    nonce: "0000000000000000",
    ...over,
  });

  test("first meetings", () => {
    expect([titForTat, skeptic, pavlov, forgiving, grudger].map((s) => s.decide(seen([])))).toEqual(["Cooperate", "Defect", "Cooperate", "Cooperate", "Cooperate"]);
  });

  test("pavlov repeats after a trust and switches after a betrayal", () => {
    expect(pavlov.decide(seen([["D", "C"]]))).toBe("Defect");
    expect(pavlov.decide(seen([["D", "D"]]))).toBe("Cooperate");
    expect(pavlov.decide(seen([["C", "D"]]))).toBe("Defect");
  });

  test("forgive once betrays only after two betrayals in a row", () => {
    expect(forgiving.decide(seen([["C", "D"]]))).toBe("Cooperate");
    expect(forgiving.decide(seen([["C", "D"], ["C", "D"]]))).toBe("Defect");
    expect(forgiving.decide(seen([["C", "D"], ["C", "C"]]))).toBe("Cooperate");
  });

  test("the public record grudger reads betrayed_other", () => {
    const record = { matches: 3, cooperated: 2, defected: 1, was_betrayed: 0, betrayed_other: 1 };
    expect(grudger.decide(seen([], { them: { id: "them", creator: "b", record } }))).toBe("Defect");
  });

  test("the coin flip reads the nonce's last hex digit", () => {
    expect(random.decide(seen([], { nonce: "aaaaaaaaaaaaaaa7" }))).toBe("Cooperate");
    expect(random.decide(seen([], { nonce: "000000000000000f" }))).toBe("Defect");
  });
});

describe("season", () => {
  test("every house constitution has a strategy", () => {
    expect(houseConstitutions().map((c) => c.id)).toEqual(["diplomat", "gambler", "grudge", "mirror", "pavlov", "saint", "skeptic", "snake"]);
  });

  test("a season is deterministic, conserves value and plays the stated pace", () => {
    const one = play(house8);
    const two = play(house8);
    expect(one.log.length).toBe(DAYS * MATCHES_PER_DAY);
    expect(one.log.map((m) => `${m.a}${m.b}${m.aMove}${m.bMove}${m.stake}`)).toEqual(two.log.map((m) => `${m.a}${m.b}${m.aMove}${m.bMove}${m.stake}`));
    expect(one.arena.value() + one.arena.paidOut).toBe(one.arena.paidIn);
  });
});

describe("first stone, a rule for a future contract", () => {
  const settle = (w: ReturnType<typeof world>, a: string, b: string, aMove: "Cooperate" | "Defect", bMove: "Cooperate" | "Defect"): [bigint, bigint] => {
    const opened = w.arena.open(w.now(), [a, b])!;
    const before = [w.arena.coin(a).treasury, w.arena.coin(b).treasury];
    w.arena.settle(opened, aMove, bMove, w.now());
    w.wait(MINUTE);
    return [w.arena.coin(a).treasury - before[0]!, w.arena.coin(b).treasury - before[1]!];
  };

  test("the first betrayal of a trusting coin forfeits every later trust bonus, and retaliation does not", () => {
    const w = world({ first_stone: true });
    for (const id of ["aa", "bb", "cc"]) w.coin(id, 10n);
    w.wait(MINUTE);
    settle(w, "aa", "bb", "Defect", "Cooperate");
    settle(w, "bb", "aa", "Defect", "Cooperate");
    expect(w.arena.coin("aa").firstStones).toBe(1);
    expect(w.arena.coin("bb").firstStones).toBe(0);
    const [aa, cc] = settle(w, "aa", "cc", "Cooperate", "Cooperate");
    expect(aa).toBe(0n);
    expect(cc > 0n).toBe(true);
    const [bb] = settle(w, "bb", "cc", "Cooperate", "Cooperate");
    expect(bb > 0n).toBe(true);
  });

  test("without the rule both sides of a mutual trust draw the bonus", () => {
    const w = world();
    for (const id of ["aa", "cc"]) w.coin(id, 10n);
    w.wait(MINUTE);
    settle(w, "aa", "cc", "Defect", "Cooperate");
    const [aa, cc] = settle(w, "aa", "cc", "Cooperate", "Cooperate");
    expect(aa > 0n && cc > 0n).toBe(true);
  });
});
