import { type Arena, type Coin, type Parley, type Records, arenaRecords, rulesHistory } from "@parley/sdk";
import type { Ledger } from "../ledger.ts";

const PARLEY_PAGE = 50;
const RECORDS_TTL = 20_000;
const COINS_TTL = 5000;

export type Told = { body: unknown; status?: number } | null;

/**
 * Arena history the contract does not keep in its state: records over every finished match, and every version
 * of a coin's constitution. Matches come from the contract's views; closed amendments only live in transactions,
 * so their text, proposer, tally and enactment come from the transactions the money log reads.
 */
export function chronicle(owner: Arena, ledger: Pick<Ledger, "governance">): (path: string) => Promise<Told> {
  const parleys = new Map<number, Parley>();
  let complete = 0;
  let records: { at: number; body: Records & { scope: "all" } } | null = null;
  let warming: Promise<void> | null = null;
  let coinsAt = 0;
  let coins: Promise<Coin[]> | null = null;

  const allCoins = () => {
    if (!coins || Date.now() - coinsAt > COINS_TTL) {
      coinsAt = Date.now();
      coins = owner.coins().catch((error) => {
        coinsAt = 0;
        throw error;
      });
    }
    return coins;
  };

  async function loadParleys() {
    const { parleys: count } = await owner.overview();
    for (let from = 0; from < count; from += PARLEY_PAGE) {
      const page = await owner.parleys(from, PARLEY_PAGE);
      for (const p of page) parleys.set(p.id, p);
      while (parleys.has(complete) && parleys.get(complete)!.status !== "Open") complete++;
      const oldest = page.at(-1)?.id ?? 0;
      if (!page.length || oldest <= complete) break;
    }
    records = { at: Date.now(), body: { ...arenaRecords([...parleys.values()], await allCoins()), scope: "all" } };
  }

  const refreshRecords = () => {
    warming ??= loadParleys()
      .catch((error) => console.error("records failed:", error instanceof Error ? error.message : error))
      .finally(() => (warming = null));
    return warming;
  };

  async function history(id: string): Promise<Told> {
    const coin = (await allCoins()).find((c) => c.id === id) ?? (await owner.coin(id));
    if (!coin) return { body: { error: "No such coin." }, status: 404 };
    return { body: rulesHistory(coin, ledger.governance(id)) };
  }

  void refreshRecords();

  return async (path) => {
    if (path === "/api/records") {
      if (!records || Date.now() - records.at > RECORDS_TTL) void refreshRecords();
      return records ? { body: records.body } : { body: { error: "The arena's records are still loading." }, status: 503 };
    }
    const rules = path.match(/^\/api\/history\/([a-z0-9]{2,20})$/);
    if (rules) return history(rules[1]!);
    return null;
  };
}
