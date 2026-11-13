import type { Amendment, Coin, Order, Parley } from "@parley/sdk/src/types.ts";
import { parseNear } from "@parley/sdk/src/units.ts";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { YourMatches } from "../components/ArenaNow.tsx";
import { Challenge } from "../components/Challenge.tsx";
import { madeBy } from "../components/MyCoins.tsx";
import { Sparkline } from "../components/CoinCard.tsx";
import { Empty } from "../components/Empty.tsx";
import { CoinMoney } from "../components/Ledger.tsx";
import { TradeGuide } from "../components/Guide.tsx";
import { MatchRow } from "../components/MatchRow.tsx";
import { MoveWords } from "../components/MoveWords.tsx";
import { RuleBuilder } from "../components/RuleBuilder.tsx";
import { RulesHistory } from "../components/RulesHistory.tsx";
import { RulesPill } from "../components/RulesPill.tsx";
import { ShareButton } from "../components/Share.tsx";
import { TokenPanel } from "../components/TokenPanel.tsx";
import { Mascot, mascotColor } from "../components/Mascot.tsx";
import { BoltIcon, BrainIcon, RestartIcon, TrustIcon, BetrayIcon, WalletIcon } from "../components/icons.tsx";
import { type CoinInfo, type Match, fmtNear, fromCoin, fromParley, nearNumber, pctText, sharePrice, sinceLaunch, trustRate } from "../lib/model.ts";
import { ARENA_API, useArenaInfo } from "../lib/live.ts";
import { holdings, setHolding } from "../lib/holdings.ts";
import { type VoteLock, forget, parleysBefore, reads, view } from "../lib/near.ts";
import { useSeason } from "../lib/season.ts";
import { failed, noteCoin, useWallet, whyFailed } from "../lib/wallet.tsx";
import { BRAIN_LABEL, PRACTICE_NOTE, brainOf, tagline } from "../lib/words.ts";

