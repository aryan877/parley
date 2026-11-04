import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyTdxQuote } from "../src/tdx.ts";

const recorded = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/tdx-quote.json"), "utf8")) as { publicKey: string; nonce: string; quote: string };

function flip(hex: string, byte: number): string {
  const value = (Number.parseInt(hex.slice(byte * 2, byte * 2 + 2), 16) ^ 1).toString(16).padStart(2, "0");
  return hex.slice(0, byte * 2) + value + hex.slice(byte * 2 + 2);
}

test("a real NEAR AI Cloud quote chains to the Intel root and names the enclave key", () => {
  const check = verifyTdxQuote(recorded.quote);
  expect(check.problems).toEqual([]);
  expect(check.quote?.reportData).toBe(recorded.publicKey + recorded.nonce);
});

test("changing the key inside the quote breaks its signature", () => {
  expect(verifyTdxQuote(flip(recorded.quote, 48 + 520)).problems).toEqual(["quote signature does not verify"]);
});

test("a swapped attestation key is not vouched for", () => {
  expect(verifyTdxQuote(flip(recorded.quote, 632 + 4 + 70)).problems).toContain("quoting enclave did not vouch for the attestation key");
});

test("a tampered quoting enclave report is refused", () => {
  expect(verifyTdxQuote(flip(recorded.quote, 632 + 4 + 134 + 10)).problems).toEqual(["quoting enclave report signature does not verify"]);
});

test("a tampered certificate breaks the chain", () => {
  expect(verifyTdxQuote(flip(recorded.quote, recorded.quote.length / 2 - 3000)).ok).toBe(false);
});

test("garbage is not a quote", () => {
  expect(verifyTdxQuote("00ff").ok).toBe(false);
  expect(verifyTdxQuote("zz").ok).toBe(false);
});
