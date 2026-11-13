import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Challenges, type Entrant } from "../src/challenges.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = 1_800_000_000_000;

function arena(file: string | null = null) {
  const clock = { now: START };
  const changing = new Set<string>();
  const held = async (coin: string) => changing.has(coin);
  const book = new Challenges(file, () => clock.now);
  const coin = (id: string, age = 30 * DAY): Entrant => ({ id, name: id.toUpperCase(), created_at: String(BigInt(clock.now - age) * 1_000_000n) });
  return { clock, changing, held, book, coin };
}

test("a coin takes part in three challenges a day as either side, then hears when it can be challenged again", async () => {
  const { clock, held, book, coin } = arena();
  expect((await book.book(coin("saint"), [coin("snake")], "1.1.1.1", held)).queued.length).toBe(1);
  clock.now += HOUR;
  expect((await book.book(coin("mirror"), [coin("snake")], "2.2.2.2", held)).queued.length).toBe(1);
  clock.now += HOUR;
  expect((await book.book(coin("snake"), [coin("grudge")], "3.3.3.3", held)).queued.length).toBe(1);

  const refused = await book.book(coin("pavlov"), [coin("snake")], "4.4.4.4", held);
  expect(refused.queued).toEqual([]);
  expect(refused.refusal).toBe("A coin gets 3 challenge matches a day, and SNAKE has used its 3. It can be challenged again in about 22 hours.");
  expect(refused.retryAt).toBe(START + DAY);
  const asChallenger = await book.book(coin("snake"), [coin("pavlov")], "4.4.4.4", held);
  expect(asChallenger.refusal).toStartWith("A coin gets 3 challenge matches a day, and SNAKE has used its 3.");

  clock.now = START + DAY - 30 * 60_000;
  expect((await book.book(coin("pavlov"), [coin("snake")], "4.4.4.4", held)).refusal).toEndWith("It can be challenged again in 30 minutes.");
  clock.now = START + DAY;
  expect((await book.book(coin("pavlov"), [coin("snake")], "4.4.4.4", held)).queued.length).toBe(1);
});

test("played and queued challenges count alike", async () => {
  const { held, book, coin } = arena();
  await book.book(coin("saint"), [coin("snake"), coin("mirror"), coin("grudge")], "1.1.1.1", held);
  expect((await book.take(held))?.b).toBe("snake");
  expect((await book.take(held))?.a).toBe("mirror");
  expect(book.queue.length).toBe(1);
  expect((await book.book(coin("saint"), [coin("pavlov")], "2.2.2.2", held)).refusal).toStartWith("A coin gets 3 challenge matches a day, and SAINT has used its 3.");
});

test("a request that runs past the limit queues what fits and says why the rest was left out", async () => {
  const { held, book, coin } = arena();
  await book.book(coin("saint"), [coin("snake"), coin("mirror")], "1.1.1.1", held);
  const partial = await book.book(coin("saint"), [coin("grudge"), coin("pavlov")], "1.1.1.1", held);
  expect(partial.queued.map((c) => [c.a, c.b])).toEqual([["saint", "grudge"]]);
  expect(partial.refusal).toStartWith("A coin gets 3 challenge matches a day, and SAINT has used its 3.");
});

test("a new coin's launch challenges go through even against busy rivals, and count only toward its own three", async () => {
  const { clock, held, book, coin } = arena();
  for (const [i, by] of ["saint", "mirror", "grudge"].entries()) await book.book(coin(by), [coin("snake")], `1.1.1.${i}`, held);
  expect((await book.book(coin("pavlov"), [coin("snake")], "9.9.9.9", held)).queued).toEqual([]);

  const fresh = coin("newbie", 2 * 60_000);
  const launched = await book.book(fresh, [coin("snake"), coin("saint"), coin("mirror")], "5.5.5.5", held);
  expect(launched.refusal).toBeNull();
  expect(launched.queued.map((c) => [c.a, c.b])).toEqual([
    ["newbie", "snake"],
    ["saint", "newbie"],
    ["newbie", "mirror"],
  ]);
  expect((await book.book(fresh, [coin("grudge")], "6.6.6.6", held)).refusal).toStartWith("A coin gets 3 challenge matches a day, and NEWBIE has used its 3.");
  expect((await book.book(coin("pavlov"), [coin("saint")], "6.6.6.6", held)).queued.length).toBe(1);
  expect((await book.book(coin("pavlov"), [coin("snake")], "6.6.6.6", held)).refusal).toStartWith("A coin gets 3 challenge matches a day, and SNAKE has used its 3.");

  const second = coin("second", 2 * 60_000);
  await book.book(second, [coin("pavlov")], "7.7.7.7", held);
  expect((await book.book(second, [coin("snake")], "7.7.7.7", held)).queued).toEqual([]);

  clock.now += 2 * HOUR;
  expect((await book.book(coin("late", 90 * 60_000), [coin("snake")], "8.8.8.8", held)).queued).toEqual([]);
});

