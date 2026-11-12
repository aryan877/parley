import type { Parley } from "@parley/sdk/src/types.ts";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArenaNow } from "../components/ArenaNow.tsx";
import { Empty } from "../components/Empty.tsx";
import { MatchRow } from "../components/MatchRow.tsx";
import { fromParley } from "../lib/model.ts";
import { useLiveArena } from "../lib/live.ts";
import { parleysBefore } from "../lib/near.ts";
import { useSeason } from "../lib/season.ts";

export function Matches() {
  const season = useSeason();
  const live = useLiveArena();
  const [tab, setTab] = useState<"live" | "season">("live");
  const showLive = tab === "live" && !!live.info;
  const liveNames = new Map((live.coins ?? []).map((c) => [c.id, c.name]));
  const seasonName = (id: string) => season?.coin(id)?.name ?? id.toUpperCase();
  const [filter, setFilter] = useState<"all" | "betrayals" | "trust">("all");
  const [older, setOlder] = useState<Parley[]>([]);
  const [paging, setPaging] = useState(false);
  const byId = new Map<number, Parley>();
  for (const p of [...older, ...live.parleys]) byId.set(p.id, p);
  const liveList = [...byId.values()].sort((x, y) => y.id - x.id);
  const oldest = liveList.at(-1)?.id ?? 0;
  const loadOlder = async () => {
    if (!live.info || paging || !live.parleys.length) return;
    setPaging(true);
    const page = await parleysBefore(live.info, oldest, live.parleys[0]!.id).catch(() => []);
    setOlder((o) => [...o, ...page]);
    setPaging(false);
  };
  const keep = (m: { aMove: string | null; bMove: string | null }) =>
    filter === "all" ? true : filter === "betrayals" ? m.aMove !== m.bMove && !!m.aMove && !!m.bMove : m.aMove === "Cooperate" && m.bMove === "Cooperate";

  return (
    <>
      <div className="page-head compact">
        <h1>Matches</h1>
        <p className="muted">Tap any match to watch it and read what each coin was thinking.</p>
      </div>
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
          ? liveList
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
      {showLive && oldest > 0 && (
        <div className="more-row">
          <button className="btn ghost" disabled={paging} onClick={loadOlder}>
            {paging ? "Loading…" : "Show older matches"}
          </button>
        </div>
      )}
    </>
  );
}