const msOf = (ns: string) => Number(BigInt(ns) / 1_000_000n);

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${Math.round(s / 3600)} h`;
}

const minutes = (ns: string | undefined, fallback: number) => {
  const m = ns ? Number(BigInt(ns) / 60_000_000_000n) : fallback;
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
};

function useNow(run: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!run) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run]);
  return now;
}

/** Treasury after each match, oldest first, counted back from the treasury now. */
function curveOf(id: string, treasury: string, matches: Match[]): number[] {
  const delta = (m: Match) => BigInt(m.a === id ? m.aDelta : m.bDelta);
  let value = BigInt(treasury) - matches.reduce((n, m) => n + delta(m), 0n);
  const curve = [nearNumber(value)];
  for (const m of matches) {
    value += delta(m);
    curve.push(nearNumber(value));
  }
  return curve;
}

function Hero({ coin, matches, live }: { coin: CoinInfo; matches: Match[]; live: boolean }) {
  const color = mascotColor(coin.id);
  const brain = brainOf(coin.model);
  const curve = curveOf(coin.id, coin.treasury, matches);
  const first = curve[0] ?? 0;
  const priced = live ? sinceLaunch(coin) : null;
  const pct = priced ?? (first ? (((curve.at(-1) ?? 0) - first) / first) * 100 : 0);
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
        <div className="coin-title">
          <h1>{coin.name}</h1>
          <RulesPill version={coin.version} />
        </div>
        <p className="lead">{tagline(coin.id, coin.rules)}</p>
        {brain === "practice" && <p className="practice-note">{PRACTICE_NOTE}</p>}
        <div className="coin-stats">
          <div>
            <b>{priced !== null ? sharePrice(coin).toFixed(4) : fmtNear(coin.treasury)}</b>
            <span>{priced !== null ? "NEAR per share" : "NEAR in its treasury"}</span>
          </div>
          <div>
            <b className={pct >= 0 ? "up" : "down"}>{pctText(pct)}</b>
            <span>{priced !== null ? "since launch, from 1 NEAR a share" : live ? `over its last ${matches.length} matches` : "since launch"}</span>
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
  const [held, setHeld] = useState<bigint | null>(null);
  const [locked, setLocked] = useState<bigint | null>(null);
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const info = w.info;

  useEffect(() => {
    if (info?.network === "testnet") setAmount((a) => (a === "5" ? "0.2" : a));
  }, [info?.network]);

  const load = useCallback(async () => {
    if (!info || !w.accountId) return;
    const account = w.accountId;
    const [s, o, v] = await Promise.allSettled([reads.shares(info, coin.id, account), reads.order(info, coin.id, account), reads.vote(info, coin.id, account)]);
    if (s.status === "fulfilled") setHeld(BigInt(s.value));
    if (o.status === "fulfilled") setOrder(o.value);
    if (v.status === "fulfilled") setLocked(BigInt(v.value?.locked ?? "0"));
    if (s.status !== "fulfilled" || o.status !== "fulfilled" || v.status !== "fulfilled") return;
    const shares = BigInt(s.value) + BigInt(v.value?.locked ?? "0");
    if (shares > 0n || o.value || holdings(account).has(coin.id)) setHolding(account, coin.id, { shares: shares.toString(), order: o.value ? { kind: o.value.kind, amount: o.value.amount } : null });
  }, [info, w.accountId, coin.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const price = Number((BigInt(coin.treasury) * 1_000_000n) / (BigInt(coin.total_shares) || 1n)) / 1_000_000;
  const value = parseNear(amount);
  const sending = w.kind === "near" ? "Approve it in your wallet…" : "Sending…";
  const run = async (label: string, action: () => Promise<{ ok: boolean; error?: string }>, done: string, placed?: Order["kind"] | null, amount?: bigint) => {
    setBusy(true);
    setNote(null);
    const result = await action();
    if (result.ok) noteCoin(w.accountId, coin.id);
    if (result.ok && placed !== undefined) {
      const known = holdings(w.accountId ?? "").get(coin.id)?.shares;
      setHolding(w.accountId, coin.id, { shares: known ?? ((held ?? 0n) + (locked ?? 0n)).toString(), order: placed && amount ? { kind: placed, amount: amount.toString() } : null });
    }
    if (result.ok && w.accountId && (label === "Buying" || label === "Selling")) {
      fetch(`${ARENA_API}/api/watch-order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin: coin.id, account: w.accountId }) }).catch(() => {});
    }
    setBusy(false);
    setNote(result.ok ? { tone: "good", text: done } : { tone: "bad", text: /Not enough balance/.test(result.error ?? "") ? "Not enough NEAR in your wallet. Keep about 0.1 NEAR for gas." : failed(label, result.error) });
    w.refresh();
    await load();
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
        <TradeGuide coin={coin.id} name={coin.name} />
        <button className="btn big" onClick={() => w.setOpen(true)} style={{ width: "100%", justifyContent: "center" }}>
          <WalletIcon /> Get a free wallet to buy
        </button>
      </div>
    );
  }

  const due = order && (coin.matches_played > order.epoch || Date.now() * 1e6 >= Number(order.placed_at) + Number(info?.config.order_timeout_ns ?? 0));
  const known = held !== null && locked !== null;
  const total = (held ?? 0n) + (locked ?? 0n);

  return (
    <div className="glass trade">
      <TradeGuide coin={coin.id} name={coin.name} />
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
        <b>{known ? `${fmtNear(total, 2)} shares` : "… shares"}</b>
        {known && <span className="faint">≈ {(nearNumber(total) * price).toFixed(2)} NEAR</span>}
        {locked !== null && locked > 0n && <span className="faint">({fmtNear(locked, 2)} held in a vote until it ends)</span>}
      </div>
      {order ? (
        <div className="pending">
          <div>
            <b>{order.kind === "Mint" ? `Buying with ${fmtNear(order.amount)} NEAR` : `Selling ${fmtNear(order.amount)} shares`}</b>
            <span>{due ? "Filling now at the price after its last match…" : `Your order fills after ${coin.name}'s next match, so nobody can buy knowing how a match ends.`}</span>
          </div>
          <button className="btn ghost" disabled={busy} onClick={() => run("Cancel", () => w.arena()!.cancelOrder(coin.id), "Order cancelled. Your funds are back.", null)}>
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
          <button className="btn trust big" disabled={busy || !value || order === undefined} style={{ width: "100%", justifyContent: "center" }} onClick={() => value && run("Buying", () => w.arena()!.placeMint(coin.id, value), "Order placed. It fills after the next match.", "Mint", value)}>
            {busy ? sending : `Buy ${coin.name}`}
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span>Shares to sell</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <button className="tiny" disabled={held === null} onClick={() => held !== null && setAmount(nearNumber(held).toString())}>
              max
            </button>
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            Your sale fills after its next match.
          </p>
          <button className="btn betray big" disabled={busy || !value || held === null || value > held || order === undefined} style={{ width: "100%", justifyContent: "center" }} onClick={() => value && run("Selling", () => w.arena()!.placeRedeem(coin.id, value), "Sell order placed. It fills after the next match.", "Redeem", value)}>
            {busy ? sending : `Sell for about ${value ? (nearNumber(value) * price).toFixed(2) : "0"} NEAR`}
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

const share = (n: bigint) => fmtNear(n, 2);

type Phase = "voting" | "counting" | "passed" | "enacting" | "inforce" | "failed" | "lapsed";

function Tally({ a, total, quorumBps, phase }: { a: Amendment; total: bigint; quorumBps: number; phase: Phase }) {
  const yes = BigInt(a.yes);
  const no = BigInt(a.no);
  const quorum = (total * BigInt(quorumBps)) / 10_000n;
  const width = (v: bigint) => (total > 0n ? Math.min(100, Number((v * 10_000n) / total) / 100) : 0);
  const line = quorumBps / 100;
  const short = quorum > yes ? quorum - yes : 0n;
  const why = yes <= no ? "more no than yes" : `${share(yes)} yes, ${share(quorum)} needed`;
  const verdict =
    phase === "voting"
      ? short > 0n
        ? `Needs ${share(short)} more yes to pass.`
        : yes > no
          ? "Enough yes to pass if the vote closed now."
          : "More no than yes, so it would fail now."
      : phase === "counting"
        ? short === 0n && yes > no
          ? `It has the votes: ${share(yes)} yes, ${share(quorum)} needed.`
          : `It does not pass: ${why}.`
        : phase === "failed"
          ? `It did not pass: ${why}.`
          : `Passed with ${share(yes)} yes (${share(quorum)} needed).`;
  return (
    <div className="tally">
      <div className="tally-bar" role="img" aria-label={`Yes ${share(yes)}, no ${share(no)}, ${share(quorum)} yes needed`}>
        <span className="tally-fill">
          <i className="yes" style={{ width: `${width(yes)}%` }} />
          <i className="no" style={{ width: `${width(no)}%` }} />
        </span>
        <span className="tally-line" style={{ left: `${line}%` }} />
      </div>
      <div className="tally-scale">
        <span style={{ left: `${line}%` }}>{line}% needed</span>
      </div>
      <div className="tally-text">
        <span className="up">Yes {share(yes)}</span>
        <span className="down">No {share(no)}</span>
        <span className="faint">of {share(total)} shares</span>
      </div>
      <p className="tally-verdict">{verdict}</p>
    </div>
  );
}

const LATE_MS = 120_000;

function Rules({ coin, onDone }: { coin: Coin; onDone: () => void }) {
  const w = useWallet();
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [closed, setClosed] = useState<Amendment[]>([]);
  const seen = useRef<Amendment[]>([]);
  const [free, setFree] = useState<bigint | null>(null);
  const [myVotes, setMyVotes] = useState<VoteLock | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const info = w.info;
  const account = w.accountId;

  const load = useCallback(async () => {
    if (!info) return;
    const [list, s, v] = await Promise.allSettled([
      reads.amendments(info, coin.id),
      account ? reads.shares(info, coin.id, account) : Promise.resolve(null),
      account ? reads.vote(info, coin.id, account) : Promise.resolve(null),
    ]);
    if (list.status === "fulfilled") {
      const open = new Set(list.value.map((a) => a.id));
      const left = seen.current.filter((a) => !open.has(a.id));
      if (left.length) setClosed((c) => [...c.filter((x) => !left.some((l) => l.id === x.id)), ...left]);
      seen.current = list.value;
      setAmendments(list.value);
    }
    if (account && s.status === "fulfilled" && s.value !== null) setFree(BigInt(s.value));
    if (account && v.status === "fulfilled") setMyVotes(v.value);
  }, [info, coin.id, account]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = async () => {
    if (info) forget(info, "get_amendments", "get_shares", "get_vote", "get_coins", "get_coin");
    await load();
    onDone();
  };

  const run = async (label: string, action: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (!account) return w.setOpen(true);
    setBusy(true);
    setNote(null);
    const r = await action();
    if (r.ok) noteCoin(account, coin.id);
    setBusy(false);
    setNote(r.ok ? { tone: "good", text: done } : { tone: "bad", text: failed(label, r.error) });
    await refresh();
  };

  const owned = free !== null && myVotes !== undefined ? free + BigInt(myVotes?.locked ?? "0") : null;
  const timelock = info ? msOf(info.config.timelock_ns) : 240_000;
  const now = useNow(amendments.length > 0 || closed.length > 0);
  const total = BigInt(coin.total_shares);
  const stake = (() => {
    const s = (total * BigInt(info?.config.proposer_bps ?? 100)) / 10_000n;
    return s > 0n ? s : 1n;
  })();
  const quorumBps = info?.config.quorum_bps ?? 2000;
  const limit = info?.config.max_constitution_len ?? 1200;
  const proposed = amendments.some((a) => a.proposer === account);

  const propose = async () => {
    const arena = w.arena();
    if (!arena || !info || !account) return w.setOpen(true);
    setBusy(true);
    setNote(null);
    setStep(w.kind === "near" ? "Step 1 of 2: approve your proposal in your wallet…" : "Step 1 of 2: sending your proposal…");
    const made = await arena.proposeAmendment(coin.id, draft.trim(), coin.model);
    if (!made.ok) {
      setBusy(false);
      setStep(null);
      setNote({ tone: "bad", text: failed("Proposing", made.error) });
      return;
    }
    const id = Number(made.value);
    noteCoin(account, coin.id);
    setWriting(false);
    setDraft("");
    setStep(w.kind === "near" ? "Step 2 of 2: approve your yes vote in your wallet…" : "Step 2 of 2: voting yes with all your shares…");
    const [mine, held] = await Promise.all([
      view<VoteLock | null>(info, "get_vote", { coin: coin.id, account }).catch(() => null),
      view<string>(info, "get_shares", { coin: coin.id, account }).catch(() => null),
    ]);
    const ballot = BigInt(mine?.ballots.find((b) => b.amendment_id === id)?.shares ?? "0");
    const add = held === null ? 0n : BigInt(held) + BigInt(mine?.locked ?? "0") - ballot;
    const voted = add > 0n ? await arena.vote(id, true, add) : { ok: held !== null, error: "could not read your shares" };
    setBusy(false);
    setStep(null);
    setNote(
      voted.ok
        ? { tone: "good", text: `Proposed, and you voted yes with ${share(ballot + add)} shares.` }
        : { tone: "bad", text: `Proposed, but your yes vote did not go through: ${whyFailed(voted.error)}. Press Vote yes to try again.` },
    );
    await refresh();
  };

  return (
    <div className="glass rules-card">
      <div className="rules-head">
        <h3>Its rules</h3>
        <span className="faint small">version {coin.constitution_version}</span>
      </div>
      <blockquote className="rules-text">{coin.constitution}</blockquote>
      <MoveWords />
      {!coin.house && (
        <>
          <div className="rules-head" style={{ marginTop: 22 }}>
            <h3>Change its rules</h3>
            {!writing && !proposed && (
              <button className="btn ghost" style={{ padding: "8px 14px", fontSize: 13.5 }} onClick={() => (account ? (setDraft(coin.constitution), setWriting(true)) : w.setOpen(true))}>
                Propose new rules
              </button>
            )}
          </div>
          <p className="muted small vote-rules">
            Holders vote with their shares for {minutes(info?.config.vote_period_ns, 2)}. A change needs more yes than no, and yes from at least {quorumBps / 100}% of all shares. It takes
            effect {minutes(info?.config.timelock_ns, 4)} after it passes.
          </p>
          {writing && (
            <div className="propose">
              <RuleBuilder value={draft} onChange={setDraft} limit={limit} legend={false} />
              <p className="faint small" style={{ margin: 0 }}>
                {owned !== null && owned < stake
                  ? `You need at least ${share(stake)} shares (${Number(info?.config.proposer_bps ?? 100) / 100}% of all) to propose. Buy some first.`
                  : "Two quick steps: it sends your proposal, then votes yes with all your shares."}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" disabled={busy || !draft.trim() || draft.trim() === coin.constitution.trim() || [...draft].length > limit || (owned !== null && owned < stake)} onClick={propose}>
                  Propose and vote yes
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => setWriting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {step && <div className="notice">{step}</div>}
          {[...amendments, ...closed].map((a) => {
            const gone = !amendments.includes(a);
            const ends = msOf(a.ends_at);
            const enact = msOf(a.enact_after);
            const phase: Phase = gone
              ? a.status === "Voting"
                ? "failed"
                : coin.constitution_version > a.base_version
                  ? coin.constitution === a.constitution
                    ? "inforce"
                    : "lapsed"
                  : now > enact + timelock
                    ? "lapsed"
                    : "enacting"
              : a.status === "Voting"
                ? now < ends
                  ? "voting"
                  : "counting"
                : now < enact
                  ? "passed"
                  : "enacting";
            const ballot = gone ? undefined : myVotes?.ballots.find((b) => b.amendment_id === a.id);
            const room = owned === null ? null : owned - BigInt(ballot?.shares ?? "0");
            const open = phase === "voting";
            const top: Record<Phase, [string, string]> = {
              voting: ["Voting", `Closes in ${countdown(ends - now)}`],
              counting: ["Vote closed", "Counting now"],
              passed: ["Passed", `Takes effect in ${countdown(enact - now)}`],
              enacting: ["Taking effect", "Being put in force"],
              inforce: ["In force", `Rules version ${coin.constitution_version}`],
              failed: ["Did not pass", ""],
              lapsed: ["Lapsed", "Other rules took effect first"],
            };
            const say: Partial<Record<Phase, string>> = {
              counting: "The arena counts the votes within about a minute.",
              passed: "The wait lets anyone who disagrees sell first.",
              enacting: "The arena puts it in force within about a minute, between matches.",
              inforce: "Its AI follows these rules from its next match.",
            };
            return (
              <div key={a.id} className={`amendment ${phase}`}>
                <div className="amendment-top">
                  <span className={`pill ${phase === "passed" || phase === "enacting" || phase === "inforce" ? "" : "dim"}`}>{top[phase][0]}</span>
                  {top[phase][1] && <span className="faint small">{top[phase][1]}</span>}
                </div>
                <p className="amendment-text">“{a.constitution}”</p>
                {phase !== "inforce" && phase !== "lapsed" && <Tally a={a} total={total} quorumBps={quorumBps} phase={phase} />}
                {say[phase] && <p className="amendment-note">{say[phase]}</p>}
                {ballot && (
                  <p className={`my-ballot ${ballot.support ? "up" : "down"}`}>
                    You voted {ballot.support ? "yes" : "no"} with {share(BigInt(ballot.shares))} shares.
                  </p>
                )}
                <div className="amendment-actions">
                  {open && !account && (
                    <>
                      <button className="btn trust" onClick={() => w.setOpen(true)}>
                        <TrustIcon size={16} /> Vote yes
                      </button>
                      <button className="btn betray" onClick={() => w.setOpen(true)}>
                        <BetrayIcon size={16} /> Vote no
                      </button>
                    </>
                  )}
                  {open && account && owned === 0n && <span className="faint small">Buy shares to vote on this.</span>}
                  {open && account && !ballot && owned !== 0n && (
                    <>
                      <button className="btn trust" disabled={busy || room === null || room <= 0n} onClick={() => room && run("Voting", () => w.arena()!.vote(a.id, true, room), `You voted yes with ${share(room)} shares.`)}>
                        <TrustIcon size={16} /> Vote yes
                      </button>
                      <button className="btn betray" disabled={busy || room === null || room <= 0n} onClick={() => room && run("Voting", () => w.arena()!.vote(a.id, false, room), `You voted no with ${share(room)} shares.`)}>
                        <BetrayIcon size={16} /> Vote no
                      </button>
                    </>
                  )}
                  {open && ballot && room !== null && room > 0n && (
                    <button className="btn ghost small-btn" disabled={busy} onClick={() => run("Voting", () => w.arena()!.vote(a.id, ballot.support, room), `Added ${share(room)} more shares to your ${ballot.support ? "yes" : "no"}.`)}>
                      Add your other {share(room)} shares
                    </button>
                  )}
                  {phase === "counting" && now > ends + LATE_MS && (
                    <button className="btn ghost small-btn" disabled={busy} onClick={() => run("Counting", () => w.arena()!.finalizeAmendment(a.id), "Votes counted.")}>
                      Count it now
                    </button>
                  )}
                  {phase === "enacting" && !gone && now > enact + LATE_MS && (
                    <button className="btn ghost small-btn" disabled={busy} onClick={() => run("Enacting", () => w.arena()!.enactAmendment(a.id), "The new rules are in force from its next match.")}>
                      Put it in force now
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

const PAGES_PER_CLICK = 8;

function LiveCoin({ id }: { id: string }) {
  const { info, ready } = useArenaInfo();
  const w = useWallet();
  const [all, setAll] = useState<Coin[] | null>(() => reads.peekCoins(info) ?? null);
  const [single, setSingle] = useState<Coin | null | undefined>(undefined);
  const [recent, setRecent] = useState<Parley[]>(() => reads.peekRecent(info) ?? []);
  const [older, setOlder] = useState<Parley[]>([]);
  const [paging, setPaging] = useState(false);
  const [atStart, setAtStart] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!info) return;
    let live = true;
    const load = () => {
      reads.coins(info).then(
        (list) => {
          if (!live) return;
          setAll(list);
          if (!list.some((c) => c.id === id)) reads.coin(info, id).then((one) => live && setSingle(one), () => {});
        },
        () => {},
      );
      reads.recent(info).then((p) => live && setRecent(p), () => {});
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [info, id, tick]);

  const coin = all?.find((c) => c.id === id) ?? single ?? null;
  if (!ready) return <p className="muted loading-line">Connecting…</p>;
  if (!info)
    return (
      <Empty id={id} mood="thinking" title="The live arena is offline right now" action={<Link to={`/season/coin/${id}`} className="btn ghost">See {id.toUpperCase()} in Season 1</Link>}>
        Season 1 replays still work.
      </Empty>
    );
  if (!coin) {
    if (single === null)
      return (
        <Empty id={id} mood="thinking" title="No coin by that name" action={<Link to="/coins" className="btn ghost">See all coins</Link>}>
          It may have a different link. Every live coin is on the Coins page.
        </Empty>
      );
    return <p className="muted loading-line">Loading…</p>;
  }

  const name = (cid: string) => all?.find((x) => x.id === cid)?.name ?? cid.toUpperCase();
  const byId = new Map<number, Parley>();
  for (const p of [...older, ...recent]) byId.set(p.id, p);
  const matches = [...byId.values()]
    .filter((p) => p.status === "Settled" && (p.a === id || p.b === id))
    .sort((x, y) => x.id - y.id)
    .map((p) => fromParley(p));
  const played = coin.stats.matches;
  const oldest = byId.size ? Math.min(...byId.keys()) : 0;
  const more = matches.length < played && !atStart && oldest > 0;

  const loadOlder = async () => {
    if (paging || !recent.length) return;
    setPaging(true);
    const newest = recent[0]!.id;
    let before = oldest;
    let found = 0;
    const got: Parley[] = [];
    let start = false;
    try {
      for (let n = 0; n < PAGES_PER_CLICK && found < 10 && !start; n++) {
        const page = await parleysBefore(info, before, newest);
        got.push(...page);
        found += page.filter((p) => p.status === "Settled" && (p.a === id || p.b === id)).length;
        const last = page.at(-1);
        if (!last || last.id === 0 || BigInt(last.opened_at) < BigInt(coin.created_at)) start = true;
        else before = last.id;
      }
    } catch {}
    setOlder((o) => [...o, ...got]);
    if (start) setAtStart(true);
    setPaging(false);
  };

  const mine = !!w.accountId && coin.creator === w.accountId;
  const challengers = madeBy(all ?? [], w.accountId)
    .filter((c) => c.id !== coin.id)
    .sort((x, y) => Number(x.in_match !== null) - Number(y.in_match !== null));
  const wallet = w.accountId ?? "";
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
      {challengers.length > 0 && <Challenge key={wallet} mine={challengers} rival={coin.id} name={name} />}
      <YourMatches coins={[coin.id]} name={name} title={`Next up for ${coin.name}`} />
      <div className="coin-body">
        <Rules key={`rules:${wallet}`} coin={coin} onDone={() => setTick((t) => t + 1)} />
        <Trade key={`trade:${wallet}`} coin={coin} onDone={() => setTick((t) => t + 1)} />
      </div>
      <RulesHistory coin={coin} />
      <TokenPanel key={`token:${wallet}`} coin={coin} />
      <CoinMoney coin={coin} name={name} />
      <section style={{ marginTop: 40 }}>
        <div className="section-head">
          <div>
            <h2 style={{ fontSize: 30 }}>Its matches</h2>
            {played > 0 && <p>{matches.length >= played ? `All ${played}, newest first.` : `Its last ${matches.length} of ${played}, newest first.`}</p>}
          </div>
        </div>
        <div className="match-list">
          {[...matches].reverse().map((m) => (
            <MatchRow key={m.id} match={m} to={`/match/${m.id}`} name={name} />
          ))}
          {!matches.length && !played && (
            <Empty id={coin.id} mood="thinking" title="No matches yet">
              {info.autoplay ? "New coins rest a moment, then the arena pairs them." : "It plays when a new coin picks it as a rival."}
            </Empty>
          )}
        </div>
        {more && (
          <div className="more-row">
            <button className="btn ghost" disabled={paging} onClick={loadOlder}>
              {paging ? "Looking back…" : "Show older matches"}
            </button>
          </div>
        )}
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
          <MoveWords />
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
  return season ? <SeasonCoin key={id} id={id} /> : <LiveCoin key={id} id={id} />;
}
