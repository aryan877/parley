import { Arena, type Config, type ModelInput, type Parley, formatNear } from "@parley/sdk";
import { attestedModel, fetchAttestation } from "../attestation.ts";
import { loadConstitutions } from "../constitutions.ts";
import { type Deployment, deployLocal } from "../localnet.ts";
import { FAST_MODEL, LOCAL_MODEL, THINKERS, THINKING_MODEL, localModels } from "../models.ts";

export function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

export interface House {
  deployment: Deployment;
  arena: Arena;
  model: string;
}

/** A fresh local arena with the eight house coins. With real AI, every model's enclave key is attested before it is registered. */
export async function deployHouse(kind: string, treasury: bigint, config: Partial<Config> = {}): Promise<House> {
  let models: ModelInput[] = localModels();
  let modelOf = (_coin: string) => LOCAL_MODEL;
  if (kind !== "scripted") {
    const thinkers = (flag("thinkers", THINKERS) ?? "").split(",").filter(Boolean);
    const nonceText = `parley arena ${new Date().toISOString()}`;
    const attestations = await Promise.all([FAST_MODEL, THINKING_MODEL].map((id) => fetchAttestation(id, nonceText, process.env.NEAR_AI_BASE_URL)));
    models = attestations.map(attestedModel);
    modelOf = (coin) => (thinkers.includes(coin) ? THINKING_MODEL : FAST_MODEL);
  }
  const deployment = await deployLocal(models, config);
  const arena = new Arena({ ...deployment, signer: deployment.accounts.arena });
  for (const c of loadConstitutions()) {
    const made = await arena.createCoin({ id: c.id, name: c.name, constitution: c.text, model: modelOf(c.id) }, treasury, true);
    if (!made.ok) throw new Error(`create ${c.id}: ${made.error}`);
  }
  return { deployment, arena, model: modelOf("") };
}

export type Names = Map<string, string>;

export async function coinNames(arena: Arena): Promise<Names> {
  return new Map((await arena.coins()).map((c) => [c.id, c.name]));
}

export function printParley(parley: Parley, names: Names = new Map()) {
  const name = (id: string) => names.get(id) ?? id.toUpperCase();
  console.log(`\n#${parley.id}  ${name(parley.a)} meets ${name(parley.b)}  (${formatNear(parley.stake)} NEAR at stake each)`);
  for (const turn of parley.turns.filter((t) => t.kind === "Talk")) {
    console.log(`    ${name(turn.side === "A" ? parley.a : parley.b).padEnd(9)} ${turn.text}`);
  }
  const line = (coin: string, move: string | null, delta: string) => `${name(coin)} ${(move ?? "?").toUpperCase()} (${BigInt(delta) > 0n ? "+" : ""}${formatNear(delta)})`;
  console.log(`    => ${line(parley.a, parley.a_move, parley.a_delta)}   ${line(parley.b, parley.b_move, parley.b_delta)}`);
}
