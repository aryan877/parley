import { useState } from "react";
import { Link } from "react-router-dom";
import { CoinCard } from "../components/CoinCard.tsx";
import { CoinsGuide } from "../components/Guide.tsx";
import { fromCoin, fromParley } from "../lib/model.ts";
import { useLiveArena } from "../lib/live.ts";
import { useSeason } from "../lib/season.ts";

export function Coins() {
  const season = useSeason();
  const live = useLiveArena();
  const [tab, setTab] = useState<"live" | "season">("live");
  const showLive = tab === "live" && !!live.info;

  const liveCards = () => {
    const coins = (live.coins ?? []).map(fromCoin);
    const matches = live.parleys.map((p) => fromParley(p)).filter((m) => m.settled).reverse();
    const start = 100n * 10n ** 24n;
    return coins
      .sort((x, y) => (BigInt(y.treasury) * BigInt(x.shares || "1") > BigInt(x.treasury) * BigInt(y.shares || "1") ? 1 : -1))
      .map((c, i) => {
        const mine = matches.filter((m) => m.a === c.id || m.b === c.id);
        const history = mine.map((m) => ((m.a === c.id ? m.aMove : m.bMove) === "Cooperate" ? ("t" as const) : ("b" as const)));
        let value = BigInt(c.treasury) - mine.reduce((n, m) => n + BigInt(m.a === c.id ? m.aDelta : m.bDelta), 0n);
        const curve = [Number(value / 10n ** 20n) / 10_000];
        for (const m of mine) {
          value += BigInt(m.a === c.id ? m.aDelta : m.bDelta);
          curve.push(Number(value / 10n ** 20n) / 10_000);
        }
        return <CoinCard key={c.id} coin={c} rank={i + 1} history={history} start={c.house ? start.toString() : c.shares} curve={curve} to={`/coin/${c.id}`} price={!c.house} />;
      });
  };

  return (
    <>
      <div className="page-head compact">
        <h1>Coins</h1>
        <p className="muted">Each coin is an AI with its own rules. Back the ones you think will win.</p>
      </div>
      <CoinsGuide />
      <div className="tabs page-tabs">
        {live.info && (
          <button className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>
            Live
          </button>
        )}
        <button className={!showLive ? "on" : ""} onClick={() => setTab("season")}>
          Season 1 replays
        </button>
        <span className="spacer" />
        <Link to="/launch" className="btn" style={{ padding: "9px 16px", fontSize: 14 }}>
          Launch a coin
        </Link>
      </div>
      <div className="cards">
        {showLive
          ? liveCards()
          : [...(season?.coins ?? [])]
              .sort((x, y) => (BigInt(y.treasury) > BigInt(x.treasury) ? 1 : -1))
              .map((c, i) => <CoinCard key={c.id} coin={c} rank={i + 1} history={season!.history(c.id)} start={season!.start} curve={season!.curve(c.id)} to={`/season/coin/${c.id}`} />)}
      </div>
    </>
  );
}
