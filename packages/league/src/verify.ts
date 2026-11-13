import { ROOT } from "@parley/relayer";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Finding, type SignerReport, checkLeague, describeSigner, signerReport } from "./check.ts";
import { readLeague } from "./fixtures.ts";

export interface LeagueVerdict {
  name: string;
  parleys: number;
  replies: number;
  signers: SignerReport[];
  findings: Finding[];
}

const SHOWN = 20;
const BASE = join(ROOT, "fixtures");

export const recordedLeagues = () => (existsSync(BASE) ? readdirSync(BASE).filter((n) => existsSync(join(BASE, n, "league.json"))) : []);

export function verifyLeague(name: string): LeagueVerdict {
  const { manifest, evidence, attestations, stats } = readLeague(join(BASE, name));
  return {
    name,
    parleys: evidence.length,
    replies: evidence.reduce((n, e) => n + e.turns.length, 0),
    signers: signerReport(manifest, evidence, attestations),
    findings: [...(stats ? [] : [{ problem: "stats.json is missing" }]), ...checkLeague(manifest, evidence, attestations, stats)],
  };
}

if (import.meta.main) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : recordedLeagues();
  let bad = 0;
  for (const { name, parleys, replies, signers, findings } of names.map(verifyLeague)) {
    console.log(`${name}: ${parleys} Parleys, ${replies} signed replies, ${findings.length ? `${findings.length} PROBLEMS` : "all verified"}`);
    for (const s of signers) {
      console.log(`  ${s.model} key ${s.publicKey.slice(0, 12)}…: ${s.replies} ${s.replies === 1 ? "reply" : "replies"}, ${describeSigner(s)}`);
    }
    if (!findings.length) console.log("  every request rebuilt byte for byte from the replayed league; treasuries, records, commons and stats.json re-derived");
    for (const f of findings.slice(0, SHOWN)) {
      const where = f.parley === undefined ? "" : `Parley ${f.parley}${f.turn === undefined ? "" : ` turn ${f.turn}`}: `;
      console.log(`  ${where}${f.problem}`);
    }
    if (findings.length > SHOWN) console.log(`  … and ${findings.length - SHOWN} more`);
    bad += findings.length;
  }
  if (!names.length) console.log("no recorded leagues in fixtures/");
  process.exit(bad ? 1 : 0);
}
