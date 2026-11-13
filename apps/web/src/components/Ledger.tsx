import type { Coin } from "@parley/sdk/src/types.ts";
import { Link } from "react-router-dom";
import { type LedgerEntry, type LedgerSummary, amount, describe, headline, useLedger, useLedgerSummary, when } from "../lib/ledger.ts";
import { type ArenaInfo, txLink, useArenaInfo } from "../lib/live.ts";
import { fmtNear } from "../lib/model.ts";
import { Mark } from "./Mark.tsx";
import { Mascot } from "./Mascot.tsx";
import "./ledger.css";

const n = (yocto: string | bigint) => `${fmtNear(yocto)} NEAR`;
const signed = (yocto: string | bigint) => `${BigInt(yocto) > 0n ? "+" : BigInt(yocto) < 0n ? "−" : ""}${amount(BigInt(yocto) < 0n ? -BigInt(yocto) : yocto)} NEAR`;

export function LedgerRow({ entry, name, info, coin }: { entry: LedgerEntry; name: (id: string) => string; info: ArenaInfo | null; coin?: string }) {
  const link = txLink(info, entry.tx);
  const change = coin ? entry.treasury[coin] : undefined;
  const shown = change !== undefined && BigInt(change) !== 0n ? signed(change) : headline(entry);
  const tone = change === undefined ? "" : BigInt(change) > 0n ? "up" : BigInt(change) < 0n ? "down" : "";
  return (
    <div className="ledger-row">
      <span className={`ledger-faces ${entry.coins.length > 1 ? "pair" : ""}`}>
        {entry.coins.length ? entry.coins.slice(0, 2).map((id) => <Mascot key={id} id={id} size={30} />) : <Mark />}
      </span>
      <span className="ledger-text">
        <span>{describe(entry, name, info?.contractId)}</span>
        <span className="ledger-meta">
          {when(entry.at)}
          {entry.parley !== undefined && (
            <>
              {" · "}
              <Link to={`/match/${entry.parley}`}>Match #{entry.parley}</Link>
            </>
          )}
          {link && (
            <>
              {" · "}
              <a href={link} target="_blank" rel="noreferrer">
                See it on NEAR
              </a>
            </>
          )}
        </span>
      </span>
      <b className={`ledger-amount ${tone}`}>{shown}</b>
    </div>
  );
}

export function BooksCheck({ summary }: { summary: LedgerSummary }) {
  const { books, status } = summary;
  if (!books) return <div className="books">{status.caughtUp ? <p className="muted">The books check runs after the next read of the contract.</p> : <p className="muted">Reading every transaction since launch. {status.txs.toLocaleString("en-US")} read so far.</p>}</div>;
  const spare = BigInt(books.spare);
  const lines: [string, string][] = [
    ["Coin treasuries", books.treasuries],
    ["The pot", books.pot],
    ["Held for open buy orders", books.escrow],
    [`Storage on NEAR (${(books.storageBytes / 1_000_000).toFixed(2)} MB)`, books.storage],
  ];
  return (
    <div className="books">
      <h2>{books.balanced ? "The books balance" : "The books are short"}</h2>
      <p className="books-lead">
        The contract holds <b>{n(books.balance)}</b>. It owes <b>{n(books.owed)}</b> to coins, the pot and open orders, and <b>{n(books.storage)}</b> pays for its storage.{" "}
        {books.balanced ? (
          <>
            That leaves <b>{n(spare)}</b> over, NEAR it holds but owes to no one.
          </>
        ) : (
          <>
            It is <b>{n(-spare)}</b> short.
          </>
        )}
      </p>
      <div className="books-sheet">
        {lines.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{n(value)}</b>
          </div>
        ))}
        <div>
          <span>{books.balanced ? "Owed to no one" : "Short"}</span>
          <b className={books.balanced ? "" : "down"}>{n(spare < 0n ? -spare : spare)}</b>
        </div>
        <div className="books-total">
          <span>Balance of {status.contractId}</span>
          <b>{n(books.balance)}</b>
        </div>
      </div>
      <p className="books-replay">
        {books.replay.matches
          ? `Adding up all ${books.replay.entries.toLocaleString("en-US")} money moves below gives every coin's treasury and shares, the pot and the open orders exactly as the contract reports them, to the last yoctoNEAR.`
          : `Adding up the ${books.replay.entries.toLocaleString("en-US")} money moves below does not match the contract on: ${books.replay.differences
              .slice(0, 4)
              .map((d) => d.what)
              .join(", ")}.`}
      </p>
      <p className="books-when">
        Checked at block {books.block.toLocaleString("en-US")}, {when(books.at)}.{status.unread.length ? ` ${status.unread.length} transactions could not be read.` : ""}
      </p>
    </div>
  );
}

export function LedgerTotals({ summary }: { summary: LedgerSummary }) {
  const t = summary.totals;
  const potIn = BigInt(t.potIn.seed) + BigInt(t.potIn.fees) + BigInt(t.potIn.matches);
  const tiles: [string, string][] = [
    [n(t.intoTreasuries), "put into coin treasuries by launches and buys"],
    [n(t.soldOut), "paid out of treasuries to sellers"],
    [n(t.taken), `taken by betrayals in ${t.matches.toLocaleString("en-US")} matches`],
    [n(potIn), "paid into the pot"],
    [n(t.potOut), "paid out of the pot to coins that both trusted"],
    [fmtNear(t.sharesMinted), `shares made, ${fmtNear(t.sharesBurned)} sold back`],
  ];
  return (
    <div className="ledger-totals">
      {tiles.map(([value, label]) => (
        <div key={label}>
          <b>{value}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function CoinMoney({ coin, name }: { coin: Coin; name: (id: string) => string }) {
  const { info } = useArenaInfo();
  const { summary } = useLedgerSummary();
  const { entries } = useLedger(coin.id, [], 5);
  const mine = summary?.coins.find((c) => c.id === coin.id);
  if (!summary || !mine) return null;
  const adds = BigInt(mine.treasury) === BigInt(coin.treasury);
  const stats: [string, string, string][] = [
    [n(mine.launched), "launched with", ""],
    [n(mine.bought), "bought in", ""],
    [n(mine.sold), "paid to sellers", ""],
    [signed(BigInt(mine.won) - BigInt(mine.lost)), `from ${mine.matches} matches`, BigInt(mine.won) >= BigInt(mine.lost) ? "up" : "down"],
  ];
  return (
    <section className="coin-money">
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: 30 }}>Money in and out</h2>
          <p>{adds ? `It all adds up to the ${n(coin.treasury)} in its treasury now.` : `It adds up to ${n(mine.treasury)}. The newest moves are still being read.`}</p>
        </div>
      </div>
      <div className="ledger-totals compact">
        {stats.map(([value, label, tone]) => (
          <div key={label}>
            <b className={tone}>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="ledger-list">
        {entries.map((e) => (
          <LedgerRow key={e.seq} entry={e} name={name} info={info} coin={coin.id} />
        ))}
      </div>
      <Link to={`/money?coin=${coin.id}`} className="ledger-more">
        See every money move of {coin.name}
      </Link>
    </section>
  );
}
