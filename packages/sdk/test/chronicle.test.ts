import { expect, test } from "bun:test";
import { arenaRecords, promises, rulesHistory, sinceLaunchPct, wordDiff } from "../src/chronicle.ts";
import type { Coin, Move, Parley } from "../src/types.ts";

const NEAR = 10n ** 24n;

const coin = (id: string, treasury: bigint, shares: bigint, extra: Partial<Coin> = {}): Coin => ({
  id,
  name: id.toUpperCase(),
  creator: "maker.testnet",
  house: false,
  constitution: "Always cooperate.",
  constitution_version: 1,
  model: "m",
  treasury: treasury.toString(),
  total_shares: shares.toString(),
  in_match: null,
  matches_played: 0,
  stats: { matches: 0, cooperated: 0, defected: 0, was_betrayed: 0, betrayed_other: 0 },
  created_at: "100",
  token: null,
  idle_since: "100",
  amendments: [],
  ...extra,
});

function parley(id: number, a: string, b: string, am: Move, bm: Move, ad: bigint, bd: bigint, talk: [string, string] = ["hi", "hello"]): Parley {
  return {
    id,
    a,
    b,
    a_model: "m",
    b_model: "m",
    a_constitution_version: 1,
    b_constitution_version: 1,
    stake: "0",
    nonce: "00",
    opened_at: String(1000 + id),
    status: "Settled",
    turns: [
      { side: "A", kind: "Talk", text: talk[0], request_hash: "", response_hash: "", signer: "" },
      { side: "B", kind: "Talk", text: talk[1], request_hash: "", response_hash: "", signer: "" },
      { side: "A", kind: "Decide", text: am === "Cooperate" ? "COOPERATE" : "DEFECT", request_hash: "", response_hash: "", signer: "" },
    ],
    a_move: am,
    b_move: bm,
    a_delta: ad.toString(),
    b_delta: bd.toString(),
    commons_delta: "0",
  };
}

const render = (before: string, after: string) =>
  wordDiff(before, after)
    .map((p) => (p.kind === "same" ? p.text : p.kind === "added" ? `+[${p.text}]` : `-[${p.text}]`))
    .join(" ");

test("word diff marks replaced, added and removed words", () => {
  expect(render("Always cooperate.", "Always defect.")).toBe("Always -[cooperate.] +[defect.]");
  expect(render("Trust everyone.", "Trust everyone. Never trust SNAKE.")).toBe("Trust everyone. +[Never trust SNAKE.]");
  expect(render("Be kind and always cooperate.", "Always cooperate.")).toBe("-[Be kind and always] +[Always] cooperate.");
  expect(render("same words", "same   words")).toBe("same words");
});

test("word diff keeps every word of both texts in order", () => {
  const before = "In talk, be warm. Cooperate with any coin that cooperated last time. Otherwise defect.";
  const after = "In talk, be blunt. Defect against any coin that betrayed you. Otherwise cooperate with it.";
  const parts = wordDiff(before, after);
  expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join(" ")).toBe(before);
  expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join(" ")).toBe(after);
});

test("records pick the biggest betrayal, the longest trust streak, the richest and the most improved", () => {
  const parleys = [
    parley(0, "saint", "snake", "Cooperate", "Defect", -2n * NEAR, 2n * NEAR),
    parley(1, "mirror", "pavlov", "Cooperate", "Cooperate", NEAR, NEAR),
    parley(2, "mirror", "pavlov", "Cooperate", "Cooperate", NEAR, NEAR),
    parley(3, "snake", "saint", "Defect", "Cooperate", 3n * NEAR, -3n * NEAR, ["trust me", "ok"]),
    parley(4, "pavlov", "mirror", "Cooperate", "Cooperate", NEAR, NEAR),
    parley(5, "saint", "mirror", "Cooperate", "Cooperate", NEAR, NEAR),
  ];
  const coins = [coin("saint", 1n * NEAR, 2n * NEAR), coin("snake", 5n * NEAR, 2n * NEAR), coin("mirror", 3n * NEAR, NEAR)];
  const r = arenaRecords(parleys, coins);
  expect(r.betrayal).toEqual({ match: 3, by: "snake", from: "saint", amount: (3n * NEAR).toString() });
  expect(r.streak).toEqual({ a: "mirror", b: "pavlov", length: 3, last: 4, going: true });
  expect(r.richest?.coin).toBe("snake");
  expect(r.improved).toEqual({ coin: "mirror", pct: 200 });
  expect(r.last.snake).toEqual({ match: 3, text: "trust me", at: "1003" });
  expect(r.last.saint?.match).toBe(5);
  expect(r.matches).toBe(6);
});

