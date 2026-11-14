import { Arena, type Coin, type Config, type Model, NETWORKS, type Parley, type SignedReply, panicMessage, signerActive } from "@parley/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { attackLab } from "../attacks.ts";
import { Challenges } from "../challenges.ts";
import { Ledger } from "../ledger.ts";
import { ROOT, fundPlayer, loadDeployment } from "../localnet.ts";
import { RoutingMind } from "../minds/routing.ts";
import { playParley } from "../runner.ts";
import { darePages, originOf, sharePages } from "../share.ts";
import { chronicle } from "./chronicle.ts";
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

const CHALLENGE_PATIENCE_MS = 10 * 60_000;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
const STATE = join(ROOT, process.env.PARLEY_NETWORK === "testnet" ? ".testnet" : ".localnet");
const PLAYERS = join(STATE, "players.json");
const ORDERS = join(STATE, "orders.json");
const QUEUE = join(STATE, "queue.json");
const SCHEDULE_TTL = 8000;
const EVIDENCE = join(STATE, "evidence");
const FAUCET_PER_IP = 5;
const FAUCET_PER_DAY = 60;
const DAY_MS = 86_400_000;

interface Next {
  a: string;
  b: string;
  /** Unix milliseconds when it can start; now or earlier means as soon as the current match ends. */
  at: number;
  why: "challenge" | "rule";
}

const NS = 1_000_000;

/**
 * Who the contract will pair next, by the same rule `open_parley` follows: rested coins only, the one that has
 * waited longest goes first and meets the rested coin it met least recently, skipping pairs that met too
 * recently. When no pair is ready, the earliest moment one will be.
 */
