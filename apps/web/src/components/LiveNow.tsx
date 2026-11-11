import { Link } from "react-router-dom";
import { useLiveArena, useLiveMatch } from "../lib/live.ts";
import { fmtNear } from "../lib/model.ts";
import { ArrowIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

/** A strip that shows the match the live arena is playing right now. */
export function LiveNow() {
  const { info, coins } = useLiveArena(8000);
  const { match } = useLiveMatch();
  if (!info || !match) return null;
  const name = (id: string) => coins?.find((c) => c.id === id)?.name ?? id.toUpperCase();
  const step = match.settled ? "just finished" : match.lines.length < 4 ? `talking, message ${match.lines.length + 1} of 4` : "choosing in secret";
  return (
    <Link to={`/match/${match.id}`} className="live-now">
      <span className="pill live">
        <i /> Live now
      </span>
      <span className="live-pair">
        <Mascot id={match.a} size={30} mood={match.settled ? "idle" : "thinking"} /> {name(match.a)} <span className="faint">vs</span> {name(match.b)} <Mascot id={match.b} size={30} mood={match.settled ? "idle" : "thinking"} />
      </span>
      <span className="muted">
        {fmtNear(match.stake)} NEAR each · {step}
      </span>
      <span className="watch">
        Watch <ArrowIcon size={14} />
      </span>
    </Link>
  );
}
