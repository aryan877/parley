import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Attestation, ROOT, quoteEvidence } from "@parley/relayer";
import { type LeagueManifest, attestedKeys, checkAttestations } from "../src/index.ts";

const recorded = JSON.parse(readFileSync(join(ROOT, "packages/sdk/test/fixtures/tdx-quote.json"), "utf8")) as { model: string; publicKey: string; quote: string };

const attestation: Attestation = {
  model: recorded.model,
  publicKey: recorded.publicKey,
  nonceText: "parley-nonce-test",
  quote: recorded.quote,
  source: "test",
  fetchedAt: "2026-11-11T00:00:00.000Z",
  platform: {},
};

function manifest(evidence = quoteEvidence(recorded.quote)): LeagueManifest {
  const signers = [{ public_key: recorded.publicKey, evidence, active_from: "0" }];
  return { models: [{ id: recorded.model, max_tokens_talk: 200, max_tokens_decide: 24, options: "{}", signers }] } as LeagueManifest;
}

const problems = (m: LeagueManifest, a: Attestation[]) => checkAttestations(m, a).map((f) => f.problem.replace(`${recorded.model}: `, ""));

test("a registered key with its recorded quote passes", () => {
  expect(problems(manifest(), [attestation])).toEqual([]);
  expect(attestedKeys(manifest())).toBe(1);
});

test("a key registered with a quote must come with that quote", () => {
  expect(problems(manifest(), [])).toEqual(["no recorded attestation for the registered enclave key"]);
});

test("a quote made for another nonce is refused", () => {
  expect(problems(manifest(), [{ ...attestation, nonceText: "some other league" }])).toEqual(["the quote does not name the registered key and nonce"]);
});

test("the recorded quote must be the one registered on chain", () => {
  const other = quoteEvidence(`${recorded.quote}00`);
  expect(problems(manifest(other), [attestation])).toEqual(["recorded quote is not the one registered on chain"]);
});

test("a local stand-in key is not treated as attested", () => {
  const local = manifest("local scripted enclave, not a TEE");
  expect(problems(local, [])).toEqual([]);
  expect(attestedKeys(local)).toBe(0);
});