test("an address sends nine challenges a day", async () => {
  const { clock, held, book, coin } = arena();
  for (let i = 0; i < 9; i++) {
    expect((await book.book(coin(`c${i}`), [coin(`d${i}`)], "1.1.1.1", held)).queued.length).toBe(1);
    clock.now += 10 * 60_000;
  }
  const refused = await book.book(coin("e"), [coin("f")], "1.1.1.1", held);
  expect(refused.queued).toEqual([]);
  expect(refused.refusal).toBe("Each address can send 9 challenge matches a day, and yours has sent 9. You can send more in about 23 hours.");
  expect((await book.book(coin("e"), [coin("f")], "2.2.2.2", held)).queued.length).toBe(1);

  const launch = await book.book(coin("fresh", 60_000), [coin("g"), coin("h")], "1.1.1.1", held);
  expect(launch.queued).toEqual([]);
  clock.now = START + DAY;
  expect((await book.book(coin("e"), [coin("f"), coin("g")], "1.1.1.1", held)).queued.length).toBe(1);
});

test("a coin with a rule change in progress is never queued, and the rest of a request still is", async () => {
  const { changing, held, book, coin } = arena();
  changing.add("snake");
  const own = await book.book(coin("snake"), [coin("saint")], "1.1.1.1", held);
  expect(own.queued).toEqual([]);
  expect(own.refusal).toBe("SNAKE has a rule change in progress, so it can't be challenged until the vote and safety wait are over.");
  expect((await book.book(coin("saint"), [coin("snake")], "1.1.1.1", held)).refusal).toStartWith("SNAKE has a rule change in progress");

  const launch = await book.book(coin("fresh", 60_000), [coin("snake"), coin("saint")], "1.1.1.1", held);
  expect(launch.queued.map((c) => [c.a, c.b])).toEqual([["fresh", "saint"]]);
  expect(launch.refusal).toStartWith("SNAKE has a rule change in progress");
  expect(book.queue.length).toBe(1);
});

test("the line skips challenges whose coins are mid rule change and plays them once the change is settled", async () => {
  const { changing, held, book, coin } = arena();
  await book.book(coin("saint"), [coin("snake")], "1.1.1.1", held);
  await book.book(coin("mirror"), [coin("grudge")], "1.1.1.1", held);
  changing.add("snake");
  expect(book.line((id) => changing.has(id))).toEqual([
    { a: "mirror", b: "grudge" },
    { a: "saint", b: "snake", held: true },
  ]);
  expect((await book.take(held))?.a).toBe("mirror");
  expect(await book.take(held)).toBeUndefined();
  expect(book.queue.map((c) => c.b)).toEqual(["snake"]);
  changing.delete("snake");
  expect((await book.take(held))?.b).toBe("snake");
  expect(book.queue).toEqual([]);
});

test("a challenge that could not start goes back to the end of the line without counting twice", async () => {
  const { held, book, coin } = arena();
  await book.book(coin("saint"), [coin("snake"), coin("mirror")], "1.1.1.1", held);
  const first = (await book.take(held))!;
  book.later(first, 123);
  expect(book.queue.map((c) => [c.a, c.b, c.since])).toEqual([
    ["mirror", "saint", undefined],
    ["saint", "snake", 123],
  ]);
  expect((await book.book(coin("saint"), [coin("grudge")], "1.1.1.1", held)).queued.length).toBe(1);
  expect((await book.book(coin("saint"), [coin("pavlov")], "1.1.1.1", held)).queued).toEqual([]);
});

test("the line and the counts survive a restart, and an old queue file still loads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "parley-challenges-"));
  const file = join(dir, "queue.json");
  const before = arena(file);
  await before.book.book(before.coin("saint"), [before.coin("snake"), before.coin("mirror"), before.coin("grudge")], "1.1.1.1", before.held);
  await before.book.take(before.held);

  const after = arena(file);
  expect(after.book.queue.length).toBe(2);
  expect((await after.book.book(after.coin("saint"), [after.coin("pavlov")], "2.2.2.2", after.held)).refusal).toStartWith("A coin gets 3 challenge matches a day, and SAINT");

  const old = join(dir, "old.json");
  writeFileSync(old, JSON.stringify([{ a: "saint", b: "snake" }, { a: "mirror", b: "grudge", since: 5 }]));
  const upgraded = arena(old);
  expect(upgraded.book.queue.map((c) => [c.a, c.b, c.by])).toEqual([
    ["saint", "snake", "saint"],
    ["mirror", "grudge", "mirror"],
  ]);
  expect((await upgraded.book.take(upgraded.held))?.b).toBe("snake");
});
