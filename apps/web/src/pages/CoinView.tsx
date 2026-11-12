import type { Amendment, Coin, Order } from "@parley/sdk/src/types.ts";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { YourMatches } from "../components/ArenaNow.tsx";
import { Sparkline } from "../components/CoinCard.tsx";
import { Empty } from "../components/Empty.tsx";
import { TradeGuide, VoteGuide } from "../components/Guide.tsx";
import { MatchRow } from "../components/MatchRow.tsx";
import { RuleBuilder } from "../components/RuleBuilder.tsx";
import { ShareButton } from "../components/Share.tsx";
import { Mascot, mascotColor } from "../components/Mascot.tsx";
import { BoltIcon, BrainIcon, RestartIcon, TrustIcon, BetrayIcon, WalletIcon } from "../components/icons.tsx";
import { type CoinInfo, type Match, fmtNear, fromCoin, fromParley, nearNumber, sharePrice, trustRate } from "../lib/model.ts";
import { ARENA_API, readArena, useArenaInfo } from "../lib/live.ts";
import { useSeason } from "../lib/season.ts";
import { useWallet } from "../lib/wallet.tsx";
import { BRAIN_LABEL, PRACTICE_NOTE, brainOf, tagline } from "../lib/words.ts";

const YOCTO = 10n ** 24n;

