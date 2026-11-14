import type { Amendment, Coin, Parley } from "@parley/sdk/src/types.ts";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { sendChallenge } from "../lib/arena.ts";
import { useLiveArena } from "../lib/live.ts";
import { coinName, fmtNear, fromParley } from "../lib/model.ts";
import { reads, view } from "../lib/near.ts";
import { useOpenAt } from "../lib/reveal.ts";
import { clock, minutes, msOf, useNow } from "../lib/time.ts";
import { shortAccount, useWallet } from "../lib/wallet.tsx";
import { headline } from "../lib/words.ts";
import { YourMatches } from "./ArenaNow.tsx";
import { Mascot } from "./Mascot.tsx";
import { SaintStory } from "./SaintStory.tsx";
import { ArrowIcon, WalletIcon } from "./icons.tsx";
import "./JudgeSeat.css";

const SEAT = "parley.judge";
const RIVALS = ["snake", "saint", "mirror", "grudge", "diplomat", "pavlov", "skeptic", "gambler"];
const listeners = new Set<() => void>();

function readSeat(): boolean {
  try {
    return localStorage.getItem(SEAT) === "1";
  } catch {
    return false;
  }
}

let seated = readSeat();

function setSeated(next: boolean) {
  seated = next;
  try {
    if (next) localStorage.setItem(SEAT, "1");
    else localStorage.removeItem(SEAT);
  } catch {}
  for (const l of listeners) l();
}

const useSeated = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => seated,
  );

const minuteLong = (ns: string | undefined, fallback: number) => `${ns ? Math.round(Number(BigInt(ns) / 1_000_000_000n) / 60) : fallback}-minute`;
const left = (ms: number) => clock(Math.max(0, Math.ceil(ms / 1000)));

type Step = "wallet" | "launch" | "amend" | "watch" | "done";

type Phase =
  | { kind: "voting"; ends: number; short: boolean }
  | { kind: "counting" }
  | { kind: "waiting"; ends: number }
  | { kind: "enacting" };

function phaseOf(a: Amendment, now: number, quorum: bigint): Phase {
  if (a.status === "Voting") return now < msOf(a.ends_at) ? { kind: "voting", ends: msOf(a.ends_at), short: BigInt(a.yes) < quorum || BigInt(a.yes) <= BigInt(a.no) } : { kind: "counting" };
  return now < msOf(a.enact_after) ? { kind: "waiting", ends: msOf(a.enact_after) } : { kind: "enacting" };
}

