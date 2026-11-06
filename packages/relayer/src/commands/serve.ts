import { Arena, type Coin, type Parley, near } from "@parley/sdk";
import { loadDeployment } from "../localnet.ts";
import { RoutingMind } from "../minds/routing.ts";
import { type TurnRecord, playParley } from "../runner.ts";
import { flag } from "./shared.ts";

interface Challenge {
  name: string;
  constitution: string;
  model: string;
  opponents: string[];
}

type Event =
  | { type: "queued"; ahead: number }
  | { type: "coin"; coin: Coin }
  | { type: "opened"; parley: Parley }
  | { type: "turn"; parley: Parley; turn: Pick<TurnRecord, "index" | "model" | "request" | "reply" | "txHash"> }
  | { type: "done"; coin: Coin }
  | { type: "error"; message: string };

interface Job {
  challenge: Challenge;
  events: Event[];
  listeners: Set<(event: Event) => void>;
  finished: boolean;
}

const MAX_QUEUE = 6;
const MAX_OPPONENTS = 3;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

/**
 * A small HTTP front for the relayer: a visitor posts a constitution, the server launches it as a coin,
 * plays it against house coins and streams every signed turn as it lands on chain.
 */
export async function serve() {
  const deployment = loadDeployment();
  const owner = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const guest = owner.as(deployment.accounts.alice!);
  const mind = new RoutingMind();
  const treasury = near(flag("treasury", "100")!);
  const jobs = new Map<string, Job>();
  const queue: string[] = [];
  const leaving: string[] = [];
  let working = false;

  /** Guest coins are funded from one account. Once a guest has played, its shares are redeemed so the NEAR can fund the next one. */
  async function recycle() {
    for (const coin of [...leaving]) {
      if ((await guest.fillOrder(coin, deployment.accounts.alice!.accountId)).ok) leaving.splice(leaving.indexOf(coin), 1);
    }
  }

  const emit = (job: Job, event: Event) => {
    job.events.push(event);
    for (const listener of job.listeners) listener(event);
  };

  async function play(job: Job) {
    const { name, constitution, model, opponents } = job.challenge;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "guest"}${Date.now().toString(36).slice(-5)}`;
    await recycle();
    const made = await guest.createCoin({ id, name, constitution, model }, treasury);
    if (!made.ok) throw new Error(made.error?.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "the arena refused this coin");
    emit(job, { type: "coin", coin: (await owner.coin(id))! });

    for (const [n, opponent] of opponents.entries()) {
      const opened = await owner.openParleyBetween(...((n % 2 === 0 ? [id, opponent] : [opponent, id]) as [string, string]));
      if (!opened.ok) throw new Error(`could not open a Parley with ${opponent}`);
      const parleyId = opened.value as number;
      emit(job, { type: "opened", parley: (await owner.parley(parleyId))! });
      await playParley(owner, mind, parleyId, async ({ index, model, request, reply, txHash }) => {
        emit(job, { type: "turn", parley: (await owner.parley(parleyId))!, turn: { index, model, request, reply, txHash } });
      });
    }
    emit(job, { type: "done", coin: (await owner.coin(id))! });
    if ((await guest.placeRedeem(id, BigInt(await owner.shares(id, deployment.accounts.alice!.accountId)))).ok) leaving.push(id);
  }

  async function work() {
    if (working) return;
    working = true;
    for (let id = queue.shift(); id; id = queue.shift()) {
      const job = jobs.get(id)!;
      try {
        await play(job);
      } catch (error) {
        emit(job, { type: "error", message: error instanceof Error ? error.message : String(error) });
      }
      job.finished = true;
      for (const listener of job.listeners) listener({ type: "queued", ahead: -1 });
    }
    working = false;
  }

  async function accept(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as Partial<Challenge> | null;
    const config = await owner.config();
    const models = await owner.models();
    const house = (await owner.coins()).filter((c) => c.house);
    const name = String(body?.name ?? "").trim().toUpperCase();
    const constitution = String(body?.constitution ?? "").trim();
    const model = models.find((m) => m.id === body?.model)?.id ?? house[0]?.model ?? "";
    const opponents = (Array.isArray(body?.opponents) ? body.opponents : []).filter((o) => house.some((c) => c.id === o)).slice(0, MAX_OPPONENTS);
    if (!/^[A-Z0-9 ]{2,16}$/.test(name)) return json({ error: "The name needs 2 to 16 letters or digits." }, 400);
    if (!constitution || [...constitution].length > config.max_constitution_len) {
      return json({ error: `The constitution needs 1 to ${config.max_constitution_len} characters.` }, 400);
    }
    if (!opponents.length) return json({ error: "Pick at least one house coin to meet." }, 400);
    if (queue.length >= MAX_QUEUE) return json({ error: "The arena is busy. Try again in a minute." }, 429);

    const id = crypto.randomUUID();
    const job: Job = { challenge: { name, constitution, model, opponents }, events: [], listeners: new Set(), finished: false };
    jobs.set(id, job);
    queue.push(id);
    emit(job, { type: "queued", ahead: queue.length - 1 + (working ? 1 : 0) });
    void work();
    return json({ id });
  }

  function stream(job: Job): Response {
    const encoder = new TextEncoder();
    let listener: (event: Event) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        for (const event of job.events) send(event);
        if (job.finished) return controller.close();
        listener = (event) => {
          if (event.type === "queued" && event.ahead < 0) {
            job.listeners.delete(listener);
            return controller.close();
          }
          send(event);
        };
        job.listeners.add(listener);
      },
      cancel() {
        job.listeners.delete(listener);
      },
    });
    return new Response(body, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  const port = Number(flag("port", "8787"));
  Bun.serve({
    port,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (url.pathname === "/api/arena") {
        const [overview, config, models, coins] = await Promise.all([owner.overview(), owner.config(), owner.models(), owner.coins()]);
        return json({ network: deployment.network, contractId: deployment.contractId, treasury: treasury.toString(), overview, config, models, house: coins.filter((c) => c.house) });
      }
      if (url.pathname === "/api/play" && req.method === "POST") return accept(req);
      const job = jobs.get(url.pathname.match(/^\/api\/play\/([\w-]+)\/events$/)?.[1] ?? "");
      if (job) return stream(job);
      return json({ error: "not found" }, 404);
    },
  });
  console.log(`live arena for ${deployment.contractId} on http://localhost:${port}`);
}
