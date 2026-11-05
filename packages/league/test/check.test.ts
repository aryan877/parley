import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "@parley/relayer";
import { checkLeague, clean, readLeague, summarize } from "../src/index.ts";

const dir = join(ROOT, "fixtures/scripted");
const recorded = existsSync(join(dir, "league.json"));

test.skipIf(!recorded)("the recorded scripted league verifies offline", () => {
  const { manifest, evidence } = readLeague(dir);
  expect(evidence.length).toBeGreaterThan(0);
  expect(checkLeague(manifest, evidence)).toEqual([]);
});

test.skipIf(!recorded)("flipping one recorded move is caught five ways", () => {
  const { manifest, evidence } = readLeague(dir);
  const target = structuredClone(evidence[0]!);
  const decision = target.turns[4]!;
  decision.reply.response = decision.reply.response.replace(/COOPERATE|DEFECT/, (m) => (m === "DEFECT" ? "COOPERATE" : "DEFECT"));
  const problems = checkLeague(manifest, [target]).map((f) => f.problem);
  expect(problems).toContain("enclave signature does not verify");
  expect(problems).toContain("response hash differs from the chain");
  expect(problems).toContain("moves on chain are not the moves in the signed replies");
  expect(problems).toContain("payoff does not follow the rules");
});

test.skipIf(!recorded)("a reply signed by an unregistered key is caught", () => {
  const { manifest, evidence } = readLeague(dir);
  const stranger = { ...manifest, models: manifest.models.map((m) => ({ ...m, signers: [] })) };
  expect(checkLeague(stranger, [evidence[0]!]).some((f) => f.problem.startsWith("signer is not a registered"))).toBe(true);
});

test.skipIf(!recorded)("standings add up to zero with the commons", () => {
  const { manifest, evidence } = readLeague(dir);
  const stats = summarize(manifest.coins, evidence, 100n * 10n ** 24n, 1);
  const coins = stats.standings.reduce((sum, s) => sum + BigInt(s.change), 0n);
  const commons = evidence.reduce((sum, e) => sum + BigInt(e.parley.commons_delta), 0n);
  expect(coins + commons).toBe(0n);
  expect(stats.outcomes.bothCooperate + stats.outcomes.oneDefects + stats.outcomes.bothDefect).toBe(evidence.length);
});

test("messages are cleaned exactly as the contract cleans them", () => {
  expect(clean('  "Hello\n\n  there"  ', 280)).toBe("Hello there");
  expect(clean("abcdef", 3)).toBe("ab…");
  expect(clean("abc", 3)).toBe("abc");
  expect(clean("one two three four", 12)).toBe("one two…");
  expect(clean("one two three four", 14)).toBe("one two three…");
  expect(clean("héllo wörld again", 12)).toBe("héllo wörld…");
  expect(clean(" \n\t ", 10)).toBe("(said nothing)");
  expect(clean("tab\there\u0007", 20)).toBe("tab here");
  expect(clean("x".repeat(400), 240)).toBe(`${"x".repeat(239)}…`);
});
