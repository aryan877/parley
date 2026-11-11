import { Arena, type Parley, type SignedReply } from "@parley/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, fundLocalAccount, loadDeployment } from "../localnet.ts";
import { RoutingMind } from "../minds/routing.ts";
import { playParley } from "../runner.ts";
import { flag } from "./shared.ts";

interface Evidence {
  index: number;
  model: string;
  request: string;
  reply: SignedReply;
  txHash: string;
}

type Event =
  | { type: "hello"; current: { parley: Parley; turns: Evidence[] } | null; queue: number }
  | { type: "opened"; parley: Parley; reason: string }
  | { type: "turn"; parley: Parley; turn: Evidence }
  | { type: "settled"; parley: Parley }
  | { type: "idle"; reason: string };

interface Challenge {
  a: string;
  b: string;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
const MAX_QUEUE = 12;
const PLAYERS = join(ROOT, ".localnet", "players.json");
const EVIDENCE = join(ROOT, ".localnet", "evidence");

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const panic = (error?: string) => error?.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? error ?? "refused";

/**
 * The live arena behind the site. One worker plays one match at a time: queued challenges first, then, with
 * --autoplay, whatever pairing the contract picks. Every signed turn is streamed to watchers and kept on disk,
 * and after each match it fills the due orders of the players it funded.
 */
export async function serve() {
  const deployment = loadDeployment();
  const owner = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const mind = new RoutingMind();
  const autoplay = process.argv.includes("--autoplay");
  const pause = Number(flag("pause", "4")) * 1000;
  const queue: Challenge[] = [];
  const watchers = new Set<(event: Event) => void>();
  const players: string[] = existsSync(PLAYERS) ? (JSON.parse(readFileSync(PLAYERS, "utf8")) as string[]) : [];
  let current: { parley: Parley; turns: Evidence[] } | null = null;
  mkdirSync(EVIDENCE, { recursive: true });

  const emit = (event: Event) => {
    for (const watch of watchers) watch(event);
  };
  const evidenceFile = (id: number) => join(EVIDENCE, `${deployment.contractId}-${id}.json`);

  async function keep() {
    const coins = (await owner.coins()).filter((c) => !c.house && c.in_match === null);
    for (const account of players) {
      for (const coin of coins) {
        if (await owner.order(coin.id, account)) await owner.fillOrder(coin.id, account);
      }
    }
  }

  async function play(open: () => Promise<{ ok: boolean; value?: unknown; error?: string }>, reason: string) {
    const opened = await open();
    if (!opened.ok) return panic(opened.error);
    const id = opened.value as number;
    const parley = (await owner.parley(id))!;
    current = { parley, turns: [] };
    emit({ type: "opened", parley, reason });
    await playParley(owner, mind, id, async ({ index, model, request, reply, txHash }) => {
      const turn = { index, model, request, reply, txHash };
      const now = (await owner.parley(id))!;
      current = { parley: now, turns: [...(current?.turns ?? []), turn] };
      writeFileSync(evidenceFile(id), JSON.stringify(current));
      emit({ type: "turn", parley: now, turn });
    });
    const done = (await owner.parley(id))!;
    current = { parley: done, turns: current?.turns ?? [] };
    writeFileSync(evidenceFile(id), JSON.stringify(current));
    emit({ type: "settled", parley: done });
    current = null;
    await keep().catch(() => {});
    return null;
  }

  async function work() {
    for (;;) {
      const next = queue.shift();
      let problem: string | null = null;
      try {
        if (next) problem = await play(() => owner.openParleyBetween(next.a, next.b), "challenge");
        else if (autoplay) problem = await play(() => owner.openParley(), "the contract's pairing");
        else problem = "waiting for a challenge";
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
        current = null;
      }
      if (problem) emit({ type: "idle", reason: problem });
      await Bun.sleep(problem ? Math.max(pause, 3000) : pause);
    }
  }

  function stream(): Response {
    const encoder = new TextEncoder();
    let watch: (event: Event) => void;
    let heartbeat: ReturnType<typeof setInterval>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        send({ type: "hello", current, queue: queue.length });
        heartbeat = setInterval(() => controller.enqueue(encoder.encode(": still here\n\n")), 15_000);
        watch = send;
        watchers.add(watch);
      },
      cancel() {
        watchers.delete(watch);
        clearInterval(heartbeat);
      },
    });
    return new Response(body, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  async function challenge(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { coin?: string; opponents?: string[] } | null;
    const coins = await owner.coins();
    const mine = coins.find((c) => c.id === body?.coin);
    if (!mine) return json({ error: "No such coin." }, 400);
    const opponents = (body?.opponents ?? []).filter((o) => o !== mine.id && coins.some((c) => c.id === o)).slice(0, 3);
    if (!opponents.length) return json({ error: "Pick at least one coin to meet." }, 400);
    if (queue.length + opponents.length > MAX_QUEUE) return json({ error: "The arena is busy. Try again in a minute." }, 429);
    opponents.forEach((o, i) => queue.push(i % 2 === 0 ? { a: mine.id, b: o } : { a: o, b: mine.id }));
    return json({ queued: opponents.length, ahead: queue.length - opponents.length + (current ? 1 : 0) });
  }

  async function faucet(req: Request): Promise<Response> {
    if (deployment.network !== "local") return json({ error: "Test NEAR is only handed out on the local chain." }, 400);
    const body = (await req.json().catch(() => null)) as { publicKey?: string } | null;
    if (!body?.publicKey?.startsWith("ed25519:")) return json({ error: "Send an ed25519 public key." }, 400);
    const accountId = await fundLocalAccount(body.publicKey);
    players.push(accountId);
    writeFileSync(PLAYERS, JSON.stringify(players));
    return json({ accountId });
  }

  const port = Number(flag("port", "8787"));
  Bun.serve({
    port,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      try {
        if (url.pathname === "/api/arena") {
          const [overview, config, models] = await Promise.all([owner.overview(), owner.config(), owner.models()]);
          return json({ network: deployment.network, rpcUrl: deployment.rpcUrl, contractId: deployment.contractId, autoplay, overview, config, models });
        }
        if (url.pathname === "/api/live") return stream();
        if (url.pathname === "/api/challenge" && req.method === "POST") return challenge(req);
        if (url.pathname === "/api/faucet" && req.method === "POST") return faucet(req);
        const match = url.pathname.match(/^\/api\/match\/(\d+)$/);
        if (match) {
          const file = evidenceFile(Number(match[1]));
          return existsSync(file) ? json(JSON.parse(readFileSync(file, "utf8"))) : json({ error: "This server did not play that match." }, 404);
        }
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
      return json({ error: "not found" }, 404);
    },
  });
  console.log(`live arena for ${deployment.contractId} on http://localhost:${port}${autoplay ? ", playing matches nonstop" : ""}`);
  void work();
}
