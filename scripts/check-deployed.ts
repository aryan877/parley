import { baseEncode } from "near-api-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The committed arena wasm is the code running on testnet: its sha256 must equal the deployed code hash. */
const ROOT = join(import.meta.dir, "..");
const deployment = JSON.parse(readFileSync(join(ROOT, "deployments/testnet.json"), "utf8")) as { contractId: string; rpcUrl: string; codeHash: string };
const local = baseEncode(createHash("sha256").update(readFileSync(join(ROOT, "contracts/arena/res/parley_arena.wasm"))).digest());
let onChain: string | null = null;
if (process.argv.includes("--live")) {
  const res = await fetch(deployment.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: deployment.contractId } }),
  });
  onChain = ((await res.json()) as { result?: { code_hash: string } }).result?.code_hash ?? null;
}
const expected = onChain ?? deployment.codeHash;
console.log(`${deployment.contractId}: ${onChain ? "on chain" : "recorded"} ${expected}, committed wasm ${local}`);
if (local !== expected) {
  console.error("the committed wasm is not the deployed code");
  process.exit(1);
}
