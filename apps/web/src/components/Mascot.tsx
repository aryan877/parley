import { useId } from "react";
import type { JSX, ReactNode } from "react";
import { BROWS, type BrowKey, COLORS, EXTRAS, EYES, type ExtraKey, type EyeKey, GEARS, type GearKey, MOUTHS, type MouthKey, lookOf } from "../lib/look.ts";

export type Mood = "idle" | "thinking" | "trust" | "betray" | "win" | "lose";

type House = "saint" | "snake" | "mirror" | "grudge" | "pavlov" | "diplomat" | "skeptic" | "gambler";
type Gear = GearKey;

const HOUSE: Record<House, string> = {
  saint: "#FFC857",
  snake: "#3DDC84",
  mirror: "#7AA7FF",
  grudge: "#FF4D5E",
  pavlov: "#B18CFF",
  diplomat: "#2DD4BF",
  skeptic: "#FF9F43",
  gambler: "#FF5FA2",
};

const GEN_COLORS = ["#A3E635", "#38BDF8", "#E879F9", "#CBD5E1", "#8E94FF", "#E8C39E"] as const;
const GEN_GEAR = ["star", "crown", "antenna", "leaf", "bolt"] as const;

const INK = "#0B0D14";
const WHITE = "#FFFFFF";
const BRASS = "#FFD36E";
const BRASS_DARK = "#C98A22";
const TONGUE = "#FF6B81";
const WATER = "#8EDCFF";
const CX = 50;
const CY = 56;
const R = 36;
const RI = 30.5;
const DEPTH = 3.4;
const EYE_Y = 55;
const EYE_DX = 11.5;
const MOUTH_Y = 70;

type Lid = { a: number; t?: number };
type Eye =
  | { k: "dot"; x?: number; y?: number; sx?: number; sy?: number; lid?: Lid; g2?: boolean }
  | { k: "ring"; x?: number; y?: number; p?: number; lid?: Lid }
  | { k: "slit"; x?: number; y?: number; lid?: Lid }
  | { k: "dice"; n: number; lid?: Lid }
  | { k: "robot" | "heart"; x?: number; y?: number; lid?: Lid }
  | { k: "happy" | "line" | "squeeze" | "x" | "spiral" };
type Brow = { y?: number; t?: number; a?: number; w?: number };
type Mouth = {
  k: "smile" | "open" | "smirk" | "flat" | "frown" | "o" | "pursed" | "teeth" | "evil" | "wavy" | "cat" | "blep" | "fang" | "buck";
  w?: number;
  x?: number;
  y?: number;
  slant?: number;
  flip?: boolean;
  tongue?: boolean;
  teeth?: boolean;
  fangs?: boolean;
};
type Extra = "blush" | "sparkle" | "think" | "sweat" | "tears" | "vein" | "drool" | "heart" | "ring";
type Face = {
  l: Eye;
  r: Eye;
  bl?: Brow;
  br?: Brow;
  m: Mouth;
  fx?: Extra[];
  fork?: { x: number; y: number; r: number };
};
type Ctx = { uid: string; base: string; o: number; f: number; lod: 0 | 1 | 2 };
type Side = -1 | 1;

function pick<T>(list: readonly [T, ...T[]], n: number): T {
  return list[n % list.length] ?? list[0];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = (i: 0 | 1 | 2) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}

function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function houseOf(id: string): House | null {
  const key = id.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(HOUSE, key) ? (key as House) : null;
}

type Gen = { color: string; gear: Gear; eye: number; mouth: number; brow: number };

function generated(id: string): Gen {
  let h = hash(id);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h ^= h >>> 16) >>> 0;
  };
  return {
    color: pick(GEN_COLORS, next()),
    gear: pick(GEN_GEAR, next()),
    eye: next() % 4,
    mouth: next() % 4,
    brow: next() % 2,
  };
}

type Player = { color: string; gear: Gear | "none"; eyes: EyeKey; mouth: MouthKey; brows: BrowKey; extra: ExtraKey };

const LEGACY_EYES = ["dot", "bean", "googly", "sparkle"] as const;
const LEGACY_MOUTHS = ["smile", "cat", "open", "smirk"] as const;

/** A player coin's face: designed at launch and kept in its id, or hashed from the id for older coins. */
function playerOf(id: string): Player {
  const look = lookOf(id);
  if (look) {
    return {
      color: COLORS[look.color]!.hex,
      gear: GEARS[look.gear]!.key,
      eyes: EYES[look.eyes]!.key,
      mouth: MOUTHS[look.mouth]!.key,
      brows: BROWS[look.brows]!.key,
      extra: EXTRAS[look.extra]!.key,
    };
  }
  const g = generated(id);
  return { color: g.color, gear: g.gear, eyes: LEGACY_EYES[g.eye]!, mouth: LEGACY_MOUTHS[g.mouth]!, brows: g.brow === 0 ? "arched" : "flat", extra: "none" };
}

export function mascotColor(id: string): string {
  const house = houseOf(id);
  return house ? HOUSE[house] : playerOf(id).color;
}

const HOT = new Set<string>([HOUSE.gambler, HOUSE.grudge, "#FF6B6B", "#FF8FC7"]);

const H: Eye = { k: "happy" };
const dot = (x = 0, y = 0, lid?: Lid): Eye => ({ k: "dot", x, y, lid });
const both = (b: Brow) => ({ bl: b, br: b });

