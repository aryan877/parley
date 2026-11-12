import type { Coin } from "@parley/sdk/src/types.ts";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { accountLink, readArena, useArenaInfo, useLiveArena } from "../lib/live.ts";
import { fmtNear, fromParley, nearNumber, signedNear } from "../lib/model.ts";
import { useWallet } from "../lib/wallet.tsx";
import { moveWord, tagline } from "../lib/words.ts";
import { YourMatches } from "./ArenaNow.tsx";
import { Empty } from "./Empty.tsx";
import { MineGuide } from "./Guide.tsx";
import { Mascot, mascotColor } from "./Mascot.tsx";
import { ArrowIcon, BetrayIcon, TrustIcon, WalletIcon } from "./icons.tsx";

/** Shares the account holds in each coin, counting shares locked in a vote. Only coins with some are kept. */
function useHoldings(coins: Coin[] | null, account: string | null) {
  const { info } = useArenaInfo();
  const [held, setHeld] = useState<Map<string, bigint> | null>(null);
  const latest = useRef(coins);
  latest.current = coins;
  const count = coins?.length ?? 0;
  useEffect(() => {
    if (!info || !account || !count) return;
    const arena = readArena(info);
    let live = true;
    const load = async () => {
      const list = latest.current ?? [];
      const out = new Map<string, bigint>();
      for (let i = 0; i < list.length; i += 6) {
        await Promise.all(
          list.slice(i, i + 6).map(async (c) => {
            const [shares, vote] = await Promise.all([
              arena.shares(c.id, account).catch(() => "0"),
              arena.view<{ locked: string } | null>("get_vote", { coin: c.id, account }).catch(() => null),
            ]);
            const total = BigInt(shares) + BigInt(vote?.locked ?? "0");
            if (total > 0n) out.set(c.id, total);
          }),
        );
      }
      if (live) setHeld(out);
    };
    load().catch(() => {});
    const timer = setInterval(() => load().catch(() => {}), 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [info, account, count]);
  return held;
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

/** The coins this browser's play wallet made or holds shares in. */
export function MyCoins() {
  const w = useWallet();
  const live = useLiveArena();
  const held = useHoldings(live.coins, w.accountId);

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
  const mine = [...madeBy(coins, account), ...coins.filter((c) => c.creator !== account && held?.has(c.id)).sort(richest)];
  const matches = live.parleys.map((p) => fromParley(p)).filter((m) => m.settled);
  const names = new Map(coins.map((c) => [c.id, c.name]));
  const name = (id: string) => names.get(id) ?? id.toUpperCase();
  const explorer = accountLink(live.info, account);
  const loading = !live.coins || (held === null && !coins.some((c) => c.creator === account));

  return (
    <>
      <div className="my-wallet">
        <Mascot id={account} size={44} />
        <div className="my-wallet-text">
          <b>Your play wallet</b>
          {explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="mono-line">
              {account}
            </a>
          ) : (
            <span className="mono-line">{account}</span>
          )}
        </div>
        <span className="my-balance">{w.balance ? fmtNear(w.balance) : "…"} NEAR</span>
        <Forget />
      </div>
      <MineGuide coin={mine[0]?.id ?? account} />
      <div style={{ height: 14 }} />
      <YourMatches coins={mine.map((c) => c.id)} name={name} />
      <div className="my-list">
        {mine.map((c) => {
          const last = matches.find((m) => m.a === c.id || m.b === c.id);
          const side = last && (last.a === c.id ? "A" : "B");
          const move = last && (side === "A" ? last.aMove : last.bMove);
          const delta = last ? BigInt(side === "A" ? last.aDelta : last.bDelta) : 0n;
          const rival = last && (side === "A" ? last.b : last.a);
          const shares = held?.get(c.id) ?? 0n;
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
              </span>
              <span className="my-stat">
                <b>{fmtNear(c.treasury)}</b>
                <small>NEAR treasury</small>
              </span>
              <span className="my-stat">
                <b>{fmtNear(shares)}</b>
                <small>{shares > 0n ? `your shares, about ${(nearNumber(shares) * price).toFixed(2)} NEAR` : "your shares"}</small>
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