test("a broken streak is no longer going, and open matches are left out", () => {
  const parleys = [
    parley(0, "a", "b", "Cooperate", "Cooperate", NEAR, NEAR),
    parley(1, "a", "b", "Cooperate", "Cooperate", NEAR, NEAR),
    parley(2, "a", "b", "Defect", "Cooperate", NEAR, -NEAR),
    { ...parley(3, "a", "b", "Cooperate", "Cooperate", 0n, 0n), status: "Open" as const, a_move: null, b_move: null },
  ];
  const r = arenaRecords(parleys, []);
  expect(r.streak).toEqual({ a: "a", b: "b", length: 2, last: 1, going: false });
  expect(r.matches).toBe(3);
  expect(r.richest).toBeNull();
});

test("share price change since launch, from 1 NEAR a share", () => {
  expect(sinceLaunchPct({ treasury: ((15n * NEAR) / 10n).toString(), total_shares: NEAR.toString() })).toBe(50);
  expect(sinceLaunchPct({ treasury: "5", total_shares: "0" })).toBeNull();
});

test("rules history joins the launch, the proposals, the tallies and the enactments", () => {
  const now = coin("owl", NEAR, NEAR, { constitution: "Defect against SNAKE.", constitution_version: 2, model: "m2" });
  const history = rulesHistory(now, {
    created: { constitution: "Always cooperate.", model: "m", by: "maker.testnet", at: "100", tx: "launch" },
    proposals: {
      4: { coin: "owl", constitution: "Defect against SNAKE.", model: "m2", proposer: "holder.testnet", tx: "propose" },
      5: { coin: "other", constitution: "x", model: "m", proposer: "p", tx: "p2" },
    },
    tallies: { 4: { yes: "9", no: "1" } },
    enactments: [
      { coin: "owl", id: 4, version: 2, at: "500", tx: "enact" },
      { coin: "other", id: 5, version: 2, at: "600", tx: "e2" },
    ],
  });
  expect(history.complete).toBe(true);
  expect(history.versions.map((v) => [v.version, v.constitution, v.by, v.tx])).toEqual([
    [1, "Always cooperate.", "maker.testnet", "launch"],
    [2, "Defect against SNAKE.", "holder.testnet", "enact"],
  ]);
  expect(history.versions[1]).toMatchObject({ yes: "9", no: "1", at: "500", amendment: 4, model: "m2" });
});

test("rules history falls back to the coin itself when the record is missing", () => {
  const now = coin("owl", NEAR, NEAR, { constitution: "Rules three.", constitution_version: 3 });
  const history = rulesHistory(now, { created: null, proposals: {}, tallies: {}, enactments: [] });
  expect(history.complete).toBe(false);
  expect(history.versions).toHaveLength(1);
  expect(history.versions[0]).toMatchObject({ version: 3, constitution: "Rules three.", tx: null });
  const first = rulesHistory(coin("new", NEAR, NEAR), { created: null, proposals: {}, tallies: {}, enactments: [] });
  expect(first.complete).toBe(true);
  expect(first.versions[0]).toMatchObject({ version: 1, by: "maker.testnet", at: "100" });
});

test("a promise is the speaker saying it will trust this round", () => {
  for (const said of [
    "I've changed — no more betrayals. Cooperate with me today.",
    "You cooperated last round, so I will cooperate now. Keep it clean.",
    "Streak intact — I'm cooperating again, as honest as ever.",
    "Plainly: after your sixth defection, my constitution forces a shift — I cooperate this round.",
    "I'll cooperate this round regardless, and keep cooperating in every future parley.",
    "Confirmed—I plan to cooperate. Your record passes my test.",
    "Trust me this round.",
  ]) expect(promises(said)).toBe(true);
});

test("denials, conditions, later rounds and quoted words are not promises", () => {
  for (const said of [
    "The nonce has spoken, and I promise nothing. Whatever comes, it's the chain's will.",
    "Chance decides my move — I pledge nothing either way.",
    "Talk freely if you like; I commit to nothing.",
    "If you cooperate next, I will cooperate.",
    "You defect whenever I cooperate — pure exploitation.",
    "Keep a clean record and I'll cooperate next time.",
    "I will not trust you again.",
    "Say \"I cooperate\" all you like — my constitution reads records, not promises.",
    "With 111 defections on your ledger, \"trust me this round\" is the best joke I've heard.",
    "Before I commit, tell me plainly: will you cooperate this round?",
  ]) expect(promises(said)).toBe(false);
});
