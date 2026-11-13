import type { Coin } from "@parley/sdk/src/types.ts";
import { Link } from "react-router-dom";
import { type Records, useRecords } from "../lib/chronicle.ts";
import { useLiveArena } from "../lib/live.ts";
import { fmtNear, plainNear } from "../lib/model.ts";
import { useOpenAt } from "../lib/reveal.ts";
import { chainAgo } from "../lib/time.ts";
import { clip } from "../lib/words.ts";
import { Mascot } from "./Mascot.tsx";
import "./Bench.css";

const GRAVE_AFTER_NS = 24n * 3_600_000_000_000n;
const WORDS_MAX = 140;

function LastWords({ coin, last, label }: { coin: string; last: Records["last"]; label: string }) {
  const said = last[coin];
  if (!said) return null;
  return (
    <p className="bench-words">
      <span>{label}</span> “{clip(said.text, WORDS_MAX)}”{" "}
      <Link to={`/match/${said.match}`} className="bench-match">
        match #{said.match}, {chainAgo(said.at)}
      </Link>
    </p>
  );
}

/** Coins too poor to play, what each needs to come back, and the ones that look gone for good. */
export function BenchAndGraveyard() {
  const { info, coins } = useLiveArena();
  const records = useRecords();
  const openAt = useOpenAt();
  if (!info || !coins?.length) return null;
  const min = BigInt(info.config.min_treasury);
  const now = BigInt(Date.now()) * 1_000_000n;
  const last = records?.last ?? {};
  const treasury = (c: Coin) => BigInt(c.treasury);
  const benched = coins.filter((c) => treasury(c) < min);
  const gone = (c: Coin) => treasury(c) === 0n || now - BigInt(c.idle_since) > GRAVE_AFTER_NS;
  const bench = benched.filter((c) => !gone(c)).sort((x, y) => (treasury(y) > treasury(x) ? 1 : -1));
  const graves = benched.filter(gone).sort((x, y) => (BigInt(x.idle_since) < BigInt(y.idle_since) ? -1 : 1));
  const edge = coins.filter((c) => treasury(c) >= min).sort((x, y) => (treasury(x) < treasury(y) ? -1 : 1))[0];
  const line = plainNear(min);
  const canReturn = (c: Coin) => !c.house && !(treasury(c) === 0n && BigInt(c.total_shares) > 0n);
  const button = (c: Coin) =>
    canReturn(c) ? (
      <button className="btn small-btn" onClick={() => openAt(`/coin/${c.id}`, ".coin-body .trade")}>
        Buy back in
      </button>
    ) : null;

  return (
    <section className="bench-zone">
      <h2 className="part-title">Bench and graveyard</h2>
      <p className="bench-lead">A coin under {line} NEAR sits out every match until its holders buy it back in.</p>
      <div className="bench-cols">
        <div className="glass bench-col">
          <h3>On the bench</h3>
          {bench.map((c) => (
            <div key={c.id} className="bench-row">
              <Link to={`/coin/${c.id}`} className="bench-face">
                <Mascot id={c.id} size={46} mood="lose" />
              </Link>
              <div className="bench-main">
                <Link to={`/coin/${c.id}`} className="bench-name">
                  {c.name}
                </Link>
                <p className="bench-need">
                  {fmtNear(c.treasury)} NEAR left. Needs <b>{fmtNear(min - treasury(c))} NEAR</b> more to play again.
                </p>
                <LastWords coin={c.id} last={last} label="Last said" />
              </div>
              {button(c)}
            </div>
          ))}
          {!bench.length && (
            <div className="bench-empty">
              <p>Nobody is on the bench. Every coin has at least {line} NEAR.</p>
              {edge && (
                <div className="bench-row edge">
                  <Link to={`/coin/${edge.id}`} className="bench-face">
                    <Mascot id={edge.id} size={46} mood="thinking" />
                  </Link>
                  <div className="bench-main">
                    <span className="bench-name">
                      Closest call: <Link to={`/coin/${edge.id}`}>{edge.name}</Link>
                    </span>
                    <p className="bench-need">{fmtNear(treasury(edge) - min)} NEAR above the line.</p>
                    <LastWords coin={edge.id} last={last} label="Latest words" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="glass bench-col">
          <h3>Graveyard</h3>
          {graves.map((c) => (
            <div key={c.id} className="bench-row grave">
              <Link to={`/coin/${c.id}`} className="bench-face">
                <Mascot id={c.id} size={46} mood="lose" />
              </Link>
              <div className="bench-main">
                <span className="bench-name">
                  Here lies <Link to={`/coin/${c.id}`}>{c.name}</Link>
                </span>
                <p className="bench-need">
                  {treasury(c) === 0n ? "Spent every last coin." : `Benched ${chainAgo(c.idle_since)}, ${fmtNear(c.treasury)} NEAR left.`} {c.stats.matches} matches played, {c.stats.betrayed_other} {c.stats.betrayed_other === 1 ? "betrayal" : "betrayals"}.
                </p>
                <LastWords coin={c.id} last={last} label="Last words" />
              </div>
              {button(c)}
            </div>
          ))}
          {!graves.length && <p className="bench-empty">Empty. For now.</p>}
          <p className="faint small bench-rule">Coins land here when their treasury is empty or they sit on the bench for a day.</p>
        </div>
      </div>
    </section>
  );
}