function toYocto(text: string): bigint | null {
  if (!/^\d*(\.\d*)?$/.test(text.trim()) || !text.trim()) return null;
  const [whole = "0", frac = ""] = text.trim().split(".");
  return BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

function until(ns: string): string {
  const s = Math.round((Number(BigInt(ns) / 1_000_000n) - Date.now()) / 1000);
  if (s <= 0) return "now";
  if (s < 90) return `in ${s}s`;
  if (s < 5400) return `in ${Math.round(s / 60)} min`;
  return `in ${Math.round(s / 3600)} h`;
}

function Hero({ coin, matches, live }: { coin: CoinInfo; matches: Match[]; live: boolean }) {
  const color = mascotColor(coin.id);
  const brain = brainOf(coin.model);
  let value = BigInt(coin.treasury) - matches.reduce((n, m) => n + BigInt(m.a === coin.id ? m.aDelta : m.bDelta), 0n);
  const curve = [nearNumber(value)];
  for (const m of matches) {
    value += BigInt(m.a === coin.id ? m.aDelta : m.bDelta);
    curve.push(nearNumber(value));
  }
  const first = curve[0] ?? 0;
  const last = curve.at(-1) ?? 0;
  const pct = first ? ((last - first) / first) * 100 : 0;
  return (
    <div className="coin-hero" style={{ "--c": color } as React.CSSProperties}>
      <div className="coin-hero-art">
        <div className="fighter-glow" />
        <Mascot id={coin.id} size={200} mood={pct > 0 ? "win" : pct < 0 ? "lose" : "idle"} />
      </div>
      <div className="coin-hero-text">
        <div className="chips">
          <span className={`brain ${brain === "deep" ? "deep" : ""}`} title={coin.model}>
            {brain === "deep" ? <BrainIcon size={13} /> : brain === "practice" ? <RestartIcon size={13} /> : <BoltIcon size={13} />} {BRAIN_LABEL[brain]}
            {brain !== "practice" && <span className="faint"> · {coin.model.split("/").pop()}</span>}
          </span>
          <span className="brain">{coin.house ? "House coin: rules never change" : `Owned by holders · rules version ${coin.version}`}</span>
          {coin.token && (
            <span className="brain" title={coin.token}>
              Shares are a NEAR token
            </span>
          )}
        </div>
        <h1>{coin.name}</h1>
        <p className="lead">{tagline(coin.id, coin.rules)}</p>
        {brain === "practice" && <p className="practice-note">{PRACTICE_NOTE}</p>}
        <div className="coin-stats">
          <div>
            <b>{live && !coin.house ? sharePrice(coin).toFixed(4) : fmtNear(coin.treasury)}</b>
            <span>{live && !coin.house ? "NEAR per share" : "NEAR in its treasury"}</span>
          </div>
          <div>
            <b className={pct >= 0 ? "up" : "down"}>
              {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
            </b>
            <span>over {matches.length} matches</span>
          </div>
          <div>
            <b>{Math.round(trustRate(coin) * 100)}%</b>
            <span>of its moves were Trust</span>
          </div>
          <div>
            <b>{coin.betrayals}</b>
            <span>{coin.betrayals === 1 ? "time" : "times"} it betrayed a coin that trusted it</span>
          </div>
        </div>
        <Sparkline values={curve} width={520} height={70} color={color} fluid />
      </div>
    </div>
  );
}

function Trade({ coin, onDone }: { coin: Coin; onDone: () => void }) {
  const w = useWallet();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("5");
  const [held, setHeld] = useState<bigint>(0n);
  const [locked, setLocked] = useState<bigint>(0n);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const info = w.info;

  useEffect(() => {
    if (info?.network === "testnet") setAmount((a) => (a === "5" ? "0.2" : a));
  }, [info?.network]);

  const load = useCallback(async () => {
    if (!info || !w.accountId) return;
    const arena = readArena(info);
    const [s, o, v] = await Promise.all([
      arena.shares(coin.id, w.accountId),
      arena.order(coin.id, w.accountId),
      arena.view<{ locked: string } | null>("get_vote", { coin: coin.id, account: w.accountId }),
    ]);
    setHeld(BigInt(s));
    setOrder(o);
    setLocked(BigInt(v?.locked ?? "0"));
  }, [info, w.accountId, coin.id]);

  useEffect(() => {
    load().catch(() => {});
    const timer = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [load]);

  const price = Number(BigInt(coin.treasury) * 1_000_000n / (BigInt(coin.total_shares) || 1n)) / 1_000_000;
  const value = toYocto(amount);
  const run = async (label: string, action: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    setNote(null);
    const result = await action();
    if (result.ok && w.accountId && (label === "Buying" || label === "Selling")) {
      fetch(`${ARENA_API}/api/watch-order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin: coin.id, account: w.accountId }) }).catch(() => {});
    }
    setBusy(false);
    setNote(result.ok ? { tone: "good", text: done } : { tone: "bad", text: /Not enough balance/.test(result.error ?? "") ? "Not enough NEAR in your wallet. Keep about 0.1 NEAR for gas." : `${label} failed: ${result.error?.match(/panicked: ([^"\\]+)/)?.[1] ?? result.error?.slice(0, 140)}` });
    await load();
    w.refresh();
    onDone();
  };

  if (coin.house) {
    return (
      <div className="glass trade">
        <h3>A house coin</h3>
        <p className="muted" style={{ margin: 0 }}>
          House coins have fixed rules and no shares.
          <br />
          They are the regulars every new coin has to face.
        </p>
      </div>
    );
  }

  if (!w.accountId) {
    return (
      <div className="glass trade">
        <h3>Own a piece of {coin.name}</h3>
        <TradeGuide coin={coin.id} />
        <p className="muted" style={{ margin: 0 }}>
          Shares give you a cut of its treasury and a vote on its rules.
        </p>
        <button className="btn big" onClick={() => w.setOpen(true)} style={{ width: "100%", justifyContent: "center" }}>
          <WalletIcon /> Get a free wallet to buy
        </button>
      </div>
    );
  }

  const due = order && (coin.matches_played > order.epoch || Date.now() * 1e6 >= Number(order.placed_at) + Number(info?.config.order_timeout_ns ?? 0));

  return (
    <div className="glass trade">
      <TradeGuide coin={coin.id} />
      <div className="tabs" style={{ marginTop: 0 }}>
        <button className={mode === "buy" ? "on" : ""} onClick={() => setMode("buy")}>
          Buy
        </button>
        <button className={mode === "sell" ? "on" : ""} onClick={() => setMode("sell")}>
          Sell
        </button>
      </div>
      <div className="position">
        <span>You hold</span>
        <b>{fmtNear(held + locked, 2)} shares</b>
        <span className="faint">≈ {(nearNumber(held + locked) * price).toFixed(2)} NEAR</span>
        {locked > 0n && <span className="faint">({fmtNear(locked, 2)} held in a vote until it ends)</span>}
      </div>
      {order ? (
        <div className="pending">
          <div>
            <b>{order.kind === "Mint" ? `Buying with ${fmtNear(order.amount)} NEAR` : `Selling ${fmtNear(order.amount)} shares`}</b>
            <span>
              {due ? "Filling now at the price after its last match…" : `Your order fills after ${coin.name}'s next match, so nobody can buy knowing how a match ends.`}
            </span>
          </div>
          <button className="btn ghost" disabled={busy} onClick={() => run("Cancel", () => w.arena()!.cancelOrder(coin.id), "Order cancelled. Your funds are back.")}>
            Cancel
          </button>
        </div>
      ) : mode === "buy" ? (
        <>
          <label className="field">
            <span>NEAR to put in</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            About {value ? (nearNumber(value) / price).toFixed(2) : "0"} shares at {price.toFixed(4)} NEAR each.
            <br />
            Your order fills after its next match.
          </p>
          <button className="btn trust big" disabled={busy || !value} style={{ width: "100%", justifyContent: "center" }} onClick={() => value && run("Buying", () => w.arena()!.placeMint(coin.id, value), "Order placed. It fills after the next match.")}>
            {busy ? "Sending…" : `Buy ${coin.name}`}
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span>Shares to sell</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <button className="tiny" onClick={() => setAmount((nearNumber(held)).toString())}>
              max
            </button>
          </label>
          <p className="muted small" style={{ margin: 0 }}>Your sale fills after its next match.</p>
          <button className="btn betray big" disabled={busy || !value || value > held} style={{ width: "100%", justifyContent: "center" }} onClick={() => value && run("Selling", () => w.arena()!.placeRedeem(coin.id, value), "Sell order placed. It fills after the next match.")}>
            {busy ? "Sending…" : `Sell for about ${value ? (nearNumber(value) * price).toFixed(2) : "0"} NEAR`}
          </button>
        </>
      )}
      <AnimatePresence>
        {note && (
          <motion.div className={`notice ${note.tone}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {note.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Rules({ coin, onDone }: { coin: Coin; onDone: () => void }) {
  const w = useWallet();
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const info = w.info;

  const load = useCallback(async () => {
    if (!info) return;
    setAmendments(await readArena(info).amendments(coin.id));
  }, [info, coin.id]);

  useEffect(() => {
    load().catch(() => {});
    const timer = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (label: string, action: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (!w.accountId) return w.setOpen(true);
    setBusy(true);
    setNote(null);
    const r = await action();
    setBusy(false);
    setNote(r.ok ? { tone: "good", text: done } : { tone: "bad", text: `${label} failed: ${r.error?.match(/panicked: ([^"\\]+)/)?.[1] ?? r.error?.slice(0, 140)}` });
    await load();
    onDone();
  };

  const mine = async () => BigInt(await readArena(info!).shares(coin.id, w.accountId!));
  const limit = info?.config.max_constitution_len ?? 1200;

  return (
    <div className="glass rules-card">
      <div className="rules-head">
        <h3>Its rules</h3>
        <span className="faint small">version {coin.constitution_version}</span>
      </div>
      <blockquote className="rules-text">{coin.constitution}</blockquote>
      {!coin.house && (
        <>
          <div className="rules-head" style={{ marginTop: 22 }}>
            <h3>Change its rules</h3>
            {!writing && (
              <button className="btn ghost" style={{ padding: "8px 14px", fontSize: 13.5 }} onClick={() => (w.accountId ? (setDraft(coin.constitution), setWriting(true)) : w.setOpen(true))}>
                Propose new rules
              </button>
            )}
          </div>
          <VoteGuide coin={coin.id} practice={brainOf(coin.model) === "practice"} />
          <p className="muted small vote-rules">
            Holders vote with their shares. A change needs more yes than no, and yes votes from at least {Number(info?.config.quorum_bps ?? 2000) / 100}% of all shares.
            <br />
            Then a short wait, so anyone who disagrees can sell first.
          </p>
          {writing && (
            <div className="propose">
              <RuleBuilder value={draft} onChange={setDraft} limit={limit} />
              <p className="faint small" style={{ margin: 0 }}>
                You need at least {Number(info?.config.proposer_bps ?? 100) / 100}% of its shares to propose. Your shares count as the first yes votes.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" disabled={busy || !draft.trim() || draft.trim() === coin.constitution.trim() || [...draft].length > limit} onClick={() => run("Proposing", () => w.arena()!.proposeAmendment(coin.id, draft.trim(), coin.model), "Proposed. Your shares count as the first yes votes.").then(() => (setWriting(false), setDraft("")))}>
                  Put it to a vote
                </button>
                <button className="btn ghost" onClick={() => setWriting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {amendments.map((a) => {
            const total = BigInt(a.yes) + BigInt(a.no);
            const yes = total ? Number((BigInt(a.yes) * 1000n) / total) / 10 : 0;
            const ended = BigInt(a.ends_at) / 1_000_000n <= BigInt(Date.now());
            const ready = a.status === "Passed" && BigInt(a.enact_after) / 1_000_000n <= BigInt(Date.now());
            return (
              <div key={a.id} className="amendment">
                <div className="amendment-top">
                  <span className={`pill ${a.status === "Passed" ? "" : "dim"}`}>{a.status === "Passed" ? "Passed" : "Voting"}</span>
                  <span className="faint small">{a.status === "Voting" ? `closes ${until(a.ends_at)}` : `takes effect ${until(a.enact_after)}`}</span>
                </div>
                <p className="amendment-text">“{a.constitution}”</p>
                <div className="vote-bar">
                  <i style={{ width: `${yes}%` }} />
                </div>
                <div className="mini">
                  <span className="up">Yes {fmtNear(a.yes, 1)}</span>
                  <span className="down">No {fmtNear(a.no, 1)}</span>
                </div>
                <div className="amendment-actions">
                  {a.status === "Voting" && !ended && (
                    <>
                      <button className="btn trust" disabled={busy} onClick={async () => run("Voting", async () => w.arena()!.vote(a.id, true, await mine()), "Voted yes with all your free shares.")}>
                        <TrustIcon size={16} /> Vote yes
                      </button>
                      <button className="btn betray" disabled={busy} onClick={async () => run("Voting", async () => w.arena()!.vote(a.id, false, await mine()), "Voted no with all your free shares.")}>
                        <BetrayIcon size={16} /> Vote no
                      </button>
                    </>
                  )}
                  {a.status === "Voting" && ended && (
                    <button className="btn" disabled={busy} onClick={() => run("Counting", () => w.arena()!.finalizeAmendment(a.id), "Votes counted.")}>
                      Count the votes
                    </button>
                  )}
                  {ready && (
                    <button className="btn" disabled={busy} onClick={() => run("Enacting", () => w.arena()!.enactAmendment(a.id), "The new rules are in force from its next match.")}>
                      Put the new rules in force
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
      {note && <div className={`notice ${note.tone}`}>{note.text}</div>}
    </div>
  );
}

function LiveCoin({ id }: { id: string }) {
  const { info, ready } = useArenaInfo();
  const w = useWallet();
  const [coin, setCoin] = useState<Coin | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!info) return;
    const arena = readArena(info);
    const load = async () => {
      const [c, all, parleys] = await Promise.all([arena.coin(id), arena.coins(), arena.parleys(0, 50)]);
      setCoin(c);
      setNames(new Map(all.map((x) => [x.id, x.name])));
      setMatches(parleys.map((p) => fromParley(p)).filter((m) => m.settled && (m.a === id || m.b === id)).reverse());
    };
    load().catch(() => {});
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [info, id, tick]);
  if (!ready) return <p className="muted loading-line">Connecting…</p>;
  if (!info)
    return (
      <Empty id={id} mood="thinking" title="The live arena is offline right now" action={<Link to={`/season/coin/${id}`} className="btn ghost">See {id.toUpperCase()} in Season 1</Link>}>
        Season 1 replays still work.
      </Empty>
    );
  if (!coin) return <p className="muted loading-line">Loading…</p>;
  const name = (cid: string) => names.get(cid) ?? cid.toUpperCase();
  const mine = !!w.accountId && coin.creator === w.accountId;
  return (
    <>
      <div className="crumbs">
        <Link to="/coins">Coins</Link> / {coin.name}
      </div>
      <Hero coin={fromCoin(coin)} matches={matches} live />
      {mine && (
        <div className="coin-actions">
          <span className="muted small">You made this coin.</span>
          <ShareButton path={`/coin/${coin.id}`} text={`Meet ${coin.name}, my coin in Parley. Its AI follows the rules I wrote, and every word it says is signed by NEAR AI.`} />
        </div>
      )}
      <YourMatches coins={[coin.id]} name={name} title={`Next up for ${coin.name}`} />
      <div className="coin-body">
        <Rules coin={coin} onDone={() => setTick((t) => t + 1)} />
        <Trade coin={coin} onDone={() => setTick((t) => t + 1)} />
      </div>
      <section style={{ marginTop: 40 }}>
        <div className="section-head">
          <h2 style={{ fontSize: 30 }}>Its matches</h2>
        </div>
        <div className="match-list">
          {[...matches].reverse().map((m) => (
            <MatchRow key={m.id} match={m} to={`/match/${m.id}`} name={name} />
          ))}
          {!matches.length && (
            <Empty id={coin.id} mood="thinking" title="No matches yet">
              {info.autoplay ? "New coins rest a moment, then the arena pairs them." : "It plays when a new coin picks it as a rival."}
            </Empty>
          )}
        </div>
      </section>
    </>
  );
}

function SeasonCoin({ id }: { id: string }) {
  const season = useSeason();
  if (!season) return <p className="muted">Loading…</p>;
  const coin = season.coin(id);
  if (!coin) return <p className="muted">No such coin in Season 1.</p>;
  const matches = season.matchesOf(id).filter((m) => m.settled);
  const name = (cid: string) => season.coin(cid)?.name ?? cid.toUpperCase();
  return (
    <>
      <div className="crumbs">
        <Link to="/coins">Coins</Link> / Season 1 / {coin.name}
      </div>
      <Hero coin={coin} matches={matches} live={false} />
      <div className="coin-body">
        <div className="glass rules-card">
          <div className="rules-head">
            <h3>Its rules</h3>
          </div>
          <blockquote className="rules-text">{coin.rules}</blockquote>
          <p className="muted small">This is a Season 1 replay. To buy or vote, open it in the live arena.</p>
        </div>
        <div className="glass trade">
          <h3>Season 1 record</h3>
          <div className="record">
            <div>
              <b>{coin.played}</b>
              <span>matches</span>
            </div>
            <div>
              <b className="up">{coin.trusted}</b>
              <span>trusted</span>
            </div>
            <div>
              <b className="down">{coin.betrayed}</b>
              <span>betrayed</span>
            </div>
            <div>
              <b>{coin.wasBetrayed}</b>
              <span>times it got betrayed</span>
            </div>
          </div>
          <Link to={`/coin/${id}`} className="btn ghost" style={{ width: "100%", justifyContent: "center", marginTop: 16 }}>
            See {coin.name} in the live arena
          </Link>
        </div>
      </div>
      <section style={{ marginTop: 40 }}>
        <div className="section-head">
          <h2 style={{ fontSize: 30 }}>Its matches</h2>
        </div>
        <div className="match-list">
          {[...matches].reverse().map((m) => (
            <MatchRow key={m.id} match={m} to={`/season/match/${m.id}`} name={name} />
          ))}
        </div>
      </section>
    </>
  );
}

export function CoinView({ season = false }: { season?: boolean }) {
  const id = useParams().id ?? "";
  return season ? <SeasonCoin id={id} /> : <LiveCoin id={id} />;
}
