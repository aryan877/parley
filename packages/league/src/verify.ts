import { ROOT } from "@parley/relayer";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Finding, checkLeague, describeSigner, signerReport } from "./check.ts";
import { readLeague } from "./fixtures.ts";

const SHOWN = 20;
const base = join(ROOT, "fixtures");
const names = process.argv.slice(2).length ? process.argv.slice(2) : existsSync(base) ? readdirSync(base).filter((n) => existsSync(join(base, n, "league.json"))) : [];
let bad = 0;
for (const name of names) {
  const { manifest, evidence, attestations, stats } = readLeague(join(base, name));
  const findings: Finding[] = [...(stats ? [] : [{ problem: "stats.json is missing" }]), ...checkLeague(manifest, evidence, attestations, stats)];
  const turns = evidence.reduce((n, e) => n + e.turns.length, 0);
  console.log(`${name}: ${evidence.length} Parleys, ${turns} signed replies, ${findings.length ? `${findings.length} PROBLEMS` : "all verified"}`);
  for (const s of signerReport(manifest, evidence, attestations)) {
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
