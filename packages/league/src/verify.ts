import { ROOT } from "@parley/relayer";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { attestedKeys, checkLeague } from "./check.ts";
import { readLeague } from "./fixtures.ts";

const base = join(ROOT, "fixtures");
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(base).filter((n) => existsSync(join(base, n, "league.json")));
let bad = 0;
for (const name of names) {
  const { manifest, evidence, attestations } = readLeague(join(base, name));
  const findings = checkLeague(manifest, evidence, attestations);
  const turns = evidence.reduce((n, e) => n + e.turns.length, 0);
  const attested = attestedKeys(manifest);
  const keys = attested ? `${attested} enclave keys backed by Intel TDX quotes` : "local stand-in key, not sealed hardware";
  console.log(`${name}: ${evidence.length} Parleys, ${turns} signed replies, ${keys}, ${findings.length ? `${findings.length} PROBLEMS` : "all verified"}`);
  for (const f of findings.slice(0, 20)) {
    const where = f.parley === undefined ? "" : `Parley ${f.parley}${f.turn === undefined ? "" : ` turn ${f.turn}`}: `;
    console.log(`  ${where}${f.problem}`);
  }
  bad += findings.length;
}
if (!names.length) console.log("no recorded leagues in fixtures/");
process.exit(bad ? 1 : 0);