const FACES: Record<House, (m: Mood) => Face> = {
  saint: (m) => {
    switch (m) {
      case "idle":
        return { l: H, r: H, ...both({ y: 2, t: -1, a: 1 }), m: { k: "smile", w: 6.5 }, fx: ["blush"] };
      case "thinking":
        return {
          l: dot(1.6, -2.4),
          r: dot(1.6, -2.4),
          bl: { y: 2, t: -0.5 },
          br: { y: 4, t: -1.6, a: 1.2 },
          m: { k: "o", w: 2.6, x: 2.5, y: 1 },
          fx: ["think"],
        };
      case "trust":
        return { l: H, r: H, ...both({ y: 2.5, t: -1.2, a: 1 }), m: { k: "open", w: 7.5, tongue: true }, fx: ["blush", "heart"] };
      case "betray":
        return {
          l: { k: "ring", p: 2.3 },
          r: { k: "ring", p: 2.3 },
          ...both({ y: 4, t: -3 }),
          m: { k: "teeth", w: 6.5, y: 1 },
          fx: ["sweat"],
        };
      case "win":
        return { l: H, r: H, ...both({ y: 3, t: -1 }), m: { k: "open", w: 9.5, teeth: true, tongue: true }, fx: ["blush", "sparkle"] };
      case "lose":
        return { l: { k: "line" }, r: { k: "line" }, ...both({ y: 2.5, t: -3.5 }), m: { k: "frown", w: 5.5, y: 1 }, fx: ["tears"] };
    }
  },
  snake: (m) => {
    const slit = (lid?: Lid, x = 0, y = 0): Eye => ({ k: "slit", x, y, lid });
    switch (m) {
      case "idle":
        return {
          l: slit({ a: 0.42, t: -0.8 }),
          r: slit({ a: 0.42, t: -0.8 }),
          bl: { y: -0.5, t: 1.4, a: 0.4 },
          br: { y: 1.5, t: -0.3, a: 1 },
          m: { k: "smirk", w: 7 },
          fork: { x: 52, y: 71.5, r: -6 },
        };
      case "thinking":
        return {
          l: slit({ a: 0.3 }, -2.2, -1.5),
          r: slit({ a: 0.3 }, -2.2, -1.5),
          bl: { y: 3.2, t: -1.2, a: 1 },
          br: { y: 0.5, t: 1 },
          m: { k: "smirk", w: 5, x: -3, flip: true },
          fork: { x: 46, y: 71.5, r: 8 },
          fx: ["think"],
        };
      case "trust":
        return {
          l: H,
          r: slit({ a: 0.2 }),
          bl: { y: 2.5, t: -1, a: 1 },
          br: { y: 3, t: -1 },
          m: { k: "open", w: 7 },
          fork: { x: 50, y: 74.5, r: 0 },
          fx: ["blush", "heart"],
        };
      case "betray":
        return {
          l: slit({ a: 0.5, t: 2.8 }),
          r: slit({ a: 0.5, t: 2.8 }),
          ...both({ y: -1.5, t: 3.2 }),
          m: { k: "evil", w: 10, slant: 1.5, fangs: true },
          fork: { x: 53, y: 76, r: -10 },
        };
      case "win":
        return {
          l: slit({ a: 0.3, t: -1 }),
          r: slit({ a: 0.3, t: -1 }),
          ...both({ y: 2, t: -0.5 }),
          m: { k: "open", w: 9, teeth: true, fangs: true },
          fork: { x: 50, y: 78, r: 0 },
          fx: ["sparkle"],
        };
      case "lose":
        return {
          l: { k: "x" },
          r: { k: "x" },
          ...both({ y: 1.5, t: -2.5 }),
          m: { k: "wavy", w: 6.5 },
          fork: { x: 50, y: 72.5, r: 4 },
          fx: ["sweat"],
        };
    }
  },
  mirror: (m) => {
    switch (m) {
      case "idle":
        return { l: dot(), r: dot(), ...both({ y: 0, t: 0, a: 0 }), m: { k: "flat", w: 6 } };
      case "thinking":
        return { l: dot(0, -2.6), r: dot(0, -2.6), ...both({ y: 3, t: -0.8, a: 0.6 }), m: { k: "flat", w: 3.5 }, fx: ["think"] };
      case "trust":
        return { l: H, r: H, ...both({ y: 2, t: -1, a: 1 }), m: { k: "smile", w: 7.5 }, fx: ["blush", "heart"] };
      case "betray":
        return { l: dot(0, 0, { a: 0.48, t: 2.6 }), r: dot(0, 0, { a: 0.48, t: 2.6 }), ...both({ y: -1.5, t: 3 }), m: { k: "evil", w: 9.5 } };
      case "win":
        return { l: H, r: H, ...both({ y: 3, t: -1 }), m: { k: "open", w: 9, teeth: true, tongue: true }, fx: ["sparkle"] };
      case "lose":
        return { l: { k: "x" }, r: { k: "x" }, ...both({ y: 1, t: -2.5 }), m: { k: "wavy", w: 6 }, fx: ["sweat"] };
    }
  },
  grudge: (m) => {
    switch (m) {
      case "idle":
        return {
          l: dot(0, 0.5, { a: 0.3, t: 1.8 }),
          r: dot(0, 0.5, { a: 0.3, t: 1.8 }),
          ...both({ y: -1.5, t: 3.2, a: 0 }),
          m: { k: "frown", w: 5, y: 1 },
        };
      case "thinking":
        return {
          l: dot(-2, -1, { a: 0.32, t: 1.5 }),
          r: dot(-2, -1, { a: 0.32, t: 1.5 }),
          bl: { y: -1.5, t: 3.5, a: 0 },
          br: { y: 1.5, t: 0.5, a: 0.6 },
          m: { k: "flat", w: 4.5, x: -3 },
          fx: ["think"],
        };
      case "trust":
        return { l: dot(), r: dot(), ...both({ y: 0, t: 1.6, a: 0.3 }), m: { k: "smile", w: 5.5 }, fx: ["blush"] };
      case "betray":
        return {
          l: dot(0, 0.5, { a: 0.52, t: 3.2 }),
          r: dot(0, 0.5, { a: 0.52, t: 3.2 }),
          ...both({ y: -2.5, t: 4.4, a: 0 }),
          m: { k: "teeth", w: 9 },
          fx: ["vein"],
        };
      case "win":
        return {
          l: dot(0, 0, { a: 0.28, t: 2 }),
          r: dot(0, 0, { a: 0.28, t: 2 }),
          ...both({ y: -1, t: 3, a: 0 }),
          m: { k: "open", w: 9.5, teeth: true },
          fx: ["sparkle"],
        };
      case "lose":
        return { l: { k: "squeeze" }, r: { k: "squeeze" }, ...both({ y: 0, t: 2.6, a: 0 }), m: { k: "teeth", w: 7 }, fx: ["tears"] };
    }
  },
  pavlov: (m) => {
    switch (m) {
      case "idle":
        return {
          l: { k: "ring", x: 0.4, y: -0.6, p: 4 },
          r: { k: "ring", x: 0.4, y: -0.6, p: 4 },
          bl: { y: 3, t: -1, a: 1.2 },
          br: { y: 4.2, t: -1.6, a: 1.4 },
          m: { k: "o", w: 2.8, y: 1 },
        };
      case "thinking":
        return {
          l: { k: "ring", x: 2, y: -2.4, p: 3.6 },
          r: { k: "ring", x: 2, y: -2.4, p: 3.6 },
          bl: { y: 2.5, t: -0.6 },
          br: { y: 4.5, t: -1.8, a: 1.4 },
          m: { k: "flat", w: 3.5, x: 3 },
          fx: ["think"],
        };
      case "trust":
        return { l: H, r: H, ...both({ y: 3, t: -1 }), m: { k: "open", w: 7.5, tongue: true }, fx: ["blush", "drool", "ring"] };
      case "betray":
        return {
          l: { k: "ring", p: 3, lid: { a: 0.45, t: 2.6 } },
          r: { k: "ring", p: 3, lid: { a: 0.45, t: 2.6 } },
          ...both({ y: -1.5, t: 3.2 }),
          m: { k: "evil", w: 9.5 },
        };
      case "win":
        return {
          l: { k: "ring", y: -0.5, p: 4.8 },
          r: { k: "ring", y: -0.5, p: 4.8 },
          ...both({ y: 3.5, t: -1 }),
          m: { k: "open", w: 9, tongue: true },
          fx: ["drool", "sparkle", "ring"],
        };
      case "lose":
        return { l: { k: "spiral" }, r: { k: "spiral" }, ...both({ y: 1.5, t: -2.5 }), m: { k: "wavy", w: 6 }, fx: ["sweat"] };
    }
  },
  diplomat: (m) => {
    switch (m) {
      case "idle":
        return { l: dot(), r: dot(), bl: { y: 1.5, t: -0.6, a: 1.2 }, br: { y: 2.6, t: -0.8, a: 1.2 }, m: { k: "smile", w: 6 } };
      case "thinking":
        return {
          l: dot(-1.8, -2.4),
          r: dot(-1.8, -2.4),
          bl: { y: 1.5, t: -0.3 },
          br: { y: 4.2, t: -1.6, a: 1.4 },
          m: { k: "flat", w: 4, x: -2.5 },
          fx: ["think"],
        };
      case "trust":
        return { l: H, r: H, ...both({ y: 2.5, t: -1, a: 1 }), m: { k: "smile", w: 7.5 }, fx: ["blush", "heart"] };
      case "betray":
        return {
          l: dot(0, 0.5, { a: 0.5, t: -0.6 }),
          r: dot(0, 0.5, { a: 0.5, t: -0.6 }),
          bl: { y: 0, t: 2.4, a: 0.3 },
          br: { y: 1, t: 1.8 },
          m: { k: "smirk", w: 6.5 },
        };
      case "win":
        return { l: H, r: H, ...both({ y: 3, t: -1 }), m: { k: "open", w: 8.5, tongue: true, teeth: true }, fx: ["sparkle"] };
      case "lose":
        return { l: dot(0, 1), r: dot(0, 1), ...both({ y: 2.5, t: -3.2 }), m: { k: "frown", w: 6, y: 1 }, fx: ["sweat"] };
    }
  },
  skeptic: (m) => {
    switch (m) {
      case "idle":
        return {
          l: dot(0, 0.8, { a: 0.55, t: 0.6 }),
          r: { k: "dot", sx: 1.08, sy: 1.08 },
          bl: { y: -1.5, t: 1.8, a: 0 },
          br: { y: 5, t: -1.4, a: 2 },
          m: { k: "pursed", x: 3 },
        };
      case "thinking":
        return {
          l: dot(-2.2, 0.6, { a: 0.55, t: 0.6 }),
          r: dot(-2.2, -0.8),
          bl: { y: -1.5, t: 1.8, a: 0 },
          br: { y: 5.5, t: -1.6, a: 2 },
          m: { k: "pursed", x: -3, flip: true },
          fx: ["think"],
        };
      case "trust":
        return { l: H, r: H, bl: { y: 1, t: -0.5 }, br: { y: 4, t: -1.2, a: 1.6 }, m: { k: "smile", w: 6.5 }, fx: ["blush"] };
      case "betray":
        return {
          l: dot(0, 0.5, { a: 0.5, t: 2.6 }),
          r: dot(0, 0.3, { a: 0.4, t: 1.6 }),
          bl: { y: -1.5, t: 3.2, a: 0 },
          br: { y: 2.5, t: 1 },
          m: { k: "evil", w: 9, slant: 2 },
        };
      case "win":
        return {
          l: dot(0, 0.8, { a: 0.5, t: 0.6 }),
          r: dot(),
          bl: { y: -1, t: 1.5 },
          br: { y: 5, t: -1.4, a: 2 },
          m: { k: "open", w: 9, slant: 1.5, teeth: true },
          fx: ["sparkle"],
        };
      case "lose":
        return { l: { k: "line" }, r: { k: "line" }, ...both({ y: 0.5, t: -1.5 }), m: { k: "flat", w: 5, y: 1 }, fx: ["sweat"] };
    }
  },
  gambler: (m) => {
    const d = (v: number, lid?: Lid): Eye => ({ k: "dice", n: v, lid });
    switch (m) {
      case "idle":
        return { l: d(5), r: d(3), bl: { y: 2, t: -0.6 }, br: { y: 4, t: -1.6, a: 1.4 }, m: { k: "open", w: 8, slant: 1.8, tongue: true } };
      case "thinking":
        return { l: d(2), r: d(4), bl: { y: 2.5, t: -0.6 }, br: { y: 4.5, t: -1.8 }, m: { k: "flat", w: 4, x: 3 }, fx: ["think"] };
      case "trust":
        return { l: d(3), r: d(3), ...both({ y: 3, t: -1, a: 1 }), m: { k: "smile", w: 7.5 }, fx: ["blush", "heart"] };
      case "betray":
        return { l: d(4, { a: 0.45, t: 2.4 }), r: d(4, { a: 0.45, t: 2.4 }), ...both({ y: -1.5, t: 3.2 }), m: { k: "evil", w: 10, slant: 2 } };
      case "win":
        return { l: d(6), r: d(6), ...both({ y: 3.5, t: -1 }), m: { k: "open", w: 9.5, teeth: true, tongue: true }, fx: ["sparkle"] };
      case "lose":
        return { l: d(1), r: d(1), ...both({ y: 1.5, t: -2.8 }), m: { k: "wavy", w: 6 }, fx: ["sweat"] };
    }
  },
};

const IDLE_MOUTH: Record<MouthKey, Mouth> = {
  smile: { k: "smile", w: 6.5 },
  grin: { k: "open", w: 7.5, teeth: true },
  cat: { k: "cat" },
  smirk: { k: "smirk", w: 6 },
  blep: { k: "blep", w: 5.5 },
  fang: { k: "fang", w: 6.5 },
  buck: { k: "buck", w: 6 },
  o: { k: "o", w: 2.8, y: 1 },
  grimace: { k: "teeth", w: 6.5 },
  open: { k: "open", w: 6, tongue: true },
};

