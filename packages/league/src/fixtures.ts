import type { Attestation } from "@parley/relayer";
import type { Coin, Model, Overview, Parley, SignedReply } from "@parley/sdk";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Everything needed to re-check one turn offline: the exact bytes sent, the exact bytes received, and the signature. */
export interface TurnEvidence {
  index: number;
  model: string;
  request: string;
  reply: SignedReply;
  txHash: string;
}

export interface ParleyEvidence {
  parley: Parley;
  commonsBefore: string;
  turns: TurnEvidence[];
}

export interface LeagueManifest {
  name: string;
  mind: string;
  network: string;
  contractId: string;
  recordedAt: string;
  rounds: number;
  startTreasury: string;
  maxMessageLength: number;
  models: Model[];
  parleys: number;
  overview: Overview;
  coins: Coin[];
}

export interface League {
  manifest: LeagueManifest;
  evidence: ParleyEvidence[];
  attestations: Attestation[];
}

const slug = (model: string) => model.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function writeParley(dir: string, item: ParleyEvidence) {
  mkdirSync(join(dir, "parleys"), { recursive: true });
  writeFileSync(join(dir, "parleys", `${String(item.parley.id).padStart(4, "0")}.json`), `${JSON.stringify(item, null, 2)}\n`);
}

export function writeLeague(dir: string, manifest: LeagueManifest, attestations: Attestation[]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "league.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (attestations.length) mkdirSync(join(dir, "attestation"), { recursive: true });
  for (const a of attestations) writeFileSync(join(dir, "attestation", `${slug(a.model)}.json`), `${JSON.stringify(a, null, 2)}\n`);
}

function readAll<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as T);
}

export function readLeague(dir: string): League {
  return {
    manifest: JSON.parse(readFileSync(join(dir, "league.json"), "utf8")) as LeagueManifest,
    evidence: readAll<ParleyEvidence>(join(dir, "parleys")),
    attestations: readAll<Attestation>(join(dir, "attestation")),
  };
}
