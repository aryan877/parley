import { formatNear } from "@parley/sdk";
import { NearAiMind, ROOT, ScriptedMind } from "@parley/relayer";
import { join } from "node:path";
import { DEFAULT_TREASURY, LOCAL_MODEL, runLeague, scriptedSigner } from "./run.ts";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const kind = flag("mind", "scripted");
const rounds = Number(flag("rounds", "3"));
const name = flag("name", kind === "scripted" ? "scripted" : "near-ai");
const out = join(ROOT, "fixtures", name);

let options;
if (kind === "scripted") {
  options = { mind: new ScriptedMind(), model: LOCAL_MODEL, signers: scriptedSigner() };
} else {
  const key = process.env.NEAR_AI_API_KEY;
  const model = flag("model", "z-ai/glm-5.3-flash");
  const publicKey = flag("signer", "");
  if (!key || !publicKey) throw new Error("near-ai leagues need NEAR_AI_API_KEY and --signer <enclave public key hex>");
  options = {
    mind: new NearAiMind(key, process.env.NEAR_AI_BASE_URL),
    model,
    signers: [{ model, public_key: publicKey, evidence: flag("evidence", "see fixtures attestation") }],
  };
}

const { stats, evidence } = await runLeague({ ...options, name, rounds, treasury: DEFAULT_TREASURY, out, log: (line) => console.log(line) });
console.log(`\n${evidence.length} Parleys recorded in fixtures/${name}`);
console.log(`both cooperate ${stats.outcomes.bothCooperate}, one defects ${stats.outcomes.oneDefects}, both defect ${stats.outcomes.bothDefect}`);
for (const s of stats.standings) {
  console.log(`  ${s.name.padEnd(9)} ${formatNear(s.treasury).padStart(8)} NEAR  (${formatNear(s.change)})  cooperates ${Math.round(s.cooperationRate * 100)}%`);
}
