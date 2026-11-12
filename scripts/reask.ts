import { type SignedReply, verifyReply } from "@parley/sdk";
import { NearAiMind } from "@parley/relayer";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Asks NEAR AI every recorded decision again, with the exact request bytes the contract wrote, and counts how often
 * the move comes back different. That is how much a relayer could gain by asking twice and keeping the answer it likes.
 */
const ROOT = join(import.meta.dir, "..");
const LEAGUE = process.argv[2] ?? "near-ai";
const TIMES = Number(process.argv[3] ?? "2");
const OUT = join(ROOT, "fixtures", `${LEAGUE}-reask`);
const key = process.env.NEAR_AI_API_KEY;
if (!key) throw new Error("set NEAR_AI_API_KEY");

interface Turn {
  index: number;
  model: string;
  request: string;
  reply: SignedReply;
}

const said = (response: string) => {
  try {
    return (JSON.parse(response) as { choices?: { message?: { content?: string | null } }[] }).choices?.[0]?.message?.content ?? "";
  } catch {
    return "";
  }
};
const moveOf = (response: string) => {
  const upper = said(response).toUpperCase();
  const d = upper.indexOf("DEFECT");
  const c = upper.indexOf("COOPERATE");
  return d >= 0 && (c < 0 || d < c) ? "Defect" : "Cooperate";
};

const dir = join(ROOT, "fixtures", LEAGUE, "parleys");
const decisions: { parley: number; coin: string; turn: Turn }[] = [];
for (const file of readdirSync(dir).sort()) {
  const p = JSON.parse(readFileSync(join(dir, file), "utf8")) as { parley: { id: number; a: string; b: string; turns: unknown[] }; turns: Turn[] };
  const talk = p.turns.length - 2;
  for (const t of p.turns.filter((t) => t.index >= talk)) decisions.push({ parley: p.parley.id, coin: t.index % 2 === 0 ? p.parley.a : p.parley.b, turn: t });
}

const mind = new NearAiMind(key, process.env.NEAR_AI_BASE_URL);
mkdirSync(OUT, { recursive: true });
const outFile = join(OUT, "reasks.json");
const done: { parley: number; index: number; coin: string; model: string; recorded: string; again: { move: string; reply: SignedReply }[] }[] = existsSync(outFile)
  ? JSON.parse(readFileSync(outFile, "utf8"))
  : [];
const seen = new Set(done.map((d) => `${d.parley}:${d.index}`));
const queue = decisions.filter((d) => !seen.has(`${d.parley}:${d.turn.index}`));
console.log(`${decisions.length} decisions, ${queue.length} left, asking each ${TIMES} more times`);

let finished = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let d; (d = queue.shift()); ) {
      const again: { move: string; reply: SignedReply }[] = [];
      for (let i = 0; i < TIMES; i++) {
        for (let tries = 0; ; tries++) {
          try {
            const reply = await mind.reply(d.turn.model, d.turn.request);
            if (!verifyReply(d.turn.model, d.turn.request, reply)) throw new Error("reply does not verify");
            again.push({ move: moveOf(reply.response), reply });
            break;
          } catch (error) {
            if (tries >= 3) throw error;
            await Bun.sleep(3000 * (tries + 1));
          }
        }
      }
      done.push({ parley: d.parley, index: d.turn.index, coin: d.coin, model: d.turn.model, recorded: moveOf(d.turn.reply.response), again });
      writeFileSync(outFile, JSON.stringify(done.sort((x, y) => x.parley - y.parley || x.index - y.index), null, 1));
      if (++finished % 10 === 0) console.log(`${finished} done`);
    }
  }),
);

const byModel = new Map<string, { asks: number; flips: number; anyFlip: number; n: number }>();
for (const d of done) {
  const m = byModel.get(d.model) ?? { asks: 0, flips: 0, anyFlip: 0, n: 0 };
  m.n++;
  m.asks += d.again.length;
  const flips = d.again.filter((a) => a.move !== d.recorded).length;
  m.flips += flips;
  if (flips) m.anyFlip++;
  byModel.set(d.model, m);
}
const summary = {
  league: LEAGUE,
  askedAt: new Date().toISOString(),
  decisions: done.length,
  timesEach: TIMES,
  models: Object.fromEntries([...byModel].map(([model, m]) => [model, { decisions: m.n, asks: m.asks, flipped: m.flips, decisionsThatFlippedAtLeastOnce: m.anyFlip }])),
  flipped: done.reduce((n, d) => n + d.again.filter((a) => a.move !== d.recorded).length, 0),
  asks: done.reduce((n, d) => n + d.again.length, 0),
  decisionsThatFlippedAtLeastOnce: done.filter((d) => d.again.some((a) => a.move !== d.recorded)).length,
};
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
