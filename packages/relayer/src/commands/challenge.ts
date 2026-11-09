import { Arena, formatNear, near } from "@parley/sdk";
import { readFileSync } from "node:fs";
import { loadDeployment } from "../localnet.ts";
import { RoutingMind } from "../minds/routing.ts";
import { strategyOf } from "../minds/scripted.ts";
import { LOCAL_MODEL } from "../models.ts";
import { openAndPlay } from "../runner.ts";
import { coinNames, flag, printParley } from "./shared.ts";

/** Launches a coin from a constitution file and plays it once against every house coin. */
export async function challenge() {
  const file = process.argv[3];
  if (!file || file.startsWith("--")) throw new Error("usage: relayer challenge <constitution.md> [--rounds N] [--model <id>]");
  const [title = "", ...body] = readFileSync(file, "utf8").trim().split("\n");
  const name = title.replace(/^#\s*/, "").trim().toUpperCase().slice(0, 24);
  const constitution = body.join("\n").trim();
  const id = `${name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}${Date.now().toString(36).slice(-4)}`;

  const deployment = loadDeployment();
  const owner = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const alice = owner.as(deployment.accounts.alice!);
  const house = (await owner.coins()).filter((c) => c.house);
  const model = flag("model", house[0]?.model) ?? LOCAL_MODEL;
  if (model === LOCAL_MODEL) {
    console.log(`Rule-based minds only know the eight house constitutions. Yours will be played as ${strategyOf(constitution).toUpperCase()}.`);
    console.log("Deploy with `bun run deploy:local --mind near-ai` to have a real model read it.\n");
  }

  const fee = BigInt((await owner.config()).creation_fee);
  const made = await alice.createCoin({ id, name, constitution, model }, near(100) + fee);
  if (!made.ok) throw new Error(`could not launch ${name}: ${made.error}`);
  console.log(`${name} launched with 100 NEAR on ${model}`);

  const mind = new RoutingMind();
  const names = await coinNames(owner);
  for (let round = 0; round < Number(flag("rounds", "1")); round++) {
    for (const opponent of house) {
      const pair: [string, string] = (round + house.indexOf(opponent)) % 2 === 0 ? [id, opponent.id] : [opponent.id, id];
      printParley((await openAndPlay(owner, mind, pair)).parley, names);
    }
  }
  const coin = (await owner.coin(id))!;
  const s = coin.stats;
  console.log(`\n${name} ends with ${formatNear(coin.treasury)} NEAR after ${s.matches} Parleys: cooperated ${s.cooperated}, defected ${s.defected}, was betrayed ${s.was_betrayed} times.`);
}
