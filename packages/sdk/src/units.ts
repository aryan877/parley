export const YOCTO = 10n ** 24n;

export function near(amount: number | string): bigint {
  const [whole, frac = ""] = String(amount).split(".");
  return BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

/** A typed amount such as "1.5", or null when it is not a plain decimal number. */
export function parseNear(text: string): bigint | null {
  const t = text.trim();
  return t && /^\d*(\.\d*)?$/.test(t) ? near(t) : null;
}

export function formatNear(yocto: bigint | string, digits = 2): string {
  const value = BigInt(yocto);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const scale = 10n ** BigInt(24 - digits);
  const scaled = abs / scale;
  const whole = scaled / 10n ** BigInt(digits);
  const frac = (scaled % 10n ** BigInt(digits)).toString().padStart(digits, "0");
  return `${sign}${whole}.${frac}`;
}

export const nearNumber = (yocto: bigint | string): number => Number(BigInt(yocto) / 10n ** 20n) / 10_000;

/** NEAR as the site shows it: `digits` decimals, more (up to 4) so a small amount never shows as 0. `formatNear` keeps exact digits. */
export function fmtNear(yocto: bigint | string, digits = 2): string {
  const n = nearNumber(yocto);
  let d = digits;
  while (d < 4 && n !== 0 && Math.abs(n) < 0.5 * 10 ** -d) d++;
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const MINUTE_NS = 60n * 1_000_000_000n;
