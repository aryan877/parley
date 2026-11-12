import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Bundle one recorded Parley into a single shareable JSON file (moves, turns, attestations). */
const ROOT = join(import.meta.dir, "..");
const league = process.argv[2] ?? "near-ai";
const id = Number(process.argv[3] ?? "1");
const dir = join(ROOT, "fixtures", league);
if (!existsSync(join(dir, "league.json"))) throw new Error(`no recorded league at fixtures/${league}`);
const evidence = JSON.parse(readFileSync(join(dir, "evidence.json"), "utf8")) as unknown[];
const parley = (evidence as { id?: number }[]).find((e) => e.id === id) ?? (evidence as unknown[])[id - 1];
if (!parley) throw new Error(`parley ${id} not in fixtures/${league}`);
const out = join(ROOT, "fixtures", `${league}-parley-${id}.json`);
mkdirSync(join(ROOT, "fixtures"), { recursive: true });
writeFileSync(out, JSON.stringify({ league, parley }, null, 2));
console.log(`wrote ${out}`);
