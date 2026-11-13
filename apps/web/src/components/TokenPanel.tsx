import { type CallResult, TOKEN_DEPOSIT } from "@parley/sdk/src/arena.ts";
import type { Coin, TokenMetadata } from "@parley/sdk/src/types.ts";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { accountLink } from "../lib/live.ts";
import { fmtNear } from "../lib/model.ts";
import { forget, reads, tokenChain } from "../lib/near.ts";
import { CANCELLED, noteCoin, useWallet } from "../lib/wallet.tsx";
import { WalletIcon } from "./icons.tsx";
import "./TokenPanel.css";

const YOCTO = 10n ** 24n;
const ENOUGH = TOKEN_DEPOSIT + YOCTO / 10n;

type Note = { tone: "good" | "bad"; text: string };

function parse(text: string): bigint | null {
  const t = text.trim();
  if (!t || !/^\d*(\.\d*)?$/.test(t)) return null;
  const [whole = "0", frac = ""] = t.split(".");
  const value = BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
  return value > 0n ? value : null;
}

const plain = (yocto: bigint) => {
  const whole = yocto / YOCTO;
  const frac = (yocto % YOCTO).toString().padStart(24, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
};

function failed(label: string, error?: string): string {
  if (error === CANCELLED) return CANCELLED;
  if (/Not enough balance|NotEnoughBalance|LackBalance/i.test(error ?? "")) return `${label} failed: not enough NEAR in your wallet for gas.`;
  return `${label} failed: ${error?.match(/panicked: ([^"\\]+)/)?.[1] ?? error?.slice(0, 140) ?? "unknown error"}.`;
}

function Notice({ note }: { note: Note | null }) {
  return (
    <AnimatePresence>
      {note && (
        <motion.div className={`notice ${note.tone}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          {note.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Create({ coin, onMade }: { coin: Coin; onMade: (token: string) => void }) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const symbol = coin.id.toUpperCase();
  const balance = w.balance === null ? null : BigInt(w.balance);
  const enough = balance !== null && balance >= ENOUGH;
  const need = `${fmtNear(ENOUGH, 1)} NEAR`;

  const create = async () => {
    const arena = w.arena();
    if (!arena || !w.info) return w.setOpen(true);
    setBusy(true);
    setNote(null);
    const r = await arena.createToken(coin.id);
    setBusy(false);
    forget(w.info, "get_coins", "get_coin");
    w.refresh();
    if (r.ok) onMade(String(r.value));
    else setNote({ tone: "bad", text: failed("Creating the token", r.error) });
  };

  return (
    <>
      <div className="token-head">
        <h3>No {symbol} token yet</h3>
      </div>
      <p className="token-lead">
        {coin.name}'s shares live inside the arena. A token would let holders wrap them into {symbol}, a standard NEAR token, and send or trade them anywhere.
      </p>
      <p className="token-cost">Anyone can create it, once. It costs 3 NEAR, which stays with the token contract to pay for its storage on NEAR.</p>
      {enough ? (
        <button className="btn" disabled={busy} onClick={create}>
          {busy ? (w.kind === "near" ? "Approve it in your wallet…" : "Creating…") : `Create the ${symbol} token for 3 NEAR`}
        </button>
      ) : w.kind !== "near" ? (
        <div className="token-row">
          <p className="token-cost">
            {w.kind === "play" && "Play wallets get 1.5 test NEAR, which is not enough. "}To create it, connect your own NEAR wallet with at least {need}.
          </p>
          {w.nearReady && (
            <button className="btn ghost small-btn" onClick={() => w.setOpen(true)}>
              <WalletIcon size={16} /> Use my NEAR wallet
            </button>
          )}
        </div>
      ) : (
        balance !== null && (
          <p className="token-cost">
            Your wallet has {fmtNear(balance)} NEAR. Creating the token needs {need}, counting a little for gas.
          </p>
        )
      )}
      <Notice note={note} />
    </>
  );
}

function Wrapped({ coin, token }: { coin: Coin; token: string }) {
  const w = useWallet();
  const info = w.info;
  const account = w.accountId;
  const [meta, setMeta] = useState<TokenMetadata | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);
  const [held, setHeld] = useState<bigint | null>(null);
  const [free, setFree] = useState<bigint | null>(null);
  const [mode, setMode] = useState<"wrap" | "unwrap">("wrap");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const load = useCallback(async () => {
    if (!info) return;
    const [m, s, h, f] = await Promise.allSettled([
      reads.tokenMeta(info, token),
      reads.tokenSupply(info, token),
      account ? reads.tokenBalance(info, token, account) : Promise.resolve(null),
      account ? reads.shares(info, coin.id, account) : Promise.resolve(null),
    ]);
    if (m.status === "fulfilled") setMeta(m.value);
    if (s.status === "fulfilled") setSupply(BigInt(s.value));
    if (h.status === "fulfilled" && h.value !== null) setHeld(BigInt(h.value));
    if (f.status === "fulfilled" && f.value !== null) setFree(BigInt(f.value));
  }, [info, token, account, coin.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const symbol = meta?.symbol ?? coin.id.toUpperCase();
  const link = accountLink(info, token);
  const max = mode === "wrap" ? free : held;
  const value = parse(amount);
  const ready = !busy && value !== null && max !== null && value <= max;

  const run = async (label: string, action: () => Promise<CallResult>, done: string) => {
    if (!info) return;
    setBusy(true);
    setNote(null);
    const r = await action();
    setBusy(false);
    if (r.ok) {
      noteCoin(account, coin.id);
      setAmount("");
    }
    setNote(r.ok ? { tone: "good", text: done } : { tone: "bad", text: failed(label, r.error) });
    forget(tokenChain(info, token));
    w.refresh();
    await load();
  };

  const wrap = () => value && run("Wrapping", () => w.arena()!.wrapShares(coin.id, value), `Wrapped ${fmtNear(value)} shares into ${fmtNear(value)} ${symbol}.`);
  const unwrap = () => value && run("Unwrapping", () => w.arena()!.unwrap(token, value), `Unwrapped ${fmtNear(value)} ${symbol}. The shares are back in the arena.`);
  const switchTo = (next: "wrap" | "unwrap") => {
    setMode(next);
    setAmount("");
    setNote(null);
  };

  return (
    <>
      <div className="token-head">
        <h3>{symbol} token</h3>
        <span className="token-std">NEP-141</span>
      </div>
      <p className="token-lead">
        Shares live inside the arena, where they vote and sell. Wrap them into {symbol}, a standard NEAR token, to send or trade them anywhere. Unwrap to get the shares back. One share makes one {symbol}.
      </p>
      <dl className="token-facts">
        <div>
          <dt>Token account</dt>
          <dd>
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" className="token-account">
                {token}
              </a>
            ) : (
              <span className="token-account">{token}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Wrapped in all</dt>
          <dd>{supply === null ? "…" : `${fmtNear(supply)} ${symbol}`}</dd>
        </div>
        {account && (
          <div>
            <dt>You hold</dt>
            <dd>{held === null ? "…" : `${fmtNear(held)} ${symbol}`}</dd>
          </div>
        )}
      </dl>
      {!account ? (
        <button className="btn ghost" onClick={() => w.setOpen(true)}>
          <WalletIcon size={16} /> Get a wallet to wrap shares
        </button>
      ) : (
        <div className="token-actions">
          <div className="tabs">
            <button className={mode === "wrap" ? "on" : ""} onClick={() => switchTo("wrap")}>
              Wrap
            </button>
            <button className={mode === "unwrap" ? "on" : ""} onClick={() => switchTo("unwrap")}>
              Unwrap
            </button>
          </div>
          {max === 0n ? (
            <p className="token-cost">
              {mode === "wrap" ? `You have no free ${coin.name} shares. Buy some first. Shares in a vote or a sell order cannot be wrapped.` : `You hold no ${symbol} to unwrap.`}
            </p>
          ) : (
            <>
              <label className="field">
                <span>{mode === "wrap" ? "Shares to wrap" : `${symbol} to unwrap`}</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" />
                <button className="tiny" disabled={max === null} onClick={() => max !== null && setAmount(plain(max))}>
                  max
                </button>
              </label>
              <p className="token-cost">
                {mode === "wrap"
                  ? `You can wrap up to ${max === null ? "…" : fmtNear(max)} shares. Wrapped shares cannot vote or sell until you unwrap them.`
                  : `You can unwrap up to ${max === null ? "…" : fmtNear(max)} ${symbol}. Each one comes back as a share in the arena.`}
              </p>
              <button className="btn" disabled={!ready} onClick={mode === "wrap" ? wrap : unwrap}>
                {busy ? (w.kind === "near" ? "Approve it in your wallet…" : "Sending…") : mode === "wrap" ? `Wrap ${value ? `${fmtNear(value)} ` : ""}shares` : `Unwrap ${value ? `${fmtNear(value)} ` : ""}${symbol}`}
              </button>
            </>
          )}
        </div>
      )}
      <Notice note={note} />
    </>
  );
}

export function TokenPanel({ coin }: { coin: Coin }) {
  const [made, setMade] = useState<string | null>(null);
  const token = coin.token ?? made;
  if (coin.house) return null;
  return <section className="glass token-panel">{token ? <Wrapped coin={coin} token={token} /> : <Create coin={coin} onMade={setMade} />}</section>;
}
