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
const clock = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

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
  const pause = schedule.pauseMs >= 90_000 ? `about ${Math.round(schedule.pauseMs / 60_000)} min` : `about ${Math.round(schedule.pauseMs / 1000)}s`;
  const soon = next?.why === "challenge" ? "a few seconds" : pause;
  const rest = info ? Math.round(Number(info.config.rest_ns) / 1e9) : 20;
  const auto = schedule.autoplay;
  const when = !next
    ? auto
      ? "Coins are resting. The next match starts in a moment."
      : "Matches start when someone launches a coin or challenges one."
    : current
      ? `Right after this match (${soon} later)`
      : wait && wait > 0
        ? `Starts in ${clock(wait)}`
        : "Starting now";
  const breakNote = schedule.pauseMs >= 60_000 ? `There is a break of ${pause} between matches.` : `Coins rest ${rest} seconds between matches.`;

  return (
    <div className="arena-now">
      <div className="now-col">
        <div className="now-label">
          {current && <span className="live-tag">Live</span>} Now playing
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
          <div className="now-idle">
            <Mascot id="pavlov" size={44} mood="idle" />
            <p className="muted">{auto || next ? (wait && wait > 45 ? `Between matches. The next one starts in ${clock(wait)}.` : "Between matches. The next one starts in a moment.") : "Nothing is playing right now."}</p>
          </div>
        )}
      </div>

      <div className="now-col">
        <div className="now-label">Up next</div>
        {next ? (
          <>
            <Pair a={next.a} b={next.b} name={name} />
            <p className="now-when">{when}</p>
            <p className="faint small">{next.why === "challenge" ? "A new coin, meeting a rival it picked." : "Picked by the arena's rule, not by a person."}</p>
          </>
        ) : (
          <>
            <p className={auto ? "muted" : "now-when calm"}>{when}</p>
            {!auto && (
              <Link to="/launch" className="btn ghost small-btn">
                Launch a coin <ArrowIcon size={16} />
              </Link>
            )}
          </>
        )}
        {queue.length > 1 && (
          <p className="faint small" style={{ marginTop: 6 }}>
            Then {queue.slice(1, 4).map((q) => `${name(q.a)} vs ${name(q.b)}`).join(", ")}
          </p>
        )}
      </div>

      <div className="now-col rule">
        <div className="now-label">How matches are picked</div>
        {auto ? (
          <>
            <p>
              <b>One match at a time, all day.</b> The coin that has waited longest plays next, against the coin it met least recently.
            </p>
            <p className="faint small">{breakNote} A new coin also picks up to three rivals when it launches, and those go first.</p>
          </>
        ) : (
          <>
            <p>
              <b>One match at a time.</b> A new coin picks up to three rivals when it launches.
            </p>
            <p className="faint small">Its matches join the line and play in order.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Where the given coins stand in the arena's line, refreshed every few seconds. */
export function YourMatches({ coins, name, watch = true, title }: { coins: string[]; name: (id: string) => string; watch?: boolean; title?: string }) {
  const { schedule } = useSchedule(4000);
  if (!schedule) return null;
  const line = [...(schedule.current ? [schedule.current] : []), ...schedule.queue];
  const mine = line.map((m, place) => ({ ...m, place: schedule.current ? place : place + 1 })).filter((m) => coins.includes(m.a) || coins.includes(m.b));
  if (!mine.length) return null;
  return (
    <div className="your-line">
      <div className="your-head">
        <b>{title ?? (mine.length === 1 ? "Your next match" : "Your next matches")}</b>
        <span>One match plays at a time. This updates by itself.</span>
      </div>
      {mine.map((m) => {
        const me = coins.includes(m.a) ? m.a : m.b;
        const rival = me === m.a ? m.b : m.a;
        const now = m.place === 0;
        return (
          <div key={`${m.a}-${m.b}-${m.place}`} className={`your-match ${now ? "now" : ""}`}>
            <span className="your-pair">
              <Mascot id={me} size={38} mood={now ? "thinking" : "idle"} />
              <Mascot id={rival} size={38} mood={now ? "thinking" : "idle"} />
            </span>
            <span className="your-names">
              <b>{name(me)}</b> vs <b>{name(rival)}</b>
            </span>
            <em>{now ? <span className="live-tag">Live</span> : null}{now ? "Playing now" : m.place === 1 ? "Next up" : `${m.place - 1} ${m.place === 2 ? "match" : "matches"} before it`}</em>
            {now && watch && schedule.current && (
              <Link to={`/match/${schedule.current.id}`} className="btn small-btn">
                Watch <ArrowIcon size={14} />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
