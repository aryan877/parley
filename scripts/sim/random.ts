export type Random = () => number;

export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nonce(random: Random): string {
  let hex = "";
  for (let i = 0; i < 2; i++) hex += Math.floor(random() * 4294967296).toString(16).padStart(8, "0");
  return hex;
}
