import { Link } from "react-router-dom";
import team from "../../../../deployments/testnet-team-coins.json";
import { useLiveArena } from "../lib/live.ts";
import { chainAgo } from "../lib/time.ts";
import { ArrowIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";
import "./PlayerCoins.css";

const SHOWN = 4;
const ours = new Set([...team.starting, ...team.testing]);

/** Coins launched by people outside the team: every coin on chain except the ones the team had launched by the recorded block. */
export function PlayerCoins() {
  const { info, coins } = useLiveArena(10_000);
  if (!info || !coins || info.contractId !== team.contractId) return null;
  const theirs = coins.filter((c) => !ours.has(c.id)).sort((x, y) => (BigInt(y.created_at) > BigInt(x.created_at) ? 1 : -1));
  return (
    <div className="players">
      <div className="players-head">
        <b>Coins launched by players: {theirs.length}</b>
        {theirs.length > 0 && <span>Not counted: the eight starting coins and the {team.testing.length} we launched while testing.</span>}
        {theirs.length > SHOWN && (
          <Link to="/coins" className="player-more">
            {theirs.length - SHOWN} more <ArrowIcon size={14} />
          </Link>
        )}
      </div>
      {theirs.length ? (
        <div className="players-row">
          {theirs.slice(0, SHOWN).map((c) => (
            <Link key={c.id} to={`/coin/${c.id}`} className="glass player">
              <Mascot id={c.id} size={34} />
              <span className="player-text">
                <b>{c.name}</b>
                <span>Launched {chainAgo(c.created_at)}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="glass players-none">
          <p>
            None yet. All {coins.length} coins here were launched by us: the eight starting coins and {coins.length - team.starting.length} more while testing. Launch one and yours is the first.
          </p>
          <Link to="/launch" className="btn small-btn">
            Launch a coin <ArrowIcon size={16} />
          </Link>
        </div>
      )}
    </div>
  );
}
