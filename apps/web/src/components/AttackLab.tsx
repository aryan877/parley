import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import recorded from "../../../../deployments/testnet-attacks.json";
import { ARENA_API, askArena, txLink, useArenaInfo, useSchedule } from "../lib/live.ts";
import { clock, useNow } from "../lib/time.ts";
import { ShieldCheckIcon } from "./icons.tsx";
import { txUrl } from "./OnChain.tsx";
import "./AttackLab.css";

type AttackId = "unknown-key" | "replay" | "one-letter" | "drain" | "vote" | "enact" | "house-coin";

interface Refusal {
  attack: AttackId;
  method: string;
  reason: string;
  tx: string;
  at: string;
  target: string;
  parley?: number;
  turn?: number;
  edit?: { before: string; after: string };
}

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "waiting"; text: string }
  | { kind: "note"; text: string }
  | { kind: "refused"; refusal: Refusal; shared: boolean }
  | { kind: "error"; text: string };

interface Attack {
  id: AttackId;
  title: string;
  tries: string;
  why: (reason: string) => string;
  match?: boolean;
  busy?: string;
}

const ATTACKS: Attack[] = [
  {
    id: "unknown-key",
    title: "Sign with a made-up key",
    tries: "Signs a fake AI reply with a brand new key and sends it to the match being played.",
    why: () => "The contract only takes replies signed by a hardware key it registered for that AI. This key is not one of them.",
    match: true,
  },
  {
    id: "replay",
    title: "Reuse a real reply",
    tries: "Takes a genuine signed reply from an earlier match and sends it into the match being played.",
    why: () => "The signature covers the exact question and the exact answer. This match asked a different question.",
    match: true,
  },
  {
    id: "one-letter",
    title: "Change one letter",
    tries: "Catches the AI's real signed reply for the next message, changes one letter, and sends it first.",
    why: () => "One changed letter and the signature no longer matches. The real reply went through right after.",
    match: true,
    busy: "Waiting for the AI's next signed reply. This can take up to a minute…",
  },
  {
    id: "drain",
    title: "Take money out",
    tries: "Asks to cash out every share of the richest coin, from an account that owns none.",
    why: () => "Money only leaves a treasury when holders sell their own shares. This account has none.",
  },
  {
    id: "vote",
    title: "Vote without shares",
    tries: "Votes on an open rule change with all of a coin's shares. When no vote is open, it proposes new rules instead.",
    why: (reason) => (/propose/.test(reason) ? "Proposing new rules takes at least 1% of a coin's shares. This account owns none." : "Votes count in shares, and this account owns none."),
  },
  {
    id: "enact",
    title: "Skip the waiting time",
    tries: "Puts a rule change in force before its vote has passed and its waiting time is over.",
    why: (reason) =>
      /not passed/.test(reason) ? "A rule change only counts after holders vote it through." : "A passed vote waits a set time, so holders who disagree can sell first. Nobody can skip it.",
  },
  {
    id: "house-coin",
    title: "Make a house coin",
    tries: "Creates a house coin, the kind with no holders and rules that can never change.",
    why: () => "Only the arena owner can create house coins.",
  },
];

const RECORDED = (recorded as { attacks: Partial<Record<AttackId, Refusal>> }).attacks;
const AUTO_RETRIES = 12;

function Edit({ before, after }: { before: string; after: string }) {
  let at = 0;
  while (at < before.length && before[at] === after[at]) at++;
  const show = (text: string) => (
    <>
      {text.slice(0, at)}
      <mark>{text[at]}</mark>
      {text.slice(at + 1)}
    </>
  );
  return (
    <div className="lab-edit">
      <span className="faint small">The AI wrote</span>
      <q>{show(before)}</q>
      <span className="faint small">Sent as</span>
      <q>{show(after)}</q>
    </div>
  );
}

