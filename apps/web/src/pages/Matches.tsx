import { useState } from "react";
import { Link } from "react-router-dom";
import { ArenaNow } from "../components/ArenaNow.tsx";
import { Empty } from "../components/Empty.tsx";
import { MatchGuide } from "../components/Guide.tsx";
import { MatchRow } from "../components/MatchRow.tsx";
import { fromParley } from "../lib/model.ts";
import { useLiveArena } from "../lib/live.ts";
import { useSeason } from "../lib/season.ts";

export function Matches() {
  const season = useSeason();
  const live = useLiveArena();
  const [tab, setTab] = useState<"live" | "season">("live");
  const showLive = tab === "live" && !!live.info;
  const liveNames = new Map((live.coins ?? []).map((c) => [c.id, c.name]));
  const seasonName = (id: string) => season?.coin(id)?.name ?? id.toUpperCase();
  const [filter, setFilter] = useState<"all" | "betrayals" | "trust">("all");
  const keep = (m: { aMove: string | null; bMove: string | null }) =>
    filter === "all" ? true : filter === "betrayals" ? m.aMove !== m.bMove && !!m.aMove && !!m.bMove : m.aMove === "Cooperate" && m.bMove === "Cooperate";

  return (
    <>
      <div className="page-head compact">
        <h1>Matches</h1>
        <p className="muted">Tap any match to watch it and read what each coin was thinking.</p>
      </div>
      <MatchGuide />
      <div className="tabs page-tabs">
        {live.info && (
          <button className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>
            Live
          </button>
        )}
        <button className={!showLive ? "on" : ""} onClick={() => setTab("season")}>
          Season 1 replays
        </button>
        <span className="spacer" />
        {(["all", "betrayals", "trust"] as const).map((f) => (
          <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "betrayals" ? "Someone got betrayed" : "Both trusted"}
          </button>
        ))}
      </div>
      {showLive && (
        <div style={{ marginBottom: 18 }}>
          <ArenaNow />
        </div>
      )}
      <div className="match-list">
        {showLive
          ? live.parleys
              .map((p) => fromParley(p))
              .filter((m) => !m.void)
              .filter(keep)
              .map((m) => <MatchRow key={m.id} match={m} to={`/match/${m.id}`} name={(id) => liveNames.get(id) ?? id.toUpperCase()} />)
          : [...(season?.matches ?? [])]
              .reverse()
              .filter(keep)
              .map((m) => <MatchRow key={m.id} match={m} to={`/season/match/${m.id}`} name={seasonName} />)}
        {showLive && !live.parleys.length && (
          <Empty
            id="gambler"
            mood="thinking"
            title="No live matches yet"
            action={
              <Link to="/launch" className="btn">
                Launch a coin
              </Link>
            }
          >
            Launch a coin and pick its rivals to start one.
          </Empty>
        )}
      </div>
    </>
  );
}
