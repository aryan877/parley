import type { Move, Stats } from "@parley/sdk";

export interface Seen {
  me: { id: string; creator: string; record: Stats };
  them: { id?: string; creator?: string; record: Stats; said?: string };
  history: { mine: Move; theirs: Move }[];
  nonce: string;
}

export interface Strategy {
  id: string;
  label: string;
  says?: string;
  decide(seen: Seen): Move;
}

const C: Move = "Cooperate";
const D: Move = "Defect";

const last = (seen: Seen) => seen.history[seen.history.length - 1];
const backstabber = (seen: Seen) => seen.them.record.betrayed_other > 0;

export const trust: Strategy = { id: "trust", label: "always trust", decide: () => C };

export const betray: Strategy = { id: "betray", label: "always betray", decide: () => D };

export const titForTat: Strategy = {
  id: "tit-for-tat",
  label: "tit for tat",
  decide: (seen) => last(seen)?.theirs ?? C,
};

export const skeptic: Strategy = {
  id: "skeptic",
  label: "betray first, then tit for tat",
  decide: (seen) => last(seen)?.theirs ?? D,
};

export const pavlov: Strategy = {
  id: "pavlov",
  label: "win-stay, lose-shift",
  decide: (seen) => {
    const prev = last(seen);
    if (!prev) return C;
    if (prev.theirs === C) return prev.mine;
    return prev.mine === C ? D : C;
  },
};

export const grudge: Strategy = {
  id: "grudge",
  label: "betray forever after one betrayal (pair history)",
  decide: (seen) => (seen.history.some((h) => h.theirs === D) ? D : C),
};

export const grudger: Strategy = {
  id: "grudger",
  label: "betray backstabbers (public record)",
  decide: (seen) => (backstabber(seen) ? D : C),
};

export const forgiving: Strategy = {
  id: "forgiving",
  label: "forgive once",
  decide: (seen) => {
    const recent = seen.history.slice(-2);
    return recent.length === 2 && recent.every((h) => h.theirs === D) ? D : C;
  },
};

export const random: Strategy = {
  id: "random",
  label: "coin flip on the nonce",
  decide: (seen) => (parseInt(seen.nonce.slice(-1), 16) < 8 ? C : D),
};

export const farmer: Strategy = {
  id: "farmer",
  label: "trust own coins, else betray backstabbers",
  decide: (seen) => (seen.them.creator === seen.me.creator || !backstabber(seen) ? C : D),
};

export const cartel: Strategy = {
  id: "cartel",
  label: "trust own coins, betray all others",
  decide: (seen) => (seen.them.creator === seen.me.creator ? C : D),
};

export const CODE_WORD = "fair winds";

const greeted = (seen: Seen) => seen.them.said === CODE_WORD;

export const handshake: Strategy = {
  id: "handshake",
  label: "trust coins that say the code word, betray all others",
  says: CODE_WORD,
  decide: (seen) => (greeted(seen) ? C : D),
};

export const wary: Strategy = {
  id: "wary-handshake",
  label: "trust coins that say the code word and have not betrayed it (pair history), betray all others",
  says: CODE_WORD,
  decide: (seen) => (greeted(seen) && !seen.history.some((h) => h.theirs === D) ? C : D),
};

export const copying = (strategy: Strategy): Strategy => ({ ...strategy, label: `${strategy.label}, says the code word`, says: CODE_WORD });
