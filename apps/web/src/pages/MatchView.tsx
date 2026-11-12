import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Rematch } from "../components/Challenge.tsx";
import { ShareButton, matchShareLine } from "../components/Share.tsx";
import { type Fighter, Stage } from "../components/Stage.tsx";
import { clock } from "../components/ArenaNow.tsx";
import { ArrowIcon } from "../components/icons.tsx";
import { useCalls } from "../lib/calls.ts";
import { type Match } from "../lib/model.ts";
import { loadLiveMatch, useArenaInfo, useLiveMatch, useSchedule } from "../lib/live.ts";
import { reads } from "../lib/near.ts";
import { useSeason } from "../lib/season.ts";
import { useWallet } from "../lib/wallet.tsx";
import type { Coin } from "@parley/sdk/src/types.ts";

function SeasonMatch({ id }: { id: number }) {
  const season = useSeason();
  if (!season) return <p className="muted">Loading…</p>;
  const index = season.matches.findIndex((m) => m.id === id);
  const match = season.matches[index];
  if (!match) return <p className="muted">No such match in Season 1.</p>;
  const fighter = (cid: string): Fighter => {
    const c = season.coin(cid);
    return { id: cid, name: c?.name ?? cid.toUpperCase(), rules: c?.rules ?? "", before: season.treasuryBefore(cid, match.id) };
  };
  const prev = season.matches[index - 1];
  const next = season.matches[index + 1];
  return (
    <>
      <div className="crumbs">
        <Link to="/matches">Matches</Link> / Season 1 / match {match.id}
      </div>
      <Stage key={match.id} match={match} a={fighter(match.a)} b={fighter(match.b)} label={`Season 1 · match ${match.id}`} callKey={`season:${match.id}`} callCounts={false} />
      <div className="after-stage">
        <p className="hint-line">
          Tap <b>Verified</b> under any message to check its signature yourself.
        </p>
        <ShareButton path={`/season/match/${match.id}`} text={matchShareLine(match, (cid) => season.coin(cid)?.name ?? cid.toUpperCase(), () => false)} />
      </div>
      <div className="pager">
        {prev ? <Link to={`/season/match/${prev.id}`}>← match {prev.id}</Link> : <span />}
        {next ? (
          <Link to={`/season/match/${next.id}`}>
            match {next.id} <ArrowIcon size={14} />
          </Link>
        ) : (
          <span />
        )}
      </div>
    </>
  );
}

function LiveMatch({ id }: { id: number }) {
  const { info, ready } = useArenaInfo();
  const [match, setMatch] = useState<Match | null>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [later, setLater] = useState<Map<string, bigint>>(new Map());
  const stream = useLiveMatch((p) => p.id === id);
  const w = useWallet();
  const { schedule, skew } = useSchedule(5000);
  const calls = useCalls();
  const openedLive = useRef<boolean | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!info) return;
    let live = true;
    const fetchMatch = () => loadLiveMatch(info, id).then((m) => live && setMatch(m), () => live && setTimeout(fetchMatch, 4000));
    fetchMatch();
    reads.coins(info).then((c) => live && setCoins(c), () => {});
    reads.recent(info).then((ps) => {
      const sums = new Map<string, bigint>();
      for (const p of ps) {
        if (p.id < id || p.status !== "Settled") continue;
        sums.set(p.a, (sums.get(p.a) ?? 0n) + BigInt(p.a_delta));
        sums.set(p.b, (sums.get(p.b) ?? 0n) + BigInt(p.b_delta));
      }
      if (live) setLater(sums);
    }, () => {});
    return () => {
      live = false;
    };
  }, [info, id]);
  const shown = stream.match ?? match;
  if (shown && openedLive.current === null) openedLive.current = !shown.settled && !shown.void;
  if (!ready) return <p className="muted loading-line">Connecting…</p>;
  if (!info) return <p className="muted loading-line">The live arena is offline right now.</p>;
  if (!shown) return <p className="muted">Loading match {id}…</p>;
  const nameOf = (cid: string) => coins.find((x) => x.id === cid)?.name ?? cid.toUpperCase();
  const own = (cid: string) => !!w.accountId && coins.find((x) => x.id === cid)?.creator === w.accountId;
  const mine = shown.settled ? [shown.a, shown.b].find(own) : undefined;
  const fighter = (cid: string): Fighter => {
    const c = coins.find((x) => x.id === cid);
    const now = BigInt(c?.treasury ?? "0");
    return { id: cid, name: c?.name ?? cid.toUpperCase(), rules: c?.constitution ?? "", before: (now - (later.get(cid) ?? 0n)).toString() };
  };
  const callKey = `live:${info.contractId}:${shown.id}`;
  const next = schedule && !schedule.current && schedule.next ? schedule.next : null;
  const wait = next ? Math.max(0, Math.round((next.at + skew - now) / 1000)) : 0;
  return (
    <>
      <div className="crumbs">
        <Link to="/matches">Matches</Link> / match {shown.id}
      </div>
      <Stage
        key={shown.id}
        match={shown}
        a={fighter(shown.a)}
        b={fighter(shown.b)}
        live={!shown.settled || !!stream.match}
        autoplay={!shown.settled}
        label={`Match ${shown.id}`}
        explorer={info.explorerTx ?? null}
        callKey={openedLive.current || calls.matches[callKey] ? callKey : undefined}
      />
      <div className="after-stage">
        {shown.lines.some((l) => l.proof) && (
          <p className="hint-line">
            Tap <b>Verified</b> under any message to check its signature yourself.
          </p>
        )}
        {mine && <Rematch key={shown.id} mine={mine} rival={mine === shown.a ? shown.b : shown.a} name={nameOf} />}
        {shown.settled && <ShareButton path={`/match/${shown.id}`} text={matchShareLine(shown, nameOf, own)} />}
      </div>
      {(shown.settled || shown.void) && schedule?.current && schedule.current.id !== shown.id && (
        <Link to={`/match/${schedule.current.id}`} className="next-live">
          <span className="live-tag">Live</span>
          <span>
            Now playing: <b>{nameOf(schedule.current.a)}</b> vs <b>{nameOf(schedule.current.b)}</b>
          </span>
          <ArrowIcon size={16} />
        </Link>
      )}
      {(shown.settled || shown.void) && next && (
        <div className="next-live">
          <span className="next-when">{wait > 0 ? `In ${clock(wait)}` : "Starting"}</span>
          <span>
            Up next: <b>{nameOf(next.a)}</b> vs <b>{nameOf(next.b)}</b>
          </span>
        </div>
      )}
    </>
  );
}

export function MatchView({ season = false }: { season?: boolean }) {
  const id = Number(useParams().id);
  return season ? <SeasonMatch id={id} /> : <LiveMatch id={id} />;
}