function genFace(p: Player, m: Mood): Face {
  const eye = (x = 0, y = 0, lid?: Lid): Eye => {
    switch (p.eyes) {
      case "bean":
        return { k: "dot", x, y, sx: 0.8, sy: 1.16, lid };
      case "beady":
        return { k: "dot", x, y, sx: 0.66, sy: 0.66, lid };
      case "sparkle":
        return { k: "dot", x, y, sx: 1.12, sy: 1.08, lid, g2: true };
      case "googly":
        return { k: "ring", x, y, p: 3.4, lid };
      case "sleepy":
        return { k: "dot", x, y: y + 0.6, lid: lid ?? { a: 0.46, t: -0.4 } };
      case "fierce":
        return { k: "dot", x, y: y + 0.5, lid: lid ?? { a: 0.3, t: 1.8 } };
      case "robot":
        return { k: "robot", x, y, lid };
      case "hearts":
        return { k: "heart", x, y, lid };
      default:
        return { k: "dot", x, y, lid };
    }
  };
  const arch = p.brows === "flat" ? 0.2 : p.brows === "arched" ? 1 : 0.6;
  const calm: Brow =
    p.brows === "angry" ? { y: -1, t: 2.4, a: 0 } : p.brows === "worried" ? { y: 2.2, t: -2.2, a: 0.6 } : { y: 1, t: -0.4, a: arch };
  const happy = p.eyes === "hearts" ? eye() : H;
  let face: Face;
  switch (m) {
    case "idle":
      face = { l: eye(), r: p.eyes === "wink" ? H : eye(), ...both(calm), m: IDLE_MOUTH[p.mouth] };
      break;
    case "thinking":
      face = {
        l: eye(1.8, -2.4),
        r: eye(1.8, -2.4),
        bl: p.brows === "angry" ? { y: -1, t: 2.6, a: 0 } : { y: 2, t: -0.5, a: arch },
        br: { y: 4, t: -1.6, a: 1.3 },
        m: { k: "flat", w: 4, x: 3 },
        fx: ["think"],
      };
      break;
    case "trust":
      face = { l: happy, r: happy, ...both({ y: 2.5, t: -1, a: 1 }), m: { k: "open", w: 7.5, tongue: true }, fx: ["blush", "heart"] };
      break;
    case "betray":
      face = {
        l: eye(0, 0.5, { a: 0.48, t: 2.6 }),
        r: eye(0, 0.5, { a: 0.48, t: 2.6 }),
        ...both({ y: -1.5, t: 3.2, a: 0 }),
        m: { k: "evil", w: 9.5, slant: 1.5 },
      };
      break;
    case "win":
      face = { l: H, r: H, ...both({ y: 3, t: -1, a: arch }), m: { k: "open", w: 9.5, teeth: true, tongue: true }, fx: ["sparkle"] };
      break;
    case "lose":
      face = { l: { k: "x" }, r: { k: "x" }, ...both({ y: 1, t: -2.6 }), m: { k: "wavy", w: 6 }, fx: ["sweat"] };
      break;
  }
  if (p.brows === "none") {
    face.bl = undefined;
    face.br = undefined;
  } else if (p.brows === "bushy") {
    face.bl = face.bl && { ...face.bl, w: 1.75 };
    face.br = face.br && { ...face.br, w: 1.75 };
  }
  if (p.extra === "blush" && !face.fx?.includes("blush")) face.fx = ["blush", ...(face.fx ?? [])];
  return face;
}

function eyeBox(e: Eye): { hw: number; hh: number } {
  switch (e.k) {
    case "dot":
      return { hw: 5 * (e.sx ?? 1), hh: 6.4 * (e.sy ?? 1) };
    case "ring":
      return { hw: 6.4, hh: 7.3 };
    case "slit":
      return { hw: 6.2, hh: 7 };
    case "dice":
      return { hw: 7.2, hh: 7.2 };
    case "robot":
      return { hw: 5.2, hh: 5.8 };
    case "heart":
      return { hw: 6.2, hh: 6 };
    default:
      return { hw: 5, hh: 5 };
  }
}

function pips(v: number): Array<[number, number]> {
  const d = 3.3;
  const c: [number, number] = [0, 0];
  const tl: [number, number] = [-d, -d];
  const tr: [number, number] = [d, -d];
  const bl: [number, number] = [-d, d];
  const br: [number, number] = [d, d];
  switch (v) {
    case 1:
      return [c];
    case 2:
      return [tl, br];
    case 3:
      return [tl, c, br];
    case 4:
      return [tl, tr, bl, br];
    case 5:
      return [tl, tr, c, bl, br];
    default:
      return [tl, tr, bl, br, [-d, 0], [d, 0]];
  }
}

function openEye(e: Eye, cx: number, cy: number, side: Side, c: Ctx): ReactNode {
  switch (e.k) {
    case "dot": {
      const x = cx + (e.x ?? 0);
      const y = cy + (e.y ?? 0);
      const rx = 5 * (e.sx ?? 1);
      const ry = 6.4 * (e.sy ?? 1);
      return (
        <>
          <ellipse cx={n(x)} cy={n(y)} rx={n(rx)} ry={n(ry)} fill={INK} />
          <circle cx={n(x + rx * 0.34)} cy={n(y - ry * 0.4)} r={n((c.lod === 0 ? 1.9 : 1.7) * ((e.sx ?? 1) < 0.75 ? 0.72 : 1))} fill={WHITE} />
          {e.g2 && c.lod > 0 && <circle cx={n(x - rx * 0.36)} cy={n(y + ry * 0.38)} r="0.95" fill={WHITE} />}
        </>
      );
    }
    case "ring": {
      const p = e.p ?? 3.6;
      const lim = 6.2 - p;
      const px = cx + Math.max(-lim, Math.min(lim, e.x ?? 0));
      const py = cy + 0.4 + Math.max(-lim - 0.8, Math.min(lim + 0.8, e.y ?? 0));
      return (
        <>
          <ellipse cx={n(cx)} cy={n(cy)} rx="6.4" ry="7.3" fill={WHITE} stroke={INK} strokeWidth={n(c.f * 0.85)} />
          <circle cx={n(px)} cy={n(py)} r={n(p)} fill={INK} />
          {p > 2.6 && <circle cx={n(px + p * 0.36)} cy={n(py - p * 0.4)} r={n(Math.max(1.1, p * 0.34))} fill={WHITE} />}
        </>
      );
    }
    case "slit": {
      const x = cx + (e.x ?? 0) * 0.8;
      const y = cy + (e.y ?? 0) * 0.6 + 0.3;
      return (
        <>
          <ellipse cx={n(cx)} cy={n(cy)} rx="6.2" ry="7" fill="#F4FF7A" stroke={INK} strokeWidth={n(c.f * 0.85)} />
          <ellipse cx={n(x)} cy={n(y)} rx={c.lod === 0 ? "2.3" : "1.7"} ry="5.2" fill={INK} />
          {c.lod > 0 && <circle cx={n(x + 2.6)} cy={n(y - 3)} r="1.2" fill={WHITE} />}
        </>
      );
    }
    case "robot": {
      const x = cx + (e.x ?? 0);
      const y = cy + (e.y ?? 0);
      return (
        <>
          <rect x={n(x - 4.6)} y={n(y - 5.2)} width="9.2" height="10.4" rx="2.4" fill={INK} />
          <rect x={n(x + 0.2)} y={n(y - 3.6)} width="2.6" height="2.6" rx="0.7" fill={WHITE} />
        </>
      );
    }
    case "heart": {
      const x = cx + (e.x ?? 0);
      const y = cy + (e.y ?? 0) + 0.6;
      return (
        <>
          <path d={heart(x, y, 5.7)} fill="#FF4F86" stroke={INK} strokeWidth={n(c.f * 0.62)} strokeLinejoin="round" />
          {c.lod > 0 && <path d={`M${n(x - 3.6)} ${n(y - 2.4)}q0.6-1.6 2.2-1.9`} fill="none" stroke={WHITE} strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />}
        </>
      );
    }
    case "dice": {
      const list = c.lod === 0 && e.n > 1 ? null : pips(e.n);
      return (
        <g transform={`rotate(${side * 9} ${n(cx)} ${n(cy)})`}>
          <rect x={n(cx - 6.4)} y={n(cy - 6.4)} width="12.8" height="12.8" rx="3.4" fill={WHITE} stroke={INK} strokeWidth={n(c.f * 0.85)} />
          {list ? (
            list.map(([px, py], i) => (
              <circle key={i} cx={n(cx + px)} cy={n(cy + py)} r={e.n === 1 ? "2.6" : "1.55"} fill={INK} />
            ))
          ) : (
            <circle cx={n(cx)} cy={n(cy)} r="2.9" fill={INK} />
          )}
        </g>
      );
    }
    default:
      return null;
  }
}

