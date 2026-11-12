import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const fixtures = join(root, "fixtures");
const out = join(import.meta.dir, "../public/data");
rmSync(out, { recursive: true, force: true });
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

const deployments = join(root, "deployments");
if (existsSync(join(deployments, "testnet.json"))) {
  const testnet = join(out, "testnet");
  mkdirSync(testnet, { recursive: true });
  const read = (path: string) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  for (const file of ["testnet.json", "testnet-forgeries.json", "testnet-amendment.json"]) {
    if (existsSync(join(deployments, file))) cpSync(join(deployments, file), join(testnet, file));
  }
  const quotes = join(deployments, "testnet-attestation");
  const attestations = existsSync(quotes) ? readdirSync(quotes).filter((f) => f.endsWith(".json")).sort() : [];
  if (attestations.length) cpSync(quotes, join(testnet, "testnet-attestation"), { recursive: true });
  const reask = join(fixtures, "near-ai-reask", "summary.json");
  if (existsSync(reask)) cpSync(reask, join(testnet, "reask-summary.json"));
  writeFileSync(
    join(testnet, "onchain.json"),
    JSON.stringify({
      deployment: read(join(deployments, "testnet.json")),
      forgeries: read(join(deployments, "testnet-forgeries.json")),
      amendment: read(join(deployments, "testnet-amendment.json")),
      reask: read(reask),
      attestations: attestations.map((file) => {
        const a = JSON.parse(readFileSync(join(quotes, file), "utf8")) as { model: string; publicKey: string; nonceText?: string };
        return { file: `testnet-attestation/${file}`, model: a.model, publicKey: a.publicKey, nonceText: a.nonceText ?? null };
      }),
    }),
  );
  console.log(`testnet proof: ${attestations.length} hardware reports`);
}
