import { expect, test } from "bun:test";
import { LocalEnclave, formatNear, near, sha256Hex, signedText, verifyReply } from "../src/index.ts";

test("sha256 matches a known vector", () => {
  expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the signed text is model, request hash, response hash", () => {
  expect(signedText("m", "abc", "abc")).toBe(`m:${sha256Hex("abc")}:${sha256Hex("abc")}`);
});

test("a local enclave reply verifies only for the exact request, response and model", () => {
  const enclave = new LocalEnclave();
  const reply = enclave.sign("model-a", "request", "response");
  expect(verifyReply("model-a", "request", reply)).toBe(true);
  expect(verifyReply("model-b", "request", reply)).toBe(false);
  expect(verifyReply("model-a", "request ", reply)).toBe(false);
  expect(verifyReply("model-a", "request", { ...reply, response: "other" })).toBe(false);
  expect(verifyReply("model-a", "request", { ...reply, signature: "zz" })).toBe(false);
});

test("NEAR amounts convert both ways", () => {
  expect(near("1.5")).toBe(1_500_000_000_000_000_000_000_000n);
  expect(formatNear(near(100))).toBe("100.00");
  expect(formatNear(near("0.505"))).toBe("0.50");
  expect(formatNear(-near("2.25"))).toBe("-2.25");
});
