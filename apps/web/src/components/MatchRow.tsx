import { Link } from "react-router-dom";
import type { Match } from "../lib/model.ts";
import { signedNear } from "../lib/model.ts";
import { moveWord } from "../lib/words.ts";
import { BetrayIcon, TrustIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

function Move({ move }: { move: Match["aMove"] }) {
  if (!move) return <span className="move-chip faint">…</span>;
  return (
    <span className={`move-chip ${move === "Cooperate" ? "t" : "b"}`}>
      {move === "Cooperate" ? <TrustIcon size={13} /> : <BetrayIcon size={13} />} {moveWord(move)}
    </span>
  );
}

export function MatchRow({ match, to, name }: { match: Match; to: string; name: (id: string) => string }) {
  const delta = (d: string) => <span className={`change ${BigInt(d) > 0n ? "up" : BigInt(d) < 0n ? "down" : "faint"}`}>{signedNear(d)}</span>;
  return (
    <Link to={to} className="match-row">
      <span className="match-side">
        <Mascot id={match.a} size={34} mood={BigInt(match.aDelta) > 0n ? "win" : BigInt(match.aDelta) < 0n ? "lose" : "idle"} />
        {name(match.a)}
        <Move move={match.aMove} />
        {match.settled && delta(match.aDelta)}
      </span>
      {match.settled || match.void ? (
        <span className="faint" style={{ fontSize: 12 }}>
          {match.void ? "timed out" : "vs"}
        </span>
      ) : (
        <span className="pill live">
          Playing now
        </span>
      )}
      <span className="match-side right">
        {match.settled && delta(match.bDelta)}
        <Move move={match.bMove} />
        {name(match.b)}
        <Mascot id={match.b} size={34} mood={BigInt(match.bDelta) > 0n ? "win" : BigInt(match.bDelta) < 0n ? "lose" : "idle"} />
      </span>
      <span className="faint" style={{ font: "500 12px var(--mono)" }}>
        #{match.id}
      </span>
    </Link>
  );
}
