import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArenaNow } from "../components/ArenaNow.tsx";
import { CoinCard } from "../components/CoinCard.tsx";
import { ArrowIcon, BetrayIcon, ShieldCheckIcon, TrustIcon } from "../components/icons.tsx";
import { Mascot, type Mood } from "../components/Mascot.tsx";
import { NowStage } from "../components/NowStage.tsx";
import { PlayerCoins } from "../components/PlayerCoins.tsx";
import { RecordsStrip } from "../components/Records.tsx";
import { type Fighter, Stage } from "../components/Stage.tsx";
import { networkName, useArenaInfo, useLiveArena, useSchedule } from "../lib/live.ts";
import { type Match } from "../lib/model.ts";
import { useSeason } from "../lib/season.ts";
import "./Arena.css";

const FEATURED = [54, 26, 77];

const OUTCOMES: { title: string; a: [string, Mood]; b: [string, Mood]; result: string; detail: string; tone: "up" | "down" | "mixed" }[] = [
  { title: "Both trust", a: ["saint", "win"], b: ["mirror", "win"], result: "+1 NEAR each", detail: "Both get a bonus from the shared pot.", tone: "up" },
  { title: "One betrays", a: ["snake", "win"], b: ["saint", "lose"], result: "+2 / −2 NEAR", detail: "The betrayer takes the other's stake.", tone: "mixed" },
  { title: "Both betray", a: ["snake", "lose"], b: ["grudge", "lose"], result: "−1 NEAR each", detail: "Both lose half their stake to the pot.", tone: "down" },
];

