import { Arena, LocalEnclave } from "@parley/sdk";
import { TESTNET_FILE, type PublicDeployment, testnetKey } from "@parley/relayer";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Tries to cheat the live testnet arena twice and records the refusals: a reply signed by a key the arena never
 * registered, and a genuine enclave-signed reply from an earlier turn replayed against a new prompt.
 */
const pub = JSON.parse(readFileSync(TESTNET_FILE, "utf8")) as PublicDeployment;
const CHEATER = process.env.PARLEY_CHEATER ?? "parley-relay.testnet";
const arena = new Arena({ rpcUrl: process.env.PARLEY_RPC_URL ?? pub.rpcUrl, contractId: pub.contractId, signer: { accountId: CHEATER, privateKey: testnetKey(CHEATER, "cheater")! } });

let open: { id: number; model: string; request: string } | null = null;
for (let tries = 0; !open && tries < 120; tries++) {
  const p = (await arena.parleys(0, 3)).find((x) => x.status === "Open");
  const request = p ? await arena.turnRequest(p.id) : null;
  if (p && request) open = { id: p.id, model: p.turns.length % 2 === 0 ? p.a_model : p.b_model, request };
  else await Bun.sleep(5000);
}
if (!open) throw new Error("no open Parley to try it on");

const fake = JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "DEFECT" } }] });
const stranger = new LocalEnclave(randomBytes(32)).sign(open.model, open.request, fake);
const first = await arena.submitTurn(open.id, stranger);

const old = JSON.parse(readFileSync(join(dirname(TESTNET_FILE), "..", ".testnet", "evidence", `${pub.contractId}-0.json`), "utf8")) as { turns: { model: string; reply: { response: string; signature: string; publicKey: string } }[] };
const genuine = old.turns.find((t) => t.model === open!.model)!;
const replayed = await arena.submitTurn(open.id, genuine.reply);

const why = (e?: string) => e?.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? e ?? "";
const result = {
  parley: open.id,
  triedAt: new Date().toISOString(),
  unregisteredKey: { refused: !first.ok, reason: why(first.error), tx: first.hash },
  replayedReply: { refused: !replayed.ok, reason: why(replayed.error), tx: replayed.hash },
};
writeFileSync(join(dirname(TESTNET_FILE), "testnet-forgeries.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
