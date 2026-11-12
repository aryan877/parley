import type { Coin, Move, Parley } from "@parley/sdk/src/types.ts";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { subscribeLive, useArenaInfo } from "../lib/live.ts";
import { holdings, holds } from "../lib/holdings.ts";
import { reads } from "../lib/near.ts";
import { fmtNear } from "../lib/model.ts";
import { useWallet } from "../lib/wallet.tsx";
import { watching } from "../lib/watching.ts";
import { Mascot, type Mood, mascotColor } from "./Mascot.tsx";

interface Toast {
  key: string;
  coin: string;
  mood: Mood;
  text: string;
  to: string;
  action: string;
}

const SHOW_MS = 8000;
const verb = (m: Move | null) => (m === "Defect" ? "betrayed" : "trusted");
const amount = (v: bigint) => fmtNear(v, v < 10n ** 22n ? 4 : 2);

function outcome(p: Parley, side: "A" | "B", me: string, them: string): { text: string; mood: Mood } {
  if (p.status === "Void") return { text: `${me}'s match with ${them} timed out. No money moved`, mood: "idle" };
  const [mine, theirs] = side === "A" ? [p.a_move, p.b_move] : [p.b_move, p.a_move];
  const delta = BigInt(side === "A" ? p.a_delta : p.b_delta);
  const money = delta > 0n ? `${me} won ${amount(delta)} NEAR` : delta < 0n ? `${me} lost ${amount(-delta)} NEAR` : "No money moved";
  return { text: `${me} ${verb(mine)}, ${them} ${verb(theirs)}. ${money}`, mood: delta > 0n ? "win" : delta < 0n ? "lose" : "idle" };
}

/** Small app-wide notes when a coin the visitor made or holds starts or finishes a live match it is not already watching. */
export function Alerts() {
  const w = useWallet();
  const { info } = useArenaInfo();
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (key: string) => setToasts((list) => list.filter((t) => t.key !== key));

  useEffect(() => {
    if (!info || !w.accountId) return;
    const account = w.accountId;
    const seen = new Set<string>();
    const coins = new Map<string, Promise<Coin | null>>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let live = true;
    const coin = (id: string) => {
      if (!coins.has(id)) {
        const found = reads.coins(info).then((list) => list.find((c) => c.id === id) ?? reads.coin(info, id), () => reads.coin(info, id));
        coins.set(id, found.catch(() => (coins.delete(id), null)));
      }
      return coins.get(id)!;
    };
    const push = (t: Toast) => {
      if (seen.has(t.key)) return;
      seen.add(t.key);
      setToasts((list) => [...list.filter((x) => x.key !== t.key), t].slice(-2));
      const timer = setTimeout(() => (timers.delete(timer), dismiss(t.key)), SHOW_MS);
      timers.add(timer);
    };
    const handle = async (p: Parley, done: boolean) => {
      const key = `${done ? "s" : "o"}${p.id}`;
      if (seen.has(key)) return;
      const [a, b] = await Promise.all([coin(p.a), coin(p.b)]);
      const held = holdings(account);
      const ours = (c: Coin | null) => !!c && (c.creator === account || holds(held.get(c.id)));
      const side = ours(a) ? "A" : ours(b) ? "B" : null;
      if (!live || !side || path.current === `/match/${p.id}` || watching(p)) return;
      const me = (side === "A" ? a : b)!;
      const them = (side === "A" ? b?.name : a?.name) ?? (side === "A" ? p.b : p.a).toUpperCase();
      if (!done) return push({ key, coin: me.id, mood: "thinking", text: `${me.name} is playing ${them} now`, to: `/match/${p.id}`, action: "Watch" });
      push({ key, coin: me.id, ...outcome(p, side, me.name, them), to: `/match/${p.id}`, action: "View" });
    };
    const off = subscribeLive({
      event(e) {
        if (e.type === "hello" && e.current?.parley.status === "Open") handle(e.current.parley, false);
        else if (e.type === "opened") handle(e.parley, false);
        else if (e.type === "settled") handle(e.parley, true);
      },
    });
    return () => {
      live = false;
      off();
      for (const t of timers) clearTimeout(t);
    };
  }, [info, w.accountId]);

  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.key}
            layout
            className="toast"
            style={{ "--c": mascotColor(t.coin) } as React.CSSProperties}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <Mascot id={t.coin} size={38} mood={t.mood} />
            <span className="toast-text">{t.text}</span>
            <Link to={t.to} className="btn small-btn toast-go" onClick={() => dismiss(t.key)}>
              {t.action}
            </Link>
            <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.key)}>
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
