import type { Attestation } from "@parley/relayer/src/attestation.ts";
import { type Coin, type EnclaveSigner, LocalEnclave, type Model, type Move, type Stats, sha256Hex, verifyReply, verifyTdxQuote } from "@parley/sdk";
import type { LeagueManifest, ParleyEvidence } from "./fixtures.ts";
import { PROTOCOL, type PairRecord, buildRequest, nearAmount, turnSpec } from "./prompt.ts";
import { spoken } from "./reply.ts";
import { type LeagueStats, summarize } from "./standings.ts";

export interface Finding {
  parley?: number;
  turn?: number;
  problem: string;
}

const QUOTE_EVIDENCE = "tdx-quote-sha256:";
const HISTORY_LEN = 8;

/** The scripted league's key. Its secret is sha256("parley local enclave"), a public constant, so anyone can sign with it. */
export const STAND_IN_KEY = new LocalEnclave().publicKey;
export const STAND_IN_LABEL = 'public stand-in key, secret sha256("parley local enclave"): anyone can sign with it, not hardware';

const trim = (text: string) => text.replace(/^ +| +$/g, "");
const short = (hex: string) => `${hex.slice(0, 12)}…`;

/** Mirrors `clean_message` in the contract, character for character. */
export function clean(raw: string, max: number): string {
  const text = trim(trim(raw.replace(/[\p{White_Space}\p{Cc}]+/gu, " ")).replace(/^"+|"+$/g, ""));
  if (text === "") return "(said nothing)";
  const chars = [...text];
  if (chars.length <= max) return text;
  const keep = Math.max(0, max - 1);
  const head = chars.slice(0, keep).join("");
  const at = head.lastIndexOf(" ");
  return `${(at >= 0 && chars[keep] !== " " ? head.slice(0, at) : head).replace(/ +$/, "")}…`;
}

function moveOf(raw: string): Move {
  const upper = raw.toUpperCase();
  const d = upper.indexOf("DEFECT");
  const c = upper.indexOf("COOPERATE");
  return d >= 0 && (c < 0 || d < c) ? "Defect" : "Cooperate";
}

function payoff(stake: bigint, commonsBefore: bigint, a: Move, b: Move): [bigint, bigint, bigint] {
  if (a === "Cooperate" && b === "Cooperate") {
    const bonus = stake / 2n < commonsBefore / 8n ? stake / 2n : commonsBefore / 8n;
    return [bonus, bonus, -2n * bonus];
  }
  if (a === "Defect" && b === "Defect") return [-(stake / 2n), -(stake / 2n), 2n * (stake / 2n)];
  return a === "Defect" ? [stake, -stake, 0n] : [-stake, stake, 0n];
}

/** A league that claims real model enclaves, by its mind or by any quote-backed key: every reply must then come from a key an Intel quote vouches for. */
export const claimsEnclaves = (manifest: LeagueManifest) =>
  manifest.mind !== "scripted" || manifest.models.some((m) => m.signers.some((s) => s.evidence.startsWith(QUOTE_EVIDENCE)));

export type SignerKind = "intel" | "stand-in" | "unproven";

interface KeyEntry {
  model: string;
  signer: EnclaveSigner;
  kind: SignerKind;
  problems: string[];
}

function quoteProblems(model: string, signer: EnclaveSigner, attestations: Attestation[]): string[] {
  const found = attestations.find((a) => a.model === model && a.publicKey === signer.public_key);
  if (!found) return ["no recorded attestation for the registered enclave key"];
  const problems: string[] = [];
  if (QUOTE_EVIDENCE + sha256Hex(found.quote) !== signer.evidence) problems.push("recorded quote is not the one registered on chain");
  const check = verifyTdxQuote(found.quote);
  problems.push(...check.problems);
  if (check.quote && check.quote.reportData !== signer.public_key + sha256Hex(found.nonceText)) problems.push("the quote does not name the registered key and nonce");
  return problems;
}

