import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "@parley/relayer";
import { LocalEnclave, sha256Hex } from "@parley/sdk";
import { type Finding, type League, type ParleyEvidence, STAND_IN_KEY, buildRequest, checkLeague, describeSigner, readLeague, signerReport, turnSpec } from "../src/index.ts";

const aiDir = join(ROOT, "fixtures/near-ai");
const scriptedDir = join(ROOT, "fixtures/scripted");
const ai = existsSync(join(aiDir, "league.json")) ? readLeague(aiDir) : undefined;
const scripted = existsSync(join(scriptedDir, "league.json")) ? readLeague(scriptedDir) : undefined;

const check = (league: League) => checkLeague(league.manifest, league.evidence, league.attestations, league.stats);
const at = (findings: Finding[], parley: number, turn?: number) => findings.filter((f) => f.parley === parley && f.turn === turn).map((f) => f.problem);

/** A shallow copy of the league in which only Parley `id` is a deep copy, so edits stay local. */
function editParley(league: League, id: number, edit: (e: ParleyEvidence) => void): League {
  const evidence = league.evidence.map((e) => (e.parley.id === id ? structuredClone(e) : e));
  edit(evidence.find((e) => e.parley.id === id)!);
  return { ...league, evidence };
}

test.skipIf(!ai)("F: a missing, duplicated or extra Parley recording fails", () => {
  const league = ai!;
  const extra = structuredClone(league.evidence[83]!);
  extra.parley.id = 90;
  const evidence = [...league.evidence.filter((e) => e.parley.id !== 54), league.evidence[3]!, extra];
  const findings = checkLeague(league.manifest, evidence, league.attestations, league.stats);
  expect(at(findings, 54)).toEqual(["no recording, though league.json counts 84 Parleys"]);
  expect(at(findings, 3)).toEqual(["recorded 2 times"]);
  expect(at(findings, 90)).toEqual(["recorded, but league.json counts only 84 Parleys"]);
  expect(findings.map((f) => f.problem)).toContain("the Parley recordings are incomplete, so requests, treasuries and standings were not re-derived");
});

test.skipIf(!ai)("G: edited final treasuries and standings are re-derived and fail", () => {
  const league = ai!;
  const manifest = structuredClone(league.manifest);
  manifest.coins.find((c) => c.id === "snake")!.treasury = "150000000000000000000000000";
  manifest.overview.commons = (BigInt(manifest.overview.commons) + 1n).toString();
  const stats = structuredClone(league.stats!);
  const grudge = stats.standings.find((s) => s.id === "grudge")!;
  const kept = grudge.followed;
  grudge.followed = grudge.prescribed;
  const problems = checkLeague(manifest, league.evidence, league.attestations, stats).map((f) => f.problem);
  expect(problems.some((p) => p.startsWith("SNAKE: league.json gives a final treasury of 150.00 NEAR"))).toBe(true);
  expect(problems.some((p) => p.startsWith("league.json gives a final commons of"))).toBe(true);
  expect(problems).toContain(`stats.json standings[grudge].followed is ${grudge.prescribed}, re-derived ${kept}`);
  expect(problems.length).toBe(3);
});

test.skipIf(!ai)("H: a reply signed by a key no Intel quote backs fails, even when league.json registers it", () => {
  const forger = new LocalEnclave(crypto.getRandomValues(new Uint8Array(32)));
  const base = ai!;
  const manifest = structuredClone(base.manifest);
  const league = editParley({ ...base, manifest }, 54, (e) => {
    const turn = e.turns[1]!;
    const signers = manifest.models.find((m) => m.id === turn.model)!.signers;
    signers.push({ public_key: forger.publicKey, evidence: "sandbox", active_from: "0", retired_from: null });
    const body = JSON.parse(turn.reply.response);
    body.choices[0].message.content = "SNAKE, you are a liar and I will make you pay.";
    turn.reply = forger.sign(turn.model, turn.request, JSON.stringify(body));
    Object.assign(e.parley.turns[1]!, { response_hash: sha256Hex(turn.reply.response), signer: forger.publicKey, text: body.choices[0].message.content });
  });
  const findings = check(league);
  expect(at(findings, 54, 1)).toEqual([`signer ${forger.publicKey.slice(0, 12)}… is not backed by hardware: no Intel TDX quote (evidence "sandbox")`]);
  const forged = signerReport(league.manifest, league.evidence, league.attestations).find((s) => s.publicKey === forger.publicKey)!;
  expect(forged).toMatchObject({ kind: "unproven", replies: 1 });
  expect(describeSigner(forged)).toBe('no Intel TDX quote (evidence "sandbox")');
});

