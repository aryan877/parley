/**
 * A coin's face, stored in its id so it lives on chain with no contract change.
 *
 * Id layout: slug (1-10 chars) + "0" + six trait digits + two random chars + one check char.
 * Each trait digit is base36, so every trait can grow to 36 options without breaking old ids.
 * Ids that do not match this layout keep the face hashed from the id.
 */

export const COLORS = [
  { key: "cherry", label: "Cherry", hex: "#FF6B6B" },
  { key: "tangerine", label: "Tangerine", hex: "#FF9F45" },
  { key: "sun", label: "Sunny", hex: "#FFD84D" },
  { key: "lime", label: "Lime", hex: "#A3E635" },
  { key: "jade", label: "Jade", hex: "#34D399" },
  { key: "sky", label: "Sky", hex: "#38BDF8" },
  { key: "periwinkle", label: "Periwinkle", hex: "#8E94FF" },
  { key: "grape", label: "Grape", hex: "#B794F6" },
  { key: "orchid", label: "Orchid", hex: "#E879F9" },
  { key: "bubblegum", label: "Bubblegum", hex: "#FF8FC7" },
  { key: "peach", label: "Peach", hex: "#FFB38A" },
  { key: "tan", label: "Biscuit", hex: "#E8C39E" },
  { key: "cocoa", label: "Cocoa", hex: "#B9875C" },
  { key: "silver", label: "Silver", hex: "#CBD5E1" },
] as const;

export const GEARS = [
  { key: "none", label: "Nothing" },
  { key: "crown", label: "Crown" },
  { key: "star", label: "Star" },
  { key: "antenna", label: "Antenna" },
  { key: "leaf", label: "Sprout" },
  { key: "bolt", label: "Bolt" },
  { key: "party", label: "Party hat" },
  { key: "tophat", label: "Top hat" },
  { key: "cap", label: "Cap" },
  { key: "horns", label: "Horns" },
  { key: "ears", label: "Cat ears" },
  { key: "flower", label: "Flower" },
  { key: "propeller", label: "Propeller" },
  { key: "bow", label: "Bow" },
  { key: "headphones", label: "Headphones" },
  { key: "mohawk", label: "Mohawk" },
] as const;

export const EYES = [
  { key: "dot", label: "Round" },
  { key: "bean", label: "Tall" },
  { key: "beady", label: "Beady" },
  { key: "sparkle", label: "Sparkly" },
  { key: "googly", label: "Googly" },
  { key: "sleepy", label: "Sleepy" },
  { key: "fierce", label: "Fierce" },
  { key: "wink", label: "Wink" },
  { key: "robot", label: "Robot" },
  { key: "hearts", label: "Hearts" },
] as const;

export const MOUTHS = [
  { key: "smile", label: "Smile" },
  { key: "grin", label: "Grin" },
  { key: "cat", label: "Cat" },
  { key: "smirk", label: "Smirk" },
  { key: "blep", label: "Blep" },
  { key: "fang", label: "Fang" },
  { key: "buck", label: "Buck teeth" },
  { key: "o", label: "Ooh" },
  { key: "grimace", label: "Grimace" },
  { key: "open", label: "Happy" },
] as const;

export const BROWS = [
  { key: "arched", label: "Arched" },
  { key: "flat", label: "Flat" },
  { key: "angry", label: "Angry" },
  { key: "worried", label: "Worried" },
  { key: "bushy", label: "Bushy" },
  { key: "none", label: "None" },
] as const;

export const EXTRAS = [
  { key: "none", label: "Nothing" },
  { key: "blush", label: "Blush" },
  { key: "shades", label: "Shades" },
  { key: "specs", label: "Glasses" },
  { key: "mustache", label: "Mustache" },
  { key: "eyepatch", label: "Eye patch" },
  { key: "bandage", label: "Plaster" },
  { key: "chain", label: "Gold chain" },
  { key: "laser", label: "Laser eyes" },
] as const;

export type GearKey = (typeof GEARS)[number]["key"];
export type EyeKey = (typeof EYES)[number]["key"];
export type MouthKey = (typeof MOUTHS)[number]["key"];
export type BrowKey = (typeof BROWS)[number]["key"];
export type ExtraKey = (typeof EXTRAS)[number]["key"];

/** Trait indexes, in id order. */
export interface Look {
  color: number;
  gear: number;
  eyes: number;
  mouth: number;
  brows: number;
  extra: number;
}

export const TRAITS = [
  { key: "color", label: "Colour", options: COLORS },
  { key: "gear", label: "Hat", options: GEARS },
  { key: "eyes", label: "Eyes", options: EYES },
  { key: "mouth", label: "Mouth", options: MOUTHS },
  { key: "brows", label: "Brows", options: BROWS },
  { key: "extra", label: "Extra", options: EXTRAS },
] as const;

export type Trait = (typeof TRAITS)[number]["key"];

export const LOOK_COUNT = TRAITS.reduce((n, t) => n * t.options.length, 1);

const MARK = "0";
const CODE = 10;
const SLUG = 20 - CODE;

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const check = (body: string) => (fnv(`look:${body}`) % 36).toString(36);

export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, SLUG) || "coin";

export const randomSalt = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => (b % 36).toString(36)).join("");

export function lookId(name: string, look: Look, salt: string): string {
  const digits = TRAITS.map((t) => look[t.key].toString(36)).join("");
  const body = `${slugOf(name)}${MARK}${digits}${salt}`;
  return `${body}${check(body)}`;
}

/** The face encoded in a coin id, or null when the id carries none. */
export function lookOf(id: string): Look | null {
  if (id.length < CODE + 1 || id.length > 20 || !/^[a-z0-9]+$/.test(id)) return null;
  const code = id.slice(-CODE);
  if (code[0] !== MARK || check(id.slice(0, -1)) !== id.at(-1)) return null;
  const d = [...code.slice(1, 1 + TRAITS.length)].map((ch) => parseInt(ch, 36));
  if (d.some((v, i) => v >= TRAITS[i]!.options.length)) return null;
  return { color: d[0]!, gear: d[1]!, eyes: d[2]!, mouth: d[3]!, brows: d[4]!, extra: d[5]! };
}

export function randomLook(): Look {
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % n;
  const extra = r(3) === 0 ? r(EXTRAS.length) : 0;
  return { color: r(COLORS.length), gear: r(GEARS.length), eyes: r(EYES.length), mouth: r(MOUTHS.length), brows: r(BROWS.length - 1), extra };
}

export const lookIndex = <K extends Trait>(trait: K, key: string) => Math.max(0, TRAITS.find((t) => t.key === trait)!.options.findIndex((o) => o.key === key));

/** A look written with option keys, for hand-made presets. */
export function look(color: string, gear: GearKey, eyes: EyeKey, mouth: MouthKey, brows: BrowKey, extra: ExtraKey = "none"): Look {
  return {
    color: lookIndex("color", color),
    gear: lookIndex("gear", gear),
    eyes: lookIndex("eyes", eyes),
    mouth: lookIndex("mouth", mouth),
    brows: lookIndex("brows", brows),
    extra: lookIndex("extra", extra),
  };
}
