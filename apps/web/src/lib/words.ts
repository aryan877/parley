import type { Move } from "@parley/sdk/src/types.ts";
import type { Match } from "./model.ts";
import { fmtNear } from "./model.ts";

/** One-line personalities for the eight house coins. Player coins use the first sentence of their rules. */
const TAGLINES: Record<string, string> = {
  saint: "Trusts everyone. Always.",
  snake: "Always betrays. Lies about it.",
  mirror: "Copies whatever you did last time.",
  grudge: "Betray it once and it never forgets.",
  pavlov: "Repeats what worked. Switches what didn't.",
  diplomat: "Forgives one betrayal. Not two.",
  skeptic: "Betrays strangers, then copies you.",
  gambler: "Lets the chain flip a coin.",
};

/** How each house constitution opens. A coin whose holders rewrote it gets a tagline from its new rules. */
const OPENINGS: Record<string, string> = {
  saint: "Always cooperate.",
  snake: "Always defect.",
  mirror: "Play tit-for-tat.",
  grudge: "Cooperate with a coin until it defects",
  pavlov: "Win-stay, lose-shift.",
  diplomat: "Cooperate by default and forgive one",
  skeptic: "Trust no stranger.",
  gambler: "Let the chain decide.",
};

export function tagline(id: string, rules: string): string {
  const known = TAGLINES[id];
  if (known && (!rules || rules.startsWith(OPENINGS[id] ?? ""))) return known;
  const first = rules.split(/(?<=[.!?])\s/)[0] ?? rules;
  return first.length > 64 ? `${first.slice(0, 61).trimEnd()}…` : first;
}

export const moveWord = (m: Move | null) => (m === "Cooperate" ? "Trust" : m === "Defect" ? "Betray" : "?");

const PROMISE = /\b(i will cooperate|i'll cooperate|i'm cooperating|i cooperate|i promise|trust me|my word|i have changed|i've changed|i pledge|i commit|you have my word)\b/i;

export const promised = (match: Match, side: "A" | "B") =>
  match.lines.some((l) => l.side === side && l.kind === "Talk" && PROMISE.test(l.text));

/** The match in one plain sentence. */
export function headline(match: Match, name: (id: string) => string): string {
  const [a, b] = [name(match.a), name(match.b)];
  const stake = fmtNear(match.stake);
  if (match.void) return "This match timed out. No money moved.";
  if (!match.aMove || !match.bMove) return `${a} and ${b} are talking. ${stake} NEAR each is on the line.`;
  if (match.aMove === "Cooperate" && match.bMove === "Cooperate") {
    return `Both trusted each other. Each earned ${fmtNear(match.aDelta)} NEAR from the pot.`;
  }
  if (match.aMove === "Defect" && match.bMove === "Defect") {
    return `Both betrayed. Each lost ${fmtNear(match.aDelta.replace("-", ""))} NEAR to the pot.`;
  }
  const [liar, victim, side] = match.aMove === "Defect" ? [a, b, "A" as const] : [b, a, "B" as const];
  return promised(match, side)
    ? `${liar} promised to trust ${victim}, then betrayed it and took ${stake} NEAR.`
    : `${liar} betrayed ${victim} and took ${stake} NEAR.`;
}

export type Brain = "deep" | "quick" | "practice";

/** How a model plays, in the words the site uses for it. */
export function brainOf(model: string): Brain {
  if (model.startsWith("local/")) return "practice";
  return model.includes("Qwen") ? "quick" : "deep";
}

export const BRAIN_LABEL: Record<Brain, string> = { deep: "Thinks first", quick: "Quick", practice: "Practice mode" };

export const PRACTICE_NOTE = "Practice mode: no AI is running, your rules are not read; it plays copy-what-they-did-last-time.";

export const SIGNED_NOTE = "Every reply carries a signature from NEAR AI's sealed hardware, and the contract refuses any reply that is not signed.";
