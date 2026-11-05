import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const fixtures = join(root, "fixtures");
const out = join(import.meta.dir, "../public/data");
mkdirSync(out, { recursive: true });

const leagues = [];
for (const name of existsSync(fixtures) ? readdirSync(fixtures) : []) {
  const dir = join(fixtures, name);
  if (!existsSync(join(dir, "league.json"))) continue;
  const manifest = JSON.parse(readFileSync(join(dir, "league.json"), "utf8"));
  const all = (sub: string) =>
    existsSync(join(dir, sub))
      ? readdirSync(join(dir, sub))
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => JSON.parse(readFileSync(join(dir, sub, f), "utf8")))
      : [];
  const evidence = all("parleys");
  mkdirSync(join(out, name), { recursive: true });
  writeFileSync(join(out, name, "league.json"), JSON.stringify(manifest));
  writeFileSync(join(out, name, "evidence.json"), JSON.stringify(evidence));
  writeFileSync(join(out, name, "attestation.json"), JSON.stringify(all("attestation")));
  cpSync(join(dir, "stats.json"), join(out, name, "stats.json"));
  if (!evidence.length) continue;
  leagues.push({ name, mind: manifest.mind, parleys: manifest.parleys, recordedAt: manifest.recordedAt, network: manifest.network });
}
leagues.sort((a, b) => (a.mind === "near-ai" ? -1 : 1) - (b.mind === "near-ai" ? -1 : 1));
writeFileSync(join(out, "index.json"), JSON.stringify(leagues));
console.log(`web data: ${leagues.map((l) => `${l.name} (${l.parleys})`).join(", ") || "none"}`);
