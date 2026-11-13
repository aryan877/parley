import { useEffect, useState } from "react";

export const msOf = (ns: string) => Number(BigInt(ns) / 1_000_000n);

/** Seconds as "42s" or "3:07". */
export const clock = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** A config length in nanoseconds as "4 minutes", or the fallback count before the config is read. */
export function minutes(ns: string | undefined, fallback: number): string {
  const m = ns ? Math.round(Number(BigInt(ns) / 1_000_000_000n) / 60) : fallback;
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

/** The time, ticking every second while `run` holds. */
export function useNow(run = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!run) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run]);
  return now;
}
