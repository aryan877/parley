import { ARENA_API } from "../lib/live.ts";
import type { Match } from "../lib/model.ts";
import { fmtNear } from "../lib/model.ts";
import { promised } from "../lib/words.ts";
import { ShareIcon } from "./icons.tsx";

const TAGS = "@NEARProtocol #NEARHackathon";

/** A match links to the server's preview page, which names what happened and then opens the match. */
function pageOf(path: string): string {
  const match = path.match(/^\/(season\/)?match\/(\d+)$/);
  if (match) return `${ARENA_API}/m/${match[1] ? "s" : ""}${match[2]}`;
  return `${window.location.origin}${window.location.pathname}#${path}`;
}

/** An X post link with our line, the page and the tags. Nothing is tracked. */
export function shareLink(text: string, path: string): string {
  const page = pageOf(path);
  return `https://x.com/intent/post?text=${encodeURIComponent(`${text} ${TAGS}`)}&url=${encodeURIComponent(page)}`;
}

/** The match in one shareable line, told from the side of a coin the viewer made when there is one. */
export function matchShareLine(m: Match, name: (id: string) => string, mine: (id: string) => boolean): string {
  const [a, b] = [name(m.a), name(m.b)];
  const signed = "Every word was signed by NEAR AI.";
  const my = (id: string) => (mine(id) ? `My coin ${name(id)}` : name(id));
  if (m.aMove === "Cooperate" && m.bMove === "Cooperate") {
    const first = mine(m.b) && !mine(m.a) ? m.b : m.a;
    return `${my(first)} and ${name(first === m.a ? m.b : m.a)} trusted each other in Parley and both got paid. ${signed}`;
  }
  if (m.aMove === "Defect" && m.bMove === "Defect") return `${a} and ${b} both betrayed each other in Parley. Nobody won. ${signed}`;
  const [liar, victim, side] = m.aMove === "Defect" ? [m.a, m.b, "A" as const] : [m.b, m.a, "B" as const];
  const lie = promised(m, side) ? " after promising to trust it" : "";
  if (mine(victim) && !mine(liar)) return `My coin ${name(victim)} just got betrayed by ${name(liar)} in Parley${lie}. ${signed}`;
  return `${my(liar)} just betrayed ${name(victim)} in Parley${lie} and took ${fmtNear(m.stake)} NEAR. ${signed}`;
}

export function ShareButton({ text, path, label = "Share on X" }: { text: string; path: string; label?: string }) {
  return (
    <a className="btn ghost small-btn share-btn" href={shareLink(text, path)} target="_blank" rel="noreferrer noopener">
      <ShareIcon size={16} /> {label}
    </a>
  );
}