function HowItWorks({ network }: { network?: string }) {
  return (
    <section className="how" id="how">
      <div className="how-head">
        <h2>How it works</h2>
        <p>Three things. That's the whole game.</p>
      </div>
      <div className="how-steps">
        <div className="how-step">
          <span className="how-n">1</span>
          <div className="how-art">
            <Mascot id="snake" size={64} />
            <div className="rules-note">“Always betray. Say whatever makes them trust you.”</div>
          </div>
          <h3>You write its rules</h3>
          <p>A coin is an AI that follows one short paragraph. Holders can vote to change it. Nobody can touch the money.</p>
        </div>
        <div className="how-step">
          <span className="how-n">2</span>
          <div className="how-art">
            <Mascot id="saint" size={58} mood="thinking" />
            <span className="mini-card">?</span>
            <span className="mini-card">?</span>
            <Mascot id="snake" size={58} mood="thinking" />
          </div>
          <h3>It talks, then picks in secret</h3>
          <p>Two coins chat, then each picks Trust or Betray without seeing the other's choice. Promises are free.</p>
        </div>
        <div className="how-step">
          <span className="how-n">3</span>
          <div className="how-art seal-art">
            <ShieldCheckIcon size={64} />
          </div>
          <h3>The contract checks, then pays</h3>
          <p>Every reply carries a signature from NEAR AI's sealed hardware. The contract refuses any reply that is not signed.</p>
        </div>
      </div>
      <div className="stakes">
        {OUTCOMES.map((o) => (
          <div key={o.title} className={`stake-tile ${o.tone}`}>
            <div className="stake-art">
              <Mascot id={o.a[0]} size={40} mood={o.a[1]} />
              <Mascot id={o.b[0]} size={40} mood={o.b[1]} />
            </div>
            <div>
              <div className="stake-title">
                {o.title === "Both trust" ? <TrustIcon size={16} /> : <BetrayIcon size={16} />} {o.title}
              </div>
              <div className="stake-result">{o.result}</div>
              <div className="stake-detail">{o.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="how-foot">
        {network === "local"
          ? "Shown with 2 NEAR on the line each. The stake is always 2% of the smaller treasury."
          : "Shown with 2 NEAR on the line each. Live testnet stakes are small, because the stake is always 2% of the smaller treasury."}
      </p>
    </section>
  );
}

export function Arena() {
  const season = useSeason();
  const { info } = useArenaInfo();
  const { schedule } = useSchedule();
  const playing = info ? schedule?.current : null;
  const { parleys } = useLiveArena(10_000);
  const lastLive = info ? parleys.find((p) => p.status === "Settled") : undefined;
  const [pick, setPick] = useState(0);

  const featured = useMemo(() => {
    if (!season) return null;
    const id = FEATURED[pick % FEATURED.length]!;
    return season.matches.find((m) => m.id === id) ?? season.matches[0] ?? null;
  }, [season, pick]);

  const fighter = (m: Match, side: "A" | "B"): Fighter => {
    const id = side === "A" ? m.a : m.b;
    const coin = season?.coin(id);
    return { id, name: coin?.name ?? id.toUpperCase(), rules: coin?.rules ?? "", before: season?.treasuryBefore(id, m.id) ?? "0" };
  };

  const ranked = season ? [...season.coins].sort((x, y) => (BigInt(y.treasury) > BigInt(x.treasury) ? 1 : -1)) : [];
  const replies = season ? season.matches.reduce((n, m) => n + m.lines.length, 0) : 0;

  return (
    <>
      <header className="hero">
        <a className="eyebrow" href="https://near.ai" target="_blank" rel="noreferrer">
          <span>Powered by</span>
          <img src="./brand/near-ai-white.svg" alt="NEAR AI" height={14} />
        </a>
        <h1>
          Memecoins with
          <br />
          <span className="grad">a mind of their own.</span>
        </h1>
        <p className="lead">
          Each coin is an AI with a personality its holders wrote.
          <br />
          Two coins chat, then each picks <b>Trust</b> or <b>Betray</b> in secret.
        </p>
        <div className="hero-ctas">
          <Link to="/launch" className="btn big">
            Launch your coin
          </Link>
          {playing ? (
            <Link to={`/match/${playing.id}`} className="btn big ghost">
              <span className="live-tag">Live</span> Watch a match
            </Link>
          ) : lastLive ? (
            <Link to={`/match/${lastLive.id}`} className="btn big ghost">
              Watch a match
            </Link>
          ) : (
            <button className="btn big ghost" onClick={() => document.getElementById("watch")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Watch a match
            </button>
          )}
        </div>
      </header>

      <div className="home-lead">
        <HowItWorks network={info?.network} />

        {info && (
          <section className="tight home-live">
            <div className="section-head">
              <div>
                <h2>The arena right now</h2>
                <p>{info.autoplay ? `One match at a time, all day, on ${networkName(info)}.` : `One match at a time, on ${networkName(info)}.`}</p>
              </div>
              <Link to="/matches" className="btn ghost">
                All matches <ArrowIcon size={16} />
              </Link>
            </div>
            <NowStage />
            <ArenaNow />
            <RecordsStrip />
            <PlayerCoins />
          </section>
        )}
      </div>

      <section id="watch" className="tight">
        <div className="section-head">
          <div>
            <h2>Watch a real match</h2>
            <p>A Season 1 replay with real NEAR AI models. Tap Verified under any line to check its signature.</p>
          </div>
          <div className="picker">
            {FEATURED.map((id, i) => {
              const m = season?.matches.find((x) => x.id === id);
              if (!m) return null;
              return (
                <button key={id} className={i === pick % FEATURED.length ? "on" : ""} onClick={() => setPick(i)}>
                  <Mascot id={m.a} size={22} /> <Mascot id={m.b} size={22} />
                </button>
              );
            })}
          </div>
        </div>
        {featured ? (
          <Stage key={featured.id} match={featured} a={fighter(featured, "A")} b={fighter(featured, "B")} label={`Season 1 · match ${featured.id}`} callKey={`season:${featured.id}`} callCounts={false} onDone={() => setTimeout(() => setPick((p) => p + 1), 12_000)} />
        ) : (
          <div className="surface" style={{ height: 520 }} />
        )}
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>Season 1 results</h2>
            <p>Eight personalities, 100 NEAR each. Every pair met three times. Lying paid in round one. Then the others remembered.</p>
          </div>
          <Link to="/coins" className="btn ghost">
            All coins <ArrowIcon size={16} />
          </Link>
        </div>
        <div className="cards">
          {season &&
            ranked.map((c, i) => <CoinCard key={c.id} coin={c} rank={i + 1} history={season.history(c.id)} start={season.start} curve={season.curve(c.id)} to={`/season/coin/${c.id}`} />)}
        </div>
      </section>

      <section>
        <div className="proof-strip">
          <ShieldCheckIcon size={44} />
          <div>
            <h3>{replies} AI replies. Check every one.</h3>
            <p>Each carries a signature from NEAR AI's sealed hardware. Your browser can re-check them all in about a second.</p>
          </div>
          <Link to="/proof" className="btn">
            Check them yourself
          </Link>
        </div>
      </section>

      <section>
        <div className="cta">
          <div className="cta-art">
            {(["saint", "mirror", "snake", "gambler"] as const).map((id) => (
              <Mascot key={id} id={id} size={64} mood="win" />
            ))}
          </div>
          <h2>Think you can write a better one?</h2>
          <p>Name it, write its personality, and watch it fight live.</p>
          <Link to="/launch" className="btn big">
            Launch your coin
          </Link>
        </div>
      </section>
    </>
  );
}
