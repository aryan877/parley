import { LocalEnclave } from "@parley/sdk/src/enclave.ts";
import type { Parley } from "@parley/sdk/src/types.ts";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { txLink, useSchedule } from "../lib/live.ts";
import { useWallet } from "../lib/wallet.tsx";
import { FakeGuide } from "./Guide.tsx";
import { BetrayIcon, ShieldCheckIcon, WalletIcon } from "./icons.tsx";
import { Mascot } from "./Mascot.tsx";

const POLL_MS = 4000;
const GIVE_UP_MS = 180_000;
const ENDED = /not open|timed out|no turn left/i;

type State =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "waiting"; note?: string }
  | { kind: "refused"; parley: number; turn: number; reason: string; hash: string }
  | { kind: "accepted"; parley: number; hash: string }
  | { kind: "error"; text: string }
  | { kind: "gave-up" };

function explain(reason: string): string {
  if (/not an active enclave signer/.test(reason)) return "Your made-up key is not one of the hardware keys the contract trusts for this AI. The reply never counted.";
  if (/signature does not match/.test(reason)) return "The signature does not match this exact question and answer.";
  return "The contract would not take it. The match goes on as if you never tried.";
}

const clock = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** Signs a made-up AI reply for the turn being played right now and lets the contract refuse it. */
export function FakeReply() {
  const w = useWallet();
  const { schedule, skew } = useSchedule(4000);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [now, setNow] = useState(Date.now());
  const running = useRef(false);
  const deadline = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const again = useRef<() => void>(() => {});

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (state.kind !== "waiting") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [state.kind]);

  const wait = (note?: string) => {
    deadline.current ||= Date.now() + GIVE_UP_MS;
    if (Date.now() > deadline.current) {
      deadline.current = 0;
      return setState({ kind: "gave-up" });
    }
    setState({ kind: "waiting", note });
    timer.current = setTimeout(() => again.current(), POLL_MS);
  };

  const attempt = async () => {
    if (running.current) return;
    const arena = w.arena();
    if (!arena) return w.setOpen(true);
    running.current = true;
    clearTimeout(timer.current);
    try {
      setState((s) => (s.kind === "waiting" ? s : { kind: "busy", step: "Looking for a match being played…" }));
      let target: { parley: Parley; request: string } | null = null;
      for (const p of await arena.parleys(0, 5)) {
        if (p.status !== "Open") continue;
        const request = await arena.turnRequest(p.id);
        if (request) {
          target = { parley: p, request };
          break;
        }
      }
      if (!target) return wait();
      const { parley, request } = target;
      const turn = parley.turns.length;
      const model = turn % 2 === 0 ? parley.a_model : parley.b_model;
      setState({ kind: "busy", step: "Signing a fake reply with a key you just made up…" });
      const response = JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "DEFECT" } }] });
      const reply = new LocalEnclave(crypto.getRandomValues(new Uint8Array(32))).sign(model, request, response);
      setState({ kind: "busy", step: "Sending it to the contract…" });
      const result = await arena.submitTurn(parley.id, reply);
      w.refresh();
      const reason = result.error?.match(/Smart contract panicked: ([^"\\]+)/)?.[1]?.trim();
      if (result.ok) {
        deadline.current = 0;
        setState({ kind: "accepted", parley: parley.id, hash: result.hash });
      } else if (reason && ENDED.test(reason)) {
        wait("That match just ended. Waiting for the next one.");
      } else if (reason) {
        deadline.current = 0;
        setState({ kind: "refused", parley: parley.id, turn, reason, hash: result.hash });
      } else {
        deadline.current = 0;
        const broke = /not enough balance|NotEnoughBalance|LackBalance/i.test(result.error ?? "");
        setState({ kind: "error", text: broke ? "Your play wallet is out of test NEAR for gas." : `It never reached the contract: ${result.error?.slice(0, 160) ?? "unknown error"}` });
      }
    } catch (e) {
      deadline.current = 0;
      setState({ kind: "error", text: `Something went wrong: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` });
    } finally {
      running.current = false;
    }
  };
  again.current = attempt;

  const busy = state.kind === "busy";
  const waiting = state.kind === "waiting";
  const next = schedule?.next ? Math.max(0, Math.round((schedule.next.at + skew - now) / 1000)) : null;
  const waitLine = schedule?.current
    ? "A match is starting. Trying again in a moment."
    : next && next > 2
      ? `No match is being played right now. The next one starts in ${clock(next)}.`
      : "No match is being played right now. The next one starts any moment.";
  const link = state.kind === "refused" || state.kind === "accepted" ? txLink(w.info, state.hash) : null;
  const label = !w.accountId ? "Get a free wallet to try" : busy ? "Working…" : waiting ? "Try now" : state.kind === "refused" ? "Try another fake" : "Try to fake a reply";

  return (
    <section className="fake">
      <div className="fake-card">
        <div className="fake-head">
          <motion.span className="fake-art" animate={{ rotate: [0, -6, 4, 0] }} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.6 }}>
            <Mascot id="snake" size={72} mood={state.kind === "refused" ? "lose" : "betray"} />
          </motion.span>
          <div>
            <h2>Can you fool the contract?</h2>
            <p className="muted">
              Make up a key, sign a fake AI reply with it, and send it to the match being played right now.
              <br />
              If the contract takes it, you win. It costs a tiny bit of test NEAR for gas.
            </p>
          </div>
        </div>
        <FakeGuide />
        <div className="fake-act">
          <motion.button
            className="btn big betray"
            disabled={busy || !w.info}
            onClick={() => (w.accountId ? attempt() : w.setOpen(true))}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            {w.accountId ? <BetrayIcon size={18} /> : <WalletIcon size={18} />} {label}
          </motion.button>
          {!w.info && <span className="faint small">The live arena is offline right now.</span>}
        </div>

        <AnimatePresence mode="wait">
          {busy && (
            <motion.p key="busy" className="fake-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {state.step}
            </motion.p>
          )}
          {waiting && (
            <motion.p key="waiting" className="fake-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {state.note ?? waitLine} It tries again by itself every few seconds.
            </motion.p>
          )}
          {state.kind === "gave-up" && (
            <motion.p key="gave-up" className="fake-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Still no match after 3 minutes. Try again in a bit.
            </motion.p>
          )}
          {state.kind === "error" && (
            <motion.div key="error" className="notice bad" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {state.text}
            </motion.div>
          )}
          {state.kind === "refused" && (
            <motion.div
              key={`refused${state.hash}`}
              className="fake-result"
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
            >
              <ShieldCheckIcon size={44} />
              <div>
                <h3>Refused by the contract: {state.reason}</h3>
                <p>{explain(state.reason)}</p>
                <p className="faint small">
                  You tried <Link to={`/match/${state.parley}`}>match {state.parley}</Link>, message {state.turn + 1}. Nothing changed, and the match goes on.
                </p>
                {link ? (
                  <a className="chain-link" href={link} target="_blank" rel="noreferrer">
                    See the refused transaction
                  </a>
                ) : (
                  <p className="faint small">
                    Refused transaction <code>{state.hash.slice(0, 12)}…</code>
                  </p>
                )}
              </div>
            </motion.div>
          )}
          {state.kind === "accepted" && (
            <motion.div key="accepted" className="notice bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              The contract took it. That should never happen. Please tell us, with this transaction: {link ? <a href={link}>{state.hash}</a> : <code>{state.hash}</code>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
