import type { Move } from "@parley/sdk/src/types.ts";
import { Link } from "react-router-dom";
import type { League } from "../lib/data.ts";
import { near, signedNear } from "../lib/data.ts";

export function MoveChip({ move }: { move: Move | null }) {
  if (!move) return null;
  return <span className={`chip ${move === "Cooperate" ? "c" : "d"}`}>{move === "Cooperate" ? "COOPERATE" : "DEFECT"}</span>;
}

export function Delta({ yocto }: { yocto: string }) {
  const v = BigInt(yocto);
  return <span className={`num ${v > 0n ? "pos" : v < 0n ? "neg" : ""}`}>{signedNear(yocto)}</span>;
}

export function nameOf(league: League, id: string) {
  return league.manifest.coins.find((c) => c.id === id)?.name ?? id.toUpperCase();
}

export function MatchRow({ league, index }: { league: League; index: number }) {
  const { parley } = league.evidence[index]!;
  return (
    <Link to={`/parley/${parley.id}`} className="match">
      <span className="id">#{parley.id}</span>
      <span className="side">
        <span className="coin">{nameOf(league, parley.a)}</span>
        <MoveChip move={parley.a_move} />
        <Delta yocto={parley.a_delta} />
      </span>
      <span className="vs">vs</span>
      <span className="side right">
        <Delta yocto={parley.b_delta} />
        <MoveChip move={parley.b_move} />
        <span className="coin">{nameOf(league, parley.b)}</span>
      </span>
      <span className="num stake" style={{ color: "var(--faint)" }}>
        {near(parley.stake)} at stake
      </span>
    </Link>
  );
}

export function Loading({ error }: { error?: string }) {
  return <p className="sub" style={{ marginTop: 64 }}>{error ? `Could not load the recorded league (${error}).` : "Loading the league…"}</p>;
}
