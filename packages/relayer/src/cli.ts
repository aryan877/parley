import { Arena, LocalEnclave, formatNear, near } from "@parley/sdk";
import { loadConstitutions } from "./constitutions.ts";
import { deployLocal, loadDeployment } from "./localnet.ts";
import type { Mind } from "./minds/mind.ts";
import { NearAiMind } from "./minds/nearai.ts";
import { ScriptedMind } from "./minds/scripted.ts";
import { openAndPlay } from "./runner.ts";

const LOCAL_MODEL = "local/scripted";

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function mind(kind: string): Mind {
  if (kind === "scripted") return new ScriptedMind();
  const key = process.env.NEAR_AI_API_KEY;
  if (!key) throw new Error("NEAR_AI_API_KEY is not set; use --mind scripted or add it to .env");
  return new NearAiMind(key, process.env.NEAR_AI_BASE_URL);
}

async function deploy() {
  const enclave = new LocalEnclave();
  const deployment = await deployLocal([{ model: LOCAL_MODEL, public_key: enclave.publicKey, evidence: "local scripted enclave, not a TEE" }]);
  const arena = new Arena({ ...deployment, signer: deployment.accounts.arena });
  for (const c of loadConstitutions()) {
    const made = await arena.createCoin({ id: c.id, name: c.name, constitution: c.text, model: LOCAL_MODEL }, near(100), true);
    if (!made.ok) throw new Error(`create ${c.id}: ${made.error}`);
  }
  console.log(`arena ${deployment.contractId} deployed with ${(await arena.coins()).length} house coins`);
}

async function play() {
  const deployment = loadDeployment();
  const arena = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const rounds = Number(flag("rounds", "1"));
  const chosen = mind(flag("mind", "scripted")!);
  for (let round = 0; round < rounds; round++) {
    const { parley } = await openAndPlay(arena, chosen);
    const talk = parley.turns.filter((t) => t.kind === "Talk").map((t) => `    ${t.side === "A" ? parley.a : parley.b}: ${t.text}`);
    console.log(`#${parley.id} ${parley.a} vs ${parley.b}  stake ${formatNear(parley.stake)} NEAR\n${talk.join("\n")}`);
    console.log(`    ${parley.a} ${parley.a_move} (${formatNear(parley.a_delta)})  ${parley.b} ${parley.b_move} (${formatNear(parley.b_delta)})\n`);
  }
}

async function status() {
  const deployment = loadDeployment();
  const arena = new Arena(deployment);
  const overview = await arena.overview();
  console.log(`${deployment.contractId}  parleys ${overview.parleys}  commons ${formatNear(overview.commons)} NEAR`);
  for (const c of (await arena.coins()).sort((x, y) => Number(BigInt(y.treasury) - BigInt(x.treasury)))) {
    const s = c.stats;
    console.log(`  ${c.name.padEnd(10)} ${formatNear(c.treasury).padStart(9)} NEAR  played ${String(s.matches).padStart(3)}  C ${s.cooperated}  D ${s.defected}  betrayed ${s.was_betrayed}x`);
  }
}

const commands: Record<string, () => Promise<void>> = { deploy, play, status };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("usage: relayer deploy | play [--rounds N] [--mind scripted|near-ai] | status");
  process.exit(1);
}
await command();