function keyTable(manifest: LeagueManifest, attestations: Attestation[]): Map<string, KeyEntry> {
  const table = new Map<string, KeyEntry>();
  for (const model of manifest.models) {
    for (const signer of model.signers) {
      const quoted = signer.evidence.startsWith(QUOTE_EVIDENCE);
      const problems = quoted ? quoteProblems(model.id, signer, attestations) : [];
      const kind: SignerKind = quoted ? (problems.length ? "unproven" : "intel") : signer.public_key === STAND_IN_KEY ? "stand-in" : "unproven";
      table.set(`${model.id}:${signer.public_key}`, { model: model.id, signer, kind, problems });
    }
  }
  return table;
}

/**
 * Each enclave key the arena registered with a quote hash must come with that quote, the quote must chain
 * to Intel, and it must name the key. Which replies such keys may sign is decided in `checkLeague`.
 */
export function checkAttestations(manifest: LeagueManifest, attestations: Attestation[]): Finding[] {
  return [...keyTable(manifest, attestations).values()].flatMap((k) => k.problems.map((p) => ({ problem: `${k.model}: ${p}` })));
}

export function attestedKeys(manifest: LeagueManifest): number {
  return manifest.models.flatMap((m) => m.signers).filter((s) => s.evidence.startsWith(QUOTE_EVIDENCE)).length;
}

export interface SignerReport {
  model: string;
  publicKey: string;
  evidence: string;
  kind: SignerKind;
  replies: number;
}

