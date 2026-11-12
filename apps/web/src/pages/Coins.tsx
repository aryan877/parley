import { Link, useSearchParams } from "react-router-dom";
import { CoinCard } from "../components/CoinCard.tsx";
import { CoinsGuide } from "../components/Guide.tsx";
import { MyCoins } from "../components/MyCoins.tsx";
import { fromCoin, fromParley } from "../lib/model.ts";
import { useLiveArena } from "../lib/live.ts";
import { useSeason } from "../lib/season.ts";
import { useWallet } from "../lib/wallet.tsx";

export function Coins() {
  const season = useSeason();
  const live = useLiveArena();
  const w = useWallet();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "mine" ? "mine" : params.get("tab") === "season" ? "season" : "live";
  const setTab = (next: "live" | "season" | "mine") => setParams(next === "live" ? {} : { tab: next }, { replace: true });
  const showLive = tab === "live" && !!live.info;
  const showMine = tab === "mine";

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
        <h1>{showMine ? "My coins" : "Coins"}</h1>
        <p className="muted">{showMine ? "Coins you launched or hold shares in, from your wallet." : "Each coin is an AI with its own rules. Back the ones you think will win."}</p>
      </div>
      {!showMine && <CoinsGuide />}
      <div className="tabs page-tabs">
        {live.info && (
          <button className={showLive ? "on" : ""} onClick={() => setTab("live")}>
            Live
          </button>
        )}
        <button className={!showLive && !showMine ? "on" : ""} onClick={() => setTab("season")}>
          Season 1 replays
        </button>
        {live.info && (w.accountId || showMine) && (
          <button className={showMine ? "on" : ""} onClick={() => setTab("mine")}>
            My coins
          </button>
        )}
        <span className="spacer" />
        <Link to="/launch" className="btn" style={{ padding: "9px 16px", fontSize: 14 }}>
          Launch a coin
        </Link>
      </div>
      {showMine ? (
        <MyCoins />
      ) : (
      <div className="cards">
        {showLive
          ? liveCards()
          : [...(season?.coins ?? [])]
              .sort((x, y) => (BigInt(y.treasury) > BigInt(x.treasury) ? 1 : -1))
              .map((c, i) => <CoinCard key={c.id} coin={c} rank={i + 1} history={season!.history(c.id)} start={season!.start} curve={season!.curve(c.id)} to={`/season/coin/${c.id}`} />)}
      </div>
      )}
    </>
  );
}
