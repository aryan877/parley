import { Arena, formatNear, near } from "@parley/sdk";
import { challenge } from "./commands/challenge.ts";
import { govern } from "./commands/govern.ts";
import { coinNames, deployHouse, flag, printParley } from "./commands/shared.ts";
import { loadDeployment } from "./localnet.ts";
import { RoutingMind } from "./minds/routing.ts";
import { openAndPlay } from "./runner.ts";

async function deploy() {
  const { deployment, arena } = await deployHouse(flag("mind", "scripted")!, near(100));
  console.log(`arena ${deployment.contractId} deployed with ${(await arena.coins()).length} house coins`);
}

async function play() {
  const deployment = loadDeployment();
  const arena = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const mind = new RoutingMind();
  const names = await coinNames(arena);
  for (let round = 0; round < Number(flag("rounds", "1")); round++) {
    printParley((await openAndPlay(arena, mind)).parley, names);
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

const commands: Record<string, () => Promise<void>> = { deploy, play, status, challenge, govern };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(
    [
      "usage: bun run relayer <command>",
      "  deploy [--mind scripted|near-ai]        fresh local arena with the eight house coins",
      "  play [--rounds N]                       open random Parleys and play them",
      "  challenge <file.md> [--rounds N]        launch your own constitution against the house",
      "  govern [--mind scripted|near-ai]        walk through buying in, amending and leaving",
      "  status                                  treasuries and records",
    ].join("\n"),
  );
  process.exit(1);
}
await command();