/** Every registered key, what backs it, and how many recorded replies it signed. */
export function signerReport(manifest: LeagueManifest, evidence: ParleyEvidence[], attestations: Attestation[] = []): SignerReport[] {
  const counts = new Map<string, number>();
  for (const { parley, turns } of evidence) {
    turns.forEach((turn, i) => {
      const key = `${i % 2 === 0 ? parley.a_model : parley.b_model}:${turn.reply.publicKey}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return [...keyTable(manifest, attestations)].map(([key, k]) => ({
    model: k.model,
    publicKey: k.signer.public_key,
    evidence: k.signer.evidence,
    kind: k.kind,
    replies: counts.get(key) ?? 0,
  }));
}

export function describeSigner(s: Pick<SignerReport, "kind" | "evidence">): string {
  if (s.kind === "intel") return "Intel TDX quote verified to Intel's root key";
  if (s.kind === "stand-in") return STAND_IN_LABEL;
  return s.evidence.startsWith(QUOTE_EVIDENCE) ? "its Intel TDX quote is missing or does not verify" : `no Intel TDX quote (evidence "${s.evidence}")`;
}

function checkReplies(manifest: LeagueManifest, evidence: ParleyEvidence[], keys: Map<string, KeyEntry>): Finding[] {
  const findings: Finding[] = [];
  const enclaves = claimsEnclaves(manifest);
  for (const { parley, turns, commonsBefore } of evidence) {
    const fail = (problem: string, turn?: number) => findings.push({ parley: parley.id, turn, problem });
    if (parley.status !== "Settled") {
      fail(`status is ${parley.status}`);
      continue;
    }
    if (turns.length !== parley.turns.length) fail("evidence and chain disagree on the number of turns");

    turns.forEach((turn, i) => {
      const onChain = parley.turns[i];
      if (!onChain) return;
      const model = i % 2 === 0 ? parley.a_model : parley.b_model;
      if (turn.model !== model) fail("model differs from the Parley's model", i);
      const key = keys.get(`${model}:${turn.reply.publicKey}`);
      if (!key) fail("signer is not a registered enclave key for this model", i);
      else if (key.kind === "unproven") fail(`signer ${short(turn.reply.publicKey)} is not backed by hardware: ${describeSigner({ kind: key.kind, evidence: key.signer.evidence })}`, i);
      else if (key.kind === "stand-in" && enclaves) fail("signed with the public stand-in key, which anyone can use, in a league that claims real enclaves", i);
      if (!verifyReply(model, turn.request, turn.reply)) fail("enclave signature does not verify", i);
      if (sha256Hex(turn.request) !== onChain.request_hash) fail("request hash differs from the chain", i);
      if (sha256Hex(turn.reply.response) !== onChain.response_hash) fail("response hash differs from the chain", i);
      if (turn.reply.publicKey !== onChain.signer) fail("signer differs from the chain", i);
      const text = spoken(turn.reply.response);
      const expected = onChain.kind === "Talk" ? clean(text, manifest.maxMessageLength) : clean(text, 64);
      if (expected !== onChain.text) fail("recorded text is not what the reply says", i);
      if (!turn.request.includes(`nonce ${parley.nonce}`)) fail("request does not carry this Parley's nonce", i);
    });

    const decisions = turns.filter((_, i) => parley.turns[i]?.kind === "Decide").map((t) => moveOf(spoken(t.reply.response)));
    const [a, b] = decisions;
    if (a !== parley.a_move || b !== parley.b_move) fail("moves on chain are not the moves in the signed replies");
    if (a && b) {
      const [da, db, dc] = payoff(BigInt(parley.stake), BigInt(commonsBefore), a, b);
      if (da !== BigInt(parley.a_delta) || db !== BigInt(parley.b_delta) || dc !== BigInt(parley.commons_delta)) {
        fail("payoff does not follow the rules");
      }
      if (da + db + dc !== 0n) fail("value was created or destroyed");
    }
  }
  return findings;
}

/** The recordings must be exactly Parleys 0..n-1, n being the count the arena reported. */
function checkSequence(manifest: LeagueManifest, evidence: ParleyEvidence[]): Finding[] {
  const findings: Finding[] = [];
  const n = manifest.parleys;
  if (manifest.overview.parleys !== n) findings.push({ problem: `league.json counts ${n} Parleys but its arena overview says ${manifest.overview.parleys}` });
  const seen = new Map<number, number>();
  for (const { parley } of evidence) seen.set(parley.id, (seen.get(parley.id) ?? 0) + 1);
  for (let id = 0; id < n; id++) if (!seen.has(id)) findings.push({ parley: id, problem: `no recording, though league.json counts ${n} Parleys` });
  for (const [id, count] of seen) {
    if (!Number.isInteger(id) || id < 0 || id >= n) findings.push({ parley: id, problem: `recorded, but league.json counts only ${n} Parleys` });
    else if (count > 1) findings.push({ parley: id, problem: `recorded ${count} times` });
  }
  return findings;
}

function firstDifference(want: string, got: string): string {
  let at = 0;
  while (at < want.length && want[at] === got[at]) at++;
  const show = (text: string) => JSON.stringify(text.slice(at, at + 48));
  return `at character ${at} the contract writes ${show(want)}, the recording has ${show(got)}`;
}

function describeMismatch(want: string, got: string): string {
  let recorded: { messages?: { content?: unknown }[] };
  try {
    recorded = JSON.parse(got);
  } catch {
    return "the recorded request is not JSON";
  }
  const rebuilt = JSON.parse(want) as { messages: { content: string }[] };
  for (const [i, part] of ["system message (rules and constitution)", "user message (treasuries, records, stake, history, talk)"].entries()) {
    const theirs = recorded.messages?.[i]?.content;
    const ours = rebuilt.messages[i]!.content;
    if (theirs !== ours) return `${part} differs: ${typeof theirs === "string" ? firstDifference(ours, theirs) : "missing"}`;
  }
  return `request settings (model, seed, max_tokens, registered options) differ: ${firstDifference(want, got)}`;
}

const zeroStats = (): Stats => ({ matches: 0, cooperated: 0, defected: 0, was_betrayed: 0, betrayed_other: 0 });
const pairKey = (x: string, y: string) => (x < y ? `${x}:${y}` : `${y}:${x}`);

/**
 * Replays the league from its start: every coin at the starting treasury with an empty record, then each Parley in
 * order, exactly as `parleys.rs` settles it. Before each turn the request is rebuilt from that state, as `prompt.rs`
 * writes it, and compared byte for byte with the recording. At the end every treasury, record and the commons
 * must be what league.json says.
 */
function checkReplay(manifest: LeagueManifest, ordered: ParleyEvidence[]): { findings: Finding[]; coins: Coin[] } {
  const findings: Finding[] = [];
  const fail = (problem: string, parley?: number, turn?: number) => findings.push({ parley, turn, problem });
  const coins = new Map(manifest.coins.map((c) => [c.id, { ...c, treasury: manifest.startTreasury, matches_played: 0, stats: zeroStats() }]));
  const replayed = () => [...coins.values()];
  if (manifest.overview.protocol !== PROTOCOL) {
    fail(`recorded under protocol ${manifest.overview.protocol}, but this checker rebuilds ${PROTOCOL} requests: no request, treasury or record was re-derived`);
    return { findings, coins: replayed() };
  }
  if (manifest.overview.coins !== manifest.coins.length) fail(`league.json lists ${manifest.coins.length} coins but its arena overview says ${manifest.overview.coins}`);

  const models = new Map<string, Model>(manifest.models.map((m) => [m.id, m]));
  const pairs = new Map<string, PairRecord>();
  const talkTurns = (ordered[0]?.parley.turns.filter((t) => t.kind === "Talk").length ?? 0) / 2;
  let commons = BigInt(ordered[0]?.commonsBefore ?? manifest.overview.commons);
  let rate: { bps: bigint; from: number } | undefined;

  for (const { parley, turns, commonsBefore } of ordered) {
    const a = coins.get(parley.a);
    const b = coins.get(parley.b);
    if (!a || !b) {
      fail(`coin ${a ? parley.b : parley.a} is not in league.json`, parley.id);
      continue;
    }
    if (parley.status !== "Settled") continue;

    if (BigInt(commonsBefore) !== commons) fail(`commons before this Parley is recorded as ${commonsBefore}, but the earlier payoffs leave ${commons}`, parley.id);
    const stake = BigInt(parley.stake);
    const smaller = BigInt(a.treasury) < BigInt(b.treasury) ? BigInt(a.treasury) : BigInt(b.treasury);
    rate ??= { bps: smaller > 0n ? (stake * 10_000n + smaller - 1n) / smaller : 0n, from: parley.id };
    if ((smaller * rate.bps) / 10_000n !== stake) {
      fail(`stake ${nearAmount(stake)} is not ${Number(rate.bps) / 100}% of the smaller treasury (${nearAmount(smaller)}), the rate Parley ${rate.from} uses`, parley.id);
    }

    const sides = [
      { coin: a, model: parley.a_model, version: parley.a_constitution_version },
      { coin: b, model: parley.b_model, version: parley.b_constitution_version },
    ];
    const rebuildable = sides.map(({ coin, model, version }) => {
      if (version !== coin.constitution_version) {
        fail(`${coin.name} played under constitution version ${version}, but league.json holds only the text of version ${coin.constitution_version}: its requests in this Parley were not rebuilt`, parley.id);
        return false;
      }
      if (model !== coin.model) {
        fail(`${coin.name} played with model ${model}, but its constitution version ${version} names ${coin.model}: its requests in this Parley were not rebuilt`, parley.id);
        return false;
      }
      if (!models.has(model)) {
        fail(`model ${model} is not registered in league.json: its requests in this Parley were not rebuilt`, parley.id);
        return false;
      }
      return true;
    });

    const record = pairs.get(pairKey(a.id, b.id)) ?? { outcomes: [] };
    if (!Number.isInteger(talkTurns) || talkTurns < 1 || parley.turns.length !== talkTurns * 2 + 2) {
      fail(`has ${parley.turns.length} turns; every Parley in this league has ${talkTurns * 2 + 2}`, parley.id);
    } else {
      turns.forEach((turn, i) => {
        const spec = turnSpec({ talk_turns: talkTurns }, i);
        const onChain = parley.turns[i];
        if (!spec || !onChain || onChain.side !== spec.side || onChain.kind !== spec.kind) {
          fail(`turn order is not the contract's: expected ${spec ? `${spec.side} ${spec.kind}` : "no turn"}`, parley.id, i);
          return;
        }
        const side = sides[spec.side === "A" ? 0 : 1]!;
        if (!rebuildable[spec.side === "A" ? 0 : 1]) return;
        const asked = { id: parley.id, nonce: parley.nonce, stake: parley.stake, turns: parley.turns.slice(0, i) };
        const request = buildRequest({ max_message_len: manifest.maxMessageLength }, side.model, models.get(side.model)!, asked, a, b, record, spec);
        if (request !== turn.request) fail(`request is not the one the contract writes: ${describeMismatch(request, turn.request)}`, parley.id, i);
      });
    }

    const [aMove, bMove] = [parley.a_move, parley.b_move];
    if (!aMove || !bMove) continue;
    a.treasury = (BigInt(a.treasury) + BigInt(parley.a_delta)).toString();
    b.treasury = (BigInt(b.treasury) + BigInt(parley.b_delta)).toString();
    commons += BigInt(parley.commons_delta);
    for (const [coin, mine, theirs] of [
      [a, aMove, bMove],
      [b, bMove, aMove],
    ] as const) {
      coin.matches_played++;
      coin.stats.matches++;
      if (mine === "Cooperate") coin.stats.cooperated++;
      else coin.stats.defected++;
      if (mine === "Cooperate" && theirs === "Defect") coin.stats.was_betrayed++;
      if (mine === "Defect" && theirs === "Cooperate") coin.stats.betrayed_other++;
    }
    const outcomes: [Move, Move][] = [...record.outcomes, a.id < b.id ? [aMove, bMove] : [bMove, aMove]];
    pairs.set(pairKey(a.id, b.id), { outcomes: outcomes.slice(-HISTORY_LEN) });
  }

  for (const recorded of manifest.coins) {
    const coin = coins.get(recorded.id)!;
    if (recorded.treasury !== coin.treasury) {
      const why = recorded.house ? "" : ` (${recorded.name} is a community coin: its mint and redeem orders are not in the recording)`;
      fail(
        `${recorded.name}: league.json gives a final treasury of ${nearAmount(BigInt(recorded.treasury))} (${recorded.treasury}), but the starting treasury plus every recorded payoff gives ${nearAmount(BigInt(coin.treasury))} (${coin.treasury})${why}`,
      );
    }
    for (const field of Object.keys(coin.stats) as (keyof Stats)[]) {
      if (recorded.stats[field] !== coin.stats[field]) fail(`${recorded.name}: league.json says ${field} ${recorded.stats[field]}, the recorded Parleys give ${coin.stats[field]}`);
    }
    if (recorded.matches_played !== coin.matches_played) fail(`${recorded.name}: league.json says ${recorded.matches_played} Parleys played, the recordings give ${coin.matches_played}`);
  }
  if (BigInt(manifest.overview.commons) !== commons) fail(`league.json gives a final commons of ${manifest.overview.commons}, but the recorded payoffs leave ${commons}`);
  return { findings, coins: replayed() };
}

