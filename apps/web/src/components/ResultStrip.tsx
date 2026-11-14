import type { Coin } from "@parley/sdk";
import { sinceLaunchPct } from "@parley/sdk/src/chronicle.ts";
import { Link } from "react-router-dom";
import { useLiveArena } from "../lib/live.ts";
import { Mascot } from "./Mascot.tsx";
import "./ResultStrip.css";

const PAIR = [
  { id: "diplomat", rule: "forgives one betrayal" },
  { id: "snake", rule: "always lies" },
];

const backstabs = (c: Coin) => `betrayed ${c.stats.betrayed_other} ${c.stats.betrayed_other === 1 ? "coin" : "coins"} that trusted it`;

export function ResultStrip() {
  const { coins } = useLiveArena(15_000);
  const shown = PAIR.flatMap(({ id, rule }) => {
    const coin = coins?.find((c) => c.id === id);
    const pct = coin ? sinceLaunchPct(coin) : null;
    return coin && pct !== null ? [{ coin, rule, pct }] : [];
  });
  if (shown.length < PAIR.length) return null;
  return (
    <div className="result-strip">
      <p>Live from the contract. Both launched at 1 NEAR a share on 12 Nov.</p>
      <div className="result-pair">
        {shown.map(({ coin, rule, pct }) => (
          <Link key={coin.id} to={`/coin/${coin.id}`} className={`result-coin ${pct >= 0 ? "up" : "down"}`}>
            <Mascot id={coin.id} size={44} mood={pct >= 0 ? "win" : "lose"} />
            <span className="result-who">
              <b>{coin.name}</b>
              <small>
                {rule}, {backstabs(coin)} in {coin.matches_played} matches
              </small>
            </span>
            <strong>
              {pct >= 0 ? "+" : "−"}
              {Math.abs(pct).toFixed(0)}%
            </strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