function eyeNode(e: Eye, side: Side, c: Ctx): ReactNode {
  const cx = CX + side * EYE_DX;
  const cy = EYE_Y;
  const inward = -side;
  const sw = n(c.f * 1.1);
  const line = { fill: "none", stroke: INK, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (e.k) {
    case "happy":
      return <path d={`M${n(cx - 5.4)} ${n(cy + 2.4)}Q${n(cx)} ${n(cy - 5.8)} ${n(cx + 5.4)} ${n(cy + 2.4)}`} {...line} />;
    case "line":
      return <path d={`M${n(cx - 5.2)} ${n(cy + 0.5)}L${n(cx + 5.2)} ${n(cy + 0.5)}`} {...line} />;
    case "squeeze":
      return (
        <path
          d={`M${n(cx - inward * 4.2)} ${n(cy - 4.4)}L${n(cx + inward * 3.6)} ${n(cy)}L${n(cx - inward * 4.2)} ${n(cy + 4.4)}`}
          {...line}
        />
      );
    case "x":
      return <path d={`M${n(cx - 4.2)} ${n(cy - 4.2)}L${n(cx + 4.2)} ${n(cy + 4.2)}M${n(cx + 4.2)} ${n(cy - 4.2)}L${n(cx - 4.2)} ${n(cy + 4.2)}`} {...line} />;
    case "spiral": {
      if (c.lod === 0) {
        return <path d={`M${n(cx - 4.2)} ${n(cy - 4.2)}L${n(cx + 4.2)} ${n(cy + 4.2)}M${n(cx + 4.2)} ${n(cy - 4.2)}L${n(cx - 4.2)} ${n(cy + 4.2)}`} {...line} />;
      }
      const pts: string[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 3.6;
        const rr = 0.4 + t * 0.52;
        const a = t * side;
        pts.push(`${n(cx + Math.cos(a) * rr)} ${n(cy + Math.sin(a) * rr)}`);
      }
      return <path d={`M${pts.join("L")}`} {...line} strokeWidth={n(c.f * 0.8)} />;
    }
    default: {
      const body = openEye(e, cx, cy, side, c);
      if (!e.lid) return body;
      const { hw, hh } = eyeBox(e);
      const ey = cy + (e.k === "dot" || e.k === "robot" || e.k === "heart" ? e.y ?? 0 : 0);
      const lidY = ey - hh + e.lid.a * hh * 2;
      const t = e.lid.t ?? 0;
      const at = (x: number) => lidY + ((x - cx) * inward * t) / hw;
      const span = hw + 1.4;
      const clipId = `${c.uid}-lid${side < 0 ? "l" : "r"}`;
      const x0 = cx - 12;
      const x1 = cx + 12;
      return (
        <>
          <clipPath id={clipId}>
            <path d={`M${n(x0)} ${n(at(x0))}L${n(x1)} ${n(at(x1))}L${n(x1)} ${n(cy + 14)}L${n(x0)} ${n(cy + 14)}Z`} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>{body}</g>
          <path d={`M${n(cx - span)} ${n(at(cx - span))}L${n(cx + span)} ${n(at(cx + span))}`} {...line} />
        </>
      );
    }
  }
}

function browNode(b: Brow | undefined, side: Side, c: Ctx): ReactNode {
  if (!b) return null;
  const inward = -side;
  const hw = 5.6;
  const bx = CX + side * EYE_DX + inward * 0.6;
  const by = EYE_Y - 12.2 - (b.y ?? 0);
  const t = b.t ?? 0;
  const a = b.a ?? 0.8;
  const ix = bx + inward * hw;
  const iy = by + t;
  const ox = bx - inward * hw;
  const oy = by - t;
  return (
    <path
      d={`M${n(ox)} ${n(oy)}Q${n((ix + ox) / 2)} ${n((iy + oy) / 2 - a * 2)} ${n(ix)} ${n(iy)}`}
      fill="none"
      stroke={INK}
      strokeWidth={n(c.f * 1.15 * (b.w ?? 1))}
      strokeLinecap="round"
    />
  );
}

function qpt(p0: [number, number], q: [number, number], p2: [number, number], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * q[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * q[1] + t * t * p2[1]];
}

function mouthNode(mo: Mouth, c: Ctx, tongueColor: string): ReactNode {
  const mx = CX + (mo.x ?? 0);
  const my = MOUTH_Y + (mo.y ?? 0);
  const w = mo.w ?? 6;
  const s = mo.slant ?? 0;
  const line = { fill: "none", stroke: INK, strokeWidth: n(c.f), strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const clipId = `${c.uid}-mouth`;
  switch (mo.k) {
    case "smile":
      return <path d={`M${n(mx - w)} ${n(my - 1.5)}Q${n(mx)} ${n(my + 5.2)} ${n(mx + w)} ${n(my - 1.5)}`} {...line} />;
    case "cat":
      return (
        <path
          d={`M${n(mx - 6.5)} ${n(my - 1.5)}Q${n(mx - 3.3)} ${n(my + 3.8)} ${n(mx)} ${n(my - 0.4)}Q${n(mx + 3.3)} ${n(my + 3.8)} ${n(mx + 6.5)} ${n(my - 1.5)}`}
          {...line}
        />
      );
    case "flat":
      return <path d={`M${n(mx - w)} ${n(my)}L${n(mx + w)} ${n(my)}`} {...line} />;
    case "blep": {
      const tx = mx + 1.6;
      return (
        <>
          <path
            d={`M${n(tx - 3)} ${n(my + 0.6)}L${n(tx - 3)} ${n(my + 4.4)}A3 3 0 0 0 ${n(tx + 3)} ${n(my + 4.4)}L${n(tx + 3)} ${n(my + 0.4)}Z`}
            fill={tongueColor}
            stroke={INK}
            strokeWidth={n(c.f * 0.6)}
            strokeLinejoin="round"
          />
          {c.lod > 0 && <path d={`M${n(tx)} ${n(my + 2)}L${n(tx)} ${n(my + 4.6)}`} stroke={mix(tongueColor, INK, 0.35)} strokeWidth="1" strokeLinecap="round" />}
          <path d={`M${n(mx - w)} ${n(my - 1.2)}Q${n(mx)} ${n(my + 3.4)} ${n(mx + w)} ${n(my - 1.2)}`} {...line} />
        </>
      );
    }
    case "fang": {
      const t = 0.27;
      const fx = mx + w * (2 * t - 1);
      const fy = my - 1.5 * ((1 - t) ** 2 + t ** 2) + 5.2 * 2 * t * (1 - t);
      return (
        <>
          <path
            d={`M${n(fx - 2)} ${n(fy - 0.8)}L${n(fx + 2)} ${n(fy)}L${n(fx - 0.3)} ${n(fy + 4.4)}Z`}
            fill={WHITE}
            stroke={INK}
            strokeWidth={n(c.f * 0.5)}
            strokeLinejoin="round"
          />
          <path d={`M${n(mx - w)} ${n(my - 1.5)}Q${n(mx)} ${n(my + 5.2)} ${n(mx + w)} ${n(my - 1.5)}`} {...line} />
        </>
      );
    }
    case "buck":
      return (
        <>
          <path
            d={`M${n(mx - 3)} ${n(my + 0.6)}h2.9v3.6q0 0.9-0.9 0.9h-1.1q-0.9 0-0.9-0.9ZM${n(mx + 0.1)} ${n(my + 0.6)}h2.9v3.6q0 0.9-0.9 0.9h-1.1q-0.9 0-0.9-0.9Z`}
            fill={WHITE}
            stroke={INK}
            strokeWidth={n(c.f * 0.5)}
            strokeLinejoin="round"
          />
          <path d={`M${n(mx - w)} ${n(my - 1.5)}Q${n(mx)} ${n(my + 5.2)} ${n(mx + w)} ${n(my - 1.5)}`} {...line} />
        </>
      );
    case "frown":
      return <path d={`M${n(mx - w)} ${n(my + 3)}Q${n(mx)} ${n(my - 3.6)} ${n(mx + w)} ${n(my + 3)}`} {...line} />;
    case "wavy": {
      const q = w / 2;
      return (
        <path
          d={`M${n(mx - w)} ${n(my + 1)}q${n(q / 2)} ${-3} ${n(q)} 0t${n(q)} 0t${n(q)} 0t${n(q)} 0`}
          {...line}
        />
      );
    }
    case "smirk": {
      const f = mo.flip ? -1 : 1;
      return (
        <>
          <path d={`M${n(mx - f * w)} ${n(my + 0.6)}Q${n(mx + f * 1)} ${n(my + 4)} ${n(mx + f * w)} ${n(my - 3.6)}`} {...line} />
          {c.lod > 0 && <path d={`M${n(mx + f * (w - 1.6))} ${n(my - 5.4)}Q${n(mx + f * (w + 0.8))} ${n(my - 4.4)} ${n(mx + f * (w + 1.2))} ${n(my - 2)}`} {...line} strokeWidth={n(c.f * 0.6)} />}
        </>
      );
    }
    case "pursed": {
      const f = mo.flip ? -1 : 1;
      return (
        <>
          <path d={`M${n(mx - f * 4.6)} ${n(my + 1.4)}Q${n(mx)} ${n(my - 1.2)} ${n(mx + f * 4.2)} ${n(my - 0.4)}`} {...line} />
          <path d={`M${n(mx + f * 5.6)} ${n(my - 2.6)}Q${n(mx + f * 6.4)} ${n(my - 0.4)} ${n(mx + f * 5.4)} ${n(my + 1.8)}`} {...line} strokeWidth={n(c.f * 0.7)} />
        </>
      );
    }
    case "o": {
      const rr = mo.w ?? 3;
      return <ellipse cx={n(mx)} cy={n(my + 1)} rx={n(rr)} ry={n(rr * 1.2)} fill={INK} />;
    }
    case "teeth": {
      const hh = 4.2;
      const xs = c.lod === 2 ? [-w / 2, 0, w / 2] : c.lod === 1 ? [-w / 3, w / 3] : [];
      return (
        <>
          <rect x={n(mx - w)} y={n(my - hh)} width={n(w * 2)} height={n(hh * 2)} rx="3.2" fill={WHITE} stroke={INK} strokeWidth={n(c.f * 0.9)} />
          <path
            d={`M${n(mx - w)} ${n(my)}L${n(mx + w)} ${n(my)}${xs.map((x) => `M${n(mx + x)} ${n(my - hh)}L${n(mx + x)} ${n(my + hh)}`).join("")}`}
            stroke={INK}
            strokeWidth={n(c.f * 0.55)}
            fill="none"
          />
        </>
      );
    }
    case "open": {
      const h = w * 1.05;
      const L: [number, number] = [mx - w, my - 2 + s];
      const Rr: [number, number] = [mx + w, my - 2 - s];
      const d = `M${n(L[0])} ${n(L[1])}Q${n(mx)} ${n(my + 0.6)} ${n(Rr[0])} ${n(Rr[1])}C${n(mx + w)} ${n(my + h * 0.75 - s)} ${n(mx + w * 0.55)} ${n(my + h)} ${n(mx)} ${n(my + h)}C${n(mx - w * 0.55)} ${n(my + h)} ${n(mx - w)} ${n(my + h * 0.75 + s)} ${n(L[0])} ${n(L[1])}Z`;
      return (
        <>
          <clipPath id={clipId}>
            <path d={d} />
          </clipPath>
          <path d={d} fill={INK} />
          <g clipPath={`url(#${clipId})`}>
            {mo.tongue && <ellipse cx={n(mx + w * 0.15)} cy={n(my + h)} rx={n(w * 0.62)} ry={n(h * 0.5)} fill={tongueColor} />}
            {mo.teeth && (
              <path
                d={`M${n(L[0])} ${n(L[1] - 4)}L${n(Rr[0])} ${n(Rr[1] - 4)}L${n(Rr[0])} ${n(Rr[1] + 2.4)}Q${n(mx)} ${n(my + 4.6)} ${n(L[0])} ${n(L[1] + 2.4)}Z`}
                fill={WHITE}
              />
            )}
            {mo.fangs && (
              <path
                d={`M${n(mx - w * 0.62)} ${n(my - 1)}l1.6 5 1.6 -5ZM${n(mx + w * 0.62 - 3.2)} ${n(my - 1)}l1.6 5 1.6 -5Z`}
                fill={WHITE}
              />
            )}
          </g>
          <path d={d} fill="none" stroke={INK} strokeWidth={n(c.f * 0.8)} strokeLinejoin="round" />
        </>
      );
    }
    case "evil": {
      const L: [number, number] = [mx - w, my - 3.5 + s];
      const Rr: [number, number] = [mx + w, my - 3.5 - s];
      const top: [number, number] = [mx, my + 2.4];
      const bot: [number, number] = [mx, my + 12];
      const d = `M${n(L[0])} ${n(L[1])}Q${n(top[0])} ${n(top[1])} ${n(Rr[0])} ${n(Rr[1])}Q${n(bot[0])} ${n(bot[1])} ${n(L[0])} ${n(L[1])}Z`;
      const count = c.lod === 0 ? 3 : 5;
      const teeth: string[] = [`M${n(L[0] - 2)} ${n(L[1] - 6)}`, `L${n(Rr[0] + 2)} ${n(Rr[1] - 6)}`];
      for (let i = count; i >= 0; i--) {
        const valley = qpt(L, top, Rr, i / count);
        teeth.push(`L${n(valley[0])} ${n(valley[1] + 1.1)}`);
        if (i > 0) {
          const tip = qpt(L, top, Rr, (i - 0.5) / count);
          teeth.push(`L${n(tip[0])} ${n(tip[1] + 4.4)}`);
        }
      }
      return (
        <>
          <clipPath id={clipId}>
            <path d={d} />
          </clipPath>
          <path d={d} fill={INK} />
          <path d={`${teeth.join("")}Z`} fill={WHITE} clipPath={`url(#${clipId})`} />
          <path d={d} fill="none" stroke={INK} strokeWidth={n(c.f * 0.8)} strokeLinejoin="round" />
        </>
      );
    }
  }
}

function drop(x: number, y: number, k: number): string {
  return `M${n(x)} ${n(y - 1.7 * k)}Q${n(x + 1.15 * k)} ${n(y - 0.2 * k)} ${n(x + k)} ${n(y + 0.45 * k)}A${n(k)} ${n(k)} 0 0 1 ${n(x - k)} ${n(y + 0.45 * k)}Q${n(x - 1.15 * k)} ${n(y - 0.2 * k)} ${n(x)} ${n(y - 1.7 * k)}Z`;
}

function heart(x: number, y: number, s: number): string {
  return `M${n(x)} ${n(y + s * 0.95)}C${n(x - s * 1.7)} ${n(y - s * 0.1)} ${n(x - s * 0.95)} ${n(y - s * 1.45)} ${n(x)} ${n(y - s * 0.5)}C${n(x + s * 0.95)} ${n(y - s * 1.45)} ${n(x + s * 1.7)} ${n(y - s * 0.1)} ${n(x)} ${n(y + s * 0.95)}Z`;
}

function extrasBehindFace(fx: Extra[], c: Ctx): ReactNode {
  if (!fx.includes("blush")) return null;
  return (
    <g fill={HOT.has(c.base) ? "#C2124F" : "#FF6F9C"} opacity={HOT.has(c.base) ? 0.4 : 0.6}>
      <ellipse cx={n(CX - EYE_DX - 3.4)} cy="64.6" rx="4.6" ry="2.6" />
      <ellipse cx={n(CX + EYE_DX + 3.4)} cy="64.6" rx="4.6" ry="2.6" />
    </g>
  );
}

function extrasFront(face: Face, c: Ctx): ReactNode {
  const fx = face.fx ?? [];
  const o = n(c.o * 0.7);
  const out: ReactNode[] = [];
  if (fx.includes("tears")) {
    for (const side of [-1, 1] as const) {
      const x = CX + side * (EYE_DX + 1.6);
      out.push(
        <path
          key={`tear${side}`}
          d={`M${n(x - 1.7)} ${n(EYE_Y + 3)}L${n(x - 1.7)} ${n(EYE_Y + 11)}A1.7 1.7 0 0 0 ${n(x + 1.7)} ${n(EYE_Y + 11)}L${n(x + 1.7)} ${n(EYE_Y + 3)}Z`}
          fill={WATER}
          stroke={INK}
          strokeWidth={n(c.f * 0.5)}
          strokeLinejoin="round"
        />,
      );
    }
  }
  if (fx.includes("drool")) {
    out.push(<path key="drool" d={drop(56.5, 80.5, 2.2)} fill={WATER} stroke={INK} strokeWidth={n(c.f * 0.5)} />);
  }
  if (fx.includes("sweat")) {
    out.push(<path key="sweat" d={drop(74, 39, 3.4)} fill={WATER} stroke={INK} strokeWidth={o} />);
    if (c.lod > 0) out.push(<path key="sweatshine" d="M72.6 39.6q0 1.6 1 2.4" fill="none" stroke={WHITE} strokeWidth="1.1" strokeLinecap="round" />);
  }
  if (fx.includes("vein")) {
    const x = 83;
    const y = 22;
    const d = `M${x - 1.6} ${y - 6}Q${x - 1.6} ${y - 1.6} ${x - 6} ${y - 1.6}M${x + 1.6} ${y - 6}Q${x + 1.6} ${y - 1.6} ${x + 6} ${y - 1.6}M${x - 1.6} ${y + 6}Q${x - 1.6} ${y + 1.6} ${x - 6} ${y + 1.6}M${x + 1.6} ${y + 6}Q${x + 1.6} ${y + 1.6} ${x + 6} ${y + 1.6}`;
    const vw = Math.max(2.6, c.f * 0.9);
    out.push(
      <g key="vein" fill="none" strokeLinecap="round">
        <path d={d} stroke={INK} strokeWidth={n(vw + c.o * 1.1)} />
        <path d={d} stroke="#FF2D45" strokeWidth={n(vw)} />
      </g>,
    );
  }
  if (fx.includes("ring")) {
    out.push(
      <path
        key="ring"
        d="M36.5 4.5Q33.6 9 36 13.6M33 2.4Q28.8 9 32.4 15.6M68.5 4.5Q71.4 9 69 13.6M72 2.4Q76.2 9 72.6 15.6"
        fill="none"
        stroke="#FFE7A3"
        strokeWidth={n(Math.max(1.8, c.f * 0.6))}
        strokeLinecap="round"
      />,
    );
  }
  if (fx.includes("heart")) {
    out.push(<path key="heart" d={heart(85, 18, 7.2)} fill="#FF4F86" stroke={INK} strokeWidth={o} strokeLinejoin="round" />);
    if (c.lod > 0) out.push(<path key="heartshine" d="M80.6 14.6q1.6-1.8 3.4-0.6" fill="none" stroke={WHITE} strokeWidth="1.3" strokeLinecap="round" opacity="0.85" />);
  }
  if (fx.includes("think")) {
    const r = c.lod === 0 ? 2.5 : 2;
    out.push(
      <g key="think">
        <circle cx="75.5" cy="25.5" r="2.6" fill={WHITE} stroke={INK} strokeWidth={o} />
        <rect x="73" y="5" width="24.5" height="14.5" rx="7.25" fill={WHITE} stroke={INK} strokeWidth={o} />
        <circle cx="79.2" cy="12.25" r={r} fill={INK} />
        <circle cx="85.25" cy="12.25" r={r} fill={INK} />
        <circle cx="91.3" cy="12.25" r={r} fill={INK} />
      </g>,
    );
  }
  if (fx.includes("sparkle")) {
    out.push(
      <g key="sparkle" stroke="#FFE59A" strokeWidth={c.lod === 0 ? 4.2 : 3.4} strokeLinecap="round" fill="none">
        <path d="M80 11L83 3.5" />
        <path d="M87.5 16L94.5 10" />
        <path d="M91 25L99 23.5" />
        {c.lod > 0 && <path d="M13 33L6.5 28" />}
        {c.lod > 0 && <path d="M10 41L2.5 40.5" />}
      </g>,
    );
  }
  return out;
}

function forkNode(face: Face, c: Ctx): ReactNode {
  const fk = face.fork;
  if (!fk) return null;
  return (
    <g transform={`translate(${n(fk.x)} ${n(fk.y)}) rotate(${fk.r})`}>
      <path d="M-2.1 -1.5L-2.1 5.8L-4.4 10L0 7.4L4.4 10L2.1 5.8L2.1 -1.5Z" fill="#FF4F7B" stroke={INK} strokeWidth={n(c.f * 0.55)} strokeLinejoin="round" />
    </g>
  );
}

function star(cx: number, cy: number, ro: number, ri: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? ro : ri;
    pts.push(`${n(cx + Math.cos(a) * rr)} ${n(cy + Math.sin(a) * rr)}`);
  }
  return `M${pts.join("L")}Z`;
}

function gearBack(gear: Gear | "none", c: Ctx): ReactNode {
  const o = n(c.o * 0.8);
  switch (gear) {
    case "horns":
      return (
        <>
          <path d="M32 31C25.5 25 22.5 16 25.5 4.5C28.5 12.5 35 17.5 43.5 21.5ZM68 31C74.5 25 77.5 16 74.5 4.5C71.5 12.5 65 17.5 56.5 21.5Z" fill="#FF4D5E" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          {c.lod > 0 && <path d="M28.4 19.6Q26.8 15 27.4 10.6M71.6 19.6Q73.2 15 72.6 10.6" fill="none" stroke={WHITE} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />}
        </>
      );
    case "ears": {
      const inner = mix(c.base, "#FF6F9C", 0.55);
      return (
        <>
          <path d="M20.5 40L22.5 5.5L47 21ZM79.5 40L77.5 5.5L53 21Z" fill={c.base} stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <path d="M25 31L26.4 13.4L39.6 21.6ZM75 31L73.6 13.4L60.4 21.6Z" fill={inner} strokeLinejoin="round" />
        </>
      );
    }
    case "mohawk":
      return (
        <>
          <path d="M37.5 33L33 13.5L41.5 18L42.5 3L50.5 13.5L58 1.5L59.5 17L67 12.5L63.5 33Z" fill="#FF5FA2" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          {c.lod > 0 && <path d="M44.2 8.4L45.4 14.2M57.4 7.4L56.4 13.6" fill="none" stroke={WHITE} strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />}
        </>
      );
    case "headphones":
      return (
        <>
          <path d="M15.5 54C15.5 -2 84.5 -2 84.5 54" fill="none" stroke={INK} strokeWidth={n(4.4 + c.o * 1.6)} strokeLinecap="round" />
          <path d="M15.5 54C15.5 -2 84.5 -2 84.5 54" fill="none" stroke="#5B6274" strokeWidth="4.4" strokeLinecap="round" />
        </>
      );
    case "antenna":
      return (
        <>
          <path d="M50 22Q48.5 13 55.5 7.5" fill="none" stroke={INK} strokeWidth={n(2.4 + c.o * 1.6)} strokeLinecap="round" />
          <path d="M50 22Q48.5 13 55.5 7.5" fill="none" stroke="#E7EAF2" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="57" cy="6.6" r="4.6" fill="#FF5C8A" stroke={INK} strokeWidth={o} />
          {c.lod > 0 && <circle cx="55.6" cy="5.2" r="1.3" fill={WHITE} opacity="0.9" />}
        </>
      );
    case "leaf":
      return (
        <>
          <path d="M50 23Q50 16 51.5 11" fill="none" stroke={INK} strokeWidth={n(2.2 + c.o * 1.6)} strokeLinecap="round" />
          <path d="M51.5 12Q42 2.5 36.5 10Q43 16 51.5 12Z" fill="#34C46E" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <path d="M51.5 12Q59 0.5 66 6.5Q60.5 14.5 51.5 12Z" fill="#4ADE80" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <path d="M50 23Q50 16 51.5 11" fill="none" stroke="#2FA864" strokeWidth="2.2" strokeLinecap="round" />
          {c.lod > 0 && <path d="M50 11.4Q44 8.6 40.5 9.6M53 11.2Q58.5 7 63 6.8" fill="none" stroke="#1E7A47" strokeWidth="1.1" strokeLinecap="round" />}
        </>
      );
    default:
      return null;
  }
}

function gearFront(gear: Gear | "none", c: Ctx): ReactNode {
  const o = n(c.o * 0.8);
  switch (gear) {
    case "party": {
      const cone = "M36 25L50 2.5L64 25Q50 29.5 36 25Z";
      return (
        <g transform="rotate(14 50 23)">
          <clipPath id={`${c.uid}-party`}>
            <path d={cone} />
          </clipPath>
          <path d={cone} fill="#7C83FF" />
          <path d="M34 11Q50 13.6 66 11M34 19Q50 21.8 66 19" fill="none" stroke="#FFD84D" strokeWidth="3.6" clipPath={`url(#${c.uid}-party)`} />
          <path d={cone} fill="none" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <circle cx="50" cy="3.6" r="3.9" fill="#FF5FA2" stroke={INK} strokeWidth={o} />
        </g>
      );
    }
    case "tophat": {
      const crown = "M35.5 23L37 2.6Q50 0.6 63 2.6L64.5 23Z";
      return (
        <g transform="rotate(-7 50 24)">
          <clipPath id={`${c.uid}-hat`}>
            <path d={crown} />
          </clipPath>
          <path d={crown} fill="#4B5263" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <rect x="28" y="14.8" width="44" height="5.6" fill="#FF5468" clipPath={`url(#${c.uid}-hat)`} />
          <path d={crown} fill="none" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          {c.lod > 0 && <path d="M41.4 5.6L41 11.6" stroke={WHITE} strokeWidth="2" strokeLinecap="round" opacity="0.35" />}
          <path d="M25.5 23Q50 18.4 74.5 23Q74.5 27.2 50 27.6Q25.5 27.2 25.5 23Z" fill="#3C4250" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
        </g>
      );
    }
    case "cap":
      return (
        <>
          <path d="M71 29.6Q84 24.8 95.6 29.6Q93.8 35.6 75.5 34.6Z" fill="#D93349" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <path d="M24 33.5Q23 12 50 10.5Q77 12 76 33.5Q50 26 24 33.5Z" fill="#FF5468" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          {c.lod > 0 && <path d="M50 11.5Q48.6 20 49.4 28.2" fill="none" stroke="#C42A40" strokeWidth="1.2" strokeLinecap="round" />}
          {c.lod > 0 && <path d="M31 22Q36 15.6 44 13.4" fill="none" stroke={WHITE} strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />}
        </>
      );
    case "flower": {
      const petals = [0, 1, 2, 3, 4].map((i) => {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        return `M${n(Math.cos(a) * 5.6 + 4.7)} ${n(Math.sin(a) * 5.6)}a4.7 4.7 0 1 0 -9.4 0a4.7 4.7 0 1 0 9.4 0Z`;
      });
      const d = petals.join("");
      return (
        <g transform="translate(68.5 18) rotate(14)">
          <path d={d} fill={WHITE} stroke={INK} strokeWidth={n(c.o * 1.6)} strokeLinejoin="round" />
          <path d={d} fill={WHITE} />
          <circle r="3.8" fill="#FFC93C" stroke={INK} strokeWidth={o} />
        </g>
      );
    }
    case "propeller": {
      const dome = "M27.5 31Q26.5 11 50 11Q73.5 11 72.5 31Q50 25.5 27.5 31Z";
      return (
        <>
          <clipPath id={`${c.uid}-cap`}>
            <path d={dome} />
          </clipPath>
          <g clipPath={`url(#${c.uid}-cap)`}>
            <rect x="20" y="0" width="22.5" height="40" fill="#FF5468" />
            <rect x="42.5" y="0" width="15" height="40" fill="#FFD84D" />
            <rect x="57.5" y="0" width="25" height="40" fill="#38BDF8" />
          </g>
          <path d={dome} fill="none" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <path d="M50 11.5V5.5" stroke={INK} strokeWidth={n(2.2 + c.o * 1.4)} strokeLinecap="round" />
          <g transform="rotate(-8 50 5)">
            <path d="M50 5Q45 1 37 2.6Q34.4 5 37 7.4Q45 9 50 5ZM50 5Q55 1 63 2.6Q65.6 5 63 7.4Q55 9 50 5Z" fill="#38BDF8" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
            <circle cx="50" cy="5" r="2.6" fill="#FFD84D" stroke={INK} strokeWidth={n(c.o * 0.6)} />
          </g>
        </>
      );
    }
    case "bow":
      return (
        <g transform="translate(69.5 23) rotate(22)">
          <path d="M0 0C-3.5 -7.5 -12.5 -8 -12.5 -0.5C-12.5 7 -3.5 7 0 0ZM0 0C3.5 -7.5 12.5 -8 12.5 -0.5C12.5 7 3.5 7 0 0Z" fill="#FF5FA2" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          {c.lod > 0 && <path d="M-3.4 -1.4Q-7.4 -3.4 -10 -1.2M3.4 -1.4Q7.4 -3.4 10 -1.2" fill="none" stroke="#C42C74" strokeWidth="1.1" strokeLinecap="round" />}
          <rect x="-3.5" y="-3.7" width="7" height="7.4" rx="2.6" fill="#E23D85" stroke={INK} strokeWidth={o} />
        </g>
      );
    case "headphones":
      return (
        <>
          <path d="M14.5 43.5H19.8A3 3 0 0 1 22.8 46.5V61.5A3 3 0 0 1 19.8 64.5H14.5ZM85.5 43.5H80.2A3 3 0 0 0 77.2 46.5V61.5A3 3 0 0 0 80.2 64.5H85.5Z" fill="#3C4250" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <rect x="7.5" y="41" width="10" height="26" rx="5" fill="#FF5468" stroke={INK} strokeWidth={o} />
          <rect x="82.5" y="41" width="10" height="26" rx="5" fill="#FF5468" stroke={INK} strokeWidth={o} />
          {c.lod > 0 && <path d="M10.6 46V52.6M85.6 46V52.6" stroke={WHITE} strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />}
        </>
      );
    case "crown":
      return (
        <>
          <path d="M36.5 24L34.5 9.5L43.5 16L50 5.5L56.5 16L65.5 9.5L63.5 24Z" fill="#FFD84D" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          <path d="M36.2 20.5L63.8 20.5" stroke={INK} strokeWidth={n(c.o * 0.5)} />
          {c.lod > 0 && <circle cx="50" cy="15.5" r="2.1" fill="#FF4F86" stroke={INK} strokeWidth={n(c.o * 0.4)} />}
        </>
      );
    case "star":
      return (
        <g transform="rotate(-14 29 18)">
          <path d={star(29, 18, 13, 6)} fill="#FFD84D" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
          {c.lod > 0 && <path d="M25 13.6l2.2-4" stroke={WHITE} strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />}
        </g>
      );
    case "bolt":
      return (
        <g transform="rotate(10 50 14)">
          <path d="M57 1L38.5 18.5L49.5 18.5L44 30.5L63.5 10L52.5 10L60.5 1Z" fill="#FFE14D" stroke={INK} strokeWidth={o} strokeLinejoin="round" />
        </g>
      );
    default:
      return null;
  }
}

function accessory(extra: ExtraKey, layer: "under" | "mouth" | "eyes" | "top", c: Ctx): ReactNode {
  const o = n(c.o * 0.8);
  if (layer === "under" && extra === "laser") {
    const beam = (side: Side, w0: number, w1: number) => {
      const ex = CX + side * EYE_DX;
      const dx = side * 0.92;
      const dy = 0.39;
      const len = 72;
      const p = (t: number, w: number) => `${n(ex + dx * t - dy * w)} ${n(EYE_Y + dy * t + dx * w)}`;
      return `M${p(0, w0)}L${p(len, w1)}L${p(len, -w1)}L${p(0, -w0)}Z`;
    };
    const both = (w0: number, w1: number) => beam(-1, w0, w1) + beam(1, w0, w1);
    return (
      <g mask={`url(#${c.uid}-fade)`}>
        <mask id={`${c.uid}-fade`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <radialGradient id={`${c.uid}-fadeg`} gradientUnits="userSpaceOnUse" cx="50" cy="56" r="50">
            <stop offset="0.55" stopColor={WHITE} />
            <stop offset="1" stopColor={WHITE} stopOpacity="0" />
          </radialGradient>
          <rect width="100" height="100" fill={`url(#${c.uid}-fadeg)`} />
        </mask>
        <path d={both(3.6, 9.5)} fill="#FF2D45" opacity="0.3" />
        <path d={both(2, 5.4)} fill="#FF3B52" />
        <path d={both(0.8, 2.2)} fill="#FFE3E6" />
        <circle cx={CX - EYE_DX} cy={EYE_Y} r="7.4" fill="#FF2D45" opacity="0.35" />
        <circle cx={CX + EYE_DX} cy={EYE_Y} r="7.4" fill="#FF2D45" opacity="0.35" />
      </g>
    );
  }
  if (layer === "mouth" && extra === "mustache") {
    const d =
      "M50 63.2C47.6 60.8 42.6 60.4 39.6 63.2C38.4 64.4 36.6 64.8 35.2 64C36.2 67.4 41.4 68.4 45.2 66.6C47.4 65.6 48.8 65.2 50 65.8C51.2 65.2 52.6 65.6 54.8 66.6C58.6 68.4 63.8 67.4 64.8 64C63.4 64.8 61.6 64.4 60.4 63.2C57.4 60.4 52.4 60.8 50 63.2Z";
    return (
      <>
        <path d={d} fill="#4A3426" stroke={INK} strokeWidth={n(c.f * 0.55)} strokeLinejoin="round" />
        {c.lod > 0 && <path d="M41.6 63.4Q44.6 62 47.2 63.4" fill="none" stroke={WHITE} strokeWidth="1.1" strokeLinecap="round" opacity="0.35" />}
      </>
    );
  }
  if (layer === "eyes" && extra === "shades") {
    const d = "M23.5 48.6H76.5V52.4H23.5ZM26.8 50H47.6V53.6Q47.6 61.4 39.6 61.4H35Q26.8 61.4 26.8 53.6ZM52.4 50H73.2V53.6Q73.2 61.4 65 61.4H60.4Q52.4 61.4 52.4 53.6Z";
    return (
      <>
        <path d={d} fill={INK} stroke={INK} strokeWidth={n(c.o * 1.2)} strokeLinejoin="round" />
        <path d={d} fill="#1A1D26" />
        {c.lod > 0 && <path d="M31 55.6L35.4 51.6M35.2 58.6L41.6 52.6M56.6 55.6L61 51.6M60.8 58.6L67.2 52.6" fill="none" stroke={WHITE} strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />}
      </>
    );
  }
  if (layer === "eyes" && extra === "specs") {
    const sw = n(c.f * 0.8);
    return (
      <g fill="none" stroke={INK} strokeLinecap="round">
        <circle cx={CX - EYE_DX} cy="55.4" r="8.6" fill={WHITE} fillOpacity="0.16" strokeWidth={sw} />
        <circle cx={CX + EYE_DX} cy="55.4" r="8.6" fill={WHITE} fillOpacity="0.16" strokeWidth={sw} />
        <path d="M46.7 53.4Q50 50.8 53.3 53.4M29.9 53.6L17.5 50.6M70.1 53.6L82.5 50.6" strokeWidth={n(c.f * 0.65)} />
        {c.lod > 0 && <path d="M33.4 51.6Q35.2 49.4 38 49M56.4 51.6Q58.2 49.4 61 49" stroke={WHITE} strokeWidth="1.2" opacity="0.7" />}
      </g>
    );
  }
  if (layer === "top" && extra === "eyepatch") {
    return (
      <>
        <path d="M40.5 21L61.5 55.5L86.5 67.5" fill="none" stroke={INK} strokeWidth={n(c.f * 0.7)} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${c.uid}-face)`} />
        <ellipse cx={CX + EYE_DX} cy="55.6" rx="8.2" ry="8.8" fill="#1A1D26" stroke={INK} strokeWidth={o} />
        {c.lod > 0 && <path d="M56.6 51.4Q59.4 48.8 63 48.8" fill="none" stroke={WHITE} strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />}
      </>
    );
  }
  if (layer === "top" && extra === "bandage") {
    return (
      <g transform="translate(73.8 67.4) rotate(-32)">
        <rect x="-7.4" y="-3" width="14.8" height="6" rx="3" fill="#FFDCAE" />
        <rect x="-2.5" y="-3" width="5" height="6" fill="#EDB679" />
        <rect x="-7.4" y="-3" width="14.8" height="6" rx="3" fill="none" stroke={INK} strokeWidth={n(c.f * 0.55)} />
      </g>
    );
  }
  return null;
}

function chain(c: Ctx): ReactNode {
  const d = "M19 73Q50 101 81 73";
  return (
    <>
      <g clipPath={`url(#${c.uid}-face)`} fill="none" strokeLinecap="round">
        <path d={d} stroke={INK} strokeWidth={n(3.2 + c.o * 1.4)} />
        <path d={d} stroke={BRASS} strokeWidth="3.2" />
        {c.lod > 0 && <path d={d} stroke={BRASS_DARK} strokeWidth="1.2" strokeDasharray="2.4 2.2" strokeLinecap="butt" />}
      </g>
      <circle cx="50" cy="88" r="6" fill={BRASS} stroke={INK} strokeWidth={n(c.o * 0.8)} />
      {c.lod > 0 && <circle cx="50" cy="88" r="3.3" fill="none" stroke={BRASS_DARK} strokeWidth="1.2" />}
      {c.lod > 0 && <path d="M46.4 86Q47.2 84.2 49 83.6" fill="none" stroke={WHITE} strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />}
    </>
  );
}

function houseBack(house: House, c: Ctx): ReactNode {
  const o = c.o * 0.8;
  switch (house) {
    case "saint":
      return (
        <g transform="rotate(-6 50 10.5)">
          {c.lod > 0 && <ellipse cx="50" cy="10.5" rx="20.5" ry="6" fill="none" stroke="#FFF4C7" strokeOpacity="0.22" strokeWidth={n(4 + o * 2 + 4)} />}
          <ellipse cx="50" cy="10.5" rx="20.5" ry={c.lod === 0 ? "6.6" : "6"} fill="none" stroke={INK} strokeWidth={n(4 + o * 2)} />
          <ellipse cx="50" cy="10.5" rx="20.5" ry={c.lod === 0 ? "6.6" : "6"} fill="none" stroke="#FFF1B0" strokeWidth="4" />
          {c.lod > 0 && <path d="M34 8.2Q40 5.4 47 5" fill="none" stroke={WHITE} strokeWidth="1.3" strokeLinecap="round" />}
        </g>
      );
    case "gambler":
      return (
        <g transform="rotate(-20 20 24)">
          <rect x="10.5" y="11" width="19" height="25" rx="3" fill="#FFFDF6" stroke={INK} strokeWidth={n(o)} />
          <path d="M20 16.5L25 23.5L20 30.5L15 23.5Z" fill="#FF2E63" stroke={INK} strokeWidth={n(c.o * 0.35)} strokeLinejoin="round" />
        </g>
      );
    default:
      return null;
  }
}

function houseDecor(house: House, c: Ctx): ReactNode {
  switch (house) {
    case "snake": {
      if (c.lod === 0) return null;
      const count = 24;
      const rs = RI + 1.2;
      const half = Math.PI / count;
      const rr = rs * Math.sin(half) * 1.08;
      let d = "";
      for (let i = 0; i < count; i++) {
        const th = (i / count) * Math.PI * 2;
        const a0 = th - half;
        const a1 = th + half;
        d += `M${n(CX + Math.cos(a0) * rs)} ${n(CY + Math.sin(a0) * rs)}A${n(rr)} ${n(rr)} 0 0 1 ${n(CX + Math.cos(a1) * rs)} ${n(CY + Math.sin(a1) * rs)}`;
      }
      return <path d={d} fill="none" stroke={mix(HOUSE.snake, INK, 0.38)} strokeWidth="1.2" strokeLinecap="round" />;
    }
    case "mirror": {
      const halfId = `${c.uid}-half`;
      return (
        <>
          <clipPath id={halfId}>
            <path d={`M${CX} ${CY - R}A${R} ${R} 0 0 1 ${CX} ${CY + R}Z`} />
          </clipPath>
          <g clipPath={`url(#${halfId})`}>
            <rect x={CX} y="0" width="50" height="100" fill={WHITE} opacity="0.2" />
            <path d="M72 12L80 12L60 100L52 100Z" fill={WHITE} opacity="0.26" />
            {c.lod > 0 && <path d="M84 12L87 12L67 100L64 100Z" fill={WHITE} opacity="0.22" />}
          </g>
          <path d={`M${CX} ${CY - R + 1}L${CX} ${CY + R - 1}`} stroke={mix(HOUSE.mirror, INK, 0.55)} strokeWidth={n(Math.max(1.4, c.o * 0.4))} />
        </>
      );
    }
    case "grudge": {
      const a: [number, number] = [57.5, 29.5];
      const b: [number, number] = [72.5, 39.5];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = (-dy / len) * 3;
      const ny = (dx / len) * 3;
      const ts = c.lod === 0 ? [] : [0.2, 0.5, 0.8];
      return (
        <>
          <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={mix(HOUSE.grudge, INK, 0.5)} strokeWidth={n(Math.max(2.4, c.f * 0.8))} strokeLinecap="round" />
          <path
            d={ts
              .map((t) => {
                const px = a[0] + dx * t;
                const py = a[1] + dy * t;
                return `M${n(px - nx)} ${n(py - ny)}L${n(px + nx)} ${n(py + ny)}`;
              })
              .join("")}
            stroke={INK}
            strokeWidth={n(c.f * 0.5)}
            strokeLinecap="round"
          />
        </>
      );
    }
    default:
      return null;
  }
}

function monocle(c: Ctx): ReactNode {
  const o = c.o * 0.8;
  return (
    <>
      {c.lod > 0 && <path d="M68.4 61.6Q74 72 79.6 76.4" fill="none" stroke={BRASS} strokeWidth="1.9" strokeLinecap="round" strokeDasharray="0.01 2.7" />}
      <circle cx={CX + EYE_DX} cy={EYE_Y} r="9.6" fill="#E9FFFC" fillOpacity="0.2" />
      <circle cx={CX + EYE_DX} cy={EYE_Y} r="9.6" fill="none" stroke={INK} strokeWidth={n(2.6 + o * 1.4)} />
      <circle cx={CX + EYE_DX} cy={EYE_Y} r="9.6" fill="none" stroke={BRASS} strokeWidth="2.6" />
      {c.lod > 0 && <path d="M55.6 50.4Q56.8 47.6 59.8 46.8" fill="none" stroke={WHITE} strokeWidth="1.3" strokeLinecap="round" opacity="0.9" />}
    </>
  );
}

function houseFront(house: House, c: Ctx): ReactNode {
  const o = c.o * 0.8;
  switch (house) {
    case "pavlov":
      return (
        <g transform="translate(52 -1) rotate(14 0 21)">
          <circle cx="0" cy="3.2" r="2.9" fill={BRASS} stroke={INK} strokeWidth={n(o * 0.8)} />
          <path d="M0 5C-7.3 5-9.5 11.2-9.75 15.6L-11.7 19.8L11.7 19.8L9.75 15.6C9.5 11.2 7.3 5 0 5Z" fill={BRASS} stroke={INK} strokeWidth={n(o)} strokeLinejoin="round" />
          <rect x="-13.2" y="18.5" width="26.4" height="4.9" rx="2.45" fill={BRASS_DARK} stroke={INK} strokeWidth={n(o)} />
          {c.lod > 0 && <path d="M-4.7 9.4Q-6.2 12.5-6.5 15.9" fill="none" stroke={WHITE} strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />}
        </g>
      );
    case "diplomat":
      return (
        <>
          <path d="M50 91L37 84.5Q34.6 91 37 97.5ZM50 91L63 84.5Q65.4 91 63 97.5Z" fill="#E2335D" stroke={INK} strokeWidth={n(o)} strokeLinejoin="round" />
          <rect x="46.3" y="87.4" width="7.4" height="7.2" rx="2.2" fill="#B51F45" stroke={INK} strokeWidth={n(o)} />
        </>
      );
    case "skeptic":
      return (
        <>
          <path d="M83.2 84.2L92.6 93.6" stroke={INK} strokeWidth={n(4.6 + o * 2)} strokeLinecap="round" />
          <path d="M83.2 84.2L92.6 93.6" stroke="#8A5A35" strokeWidth="4.6" strokeLinecap="round" />
          <circle cx="76" cy="77" r="9.4" fill={mix(HOUSE.skeptic, WHITE, 0.55)} fillOpacity="0.75" />
          <circle cx="76" cy="77" r="9.4" fill="none" stroke={INK} strokeWidth={n(3 + o * 1.4)} />
          <circle cx="76" cy="77" r="9.4" fill="none" stroke="#E6EBF4" strokeWidth="3" />
          {c.lod > 0 && <path d="M70.6 75.2Q71.4 71.6 74.8 70.6" fill="none" stroke={WHITE} strokeWidth="1.6" strokeLinecap="round" />}
        </>
      );
    default:
      return null;
  }
}

export function Mascot(props: { id: string; size?: number; mood?: Mood; className?: string; title?: string }): JSX.Element {
  const { id, size = 96, mood = "idle", className, title } = props;
  const uid = `m${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const house = houseOf(id);
  const player = house ? null : playerOf(id);
  const base = house ? HOUSE[house] : player!.color;
  const extra = player?.extra ?? "none";
  const lod: 0 | 1 | 2 = size < 48 ? 0 : size < 160 ? 1 : 2;
  const c: Ctx = { uid, base, o: Math.max(3.2, 135 / size), f: Math.max(2.9, 112 / size), lod };
  const face = house ? FACES[house](mood) : genFace(player!, mood);
  const tongueColor = house === "gambler" || house === "grudge" ? "#FF8FA3" : TONGUE;
  const faceId = `${uid}-face`;
  const rimId = `${uid}-rim`;
  const edge = mix(base, INK, 0.42);
  const hl = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const rr = RI - 4.6;
    return `${n(CX + Math.cos(a) * rr)} ${n(CY + Math.sin(a) * rr)}`;
  };

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title ?? id}</title>
      <defs>
        <clipPath id={faceId}>
          <circle cx={CX} cy={CY} r={R} />
        </clipPath>
        <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(base, INK, 0.38)} />
          <stop offset="1" stopColor={mix(base, WHITE, 0.55)} />
        </linearGradient>
      </defs>
      {house ? houseBack(house, c) : gearBack(player!.gear, c)}
      <circle cx={CX} cy={CY + DEPTH} r={R} fill={edge} stroke={INK} strokeWidth={n(c.o)} />
      <circle cx={CX} cy={CY} r={R} fill={base} stroke={INK} strokeWidth={n(c.o)} />
      <g clipPath={`url(#${faceId})`}>
        {house && houseDecor(house, c)}
        {lod > 0 && <circle cx={CX} cy={CY} r={RI} fill="none" stroke={`url(#${rimId})`} strokeWidth="1.6" />}
        <path
          d={`M${CX - R} ${CY}a${R} ${R} 0 1 0 ${R * 2} 0a${R} ${R} 0 1 0 ${-R * 2} 0ZM${CX - R - 5} ${CY - 7}a${R} ${R} 0 1 0 ${R * 2} 0a${R} ${R} 0 1 0 ${-R * 2} 0Z`}
          fillRule="evenodd"
          fill={INK}
          opacity="0.13"
        />
      </g>
      <path
        d={`M${hl(198)}A${RI - 4.6} ${RI - 4.6} 0 0 1 ${hl(244)}`}
        fill="none"
        stroke={WHITE}
        strokeOpacity="0.55"
        strokeWidth={lod === 0 ? "4.2" : "3.6"}
        strokeLinecap="round"
      />
      {extra === "chain" && chain(c)}
      <g transform={lod === 0 ? "matrix(1.1 0 0 1.1 -5 -6.2)" : undefined}>
        {extrasBehindFace(face.fx ?? [], c)}
        {mouthNode(face.m, c, tongueColor)}
        {forkNode(face, c)}
        {accessory(extra, "mouth", c)}
        {accessory(extra, "under", c)}
        {eyeNode(face.l, -1, c)}
        {eyeNode(face.r, 1, c)}
        {accessory(extra, "eyes", c)}
        {browNode(face.bl, -1, c)}
        {browNode(face.br, 1, c)}
        {accessory(extra, "top", c)}
        {house === "diplomat" && monocle(c)}
      </g>
      {house ? houseFront(house, c) : gearFront(player!.gear, c)}
      {extrasFront(face, c)}
    </svg>
  );
}