function differences(path: string, want: unknown, got: unknown, out: string[]) {
  if (out.length >= 8) return;
  if (typeof want !== "object" || want === null || typeof got !== "object" || got === null) {
    if (!Object.is(want, got)) out.push(`stats.json ${path} is ${JSON.stringify(got)}, re-derived ${JSON.stringify(want)}`);
    return;
  }
  const w = want as Record<string, unknown>;
  const g = got as Record<string, unknown>;
  for (const key of new Set([...Object.keys(w), ...Object.keys(g)])) {
    const item = w[key] ?? g[key];
    const id = Array.isArray(want) && typeof item === "object" && item !== null && "id" in item ? String(item.id) : undefined;
    differences(id === undefined ? (path ? `${path}.${key}` : key) : `${path}[${id}]`, w[key], g[key], out);
  }
}

/**
 * Re-checks a recorded league with no network and no key: every reply's signature against the registered enclave
 * key and what backs that key, every hash the chain stored, every message, move and payoff, every request byte,
 * the final treasuries, records and commons, and, when given, the standings in stats.json.
 */
export function checkLeague(manifest: LeagueManifest, evidence: ParleyEvidence[], attestations: Attestation[] = [], stats?: LeagueStats): Finding[] {
  const keys = keyTable(manifest, attestations);
  const findings: Finding[] = [...keys.values()].flatMap((k) => k.problems.map((p) => ({ problem: `${k.model}: ${p}` })));
  const ordered = [...evidence].sort((x, y) => x.parley.id - y.parley.id);
  const sequence = checkSequence(manifest, ordered);
  findings.push(...sequence, ...checkReplies(manifest, ordered, keys));
  if (sequence.length) {
    findings.push({ problem: "the Parley recordings are incomplete, so requests, treasuries and standings were not re-derived" });
    return findings;
  }
  const replay = checkReplay(manifest, ordered);
  findings.push(...replay.findings);
  if (stats) {
    const out: string[] = [];
    differences("", summarize(replay.coins, ordered, BigInt(manifest.startTreasury), manifest.rounds), stats, out);
    findings.push(...out.map((problem) => ({ problem })));
  }
  return findings;
}
