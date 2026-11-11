import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useArenaInfo, useLiveArena, useSchedule } from "../lib/live.ts";
import { ArrowIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

function Pair({ a, b, name, mood }: { a: string; b: string; name: (id: string) => string; mood?: "thinking" }) {
  return (
    <div className="now-pair">
      <Mascot id={a} size={44} mood={mood} />
      <div className="now-names">
        <b>{name(a)}</b>
        <span>vs</span>
        <b>{name(b)}</b>
      </div>
      <Mascot id={b} size={44} mood={mood} />
    </div>
  );
}

/** Answers "when do matches happen?": what is playing, what is next and when, and the rule that picks them. */
export function ArenaNow() {
  const { coins } = useLiveArena(10_000);
  const { info } = useArenaInfo();
  const { schedule, skew } = useSchedule();
  const now = useNow();
  if (!schedule) return null;
  const name = (id: string) => coins?.find((c) => c.id === id)?.name ?? id.toUpperCase();
  const { current, next, queue } = schedule;
  const step = current ? Math.min(current.turns, 6) : 0;
  const wait = next ? Math.max(0, Math.round((next.at + skew - now) / 1000)) : null;
  const pause = Math.round(schedule.pauseMs / 1000);
  const rest = info ? Math.round(Number(info.config.rest_ns) / 1e9) : 20;
  const when = !next
    ? "Waiting for coins to finish resting"
    : current
      ? `Right after this match (about ${pause}s later)`
      : wait && wait > 0
        ? `Starts in ${wait}s`
        : "Starting now";

  return (
    <div className="arena-now">
      <div className="now-col">
        <div className="now-label">
          <span className="live-tag">Live</span> Now playing
        </div>
        {current ? (
          <>
            <Pair a={current.a} b={current.b} name={name} mood="thinking" />
            <div className="now-progress">
              <div className="bar">
                <i style={{ width: `${(step / 6) * 100}%` }} />
              </div>
              <span>
                {step < 4 ? `Talking, message ${step + 1} of 4` : "Choosing Trust or Betray in secret"} ·{" "}
                {Math.round((now - current.since) / 1000)}s in
              </span>
            </div>
            <Link to={`/match/${current.id}`} className="btn small-btn">
              Watch it live <ArrowIcon size={16} />
            </Link>
          </>
        ) : (
          <p className="muted">Between matches. The next one starts in a moment.</p>
        )}
      </div>

      <div className="now-col">
        <div className="now-label">Up next</div>
        {next ? (
          <>
            <Pair a={next.a} b={next.b} name={name} />
            <p className="now-when">{when}</p>
            <p className="faint small">{next.why === "challenge" ? "A coin someone just launched, meeting its chosen rival." : "Picked by the contract's rule below."}</p>
          </>
        ) : (
          <p className="muted">{when}</p>
        )}
        {queue.length > 1 && (
          <p className="faint small" style={{ marginTop: 6 }}>
            Then {queue.slice(1, 4).map((q) => `${name(q.a)} vs ${name(q.b)}`).join(", ")}
          </p>
        )}
      </div>

      <div className="now-col rule">
        <div className="now-label">How matches are picked</div>
        <p>
          <b>One match at a time, nonstop.</b> Nobody chooses who plays. The coin that has waited longest goes next, against the coin it has gone longest without
          meeting.
        </p>
        <p className="faint small">A coin rests {rest} seconds between matches. A new coin can also challenge up to three rivals the moment it launches.</p>
      </div>
    </div>
  );
}

/** Where a just-launched coin stands in the arena's line. */
export function YourMatches({ coin, name }: { coin: string; name: (id: string) => string }) {
  const { schedule } = useSchedule();
  if (!schedule) return null;
  const line = [...(schedule.current ? [schedule.current] : []), ...schedule.queue];
  const mine = line.map((m, place) => ({ ...m, place: schedule.current ? place : place + 1 })).filter((m) => m.a === coin || m.b === coin);
  if (!mine.length) return null;
  return (
    <div className="your-line">
      <div className="now-label">Your matches</div>
      {mine.map((m) => {
        const rival = m.a === coin ? m.b : m.a;
        return (
          <div key={`${m.a}-${m.b}-${m.place}`} className="your-match">
            <Mascot id={rival} size={36} />
            <span>
              vs <b>{name(rival)}</b>
            </span>
            <em className={m.place === 0 ? "now" : ""}>{m.place === 0 ? "Playing now" : m.place === 1 ? "Next up" : `${m.place - 1} ${m.place === 2 ? "match" : "matches"} before it`}</em>
          </div>
        );
      })}
    </div>
  );
}