/** Where the visitor is in the walkthrough, read from the chain: their wallet, their newest coin, its open vote and its matches. */
function useJudge() {
  const w = useWallet();
  const { info, coins, parleys } = useLiveArena(5000);
  const account = w.accountId;
  const coin = account && coins ? ([...coins].filter((c) => c.creator === account).sort((x, y) => (BigInt(y.created_at) > BigInt(x.created_at) ? 1 : -1))[0] ?? null) : null;
  const coinId = coin?.id;
  const version = coin?.constitution_version ?? 0;
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [dropped, setDropped] = useState(false);
  const seen = useRef(new Map<number, number>());

  useEffect(() => {
    setAmendments([]);
    setDropped(false);
    seen.current.clear();
    if (!info || !coinId) return;
    let live = true;
    const load = () =>
      reads.amendments(info, coinId).then(
        async (list) => {
          if (!live) return;
          setAmendments(list);
          const open = new Set(list.map((a) => a.id));
          const gone = [...seen.current].filter(([id]) => !open.has(id));
          for (const a of list) seen.current.set(a.id, a.base_version);
          if (!gone.length) return;
          for (const [id] of gone) seen.current.delete(id);
          const fresh = await view<Coin | null>(info, "get_coin", { coin: coinId }).catch(() => null);
          if (live && fresh && gone.some(([, base]) => fresh.constitution_version <= base)) setDropped(true);
        },
        () => {},
      );
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [info, coinId]);

  const amendment = amendments.find((a) => a.proposer === account) ?? amendments[0] ?? null;
  const underNew = coin && version >= 2 ? parleys.filter((p) => (p.a === coin.id && p.a_constitution_version === version) || (p.b === coin.id && p.b_constitution_version === version)) : [];
  const match: Parley | null = underNew.find((p) => p.status === "Settled") ?? underNew.find((p) => p.status === "Open") ?? null;
  const step: Step = !account ? "wallet" : !coin ? "launch" : version < 2 ? "amend" : match?.status !== "Settled" ? "watch" : "done";
  const quorum = coin && info ? (BigInt(coin.total_shares) * BigInt(info.config.quorum_bps)) / 10_000n : 0n;
  return { info, coins, ready: !!info && (!account || !!coins), account, coin, version, amendment, dropped: dropped && !amendment, match, step, quorum };
}

type Judge = ReturnType<typeof useJudge>;

function Countdown({ phase, amendment, now, vote, wait }: { phase: Phase; amendment: Amendment; now: number; vote: number; wait: number }) {
  const total = vote + wait;
  const voteEnds = msOf(amendment.ends_at);
  const start = voteEnds - vote;
  const done = phase.kind === "voting" ? now - start : phase.kind === "counting" ? vote : phase.kind === "waiting" ? vote + (wait - (phase.ends - now)) : total;
  const pct = Math.max(0, Math.min(100, (done / total) * 100));
  return (
    <div className="judge-clock">
      <div className="judge-clock-top">
        <span>{phase.kind === "voting" ? "Vote closes in" : phase.kind === "waiting" ? "Safety wait ends in" : phase.kind === "counting" ? "Vote closed" : "Wait is over"}</span>
        <b>{phase.kind === "voting" || phase.kind === "waiting" ? left(phase.ends - now) : phase.kind === "counting" ? "Counting" : "Going in"}</b>
      </div>
      <div className="judge-bar" role="img" aria-label={`${Math.round(pct)}% of the way to the new rules`}>
        <i style={{ width: `${pct}%` }} />
        <span style={{ left: `${(vote / total) * 100}%` }} />
      </div>
      <div className="judge-bar-labels">
        <span style={{ width: `${(vote / total) * 100}%` }}>Vote</span>
        <span>Safety wait</span>
      </div>
    </div>
  );
}

function Challenger({ coin, name, coins }: { coin: Coin; name: (id: string) => string; coins: Coin[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<{ rival: string; ahead: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = RIVALS.filter((id) => coins.some((c) => c.id === id && c.creator !== coin.creator));
  const rivals = open.slice(0, 3);
  const send = async (first: string) => {
    setBusy(first);
    setError(null);
    let last = "";
    for (const rival of [first, ...open.filter((id) => id !== first)]) {
      try {
        setSent({ rival, ahead: await sendChallenge(coin.id, [rival]) });
        setBusy(null);
        return;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        if (!last.includes(`${name(rival)} has used its`)) break;
      }
    }
    setError(last);
    setBusy(null);
  };
  if (!rivals.length) return null;
  return (
    <>
      <p>Send it in now instead of waiting its turn. Pick who it meets:</p>
      <div className="judge-actions rivals">
        {rivals.map((r) => (
          <button key={r} className="btn ghost small-btn" disabled={!!busy || !!sent} onClick={() => send(r)}>
            <Mascot id={r} size={22} /> {busy === r ? "Sending…" : name(r)}
          </button>
        ))}
      </div>
      {sent && (
        <div className="notice good">
          Sent. {coin.name} meets {name(sent.rival)} live. {sent.ahead === 0 ? "It plays next." : `${sent.ahead} ${sent.ahead === 1 ? "match plays" : "matches play"} before it.`}
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}
    </>
  );
}

function Steps({ j }: { j: Judge }) {
  const w = useWallet();
  const openAt = useOpenAt();
  const now = useNow(!!j.amendment);
  const { info, coin, amendment, match, version } = j;
  const name = coinName(j.coins);
  const saint = j.coins?.find((c) => c.id === "saint");
  const voteMs = info ? msOf(info.config.vote_period_ns) : 120_000;
  const waitMs = info ? msOf(info.config.timelock_ns) : 240_000;
  const vote = minutes(info?.config.vote_period_ns, 2);
  const waitLong = minuteLong(info?.config.timelock_ns, 4);
  const phase = amendment ? phaseOf(amendment, now, j.quorum) : null;
  const order: Step[] = ["wallet", "launch", "amend", "watch"];
  const at = j.step === "done" ? order.length : order.indexOf(j.step);

  const steps: { id: Step; title: string; teaser: string; body: ReactNode }[] = [
    {
      id: "wallet",
      title: "Get a free play wallet",
      teaser: "One tap, free test NEAR, no sign-up.",
      body: j.account ? (
        <p>
          You're in as <b>{shortAccount(j.account)}</b>
          {w.balance ? ` with ${fmtNear(w.balance)} NEAR` : ""}.
        </p>
      ) : (
        <>
          <p>One tap makes a wallet with free test NEAR. No sign-up, and its key stays in this browser.</p>
          <div className="judge-actions">
            <button className="btn" disabled={w.busy || !info} onClick={() => w.connectPlay()}>
              <WalletIcon size={16} /> {w.busy ? "Making it…" : "Get a free play wallet"}
            </button>
            {w.nearReady && (
              <button className="btn ghost" onClick={() => w.setOpen(true)}>
                Use my NEAR wallet
              </button>
            )}
          </div>
          {w.error && <div className="notice bad">{w.error}</div>}
        </>
      ),
    },
    {
      id: "launch",
      title: "Launch a coin",
      teaser: "Its AI follows rules you write. You hold all its shares.",
      body: coin ? (
        <div className="judge-coin">
          <Mascot id={coin.id} size={44} mood="win" />
          <p>
            <b>{coin.name}</b> is live. You launched it, so you hold its shares and your vote decides its rules.{" "}
            <Link to={`/coin/${coin.id}`} className="judge-link">
              Open its page
            </Link>
          </p>
        </div>
      ) : (
        <>
          <p>Pick a face, tap together its rules, choose rivals, launch. You get all its shares, so your vote alone can change its rules.</p>
          <div className="judge-actions">
            <Link to="/launch" className="btn">
              Launch a coin <ArrowIcon size={16} />
            </Link>
          </div>
        </>
      ),
    },
    {
      id: "amend",
      title: "Change its rules",
      teaser: `Holders vote for ${vote}, then a ${waitLong} safety wait.`,
      body:
        coin && version >= 2 ? (
          <>
            <p>Rules version {version} is in force. Its AI reads them from its next match on.</p>
            <div className="judge-actions">
              <button className="btn ghost small-btn" onClick={() => openAt(`/coin/${coin.id}`, "#rules-history")}>
                See what changed
              </button>
            </div>
          </>
        ) : coin && amendment && phase ? (
          <>
            <Countdown phase={phase} amendment={amendment} now={now} vote={voteMs} wait={waitMs} />
            <p>
              {phase.kind === "voting"
                ? phase.short
                  ? "It needs more yes votes to pass. Open its rules and vote yes with all your shares."
                  : "You hold the shares, so your yes carries it. Holders have until the clock runs out."
                : phase.kind === "counting"
                  ? "The arena closes the vote within about a minute."
                  : phase.kind === "waiting"
                    ? "It passed. This wait lets any holder who disagrees sell before the new rules play."
                    : coin.in_match !== null
                      ? "It goes in force as soon as its current match ends."
                      : "The arena puts it in force within about a minute."}
            </p>
            {phase.kind === "voting" && phase.short && (
              <div className="judge-actions">
                <button className="btn small-btn" onClick={() => openAt(`/coin/${coin.id}`, ".rules-card")}>
                  Open its rules
                </button>
              </div>
            )}
            {info && saint && <SaintStory info={info} saint={saint} coins={j.coins ?? []} />}
          </>
        ) : coin ? (
          <>
            <p>
              On its page, press <b>Propose new rules</b>, change something, then press <b>Propose and vote yes</b>.
            </p>
            <p className="judge-note">
              Holders vote for {vote}. If it passes, a {waitLong} safety wait lets anyone who disagrees sell first. Then the new rules go in force.
            </p>
            <p className="judge-note">Tip: change how it treats betrayers, then send it against SNAKE, which always betrays.</p>
            {j.dropped && <div className="notice bad">Your last proposal did not pass. Propose again; it votes yes with all your shares.</div>}
            <div className="judge-actions">
              <button className="btn" onClick={() => openAt(`/coin/${coin.id}`, ".rules-card")}>
                Open its rules <ArrowIcon size={16} />
              </button>
            </div>
          </>
        ) : null,
    },
    {
      id: "watch",
      title: "Watch it play by the new rules",
      teaser: "Its next match reads the new rules, word for word.",
      body:
        coin && match?.status === "Settled" ? (
          <>
            <p>
              It played match #{match.id} under rules version {version}. {headline(fromParley(match), name)}
            </p>
            <div className="judge-actions">
              <Link to={`/match/${match.id}`} className="btn">
                Watch the match <ArrowIcon size={16} />
              </Link>
            </div>
          </>
        ) : coin && match ? (
          <>
            <p>
              <span className="live-tag">Live</span> {name(match.a)} and {name(match.b)} are playing now, with {coin.name} on rules version {version}.
            </p>
            <div className="judge-actions">
              <Link to={`/match/${match.id}`} className="btn">
                Watch it live <ArrowIcon size={16} />
              </Link>
            </div>
          </>
        ) : coin && j.coins ? (
          <>
            <YourMatches coins={[coin.id]} name={name} title={`Next up for ${coin.name}`} />
            <Challenger coin={coin} name={name} coins={j.coins} />
          </>
        ) : null,
    },
  ];

  return (
    <ol className="judge-steps">
      {steps.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "later";
        return (
          <li key={s.id} className={`glass judge-step ${state}`}>
            <div className="judge-step-top">
              <h2>{s.title}</h2>
              {state === "done" && <span className="judge-done">Done</span>}
            </div>
            {state === "later" ? <p className="judge-teaser">{s.teaser}</p> : <div className="judge-body">{s.body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** A guided walk through the whole mechanic that ticks itself off from what the chain shows. */
export function JudgeSeat() {
  const navigate = useNavigate();
  const j = useJudge();
  useEffect(() => setSeated(true), []);
  return (
    <div className="judge">
      <div className="page-head compact">
        <h1>Judge seat</h1>
        <p className="muted">The whole game in about ten minutes. Each step ticks itself off when it happens on chain.</p>
      </div>
      {!j.info ? (
        <p className="muted loading-line">Connecting to the live arena…</p>
      ) : !j.ready ? (
        <p className="muted loading-line">Reading your wallet and coins…</p>
      ) : (
        <Steps j={j} />
      )}
      {j.step === "done" && (
        <div className="judge-end">
          <h2>That's the whole game</h2>
          <p>Holders changed one paragraph, and the coin played differently. Nobody touched its money, and the contract checked every signed reply before it paid out.</p>
          <div className="judge-actions">
            <Link to="/proof" className="btn ghost">
              Check the signatures yourself
            </Link>
          </div>
        </div>
      )}
      <button
        className="link-btn judge-leave"
        onClick={() => {
          setSeated(false);
          navigate("/");
        }}
      >
        Leave the judge seat
      </button>
    </div>
  );
}

function Dock() {
  const j = useJudge();
  const now = useNow(!!j.amendment && j.step === "amend");
  useEffect(() => {
    document.body.classList.add("judge-docked");
    return () => document.body.classList.remove("judge-docked");
  }, []);
  const phase = j.amendment ? phaseOf(j.amendment, now, j.quorum) : null;
  const line =
    !j.ready
      ? "Your walkthrough"
      : j.step === "wallet"
        ? "Next: get a free play wallet"
        : j.step === "launch"
          ? "Next: launch a coin"
          : j.step === "amend"
            ? phase?.kind === "voting"
              ? `Vote closes in ${left(phase.ends - now)}`
              : phase?.kind === "waiting"
                ? `Safety wait: ${left(phase.ends - now)}`
                : phase
                  ? "New rules going in force"
                  : "Next: change its rules"
            : j.step === "watch"
              ? j.match
                ? "Its match is playing now"
                : "Next: watch it play by the new rules"
              : "All done";
  return (
    <div className="judge-dock" role="complementary" aria-label="Judge seat">
      <Link to="/judge" className="judge-dock-main">
        <small>Judge seat</small>
        <b>{line}</b>
      </Link>
      <Link to="/judge" className="btn small-btn">
        Open
      </Link>
      <button className="judge-dock-x" aria-label="Leave the judge seat" onClick={() => setSeated(false)}>
        ×
      </button>
    </div>
  );
}

/** Seats a visitor who arrives with ?judge, and keeps a small way back to the walkthrough on every other page. */
export function JudgeDock() {
  const on = useSeated();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const outer = new URLSearchParams(window.location.search);
    const inner = new URLSearchParams(search);
    if (!outer.has("judge") && !inner.has("judge")) return;
    setSeated(true);
    if (outer.has("judge")) {
      outer.delete("judge");
      const rest = outer.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    }
    navigate("/judge", { replace: true });
  }, []);
  if (!on || pathname === "/judge") return null;
  return <Dock />;
}
