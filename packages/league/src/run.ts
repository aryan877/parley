import { Arena, LocalEnclave, type SignerList, near } from "@parley/sdk";
import { type Mind, deployLocal, loadConstitutions, openAndPlay } from "@parley/relayer";
import { type LeagueManifest, type ParleyEvidence, writeLeague } from "./fixtures.ts";
import { summarize } from "./standings.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LeagueOptions {
  name: string;
  mind: Mind;
  model: string;
  signers: { model: string; public_key: string; evidence: string }[];
  rounds: number;
  treasury: bigint;
  out: string;
  log?: (line: string) => void;
}

/** Every pair of house constitutions meets once per round, on a fresh local arena, and every turn is recorded. */
export async function runLeague(options: LeagueOptions) {
  const log = options.log ?? (() => {});
  const deployment = await deployLocal(options.signers);
  const arena = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const constitutions = loadConstitutions();
  for (const c of constitutions) {
    const made = await arena.createCoin({ id: c.id, name: c.name, constitution: c.text, model: options.model }, options.treasury, true);
    if (!made.ok) throw new Error(`create ${c.id}: ${made.error}`);
  }

  const ids = constitutions.map((c) => c.id);
  const evidence: ParleyEvidence[] = [];
  for (let round = 0; round < options.rounds; round++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pair: [string, string] = (round + i + j) % 2 === 0 ? [ids[i]!, ids[j]!] : [ids[j]!, ids[i]!];
        const commonsBefore = (await arena.overview()).commons;
        const { parley, turns } = await openAndPlay(arena, options.mind, pair);
        evidence.push({
          parley,
          commonsBefore,
          turns: turns.map((t) => ({ index: t.index, model: t.model, request: t.request, reply: t.reply, txHash: t.txHash })),
        });
        log(`round ${round + 1} #${parley.id} ${parley.a} ${parley.a_move} / ${parley.b} ${parley.b_move}`);
      }
    }
  }

  const signers: SignerList[] = await arena.signers();
  const coins = await arena.coins();
  const manifest: LeagueManifest = {
    name: options.name,
    mind: options.mind.name,
    network: deployment.network,
    contractId: deployment.contractId,
    recordedAt: new Date().toISOString(),
    signers: signers.flatMap((s) => s.keys.map((k) => ({ model: s.model, publicKey: k.public_key, evidence: k.evidence }))),
    parleys: evidence.length,
    overview: await arena.overview(),
    coins,
  };
  writeLeague(options.out, manifest, evidence);
  const stats = summarize(coins, evidence, options.treasury, options.rounds);
  writeFileSync(join(options.out, "stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
  return { manifest, evidence, stats };
}

export const LOCAL_MODEL = "local/scripted";

export function scriptedSigner(enclave = new LocalEnclave()) {
  return [{ model: LOCAL_MODEL, public_key: enclave.publicKey, evidence: "local scripted enclave, not a TEE" }];
}

export const DEFAULT_TREASURY = near(100);
