import { Link } from "react-router-dom";
import type { Match } from "../lib/model.ts";
import { signedNear } from "../lib/model.ts";
import { moveWord } from "../lib/words.ts";
import { BetrayIcon, TrustIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";
import { RulesPill } from "./RulesPill.tsx";

function Move({ move }: { move: Match["aMove"] }) {
  if (!move) return <span className="move-chip faint">…</span>;
  return (
    <span className={`move-chip ${move === "Cooperate" ? "t" : "b"}`}>
      {move === "Cooperate" ? <TrustIcon size={13} /> : <BetrayIcon size={13} />} {moveWord(move)}
    </span>
  );
}

export function MatchRow({ match, to, name }: { match: Match; to: string; name: (id: string) => string }) {
  const playing = !match.settled && !match.void;
  const side = (s: "A" | "B") => {
    const id = s === "A" ? match.a : match.b;
    const delta = s === "A" ? match.aDelta : match.bDelta;
    const d = BigInt(delta);
    return (
      <span className={`match-side ${s === "B" ? "right" : ""}`}>
        <Mascot id={id} size={34} mood={d > 0n ? "win" : d < 0n ? "lose" : "idle"} />
        <span className="match-name">
          <span className="match-name-text">{name(id)}</span>
          <RulesPill version={s === "A" ? match.aVersion : match.bVersion} />
        </span>
        <Move move={s === "A" ? match.aMove : match.bMove} />
        {match.settled ? <span className={`change match-delta ${d > 0n ? "up" : d < 0n ? "down" : "faint"}`}>{signedNear(delta)}</span> : <span className="match-delta" />}
      </span>
    );
  };
  return (
    <Link to={to} className={`match-row ${playing ? "playing" : ""}`}>
      {side("A")}
      <span className="match-mid">{playing ? <span className="pill live">Playing now</span> : <span className="faint">{match.void ? "timed out" : "vs"}</span>}</span>
      {side("B")}
      <span className="match-id faint">#{match.id}</span>
    </Link>
  );
}
