import { Arena, type ModelInput, near } from "@parley/sdk";
import { type Attestation, type Mind, deployLocal, loadConstitutions, openAndPlay } from "@parley/relayer";
import { type LeagueManifest, type ParleyEvidence, writeLeague, writeParley } from "./fixtures.ts";
import { summarize } from "./standings.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LeagueOptions {
  name: string;
  mind: Mind;
  models: ModelInput[];
  modelOf: (coin: string) => string;
  attestations?: Attestation[];
  rounds: number;
  treasury: bigint;
  out: string;
  log?: (line: string) => void;
}

/** Every pair of house constitutions meets once per round, on a fresh local arena, and every turn is recorded. */
export async function runLeague(options: LeagueOptions) {
  const log = options.log ?? (() => {});
  const deployment = await deployLocal(options.models);
  const arena = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const constitutions = loadConstitutions();
  for (const c of constitutions) {
    const made = await arena.createCoin({ id: c.id, name: c.name, constitution: c.text, model: options.modelOf(c.id) }, options.treasury, true);
    if (!made.ok) throw new Error(`create ${c.id}: ${made.error}`);
  }

  const ids = constitutions.map((c) => c.id);
  const evidence: ParleyEvidence[] = [];
  for (let round = 0; round < options.rounds; round++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pair: [string, string] = (round + i + j) % 2 === 0 ? [ids[i]!, ids[j]!] : [ids[j]!, ids[i]!];
        const commonsBefore = (await arena.overview()).commons;
        const started = Date.now();
        const { parley, turns } = await openAndPlay(arena, options.mind, pair);
        const item: ParleyEvidence = {
          parley,
          commonsBefore,
          turns: turns.map((t) => ({ index: t.index, model: t.model, request: t.request, reply: t.reply, txHash: t.txHash })),
        };
        evidence.push(item);
        writeParley(options.out, item);
        const seconds = (ms: number) => (ms / 1000).toFixed(1);
        const model = turns.reduce((n, t) => n + t.modelMs, 0);
        const chain = turns.reduce((n, t) => n + t.chainMs, 0);
        log(`round ${round + 1} #${parley.id} ${parley.a} ${parley.a_move} / ${parley.b} ${parley.b_move}  ${seconds(Date.now() - started)}s (model ${seconds(model)}s, chain ${seconds(chain)}s)`);
      }
    }
  }

  const coins = await arena.coins();
  const manifest: LeagueManifest = {
    name: options.name,
    mind: options.mind.name,
    network: deployment.network,
    contractId: deployment.contractId,
    recordedAt: new Date().toISOString(),
    rounds: options.rounds,
    startTreasury: options.treasury.toString(),
    maxMessageLength: (await arena.config()).max_message_len,
    models: await arena.models(),
    parleys: evidence.length,
    overview: await arena.overview(),
    coins,
  };
  writeLeague(options.out, manifest, options.attestations ?? []);
  const stats = summarize(coins, evidence, options.treasury, options.rounds);
  writeFileSync(join(options.out, "stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
  return { manifest, evidence, stats };
}

export const DEFAULT_TREASURY = near(100);
