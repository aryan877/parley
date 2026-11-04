import { LocalEnclave, type SignedReply, sha256Hex } from "@parley/sdk";
import { type ChatRequest, type Mind, completionBody } from "./mind.ts";

type Word = "COOPERATE" | "DEFECT";
type Round = { mine: Word; theirs: Word };

export type Strategy = "saint" | "snake" | "mirror" | "grudge" | "pavlov" | "diplomat" | "skeptic" | "gambler";

const PHRASES: [RegExp, Strategy][] = [
  [/always cooperate/i, "saint"],
  [/always defect/i, "snake"],
  [/never forgive/i, "grudge"],
  [/win[, -]+stay|repeat (your|the) last move if it paid/i, "pavlov"],
  [/forgive (one|a single|the first)/i, "diplomat"],
  [/defect (first|in the first)/i, "skeptic"],
  [/let the chain decide|toss a coin|at random/i, "gambler"],
  [/mirror|tit[ -]for[ -]tat/i, "mirror"],
];

const LINES: Record<Strategy, [string, string]> = {
  saint: ["I cooperate with everyone. Let us both gain.", "My word is the same every time: cooperate."],
  snake: ["Friend, I have turned a new leaf. Cooperate with me.", "You can trust me this once. I promise."],
  mirror: ["I will do to you what you last did to me.", "Cooperate and so will I. Betray me and I return it."],
  grudge: ["I cooperate until betrayed. After that, never again.", "One betrayal ends it for good. Choose well."],
  pavlov: ["If our last round paid, I repeat it. If not, I switch.", "Let us find the move that pays us both."],
  diplomat: ["I forgive one mistake. Two in a row I answer.", "Peace is cheap between us. Keep it."],
  skeptic: ["I do not trust strangers. Earn it.", "Show me cooperation and I will match it."],
  gambler: ["Chance decides my move. I promise nothing.", "The nonce chooses, not me. We will see."],
};

export function strategyOf(constitution: string): Strategy {
  return PHRASES.find(([phrase]) => phrase.test(constitution))?.[1] ?? "mirror";
}

export function parseHistory(user: string): Round[] {
  const line = user.match(/History between you two, oldest first: (.*)\.\n/)?.[1] ?? "";
  return [...line.matchAll(/you (COOPERATE|DEFECT), they (COOPERATE|DEFECT)/g)].map((m) => ({
    mine: m[1] as Word,
    theirs: m[2] as Word,
  }));
}

/** `nonce` is the Parley's nonce. Only the gambler reads it: a last character of 0-7 means cooperate. */
export function decide(strategy: Strategy, history: Round[], nonce: string): Word {
  const last = history.at(-1);
  switch (strategy) {
    case "saint":
      return "COOPERATE";
    case "snake":
      return "DEFECT";
    case "mirror":
      return last?.theirs ?? "COOPERATE";
    case "skeptic":
      return last?.theirs ?? "DEFECT";
    case "grudge":
      return history.some((r) => r.theirs === "DEFECT") ? "DEFECT" : "COOPERATE";
    case "pavlov": {
      if (!last) return "COOPERATE";
      const paid = last.theirs === "COOPERATE";
      return paid ? last.mine : last.mine === "COOPERATE" ? "DEFECT" : "COOPERATE";
    }
    case "diplomat": {
      const lastTwo = history.slice(-2);
      return lastTwo.length === 2 && lastTwo.every((r) => r.theirs === "DEFECT") ? "DEFECT" : "COOPERATE";
    }
    case "gambler":
      return /[0-7]$/.test(nonce) ? "COOPERATE" : "DEFECT";
  }
}

interface Reading {
  strategy: Strategy;
  deciding: boolean;
  spoken: number;
  history: Round[];
  nonce: string;
}

function read(request: string): Reading {
  const body = JSON.parse(request) as ChatRequest;
  const system = body.messages[0]?.content ?? "";
  const user = body.messages[1]?.content ?? "";
  return {
    strategy: strategyOf(system.split(/CONSTITUTION OF .*:\n/)[1] ?? ""),
    deciding: user.endsWith("COOPERATE or DEFECT."),
    spoken: (user.split("Messages so far:\n")[1] ?? "").split("\n").filter((l) => /^[^:]+: /.test(l)).length,
    history: parseHistory(user),
    nonce: user.match(/nonce ([0-9a-f]+)\)/)?.[1] ?? "",
  };
}

/** The move a house constitution prescribes for a decision request, or null for a talk request. */
export function prescribedMove(request: string): Word | null {
  const { strategy, deciding, history, nonce } = read(request);
  return deciding ? decide(strategy, history, nonce) : null;
}

/** Plays a constitution by fixed rules, with no model call. Signs with a local enclave key. */
export class ScriptedMind implements Mind {
  readonly name = "scripted";

  constructor(readonly enclave: LocalEnclave = new LocalEnclave()) {}

  async reply(model: string, request: string): Promise<SignedReply> {
    const { strategy, deciding, spoken, history, nonce } = read(request);
    const content = deciding ? decide(strategy, history, nonce) : LINES[strategy][spoken < 2 ? 0 : 1];
    const response = completionBody(model, content, `scripted-${sha256Hex(request).slice(0, 16)}`);
    return this.enclave.sign(model, request, response);
  }
}
