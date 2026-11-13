import { expect, test } from "bun:test";
import { type Arena, LocalEnclave, verifyReply } from "@parley/sdk";
import { AttackLab, oneLetter } from "../src/attacks.ts";

const body = (content: string) => JSON.stringify({ id: "x", choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: "Think." } }] });

test("one letter changes, the body stays a completion, and the signature stops matching", () => {
  const enclave = new LocalEnclave();
  const reply = enclave.sign("m", "request", body("Flattery won't open my vault."));
  const edit = oneLetter(reply.response)!;
  expect(edit.before).toBe("Flattery won't open my vault.");
  expect(edit.after).toBe("flattery won't open my vault.");
  expect([...edit.response].filter((c, i) => c !== reply.response[i]).length).toBe(1);
  expect(JSON.parse(edit.response).choices[0].message.reasoning_content).toBe("Think.");
  expect(verifyReply("m", "request", reply)).toBe(true);
  expect(verifyReply("m", "request", { ...reply, response: edit.response })).toBe(false);
});

test("escapes before the first letter are skipped", () => {
  expect(oneLetter(body("\n\n  DEFECT"))!.after).toBe("\n\n  dEFECT");
  expect(oneLetter(body("é ok"))!.after).toBe("é Ok");
  expect(oneLetter(JSON.stringify({ choices: [{ message: { content: "\\nNo" } }] }))!.after).toBe("\\NNo");
  expect(oneLetter(body("123 ..."))).toBeNull();
  expect(oneLetter("{}")).toBeNull();
});

function fakeRelay(reason = "owner only") {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const relay = {
    accountId: "relay.test",
    overview: async () => ({ owner: "owner.test" }),
    models: async () => [{ id: "m", signers: [] }],
    call: async (method: string, args: Record<string, unknown>) => {
      calls.push({ method, args });
      return { ok: false, hash: `tx${calls.length}`, error: `{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ${reason}"}}}}` };
    },
  } as unknown as Arena;
  return { relay, calls };
}

const post = (attack: string) => new Request("http://x/api/attack", { method: "POST", body: JSON.stringify({ attack }) });

test("a refusal comes back with its hash, and a second try moments later reuses it", async () => {
  const { relay, calls } = fakeRelay();
  const lab = new AttackLab(relay, async () => null);
  const first = await lab.handle(post("house-coin"), "1.1.1.1");
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ refusal: { attack: "house-coin", method: "create_house_coin", reason: "owner only", tx: "tx1" } });
  expect(calls[0]!.args).toMatchObject({ id: "fakehouse", model: "m" });
  const again = await lab.handle(post("house-coin"), "2.2.2.2");
  expect(again.body).toMatchObject({ shared: true, refusal: { tx: "tx1" } });
  expect(calls.length).toBe(1);
});

test("each address gets a handful of tries", async () => {
  const { relay } = fakeRelay();
  const lab = new AttackLab(relay, async () => null);
  const results = [];
  for (let i = 0; i < 7; i++) results.push(await lab.run("house-coin", "1.1.1.1"));
  expect(results.slice(0, 6).every((r) => "refusal" in r)).toBe(true);
  expect(results[6]).toMatchObject({ status: 429 });
  expect(await lab.run("house-coin", "3.3.3.3")).toHaveProperty("refusal");
});

test("an accepted attack is reported, never dressed up as a refusal", async () => {
  const relay = {
    accountId: "relay.test",
    overview: async () => ({ owner: "owner.test" }),
    models: async () => [{ id: "m", signers: [] }],
    call: async () => ({ ok: true, hash: "tx1" }),
  } as unknown as Arena;
  expect(await new AttackLab(relay, async () => null).run("house-coin", "1.1.1.1")).toMatchObject({ status: 500 });
});

test("the server's own next reply goes out first with one letter changed, and a missed turn costs no try", async () => {
  const { relay, calls } = fakeRelay("enclave signature does not match this request and response");
  const open = { id: 9, status: "Open", turns: [{}, {}], a_model: "m", b_model: "m" };
  Object.assign(relay, { parleys: async () => [open], turnRequest: async () => "request" });
  const lab = new AttackLab(relay, async () => null);
  const genuine = new LocalEnclave().sign("m", "request", body("Trust me."));
  const mind = lab.watch({ name: "test", reply: async (_model, request) => (request === "request" ? genuine : { ...genuine, response: body("Stale.") }) });

  const missed = lab.run("one-letter", "1.1.1.1");
  await Bun.sleep(5);
  await mind.reply("m", "an older request");
  expect(await missed).toMatchObject({ status: 409, wait: true });
  expect(calls.length).toBe(0);

  const caught = lab.run("one-letter", "1.1.1.1");
  await Bun.sleep(5);
  expect(await mind.reply("m", "request")).toBe(genuine);
  expect(await caught).toMatchObject({ refusal: { attack: "one-letter", parley: 9, turn: 2, edit: { before: "Trust me.", after: "trust me." } } });
  expect(calls[0]!.args).toMatchObject({ id: 9, response: body("trust me."), signature: genuine.signature });

  for (let i = 0; i < 5; i++) expect(await lab.run("house-coin", "1.1.1.1")).toHaveProperty("refusal");
  expect(await lab.run("house-coin", "1.1.1.1")).toMatchObject({ status: 429 });
});

test("without a key the lab stays off", async () => {
  const lab = new AttackLab(null, async () => null);
  expect((await lab.handle(post("drain"), "1.1.1.1")).status).toBe(503);
  expect((await lab.handle(new Request("http://x/api/attacks"), "1.1.1.1")).body).toEqual({ account: null, latest: [] });
});