async function predict(arena: Arena, coins: Coin[], config: Config, models: Model[], met = new Map<string, bigint>()): Promise<Next | null> {
  const now = BigInt(Date.now()) * BigInt(NS);
  const rest = BigInt(config.rest_ns);
  const apart = BigInt(config.pair_rest_ns);
  const answers = (model: string) => models.some((m) => m.id === model && m.signers.some((k) => signerActive(k, now)));
  const able = coins.filter((c) => c.in_match === null && BigInt(c.treasury) >= BigInt(config.min_treasury) && answers(c.model));
  const order = [...able].sort((x, y) => (BigInt(x.idle_since) === BigInt(y.idle_since) ? x.id.localeCompare(y.id) : BigInt(x.idle_since) < BigInt(y.idle_since) ? -1 : 1));
  const lastMet = async (a: Coin, b: Coin) => {
    const key = [a.id, b.id].sort().join(":");
    if (!met.has(key)) {
      const record = await arena.view<{ last_met: string }>("get_pair_record", { a: a.id, b: b.id });
      met.set(key, BigInt(record.last_met ?? "0"));
    }
    const together = BigInt(a.created_at) > BigInt(b.created_at) ? BigInt(a.created_at) : BigInt(b.created_at);
    const last = met.get(key)!;
    return last > together ? last : together;
  };
  let soonest: { a: Coin; b: Coin; at: bigint } | null = null;
  for (const first of order.slice(0, 6)) {
    let best: { b: Coin; last: bigint } | null = null;
    for (const other of order) {
      if (other.id === first.id) continue;
      const last = await lastMet(first, other);
      const ready = [BigInt(first.idle_since) + rest, BigInt(other.idle_since) + rest, last + apart].reduce((x, y) => (x > y ? x : y));
      if (ready <= now && (!best || last < best.last)) best = { b: other, last };
      if (!soonest || ready < soonest.at) soonest = { a: first, b: other, at: ready };
    }
    if (best && BigInt(first.idle_since) + rest <= now) return { a: first.id, b: best.b.id, at: Date.now(), why: "rule" };
  }
  return soonest ? { a: soonest.a.id, b: soonest.b.id, at: Number(soonest.at / BigInt(NS)), why: "rule" } : null;
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

/** The built site, from `--static <dir>`. Hashed assets are cached for a year; the page itself never is. */
function page(dir: string, pathname: string): Response {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  let file = Bun.file(join(dir, rel || "index.html"));
  if (!rel || !existsSync(join(dir, rel)) || rel.endsWith("/")) file = Bun.file(join(dir, "index.html"));
  const type = TYPES[extname(file.name ?? "")] ?? "application/octet-stream";
  const cache = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  return new Response(file, { headers: { "content-type": type, "cache-control": cache } });
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const panic = (error?: string) => panicMessage(error) ?? error ?? "refused";

/**
 * The live arena behind the site. One worker plays one match at a time: queued challenges first, then, with
 * --autoplay, whatever pairing the contract picks. Every signed turn is streamed to watchers and kept on disk,
 * and after each match it fills the due orders of the players it funded.
 */
export async function serve() {
  const deployment = loadDeployment();
  const owner = new Arena({ ...deployment, signer: deployment.accounts.arena });
  const evidenceFile = (id: number) => join(EVIDENCE, `${deployment.contractId}-${id}.json`);
  const kept = (id: number) => (existsSync(evidenceFile(id)) ? (JSON.parse(readFileSync(evidenceFile(id), "utf8")) as { turns: Evidence[] }) : null);
  const lab = attackLab(deployment, async (id) => kept(id));
  const mind = lab.watch(new RoutingMind());
  const share = sharePages(owner, flag("static"));
  const dare = darePages(owner);
  const autoplay = process.argv.includes("--autoplay");
  const pause = Number(flag("pause", "4")) * 1000;
  const challenges = new Challenges(QUEUE);
  const held = async (coin: string) => (await owner.amendments(coin)).length > 0;
  const watchers = new Set<(event: Event) => void>();
  const players: string[] = existsSync(PLAYERS) ? (JSON.parse(readFileSync(PLAYERS, "utf8")) as string[]) : [];
  const watched = new Set<string>(existsSync(ORDERS) ? (JSON.parse(readFileSync(ORDERS, "utf8")) as string[]) : []);
  const saveWatched = () => writeFileSync(ORDERS, JSON.stringify([...watched]));
  const pairs = new Map<string, bigint>();
  let schedule: { at: number; body: unknown } | null = null;
  let current: { parley: Parley; turns: Evidence[] } | null = null;
  let currentSince = 0;
  let lastEnded = Date.now();
  mkdirSync(EVIDENCE, { recursive: true });
  const handedOut: { ip: string; at: number }[] = [];
  let wake: (() => void) | null = null;
  const rest = (ms: number) => Promise.race([Bun.sleep(ms).then(() => false), new Promise<boolean>((resolve) => (wake = () => resolve(true)))]).finally(() => (wake = null));
  const site = flag("static");
  const ledger = new Ledger({ dir: STATE, network: deployment.network, contractId: deployment.contractId, rpcUrl: deployment.rpcUrl });
  const annals = chronicle(owner, ledger);

  const emit = (event: Event) => {
    for (const watch of watchers) watch(event);
  };

  /** Fills the due orders the site told us about. Anyone may call fill_order; this just saves players the wait. */
  async function keep() {
    const idle = new Set((await owner.coins()).filter((c) => c.in_match === null).map((c) => c.id));
    for (const key of [...watched]) {
      const [coin, account] = key.split(" ") as [string, string];
      if (!idle.has(coin)) continue;
      const order = await owner.order(coin, account).catch(() => undefined);
      if (order === null) watched.delete(key);
      else if (order && (await owner.fillOrder(coin, account)).ok) watched.delete(key);
    }
    saveWatched();
  }

  /** Finishes votes nobody came back for: closes the vote when it ends, enacts it when the timelock is over. */
  async function govern() {
    const now = BigInt(Date.now()) * 1_000_000n;
    for (const coin of await owner.coins()) {
      for (const id of coin.amendments ?? []) {
        const a = await owner.amendment(id).catch(() => null);
        if (!a) continue;
        if (a.status === "Voting" && now > BigInt(a.ends_at)) await owner.finalizeAmendment(id);
        else if (a.status === "Passed" && now > BigInt(a.enact_after) && coin.in_match === null) await owner.enactAmendment(id);
      }
    }
  }

  async function play(open: () => Promise<{ ok: boolean; value?: unknown; error?: string }>, reason: string) {
    const opened = await open();
    if (!opened.ok) return panic(opened.error);
    const id = opened.value as number;
    const parley = (await owner.parley(id))!;
    current = { parley, turns: kept(id)?.turns ?? [] };
    currentSince = Date.now();
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
    lastEnded = Date.now();
    pairs.clear();
    schedule = null;
    await keep().catch(() => {});
    return null;
  }

  /** A Parley left open by a restart is finished first, or voided once it can no longer be played. */
  async function unfinished(): Promise<number | null> {
    const busy = (await owner.coins()).map((c) => c.in_match).filter((id): id is number => id !== null);
    return busy.length ? Math.min(...busy) : null;
  }

  async function work() {
    for (;;) {
      const stuck = await unfinished().catch(() => null);
      const next = stuck === null ? await challenges.take(held).catch(() => undefined) : undefined;
      let problem: string | null = null;
      try {
        if (stuck !== null) {
          problem = await play(async () => ({ ok: true, value: stuck }), "a match left open").catch(async (error) => {
            const voided = await owner.call("void_parley", { id: stuck });
            current = null;
            return voided.ok ? null : `Parley ${stuck} could not be finished or voided: ${error instanceof Error ? error.message : error}`;
          });
        } else if (next) {
          problem = await play(() => owner.openParleyBetween(next.a, next.b), "challenge");
          const since = next.since ?? Date.now();
          if (problem?.includes("already in a Parley") && Date.now() - since < CHALLENGE_PATIENCE_MS) challenges.later(next, since);
        }
        else if (autoplay) problem = await play(() => owner.openParley(), "the contract's pairing");
        else problem = "waiting for a challenge";
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
        current = null;
      }
      if (problem) emit({ type: "idle", reason: problem });
      const until = Date.now() + (stuck !== null && problem ? Math.max(pause, 30_000) : challenges.queue.length ? 3000 : problem ? Math.max(pause, 3000) : pause);
      do {
        await govern().catch(() => {});
      } while (Date.now() < until && !(await rest(Math.min(60_000, until - Date.now()))));
    }
  }

  function stream(): Response {
    const encoder = new TextEncoder();
    let watch: (event: Event) => void;
    let heartbeat: ReturnType<typeof setInterval>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        send({ type: "hello", current, queue: challenges.queue.length });
        // Proxies buffer idle streams; 20s keeps the live arena feed alive without spamming.
        heartbeat = setInterval(() => controller.enqueue(encoder.encode(": still here\n\n")), 20_000);
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

  async function challenge(req: Request, ip: string): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { coin?: string; opponents?: string[] } | null;
    const coins = await owner.coins();
    const mine = coins.find((c) => c.id === body?.coin);
    if (!mine) return json({ error: "No such coin." }, 400);
    const opponents = [...new Set(body?.opponents ?? [])].flatMap((o) => coins.filter((c) => c.id === o && o !== mine.id)).slice(0, 3);
    if (!opponents.length) return json({ error: "Pick at least one coin to meet." }, 400);
    const { queued, refusal, retryAt } = await challenges.book(mine, opponents, ip, held);
    if (!queued.length) return json({ error: refusal, retryAt }, 429);
    wake?.();
    return json({ queued: queued.length, ahead: challenges.queue.length - queued.length + (current ? 1 : 0), ...(refusal && { note: refusal }) });
  }

  async function faucet(req: Request, ip: string): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { publicKey?: string } | null;
    if (!body?.publicKey?.startsWith("ed25519:")) return json({ error: "Send an ed25519 public key." }, 400);
    if (deployment.network !== "local") {
      const now = Date.now();
      while (handedOut[0] && now - handedOut[0].at > DAY_MS) handedOut.shift();
      if (handedOut.length >= FAUCET_PER_DAY) return json({ error: "Today's free play wallets are all handed out. Try again tomorrow." }, 429);
      if (handedOut.filter((h) => h.ip === ip).length >= FAUCET_PER_IP) return json({ error: "You already have play wallets from today. Reuse the one in this browser." }, 429);
    }
    let accountId: string;
    try {
      accountId = await fundPlayer(deployment, body.publicKey);
    } catch (error) {
      console.error("faucet failed:", error instanceof Error ? error.message : error);
      return json({ error: "Couldn't make a play wallet right now. Try again in a minute." }, 503);
    }
    if (deployment.network !== "local") handedOut.push({ ip, at: Date.now() });
    players.push(accountId);
    writeFileSync(PLAYERS, JSON.stringify(players));
    return json({ accountId });
  }

  const port = Number(flag("port", "8787"));
  Bun.serve({
    port,
    idleTimeout: 255,
    async fetch(req, server) {
      const url = new URL(req.url);
      const ip = () => req.headers.get("cf-connecting-ip") ?? server.requestIP(req)?.address ?? "?";
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      try {
        if (url.pathname === "/api/arena") {
          const [overview, config, models] = await Promise.all([owner.overview(), owner.config(), owner.models()]);
          return json({ network: deployment.network, rpcUrl: deployment.rpcUrl, contractId: deployment.contractId, explorerTx: NETWORKS[deployment.network].explorerTx ?? null, autoplay, overview, config, models });
        }
        if (url.pathname === "/api/live") return stream();
        if (url.pathname === "/api/attack" || url.pathname === "/api/attacks") {
          const { status, body } = await lab.handle(req, ip());
          return json(body, status);
        }
        const shared = req.method === "GET" && url.pathname.match(/^\/m\/(s?\d{1,9})\/?$/);
        if (shared) return await share(shared[1]!, originOf(req));
        const dared = req.method === "GET" && url.pathname.match(/^\/(?:beat-snake|vs\/([a-z0-9]{2,64}))\/?$/);
        if (dared) return await dare(dared[1] ?? "snake", originOf(req), url.pathname);
        const money = ledger.respond(url);
        if (money) return json(money.body, money.status);
        if (url.pathname === "/api/schedule") {
          if (schedule && Date.now() - schedule.at < SCHEDULE_TTL) return json({ ...(schedule.body as object), now: Date.now() });
          const [coins, config, models] = await Promise.all([owner.coins(), owner.config(), owner.models()]);
          const changing = new Set(coins.filter((c) => c.amendments?.length).map((c) => c.id));
          const queued = challenges.line((id) => changing.has(id));
          const ready = queued.find((q) => !q.held);
          const next: Next | null = ready
            ? { a: ready.a, b: ready.b, at: current ? 0 : Date.now(), why: "challenge" }
            : autoplay
              ? await predict(owner, coins.filter((c) => c.id !== current?.parley.a && c.id !== current?.parley.b), config, models, pairs)
              : null;
          if (next && next.why === "rule" && !current) next.at = Math.max(next.at, lastEnded + pause);
          const body = {
            now: Date.now(),
            autoplay,
            pauseMs: pause,
            current: current ? { id: current.parley.id, a: current.parley.a, b: current.parley.b, turns: current.parley.turns.length, since: currentSince } : null,
            lastEnded,
            queue: queued,
            next,
          };
          schedule = { at: Date.now(), body };
          return json(body);
        }
        if (url.pathname === "/api/challenge" && req.method === "POST") return await challenge(req, ip());
        if (url.pathname === "/api/watch-order" && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as { coin?: string; account?: string } | null;
          if (!body?.coin || !body.account || !/^[a-z0-9._-]{2,64}$/.test(body.account) || !(await owner.coin(body.coin))) return json({ error: "Send a coin and an account." }, 400);
          if (watched.size < 5000) watched.add(`${body.coin} ${body.account}`);
          saveWatched();
          return json({ watching: true });
        }
        if (url.pathname === "/api/faucet" && req.method === "POST") return await faucet(req, ip());
        const told = await annals(url.pathname);
        if (told) return json(told.body, told.status);
        const match = url.pathname.match(/^\/api\/match\/(\d+)$/);
        if (match) {
          const found = kept(Number(match[1]));
          return found ? json(found) : json({ error: "This server did not play that match." }, 404);
        }
        if (site && req.method === "GET" && !url.pathname.startsWith("/api/")) return page(site, url.pathname);
      } catch (error) {
        console.error(`${req.method} ${url.pathname} failed:`, error instanceof Error ? error.message : error);
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
      return json({ error: "not found" }, 404);
    },
  });
  console.log(`live arena for ${deployment.contractId} on http://localhost:${port}${autoplay ? ", playing matches nonstop" : ""}`);
  ledger.start();
  void work();
}
