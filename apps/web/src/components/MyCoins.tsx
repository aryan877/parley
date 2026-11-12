import type { Coin } from "@parley/sdk/src/types.ts";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { accountLink, useArenaInfo, useLiveArena } from "../lib/live.ts";
import { holdings, holds, setHolding, useHoldingsOf } from "../lib/holdings.ts";
import { reads } from "../lib/near.ts";
import { fmtNear, fromParley, nearNumber, signedNear } from "../lib/model.ts";
import { noteCoin, notedCoins, useWallet } from "../lib/wallet.tsx";
import { moveWord, tagline } from "../lib/words.ts";
import { YourMatches } from "./ArenaNow.tsx";
import { Empty } from "./Empty.tsx";
import { Mascot, mascotColor } from "./Mascot.tsx";
import { ArrowIcon, BetrayIcon, ClockIcon, TrustIcon, WalletIcon } from "./icons.tsx";

const swept = new Set<string>();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the account's shares and open orders into the holdings store. Coins it made or used from this browser are
 * read every 30 seconds, or every 8 while an order waits; the rest are checked once per visit.
 */
function useChainHoldings(coins: Coin[] | null, account: string | null) {
  const { info } = useArenaInfo();
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(coins);
  latest.current = coins;
  const ready = !!coins;
  useEffect(() => {
    setLoaded(false);
    if (!info || !account || !ready) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (id: string) => {
      const [s, v, o] = await Promise.allSettled([reads.shares(info, id, account), reads.vote(info, id, account), reads.order(info, id, account)]);
      if (s.status === "rejected" || v.status === "rejected" || !live) return;
      const before = holdings(account).get(id);
      const order = o.status === "fulfilled" ? (o.value ? { kind: o.value.kind, amount: o.value.amount } : null) : (before?.order ?? null);
      setHolding(account, id, { shares: (BigInt(s.value) + BigInt(v.value?.locked ?? "0")).toString(), order });
    };
    const load = async () => {
      const noted = notedCoins(account);
      const relevant = (latest.current ?? []).filter((c) => c.creator === account || noted.has(c.id) || holdings(account).has(c.id));
      for (let i = 0; i < relevant.length; i += 4) await Promise.all(relevant.slice(i, i + 4).map((c) => read(c.id)));
      if (!live) return;
      setLoaded(true);
      const waiting = [...holdings(account).values()].some((h) => h.order);
      timer = setTimeout(load, waiting ? 8000 : 30_000);
    };
    const sweep = async () => {
      if (swept.has(account) || !live) return;
      swept.add(account);
      setSearching(true);
      const noted = notedCoins(account);
      const rest = (latest.current ?? []).filter((c) => !c.house && c.creator !== account && !noted.has(c.id) && !holdings(account).has(c.id));
      for (let i = 0; i < rest.length; i += 4) {
        if (!live) {
          swept.delete(account);
          return;
        }
        const batch = rest.slice(i, i + 4);
        const values = await Promise.all(batch.map((c) => reads.shares(info, c.id, account).then(BigInt, () => null)));
        batch.forEach((c, k) => {
          const shares = values[k];
          if (shares === null || shares === undefined) swept.delete(account);
          else if (shares > 0n) {
            noteCoin(account, c.id);
            setHolding(account, c.id, { shares: shares.toString(), order: null });
          }
        });
        await pause(200);
      }
      if (live) setSearching(false);
    };
    load().then(sweep);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [info, account, ready]);
  return { searching, loaded };
}

function Forget() {
  const w = useWallet();
  const [sure, setSure] = useState(false);
  if (!sure) {
    return (
      <button className="tiny" onClick={() => setSure(true)}>
        Forget this wallet
      </button>
    );
  }
  return (
    <div className="forget">
      <p>This browser forgets the key. Your coins stay on chain, but you can't trade or vote with them from here again.</p>
      <div>
        <button className="btn ghost small-btn" onClick={() => setSure(false)}>
          Keep it
        </button>
        <button className="btn betray small-btn" onClick={w.disconnect}>
          Forget it
        </button>
      </div>
    </div>
  );
}

const richest = (x: Coin, y: Coin) => (BigInt(y.treasury) > BigInt(x.treasury) ? 1 : -1);

/** Coins the account launched, richest first. */
export const madeBy = (coins: Coin[], account: string | null) => (account ? coins.filter((c) => c.creator === account).sort(richest) : []);

/** The coins the connected wallet made or holds shares in. */
export function MyCoins() {
  const w = useWallet();
  return <Mine key={w.accountId ?? ""} />;
}

function Mine() {
  const w = useWallet();
  const live = useLiveArena();
  const { searching, loaded } = useChainHoldings(live.coins, w.accountId);
  const held = useHoldingsOf(w.accountId);

  if (!w.accountId) {
    return (
      <Empty
        id="wallet"
        mood="thinking"
        title="No wallet in this browser yet"
        action={
          <button className="btn" onClick={() => w.setOpen(true)}>
            <WalletIcon size={16} /> Get a free wallet
          </button>
        }
      >
        Your coins show up here once you launch one or buy shares.
      </Empty>
    );
  }

  const account = w.accountId;
  const coins = live.coins ?? [];
  const mine = [...madeBy(coins, account), ...coins.filter((c) => c.creator !== account && holds(held.get(c.id))).sort(richest)];
  const matches = live.parleys.map((p) => fromParley(p)).filter((m) => m.settled);
  const names = new Map(coins.map((c) => [c.id, c.name]));
  const name = (id: string) => names.get(id) ?? id.toUpperCase();
  const explorer = accountLink(live.info, account);
  const loading = !live.coins || searching || (!loaded && !mine.length);

  return (
    <>
      <div className="my-wallet">
        <Mascot id={account} size={44} />
        <div className="my-wallet-text">
          {w.kind === "near" ? (
            <b>
              Your NEAR wallet {w.walletName && <span className="wallet-by">{w.walletName}</span>}
            </b>
          ) : (
            <b>Your play wallet</b>
          )}
          {explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="mono-line">
              {account}
            </a>
          ) : (
            <span className="mono-line">{account}</span>
          )}
        </div>
        <span className="my-balance">{w.balance ? fmtNear(w.balance) : "…"} NEAR</span>
        {w.kind === "near" ? (
          <span className="my-wallet-tools">
            <button className="tiny" onClick={() => w.setOpen(true)}>
              Switch
            </button>
            <button className="tiny" onClick={w.disconnect}>
              Sign out
            </button>
          </span>
        ) : (
          <>
            {w.nearReady && (
              <button className="tiny" onClick={() => w.setOpen(true)}>
                Use my NEAR wallet
              </button>
            )}
            <Forget />
          </>
        )}
      </div>
      <div style={{ height: 14 }} />
      <YourMatches coins={mine.map((c) => c.id)} name={name} />
      <div className="my-list">
        {mine.map((c) => {
          const last = matches.find((m) => m.a === c.id || m.b === c.id);
          const side = last && (last.a === c.id ? "A" : "B");
          const move = last && (side === "A" ? last.aMove : last.bMove);
          const delta = last ? BigInt(side === "A" ? last.aDelta : last.bDelta) : 0n;
          const rival = last && (side === "A" ? last.b : last.a);
          const holding = held.get(c.id);
          const shares = holding ? BigInt(holding.shares) : undefined;
          const order = holding?.order;
          const price = BigInt(c.total_shares) > 0n ? nearNumber(c.treasury) / nearNumber(c.total_shares) : 0;
          return (
            <Link key={c.id} to={`/coin/${c.id}`} className="my-coin" style={{ "--c": mascotColor(c.id) } as React.CSSProperties}>
              <Mascot id={c.id} size={56} mood={delta > 0n ? "win" : delta < 0n ? "lose" : "idle"} />
              <span className="my-main">
                <b>
                  {c.name}
                  {c.creator === account && <span className="my-tag">You made it</span>}
                </b>
                <small>{tagline(c.id, c.constitution)}</small>
                {order && (
                  <span className="my-order">
                    <ClockIcon size={14} /> Order waiting for the next match: {order.kind === "Mint" ? `buy with ${fmtNear(order.amount)} NEAR` : `sell ${fmtNear(order.amount)} shares`}
                  </span>
                )}
              </span>
              <span className="my-stat">
                <b>{fmtNear(c.treasury)}</b>
                <small>NEAR treasury</small>
              </span>
              <span className="my-stat">
                <b>{typeof shares === "bigint" ? fmtNear(shares) : "…"}</b>
                <small>{typeof shares === "bigint" && shares > 0n ? `your shares, about ${(nearNumber(shares) * price).toFixed(2)} NEAR` : "your shares"}</small>
              </span>
              <span className="my-last">
                {last && move && rival ? (
                  <>
                    <small>Last match</small>
                    <span>
                      <span className={`move-chip ${move === "Cooperate" ? "t" : "b"}`}>
                        {move === "Cooperate" ? <TrustIcon size={13} /> : <BetrayIcon size={13} />} {moveWord(move)}
                      </span>{" "}
                      vs {name(rival)} <span className={`change ${delta > 0n ? "up" : delta < 0n ? "down" : "faint"}`}>{signedNear(delta)}</span>
                    </span>
                  </>
                ) : (
                  <small>{c.stats.matches ? `${c.stats.matches} matches played` : "No matches yet"}</small>
                )}
              </span>
              <ArrowIcon size={16} className="my-go" />
            </Link>
          );
        })}
        {loading && !mine.length && <p className="muted loading-line">Looking up your coins…</p>}
        {!loading && !mine.length && (
          <Empty
            id={account}
            mood="idle"
            title="No coins yet"
            action={
              <Link to="/launch" className="btn">
                Launch a coin
              </Link>
            }
          >
            Launch one, or buy shares in any coin, and it shows up here.
          </Empty>
        )}
      </div>
    </>
  );
}
