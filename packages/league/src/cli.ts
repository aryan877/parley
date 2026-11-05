import { formatNear } from "@parley/sdk";
import {
  FAST_MODEL,
  LOCAL_MODEL,
  NearAiMind,
  ROOT,
  ScriptedMind,
  THINKERS,
  THINKING_MODEL,
  attestedModel,
  fetchAttestation,
  localModels,
} from "@parley/relayer";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TREASURY, type LeagueOptions, runLeague } from "./run.ts";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const kind = flag("mind", "scripted");
const rounds = Number(flag("rounds", "3"));
const name = flag("name", kind === "scripted" ? "scripted" : "near-ai");
const out = join(ROOT, "fixtures", name);

let options: Pick<LeagueOptions, "mind" | "models" | "modelOf" | "attestations">;
if (kind === "scripted") {
  options = { mind: new ScriptedMind(), models: localModels(), modelOf: () => LOCAL_MODEL };
} else {
  const key = process.env.NEAR_AI_API_KEY;
  if (!key) throw new Error("a near-ai league needs NEAR_AI_API_KEY in .env");
  const thinkers = flag("thinkers", THINKERS).split(",").filter(Boolean);
  const nonceText = `parley league ${name} ${new Date().toISOString()}`;
  const ids = thinkers.length ? [FAST_MODEL, THINKING_MODEL] : [FAST_MODEL];
  const attestations = await Promise.all(ids.map((id) => fetchAttestation(id, nonceText, process.env.NEAR_AI_BASE_URL)));
  for (const a of attestations) console.log(`${a.model}: enclave key ${a.publicKey.slice(0, 16)}… attested by an Intel TDX quote`);
  options = {
    mind: new NearAiMind(key, process.env.NEAR_AI_BASE_URL),
    models: attestations.map(attestedModel),
    modelOf: (coin) => (thinkers.includes(coin) ? THINKING_MODEL : FAST_MODEL),
    attestations,
  };
}

if (existsSync(out)) {
  const old = join(ROOT, ".localnet", "replaced-fixtures");
  mkdirSync(old, { recursive: true });
  renameSync(out, join(old, `${name}-${Date.now()}`));
}

const { stats, evidence } = await runLeague({ ...options, name, rounds, treasury: DEFAULT_TREASURY, out, log: (line) => console.log(line) });
console.log(`\n${evidence.length} Parleys recorded in fixtures/${name}`);
console.log(`both cooperate ${stats.outcomes.bothCooperate}, one defects ${stats.outcomes.oneDefects}, both defect ${stats.outcomes.bothDefect}`);
for (const s of stats.standings) {
  console.log(`  ${s.name.padEnd(9)} ${formatNear(s.treasury).padStart(8)} NEAR  (${formatNear(s.change)})  cooperates ${Math.round(s.cooperationRate * 100)}%`);
}
