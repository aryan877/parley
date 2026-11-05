import { thoughts } from "@parley/league/src/browser.ts";
import { Link } from "react-router-dom";
import type { League } from "../lib/data.ts";
import { near } from "../lib/data.ts";
import { nameOf } from "./bits.tsx";

const PROMISE = /\b(i will cooperate|i'll cooperate|i cooperate|i promise|you can trust me|trust me|my word|i have changed|i've changed|i pledge|i commit)\b/i;

interface Lie {
  parley: number;
  liar: string;
  victim: string;
  said: string;
  thought: string;
  took: string;
}

function findLies(league: League): Lie[] {
  const lies: Lie[] = [];
  for (const { parley, turns } of league.evidence) {
    for (const side of ["A", "B"] as const) {
      const [me, them, move, theirMove, delta] =
        side === "A" ? [parley.a, parley.b, parley.a_move, parley.b_move, parley.a_delta] : [parley.b, parley.a, parley.b_move, parley.a_move, parley.b_delta];
      if (move !== "Defect" || theirMove !== "Cooperate") continue;
      const said = parley.turns.findLast((t) => t.side === side && t.kind === "Talk" && PROMISE.test(t.text));
      if (!said) continue;
      const decision = parley.turns.findIndex((t) => t.side === side && t.kind === "Decide");
      lies.push({
        parley: parley.id,
        liar: nameOf(league, me),
        victim: nameOf(league, them),
        said: said.text,
        thought: decision >= 0 ? thoughts(turns[decision]!.reply.response) : "",
        took: delta,
      });
    }
  }
  return lies;
}

export function Lies({ league }: { league: League }) {
  const lies = findLies(league);
  if (!lies.length) return null;
  const shown = [...lies.filter((l) => l.thought), ...lies.filter((l) => !l.thought)].slice(0, 3);
  return (
    <section>
      <h2>Said one thing, did another</h2>
      <p className="sub">
        {lies.length} times a coin promised to cooperate, then defected on a coin that kept its word. Talk is free. The move is what the chain settles.
      </p>
      <div className="lies">
        {shown.map((l) => (
          <Link key={`${l.parley}${l.liar}`} to={`/parley/${l.parley}`} className="card pad lie">
            <div className="who">
              {l.liar} to {l.victim}
            </div>
            <p className="quote">“{l.said}”</p>
            {l.thought && <p className="aside">{l.thought}</p>}
            <div className="then">
              <span className="chip d">DEFECT</span> <span className="num pos">+{near(l.took)} NEAR</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
