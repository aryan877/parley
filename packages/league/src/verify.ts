import { ROOT } from "@parley/relayer";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkLeague } from "./check.ts";
import { readLeague } from "./fixtures.ts";

const base = join(ROOT, "fixtures");
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(base).filter((n) => existsSync(join(base, n, "league.json")));
let bad = 0;
for (const name of names) {
  const { manifest, evidence } = readLeague(join(base, name));
  const findings = checkLeague(manifest, evidence);
  const turns = evidence.reduce((n, e) => n + e.turns.length, 0);
  console.log(`${name}: ${evidence.length} Parleys, ${turns} signed replies, ${findings.length ? `${findings.length} PROBLEMS` : "all verified"}`);
  for (const f of findings.slice(0, 20)) console.log(`  Parley ${f.parley}${f.turn === undefined ? "" : ` turn ${f.turn}`}: ${f.problem}`);
  bad += findings.length;
}
if (!names.length) console.log("no recorded leagues in fixtures/");
process.exit(bad ? 1 : 0);
