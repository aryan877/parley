import { Arena } from "@parley/sdk";
import { TESTNET_FILE, publicTestnet, testnetKey } from "@parley/relayer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A holder rewrites one coin's constitution on the live testnet arena: propose, vote, wait out the vote, finalize,
 * wait out the timelock, enact. Every step is a transaction; the next Parley that coin plays uses the new text.
 */
const pub = publicTestnet();
const COIN = process.argv[2] ?? "saint";
const TEXT =
  process.argv[3] ??
  "Cooperate with any coin that has never betrayed a coin that trusted it. Defect against any coin that has. In talk, stay warm, and say plainly what you will do and why.";
const holder = { accountId: pub.owner, privateKey: testnetKey(pub.owner, "owner")! };
const arena = new Arena({ rpcUrl: pub.rpcUrl, contractId: pub.contractId, signer: holder });
const log = join(dirname(TESTNET_FILE), "testnet-amendment.json");
const steps: Record<string, string> = existsSync(log) ? (JSON.parse(readFileSync(log, "utf8")) as { steps: Record<string, string> }).steps : {};

const must = async (step: string, call: Promise<{ ok: boolean; hash: string; error?: string; value?: unknown }>) => {
  const r = await call;
  if (!r.ok) throw new Error(`${step}: ${r.error}`);
  steps[step] = r.hash;
  writeFileSync(log, `${JSON.stringify({ coin: COIN, constitution: TEXT, steps }, null, 2)}\n`);
  console.log(`${step}: ${r.hash}`);
  return r.value;
};

const coin = (await arena.coin(COIN))!;
const config = await arena.config();
const before = coin.constitution_version;
const id = (await must("propose", arena.proposeAmendment(COIN, TEXT, coin.model))) as number;
await must("vote yes", arena.vote(id, true, BigInt(await arena.shares(COIN, holder.accountId))));
const wait = async (ns: string, why: string) => {
  const ms = Number(BigInt(ns) / 1_000_000n) + 5000;
  console.log(`waiting ${Math.round(ms / 1000)}s: ${why}`);
  await Bun.sleep(ms);
};
await wait(config.vote_period_ns, "the vote stays open");
await must("finalize", arena.finalizeAmendment(id));
await wait(config.timelock_ns, "the timelock lets anyone who disagrees sell first");
await must("enact", arena.enactAmendment(id));
const after = (await arena.coin(COIN))!;
console.log(`${after.name} rules v${before} -> v${after.constitution_version}`);
