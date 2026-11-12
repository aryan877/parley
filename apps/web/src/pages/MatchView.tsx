import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Rematch } from "../components/Challenge.tsx";
import { ShareButton, matchShareLine } from "../components/Share.tsx";
import { type Fighter, Stage } from "../components/Stage.tsx";
import { ArrowIcon } from "../components/icons.tsx";
import { type Match } from "../lib/model.ts";
import { loadLiveMatch, readArena, useArenaInfo, useLiveMatch } from "../lib/live.ts";
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
      <Stage key={match.id} match={match} a={fighter(match.a)} b={fighter(match.b)} label={`Season 1 · match ${match.id}`} callKey={`season:${match.id}`} />
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
  useEffect(() => {
    if (!info) return;
    const arena = readArena(info);
    loadLiveMatch(info, id).then(setMatch);
    arena.coins().then(setCoins);
    arena.parleys(0, 50).then((ps) => {
      const sums = new Map<string, bigint>();
      for (const p of ps) {
        if (p.id < id || p.status !== "Settled") continue;
        sums.set(p.a, (sums.get(p.a) ?? 0n) + BigInt(p.a_delta));
        sums.set(p.b, (sums.get(p.b) ?? 0n) + BigInt(p.b_delta));
      }
      setLater(sums);
    });
  }, [info, id]);
  const shown = stream.match ?? match;
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
  return (
    <>
      <div className="crumbs">
        <Link to="/matches">Matches</Link> / live / match {shown.id}
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
        callKey={`live:${info.contractId}:${shown.id}`}
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
    </>
  );
}

export function MatchView({ season = false }: { season?: boolean }) {
  const id = Number(useParams().id);
  return season ? <SeasonMatch id={id} /> : <LiveMatch id={id} />;
}
