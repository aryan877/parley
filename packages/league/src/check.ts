import { type Move, sha256Hex, verifyReply } from "@parley/sdk";
import type { LeagueManifest, ParleyEvidence } from "./fixtures.ts";

export interface Finding {
  parley: number;
  turn?: number;
  problem: string;
}

function assistantText(response: string): string {
  const body = JSON.parse(response) as { choices?: { message?: { content?: string | null } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

function clean(raw: string, max: number): string {
  const text = raw.replace(/[\s\p{Cc}]+/gu, " ").trim().replace(/^"+|"+$/g, "").trim();
  return text === "" ? "(said nothing)" : [...text].slice(0, max).join("");
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
 * Re-checks a recorded league with no network and no key: every reply's signature against the registered
 * enclave key, every hash the chain stored, every message and move the chain derived, and every payoff.
 */
export function checkLeague(manifest: LeagueManifest, evidence: ParleyEvidence[], maxMessage = 240): Finding[] {
  const findings: Finding[] = [];
  const keys = new Map(manifest.signers.map((s) => [`${s.model}:${s.publicKey}`, s]));

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
      const text = assistantText(turn.reply.response);
      const expected = onChain.kind === "Talk" ? clean(text, maxMessage) : clean(text, 64);
      if (expected !== onChain.text) fail("recorded text is not what the reply says", i);
      if (!turn.request.includes(`nonce ${parley.nonce}`)) fail("request does not carry this Parley's nonce", i);
    });

    const decisions = turns.filter((_, i) => parley.turns[i]?.kind === "Decide").map((t) => moveOf(assistantText(t.reply.response)));
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