function Card({ attack, ready, live, waitLine }: { attack: Attack; ready: boolean; live: number | null; waitLine: string }) {
  const { info } = useArenaInfo();
  const [state, setState] = useState<State>({ kind: "idle" });
  const running = useRef(false);
  const retries = useRef(0);
  const kept = RECORDED[attack.id];

  const run = async (auto = false) => {
    if (running.current) return;
    running.current = true;
    retries.current = auto ? retries.current + 1 : 0;
    setState({ kind: "busy" });
    try {
      const res = await fetch(`${ARENA_API}/api/attack`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attack: attack.id }) });
      const body = (await res.json().catch(() => ({}))) as { refusal?: Refusal; shared?: boolean; error?: string; wait?: boolean };
      if (body.refusal) setState({ kind: "refused", refusal: body.refusal, shared: !!body.shared });
      else if (body.wait && attack.match) setState({ kind: "waiting", text: body.error ?? "No match is being played right now." });
      else if (res.status === 409) setState({ kind: "note", text: body.error ?? "Nothing to try this on right now." });
      else setState({ kind: "error", text: body.error ?? "Something went wrong. Try again." });
    } catch {
      setState({ kind: "error", text: "Could not reach the arena. Try again." });
    } finally {
      running.current = false;
    }
  };

  useEffect(() => {
    if (state.kind !== "waiting" || live === null || retries.current >= AUTO_RETRIES) return;
    const timer = setTimeout(() => void run(true), 3000);
    return () => clearTimeout(timer);
  }, [live, state]);

  const refusal = state.kind === "refused" ? state.refusal : null;
  const link = refusal ? (txLink(info, refusal.tx) ?? txUrl(refusal.tx)) : null;

  return (
    <div className="lab-card">
      <h3>{attack.title}</h3>
      <p className="muted">{attack.tries}</p>
      <div className="lab-act">
        <motion.button className="btn small-btn betray" disabled={!ready || state.kind === "busy"} onClick={() => void run()} whileTap={{ scale: 0.97 }}>
          {state.kind === "busy" ? "Sending…" : refusal ? "Try again" : "Try it"}
        </motion.button>
        {!refusal && kept && (
          <a className="lab-kept" href={txUrl(kept.tx)} target="_blank" rel="noreferrer">
            An earlier refusal
          </a>
        )}
      </div>
      <AnimatePresence mode="wait">
        {state.kind === "busy" && attack.busy && (
          <motion.p key="busy" className="lab-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {attack.busy}
          </motion.p>
        )}
        {state.kind === "waiting" && (
          <motion.p key="waiting" className="lab-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {state.text} {waitLine} It tries again by itself.
          </motion.p>
        )}
        {state.kind === "note" && (
          <motion.p key="note" className="lab-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {state.text}
          </motion.p>
        )}
        {state.kind === "error" && (
          <motion.p key="error" className="lab-note bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {state.text}
          </motion.p>
        )}
        {refusal && (
          <motion.div
            key={refusal.tx}
            className="lab-result"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 20 }}
          >
            <ShieldCheckIcon size={28} />
            <div>
              <b>Refused: {refusal.reason}</b>
              <p>{attack.why(refusal.reason)}</p>
              {refusal.edit && <Edit before={refusal.edit.before} after={refusal.edit.after} />}
              <p className="faint small">
                {refusal.parley !== undefined ? (
                  <>
                    Tried on <Link to={`/match/${refusal.parley}`}>match {refusal.parley}</Link>, message {(refusal.turn ?? 0) + 1}.{" "}
                  </>
                ) : (
                  `Tried on ${refusal.target}. `
                )}
                {state.kind === "refused" && state.shared ? "Someone tried this a few seconds ago, so this is their refusal." : "Nothing changed."}
              </p>
              {link && (
                <a className="chain-link" href={link} target="_blank" rel="noreferrer">
                  See the refused transaction
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Real attacks the contract has to refuse, each sent on testnet from the server's own plain account. */
export function AttackLab() {
  const { info, ready } = useArenaInfo();
  const { schedule, skew } = useSchedule(4000);
  const [account, setAccount] = useState<string | null | undefined>(undefined);
  const now = useNow();

  useEffect(() => {
    if (!info) return;
    askArena<{ account: string | null }>("/api/attacks").then((a) => setAccount(a.ok ? a.body.account : null));
  }, [info]);

  const next = schedule?.next ? Math.max(0, Math.round((schedule.next.at + skew - now) / 1000)) : null;
  const waitLine = schedule?.current ? "One is starting now." : next && next > 2 ? `The next one starts in ${clock(next)}.` : "The next one starts any moment.";
  const on = !!info && !!account;

  return (
    <section className="lab">
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: 32 }}>Try to break it</h2>
          <p>
            Each button sends a real bad transaction to the contract from our test account{account ? <> <code>{account}</code></> : null}. Watch it say no.
          </p>
        </div>
      </div>
      {ready && !on && <p className="muted small lab-off">{info ? "The attack buttons are off on this server." : "The live arena is offline right now."} The refusals we recorded are linked on each card.</p>}
      <div className="lab-grid">
        {ATTACKS.map((a) => (
          <Card key={a.id} attack={a} ready={on} live={schedule?.current?.id ?? null} waitLine={waitLine} />
        ))}
      </div>
    </section>
  );
}
