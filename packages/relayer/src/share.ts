import { type Arena, type Coin, type Parley, fmtNear, promises } from "@parley/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Outcome = "trust" | "betray" | "both-betray";

export interface Told {
  title: string;
  description: string;
  image: string;
  alt: string;
  /** The site route the page sends people on to. */
  route: string;
  /** The match is over, so the preview never changes. */
  final: boolean;
}

const SIGNED = "Two AI coins talked, then each picked Trust or Betray in secret. NEAR AI signed every word, and the NEAR contract checked it before any money moved.";
const SIGNED_SEASON = "Two AI coins talked, then each picked Trust or Betray in secret. NEAR AI signed every word, and the same contract checked it on a local NEAR node before any money moved.";
const ALT: Record<Outcome, string> = {
  trust: "Two Parley coins both picked Trust and got paid",
  betray: "One Parley coin trusted, the other betrayed it and took its stake",
  "both-betray": "Two Parley coins both picked Betray and both lost",
};
const KEEP = 500;
const FRESH_MS = 10_000;

export const near = (yocto: string | bigint) => fmtNear(BigInt(yocto) < 0n ? -BigInt(yocto) : yocto);

function outcomeOf(parley: Parley): Outcome | null {
  if (parley.status !== "Settled" || !parley.a_move || !parley.b_move) return null;
  if (parley.a_move === "Cooperate" && parley.b_move === "Cooperate") return "trust";
  return parley.a_move === "Defect" && parley.b_move === "Defect" ? "both-betray" : "betray";
}

/** What happened in a match, in one line for a link preview. */
export function tell(parley: Parley, name: (id: string) => string, season = false): Told {
  const [a, b] = [name(parley.a), name(parley.b)];
  const where = season ? `Season 1, match ${parley.id} on Parley.` : `Match ${parley.id} on Parley.`;
  const signed = season ? SIGNED_SEASON : SIGNED;
  const route = season ? `/season/match/${parley.id}` : `/match/${parley.id}`;
  const outcome = outcomeOf(parley);
  const plain = (title: string): Told => ({ title, description: `${where} ${signed}`, image: "og.png", alt: "Parley: memecoins with a mind of their own", route, final: parley.status !== "Open" });
  if (parley.status === "Void") return plain(`${a} vs ${b} timed out. No money moved`);
  if (!outcome) return plain(`${a} vs ${b}, live now on Parley`);
  const told = (title: string): Told => ({ title, description: `${where} ${signed}`, image: `og/${outcome}.png`, alt: ALT[outcome], route, final: true });
  if (outcome === "trust") return told(`${a} and ${b} trusted each other and each earned ${near(parley.a_delta)} NEAR`);
  if (outcome === "both-betray") return told(`${a} and ${b} betrayed each other and each lost ${near(parley.a_delta)} NEAR`);
  const [liar, victim, side] = parley.a_move === "Defect" ? [a, b, "A"] : [b, a, "B"];
  const lied = parley.turns.some((t) => t.side === side && t.kind === "Talk" && promises(t.text));
  return told(lied ? `${liar} promised to trust ${victim}, then betrayed it and took ${near(parley.stake)} NEAR` : `${liar} betrayed ${victim} and took ${near(parley.stake)} NEAR`);
}

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function shareHtml(told: Told, origin: string, path: string): string {
  const url = `${origin}${path}`;
  const image = `${origin}/${told.image}`;
  const to = `/#${told.route}`;
  const meta = [
    ["property", "og:type", "article"],
    ["property", "og:site_name", "Parley"],
    ["property", "og:url", url],
    ["property", "og:title", told.title],
    ["property", "og:description", told.description],
    ["property", "og:image", image],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", told.alt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", told.title],
    ["name", "twitter:description", told.description],
    ["name", "twitter:image", image],
    ["name", "twitter:image:alt", told.alt],
    ["name", "description", told.description],
    ["name", "theme-color", "#0a0b0f"],
  ]
    .map(([kind, key, value]) => `<meta ${kind}="${key}" content="${esc(value!)}">`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(told.title)} · Parley</title>
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.svg">
${meta}
<style>html{background:#0a0b0f;color:#f2f0ea;font:16px/1.5 system-ui,sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;text-align:center;padding:24px}a{color:#f2f0ea}</style>
</head>
<body>
<p>${esc(told.title)}.<br><a href="${esc(to)}">Watch it on Parley</a></p>
<script>location.replace(${JSON.stringify(to)})</script>
</body>
</html>`;
}

interface Season {
  parleys: Map<number, Parley>;
  names: Map<string, string>;
}

/** Link previews for `/m/<id>` (a live match) and `/m/s<id>` (a Season 1 match), cached once a match is over. */
export function sharePages(arena: Arena, site?: string) {
  const cache = new Map<string, { html: string; at: number; final: boolean }>();
  let season: Season | null | undefined;

  const loadSeason = (): Season | null => {
    if (season !== undefined) return season;
    season = null;
    const data = site ? join(site, "data") : null;
    if (!data || !existsSync(join(data, "index.json"))) return season;
    const league = (JSON.parse(readFileSync(join(data, "index.json"), "utf8")) as { name: string }[])[0];
    if (!league) return season;
    const evidence = JSON.parse(readFileSync(join(data, league.name, "evidence.json"), "utf8")) as { parley: Parley }[];
    const manifest = JSON.parse(readFileSync(join(data, league.name, "league.json"), "utf8")) as { coins: Coin[] };
    season = { parleys: new Map(evidence.map((e) => [e.parley.id, e.parley])), names: new Map(manifest.coins.map((c) => [c.id, c.name])) };
    return season;
  };

  const told = async (key: string): Promise<Told | null> => {
    if (key.startsWith("s")) {
      const s = loadSeason();
      const parley = s?.parleys.get(Number(key.slice(1)));
      return parley ? tell(parley, (id) => s!.names.get(id) ?? id.toUpperCase(), true) : null;
    }
    const parley = await arena.parley(Number(key));
    if (!parley) return null;
    const [a, b] = await Promise.all([arena.coin(parley.a), arena.coin(parley.b)]);
    return tell(parley, (id) => (id === a?.id ? a.name : id === b?.id ? b.name : id.toUpperCase()));
  };

  return async (key: string, origin: string): Promise<Response> => {
    const path = `/m/${key}`;
    const hit = cache.get(key);
    let html = hit && (hit.final || Date.now() - hit.at < FRESH_MS) ? hit.html : null;
    if (!html) {
      const found = await told(key);
      if (!found) return Response.redirect(`${origin}/`, 302);
      html = shareHtml(found, origin, path);
      if (cache.size >= KEEP) cache.delete(cache.keys().next().value!);
      cache.set(key, { html, at: Date.now(), final: found.final });
    }
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  };
}

/** The public origin of a request, through proxies such as Cloudflare. `PARLEY_SITE_URL` wins when set. */
export function originOf(req: Request): string {
  const fixed = process.env.PARLEY_SITE_URL?.replace(/\/+$/, "");
  if (fixed) return fixed;
  const url = new URL(req.url);
  const local = /^(localhost|127\.|\[::1\])/.test(url.hostname);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (local ? url.protocol.replace(":", "") : "https");
  return `${proto}://${req.headers.get("x-forwarded-host") ?? url.host}`;
}
