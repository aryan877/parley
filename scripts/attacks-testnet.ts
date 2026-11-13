import { Arena, NearRpc, type Parley, type TxOutcome } from "@parley/sdk";
import { NearAiMind, TESTNET_FILE, publicTestnet } from "@parley/relayer";
import { ATTACKS, type AttackId, type Refusal, attackLab } from "@parley/relayer/src/attacks.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Runs each attack in the Proof page's lab once against the live testnet arena, from `parley-relay.testnet`, and
 * records the refused transactions. Pass attack ids to run only those; earlier results are kept.
 * The one-letter attack needs NEAR_AI_API_KEY, because this script has no hold on the server's own replies.
 */
const pub = publicTestnet();
const SITE = process.env.PARLEY_SITE_URL ?? "https://parley.aryankumar.dev";
const OUT = join(dirname(TESTNET_FILE), "testnet-attacks.json");
const rpcUrl = process.env.PARLEY_RPC_URL ?? pub.rpcUrl;
const deployment = { network: "testnet" as const, rpcUrl, contractId: pub.contractId, accounts: {} };
const lab = attackLab(deployment, async (id) => {
  const res = await fetch(`${SITE}/api/match/${id}`);
  return res.ok ? ((await res.json()) as { turns: { model: string; reply: { response: string; signature: string; publicKey: string } }[] }) : null;
});
if (!lab.account) throw new Error("no key for parley-relay.testnet; set PARLEY_RELAY_KEY or add it to ~/.near-credentials/testnet");
const chain = new Arena({ rpcUrl, contractId: pub.contractId });
const rpc = new NearRpc([rpcUrl]);

type Kept = Refusal & { genuineTx?: string };
const asked = process.argv.slice(2).filter((a): a is AttackId => (ATTACKS as readonly string[]).includes(a));
const todo = asked.length ? asked : [...ATTACKS];
const kept = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { attacks: Partial<Record<AttackId, Kept>> }).attacks : {};
const save = () =>
  writeFileSync(OUT, `${JSON.stringify({ contract: pub.contractId, account: lab.account, recordedAt: new Date().toISOString(), attacks: kept }, null, 2)}\n`);

async function openTurn(timeoutMs = 15 * 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const p = (await chain.parleys(0, 3)).find((x) => x.status === "Open");
    if (p && (await chain.turnRequest(p.id))) return p;
    await Bun.sleep(3000);
  }
  throw new Error("no match was played in time");
}

/** Each new turn as the arena's server announces it on the site's public live stream, right after the last reply lands. */
async function* announced(): AsyncGenerator<{ parley: Parley; at: number }> {
  const res = await fetch(`${SITE}/api/live`);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
      const data = buffer
        .slice(0, cut)
        .split("\n")
        .find((line) => line.startsWith("data: "));
      buffer = buffer.slice(cut + 2);
      const event = data ? (JSON.parse(data.slice(6)) as { type: string; parley?: Parley }) : null;
      if (event?.parley?.status === "Open" && (event.type === "opened" || event.type === "turn")) yield { parley: event.parley, at: Date.now() };
    }
  }
}

async function receiptBlock(hash: string, sender: string): Promise<number> {
  const tx = await rpc.call<TxOutcome>("tx", { tx_hash: hash, sender_account_id: sender, wait_until: "EXECUTED_OPTIMISTIC" });
  return (await rpc.block(tx.receipts_outcome[0]!.block_hash)).header.height;
}

async function genuineTx(id: number, index: number): Promise<string | null> {
  for (let tries = 0; tries < 60; tries++) {
    const res = await fetch(`${SITE}/api/match/${id}`);
    const turn = res.ok ? ((await res.json()) as { turns: { index: number; txHash: string }[] }).turns.find((t) => t.index === index) : undefined;
    if (turn) return turn.txHash;
    await Bun.sleep(3000);
  }
  return null;
}

/**
 * Races the arena's server: three NEAR AI calls for the turn it is about to answer, and the first one back goes out with
 * one letter changed. It counts only if the refused transaction ran in an earlier block than the genuine reply for that turn.
 */
async function oneLetter(): Promise<Kept | null> {
  const key = process.env.NEAR_AI_API_KEY;
  if (!key) {
    console.log("one-letter: skipped, NEAR_AI_API_KEY is not set");
    return null;
  }
  const nearAi = new NearAiMind(key, process.env.NEAR_AI_BASE_URL);
  const shadow = lab.watch({ name: "near-ai-race", reply: (model, request) => Promise.any([0, 1, 2].map(() => nearAi.reply(model, request))) });
  let tries = 0;
  for await (const { parley, at } of announced()) {
    const index = parley.turns.length;
    if (Date.now() - at > 1500) continue;
    const request = await chain.turnRequest(parley.id);
    if (!request) continue;
    const pending = lab.run("one-letter", `recorder-${tries}`);
    await shadow.reply(index % 2 === 0 ? parley.a_model : parley.b_model, request).catch((e) => console.log(`one-letter: NEAR AI failed: ${e instanceof Error ? e.message : e}`));
    const result = await pending;
    if (!("refusal" in result)) console.log(`one-letter: ${result.error}`);
    else {
      const genuine = await genuineTx(parley.id, index);
      const [ours, theirs] = genuine ? [await receiptBlock(result.refusal.tx, lab.account!), await receiptBlock(genuine, pub.owner)] : [0, 0];
      if (genuine && ours < theirs) return { ...result.refusal, genuineTx: genuine };
      console.log(`one-letter: refused in ${result.refusal.tx} at block ${ours}, after the genuine reply at block ${theirs}; trying again`);
    }
    if (++tries >= 16) return null;
  }
  return null;
}

for (const attack of todo) {
  let refusal: Kept | null = null;
  if (attack === "one-letter") refusal = await oneLetter();
  else {
    if (attack === "unknown-key" || attack === "replay") await openTurn();
    const result = await lab.run(attack, `recorder-${attack}`);
    if ("refusal" in result) refusal = result.refusal;
    else console.log(`${attack}: ${result.error}`);
  }
  if (!refusal) continue;
  kept[attack] = refusal;
  save();
  console.log(`${attack}: refused by ${refusal.method}, "${refusal.reason}", ${refusal.tx}`);
}
process.exit(0);
