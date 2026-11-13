import { expect, test } from "bun:test";
import { NearRpc, RpcRefusal, functionCall, toBase64 } from "../src/rpc.ts";

function node(answers: Record<string, (() => Response)[]>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const next = answers[url]?.shift();
    if (!next) throw new Error(`unexpected call to ${url}`);
    return next();
  };
  return { asked, fetch };
}

const ok = (result: unknown) => () => Response.json({ jsonrpc: "2.0", id: "parley", result });
const error = (name: string, cause: string, data = "") => () => Response.json({ jsonrpc: "2.0", id: "parley", error: { name, cause: { name: cause }, code: -32000, data } });

test("a rate-limited node hands the call to the next one, then the list repeats", async () => {
  const { asked, fetch } = node({
    a: [() => new Response("slow down", { status: 429 }), ok({ code_hash: "abc", block_height: 7 })],
    b: [error("HANDLER_ERROR", "UNKNOWN_TRANSACTION")],
  });
  const rpc = new NearRpc(["a", "b"], { fetch, backoffMs: 0 });
  expect((await rpc.account("x.testnet")).code_hash).toBe("abc");
  expect(asked).toEqual(["a", "b", "a"]);
});

test("a refusal is final and no other node is asked", async () => {
  const { asked, fetch } = node({ a: [error("HANDLER_ERROR", "CONTRACT_EXECUTION_ERROR", "Smart contract panicked: no")] });
  const rpc = new NearRpc(["a", "b"], { fetch, backoffMs: 0 });
  const failed = await rpc.view("x.testnet", "get_thing").catch((e: unknown) => e);
  expect(failed).toBeInstanceOf(RpcRefusal);
  expect((failed as Error).message).toContain("panicked: no");
  expect(asked).toEqual(["a"]);
});

test("gives up after its attempts with the last problem", async () => {
  const { fetch } = node({ a: Array.from({ length: 3 }, () => () => new Response("", { status: 503 })) });
  const rpc = new NearRpc(["a"], { fetch, backoffMs: 0, attempts: 3 });
  await expect(rpc.block("h")).rejects.toThrow("a answered HTTP 503");
});

test("view results and function call arguments decode as UTF-8 JSON", async () => {
  const bytes = [...new TextEncoder().encode(JSON.stringify({ said: "café ✓" }))];
  const rpc = new NearRpc(["a"], { fetch: node({ a: [ok({ result: bytes })] }).fetch });
  expect(await rpc.view("x.testnet", "said")).toEqual({ said: "café ✓" });
  const tx = { transaction: { hash: "h", signer_id: "s", receiver_id: "r", actions: [{ FunctionCall: { method_name: "submit_turn", args: toBase64('{"id":3,"response":"é"}') } }] } };
  expect(functionCall(tx)).toEqual({ method: "submit_turn", args: { id: 3, response: "é" } });
  expect(functionCall({ transaction: { ...tx.transaction, actions: ["CreateAccount"] } })).toBeNull();
});
