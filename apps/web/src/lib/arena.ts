import { ARENA_API } from "./live.ts";

/** Puts a coin's matches against the given rivals in the arena's line. Returns how many matches play before them. */
export async function sendChallenge(coin: string, opponents: string[]): Promise<number> {
  const res = await fetch(`${ARENA_API}/api/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin, opponents }) });
  const body = (await res.json().catch(() => ({}))) as { ahead?: number; error?: string };
  if (!res.ok || typeof body.ahead !== "number") throw new Error(body.error ?? "The arena could not take the challenge.");
  return body.ahead;
}
