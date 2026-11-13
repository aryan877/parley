import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCalls } from "../lib/calls.ts";
import { liveFighters, loadLiveMatch, useArenaInfo, useLiveArena, useLiveMatch, useSchedule } from "../lib/live.ts";
import { type Match, coinName } from "../lib/model.ts";
import { clock, msOf, shortAgo, useNow } from "../lib/time.ts";
import { ArrowIcon } from "./icons.tsx";
import { Stage } from "./Stage.tsx";
import "./NowStage.css";

/** The match playing now, live. Between matches, a replay of the last one until the next one opens. */
export function NowStage() {
  const { info } = useArenaInfo();
  const { coins, parleys } = useLiveArena(10_000);
  const stream = useLiveMatch();
  const { schedule, skew } = useSchedule();
  const calls = useCalls();
  const now = useNow();
  const last = parleys.find((p) => p.status === "Settled");
  const [replay, setReplay] = useState<Match | null>(null);
  const [seen, setSeen] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!info || !last) return;
    let live = true;
    loadLiveMatch(info, last.id).then((m) => live && m?.settled && setReplay(m), () => {});
    return () => {
      live = false;
    };
  }, [info, last?.id]);

  useEffect(() => {
    const el = box.current;
    if (!el || !replay) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setSeen((n) => n + 1);
        watch.disconnect();
      },
      { threshold: 0.4 },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [replay?.id]);

  const live = stream.match;
  if (!info || (!live && !info.overview.parleys)) return null;
  const name = coinName(coins);
  const next = schedule?.next;
  const wait = next ? Math.max(0, Math.round((next.at + skew - now) / 1000)) : 0;
  const elsewhere = schedule?.current && schedule.current.id !== live?.id ? schedule.current : null;
  const played = replay && parleys.find((p) => p.id === replay.id)?.opened_at;
  const keyOf = (m: Match) => `live:${info.contractId}:${m.id}`;
  const fighters = (m: Match) => {
    const fighter = liveFighters(coins, parleys, m.id);
    return { a: fighter(m.a), b: fighter(m.b) };
  };

  const upcoming = elsewhere ? (
    <Link to={`/match/${elsewhere.id}`} className="now-stage-go">
      <span className="live-tag">Live</span>
      {name(elsewhere.a)} vs {name(elsewhere.b)} is playing now <ArrowIcon size={14} />
    </Link>
  ) : next ? (
    <span>{wait > 0 ? <>Next live match in <b>{clock(wait)}</b></> : "Next live match is starting"}</span>
  ) : (
    <span>{schedule?.autoplay ? "Next live match in a moment" : "Live matches start when someone launches or challenges a coin"}</span>
  );

  return (
    <div className="now-stage" ref={box}>
      <div className="now-stage-line">
        {live && !live.settled ? (
          <span>Playing live. Each message shows up once the chain accepts it.</span>
        ) : live ? (
          <span>
            <Link to={`/match/${live.id}`}>Match #{live.id}</Link> just finished.
          </span>
        ) : replay ? (
          <span>
            Replay of <Link to={`/match/${replay.id}`}>match #{replay.id}</Link>
            {played ? `, played ${shortAgo(msOf(played), now)}` : ""}
          </span>
        ) : (
          <span />
        )}
        {(!live || live.settled) && upcoming}
      </div>
      {coins && live ? (
        <Stage key={`live-${live.id}`} match={live} {...fighters(live)} live autoplay={!live.settled} explorer={info.explorerTx ?? null} callKey={keyOf(live)} />
      ) : coins && replay ? (
        <Stage key={`replay-${replay.id}-${seen}`} match={replay} {...fighters(replay)} explorer={info.explorerTx ?? null} callKey={calls.matches[keyOf(replay)] ? keyOf(replay) : undefined} />
      ) : (
        <div className="surface now-stage-wait" />
      )}
    </div>
  );
}
