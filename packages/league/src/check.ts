import type { Attestation } from "@parley/relayer/src/attestation.ts";
import { type Move, sha256Hex, verifyReply, verifyTdxQuote } from "@parley/sdk";
import type { LeagueManifest, ParleyEvidence } from "./fixtures.ts";
import { spoken } from "./reply.ts";

export interface Finding {
  parley?: number;
  turn?: number;
  problem: string;
}

const QUOTE_EVIDENCE = "tdx-quote-sha256:";

const trim = (text: string) => text.replace(/^ +| +$/g, "");

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

/**
 * Each enclave key the arena registered with a quote hash must come with that quote, the quote must chain
 * to Intel, and it must name the key. Keys registered without a quote are local stand-ins and are skipped.
 */
export function checkAttestations(manifest: LeagueManifest, attestations: Attestation[]): Finding[] {
  const findings: Finding[] = [];
  for (const model of manifest.models) {
    for (const signer of model.signers) {
      if (!signer.evidence.startsWith(QUOTE_EVIDENCE)) continue;
      const fail = (problem: string) => findings.push({ problem: `${model.id}: ${problem}` });
      const found = attestations.find((a) => a.model === model.id && a.publicKey === signer.public_key);
      if (!found) {
        fail("no recorded attestation for the registered enclave key");
        continue;
      }
      if (QUOTE_EVIDENCE + sha256Hex(found.quote) !== signer.evidence) fail("recorded quote is not the one registered on chain");
      const check = verifyTdxQuote(found.quote);
      for (const problem of check.problems) fail(problem);
      if (check.quote && check.quote.reportData !== signer.public_key + sha256Hex(found.nonceText)) {
        fail("the quote does not name the registered key and nonce");
      }
    }
  }
  return findings;
}

export function attestedKeys(manifest: LeagueManifest): number {
  return manifest.models.flatMap((m) => m.signers).filter((s) => s.evidence.startsWith(QUOTE_EVIDENCE)).length;
}

/**
 * Re-checks a recorded league with no network and no key: every reply's signature against the registered
 * enclave key, every hash the chain stored, every message and move the chain derived, and every payoff.
 */
export function checkLeague(manifest: LeagueManifest, evidence: ParleyEvidence[], attestations: Attestation[] = [], maxMessage = manifest.maxMessageLength): Finding[] {
  const findings: Finding[] = checkAttestations(manifest, attestations);
  const keys = new Set(manifest.models.flatMap((m) => m.signers.map((s) => `${m.id}:${s.public_key}`)));

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
      if (!keys.has(`${model}:${turn.reply.publicKey}`)) fail("signer is not a registered enclave key for this model", i);
      if (!verifyReply(model, turn.request, turn.reply)) fail("enclave signature does not verify", i);
      if (sha256Hex(turn.request) !== onChain.request_hash) fail("request hash differs from the chain", i);
      if (sha256Hex(turn.reply.response) !== onChain.response_hash) fail("response hash differs from the chain", i);
      if (turn.reply.publicKey !== onChain.signer) fail("signer differs from the chain", i);
      const text = spoken(turn.reply.response);
      const expected = onChain.kind === "Talk" ? clean(text, maxMessage) : clean(text, 64);
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