test.skipIf(!ai)("H: the public stand-in key cannot sign for a league with real enclaves, whatever its mind says", () => {
  const stand = new LocalEnclave();
  const base = ai!;
  const manifest = { ...structuredClone(base.manifest), mind: "scripted" };
  const league = editParley({ ...base, manifest }, 83, (e) => {
    const turn = e.turns[5]!;
    const signers = manifest.models.find((m) => m.id === turn.model)!.signers;
    signers.push({ public_key: stand.publicKey, evidence: "local scripted enclave, not a TEE", active_from: "0", retired_from: null });
    turn.reply = stand.sign(turn.model, turn.request, turn.reply.response);
    e.parley.turns[5]!.signer = stand.publicKey;
  });
  expect(at(check(league), 83, 5)).toEqual(["signed with the public stand-in key, which anyone can use, in a league that claims real enclaves"]);
});

test.skipIf(!scripted)("I: a rewritten constitution in a re-signed request fails the byte-for-byte rebuild", () => {
  const league = editParley(scripted!, 0, (e) => {
    const turn = e.turns[0]!;
    const request = JSON.parse(turn.request);
    request.messages[0].content = request.messages[0].content.replace(/(CONSTITUTION OF [A-Z]+ \(version \d+\):\n)[\s\S]*$/, "$1Whatever the relayer wants this coin to believe.");
    turn.request = JSON.stringify(request);
    turn.reply = new LocalEnclave().sign(turn.model, turn.request, turn.reply.response);
    e.parley.turns[0]!.request_hash = sha256Hex(turn.request);
  });
  const findings = check(league);
  expect(findings.length).toBe(1);
  expect(findings[0]).toMatchObject({ parley: 0, turn: 0 });
  expect(findings[0]!.problem).toStartWith("request is not the one the contract writes: system message (rules and constitution) differs");
  expect(findings[0]!.problem).toContain('the recording has "Whatever the relayer wants this coin to believe."');
});

test.skipIf(!scripted)("the scripted league is labelled as signed by the public stand-in key", () => {
  const { manifest, evidence } = scripted!;
  const report = signerReport(manifest, evidence);
  expect(report).toHaveLength(1);
  expect(report[0]).toMatchObject({ publicKey: STAND_IN_KEY, kind: "stand-in", replies: evidence.reduce((n, e) => n + e.turns.length, 0) });
  expect(describeSigner(report[0]!)).toContain('sha256("parley local enclave")');
});

test.skipIf(!ai)("the request port writes a recorded request byte for byte", () => {
  const { manifest, evidence } = ai!;
  const { parley, turns } = evidence[0]!;
  const stats = { matches: 0, cooperated: 0, defected: 0, was_betrayed: 0, betrayed_other: 0 };
  const coin = (id: string) => ({ ...manifest.coins.find((c) => c.id === id)!, treasury: manifest.startTreasury, stats });
  const model = manifest.models.find((m) => m.id === parley.b_model)!;
  const spec = turnSpec({ talk_turns: 2 }, 5)!;
  const asked = { ...parley, turns: parley.turns.slice(0, 5) };
  const request = buildRequest({ max_message_len: manifest.maxMessageLength }, parley.b_model, model, asked, coin(parley.a), coin(parley.b), { outcomes: [] }, spec);
  expect(request).toBe(turns[5]!.request);
});
