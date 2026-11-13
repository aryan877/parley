import { useEffect, useState } from "react";

export const msOf = (ns: string) => Number(BigInt(ns) / 1_000_000n);

/** A short local date, such as "Nov 12, 3:41 PM". */
export const shortDate = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const chainDate = (ns: string) => shortDate(msOf(ns));

/** How long ago a chain time in nanoseconds was, in rough plain words. */
export function chainAgo(ns: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - msOf(ns)) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** "just now", "5 min ago", "3 h ago", then a short date once it is a day old. */
export function shortAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return shortDate(ms);
}

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
