import type { Coin, Overview, Parley, SignedReply } from "@parley/sdk";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  signers: { model: string; publicKey: string; evidence: string }[];
  parleys: number;
  overview: Overview;
  coins: Coin[];
}

export function writeLeague(dir: string, manifest: LeagueManifest, evidence: ParleyEvidence[]) {
  mkdirSync(join(dir, "parleys"), { recursive: true });
  writeFileSync(join(dir, "league.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const item of evidence) {
    writeFileSync(join(dir, "parleys", `${String(item.parley.id).padStart(4, "0")}.json`), `${JSON.stringify(item, null, 2)}\n`);
  }
}

export function readLeague(dir: string): { manifest: LeagueManifest; evidence: ParleyEvidence[] } {
  const manifest = JSON.parse(readFileSync(join(dir, "league.json"), "utf8")) as LeagueManifest;
  const evidence = readdirSync(join(dir, "parleys"))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, "parleys", file), "utf8")) as ParleyEvidence);
  return { manifest, evidence };
}
