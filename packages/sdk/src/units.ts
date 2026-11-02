export const YOCTO = 10n ** 24n;

export function near(amount: number | string): bigint {
  const [whole, frac = ""] = String(amount).split(".");
  return BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
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

export const MINUTE_NS = 60n * 1_000_000_000n;
