import { useSearchParams } from "react-router-dom";
import { Empty } from "../components/Empty.tsx";
import { BooksCheck, LedgerRow, LedgerTotals } from "../components/Ledger.tsx";
import { GROUPS, useLedger, useLedgerSummary } from "../lib/ledger.ts";
import { useLiveArena } from "../lib/live.ts";

export function Money() {
  const [params, setParams] = useSearchParams();
  const coin = params.get("coin") || null;
  const group = GROUPS.find((g) => g.id === params.get("type")) ?? GROUPS[0]!;
  const live = useLiveArena(15_000);
  const names = new Map((live.coins ?? []).map((c) => [c.id, c.name]));
  const name = (id: string) => names.get(id) ?? id.toUpperCase();
  const { summary, problem, ready } = useLedgerSummary();
  const ledger = useLedger(coin, group.kinds);
  const pick = (key: "coin" | "type", value: string | null) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const coins = [...(live.coins ?? [])].sort((x, y) => x.name.localeCompare(y.name));

  return (
    <>
      <div className="page-head compact">
        <h1>Money</h1>
        <p className="muted">Every NEAR that went into or out of a coin, the pot or an order, read from the contract's own records on NEAR.</p>
      </div>
      {!summary && ready && (
        <Empty id="gambler" mood="thinking" title={problem === "offline" ? "The money log is offline right now" : "The money log is not available here"}>
          {problem === "offline" ? "Try again in a minute." : problem}
        </Empty>
      )}
      {summary && (
        <>
          <BooksCheck summary={summary} />
          <LedgerTotals summary={summary} />
          <div className="money-filters">
            <label className="money-coin">
              <span>Coin</span>
              <select value={coin ?? ""} onChange={(e) => pick("coin", e.target.value || null)}>
                <option value="">All coins</option>
                {coins.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {coin && !names.has(coin) && <option value={coin}>{coin.toUpperCase()}</option>}
              </select>
            </label>
            <div className="tabs money-types">
              {GROUPS.map((g) => (
                <button key={g.id} className={g.id === group.id ? "on" : ""} onClick={() => pick("type", g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ledger-list">
            {ledger.entries.map((e) => (
              <LedgerRow key={e.seq} entry={e} name={name} info={live.info} coin={coin ?? undefined} />
            ))}
            {ledger.ready && !ledger.entries.length && (
              <Empty id={coin ?? "saint"} mood="idle" title="Nothing here yet">
                {summary.status.caughtUp ? "No money has moved this way so far." : "Still reading the chain. Check back in a minute."}
              </Empty>
            )}
            {!ledger.ready && <p className="muted loading-line">Loading…</p>}
          </div>
          {ledger.next !== null && (
            <div className="more-row">
              <button className="btn ghost" disabled={ledger.paging} onClick={ledger.more}>
                {ledger.paging ? "Loading…" : "Show older"}
              </button>
            </div>
          )}
        </>
      )}
      {!ready && <p className="muted loading-line">Loading…</p>}
    </>
  );
}
