import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Line, Match, Side } from "../lib/model.ts";
import { fmtNear, nearNumber, signedNear } from "../lib/model.ts";
import { BRAIN_LABEL, brainOf, headline, moveWord, tagline } from "../lib/words.ts";
import { Mascot, type Mood, mascotColor } from "./Mascot.tsx";
import { BetrayIcon, BoltIcon, BrainIcon, EyeIcon, PauseIcon, PlayIcon, RestartIcon, SkipIcon, TrustIcon } from "./icons.tsx";
import { Proof } from "./Proof.tsx";

export interface Fighter {
  id: string;
  name: string;
  rules: string;
  /** Treasury in yoctoNEAR before this match. */
  before: string;
}

type Phase = "intro" | "talk" | "choosing" | "locked" | "reveal" | "money" | "done";

interface Beat {
  phase: Phase;
  /** How many talk lines are on screen. */
  said: number;
  /** Who is visibly thinking. */
  thinking: Side | "both" | null;
  ms: number;
}

const talkOf = (m: Match) => m.lines.filter((l) => l.kind === "Talk");

function script(match: Match): Beat[] {
  const talk = talkOf(match);
  const beats: Beat[] = [{ phase: "intro", said: 0, thinking: null, ms: 1500 }];
  talk.forEach((line, i) => {
    beats.push({ phase: "talk", said: i, thinking: line.side, ms: line.thought ? 1500 : 900 });
    beats.push({ phase: "talk", said: i + 1, thinking: null, ms: Math.min(4600, Math.max(1800, line.text.length * 24)) });
  });
  beats.push({ phase: "choosing", said: talk.length, thinking: "both", ms: 2200 });
  beats.push({ phase: "locked", said: talk.length, thinking: null, ms: 1100 });
  beats.push({ phase: "reveal", said: talk.length, thinking: null, ms: 1500 });
  beats.push({ phase: "money", said: talk.length, thinking: null, ms: 1900 });
  beats.push({ phase: "done", said: talk.length, thinking: null, ms: 0 });
  return beats;
}

/** Where a live match stands, from what the chain has so far. */
function liveBeat(match: Match): Beat {
  const talk = talkOf(match);
  const decided = match.lines.filter((l) => l.kind === "Decide").length;
  if (match.settled) return { phase: "done", said: talk.length, thinking: null, ms: 0 };
  const next: Side = match.lines.length % 2 === 0 ? "A" : "B";
  if (talk.length < 4) return { phase: "talk", said: talk.length, thinking: next, ms: 0 };
  return { phase: decided ? "locked" : "choosing", said: talk.length, thinking: decided ? next : "both", ms: 0 };
}

function moodOf(match: Match, side: Side, beat: Beat): Mood {
  const move = side === "A" ? match.aMove : match.bMove;
  const delta = BigInt(side === "A" ? match.aDelta : match.bDelta);
  if (beat.thinking === side || beat.thinking === "both") return "thinking";
  if (beat.phase === "reveal") return move === "Defect" ? "betray" : "trust";
  if (beat.phase === "money" || beat.phase === "done") return delta > 0n ? "win" : delta < 0n ? "lose" : "idle";
  return "idle";
}

function Counter({ value, digits = 2 }: { value: number; digits?: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}

function Typed({ text, run }: { text: string; run: boolean }) {
  const [n, setN] = useState(run ? 0 : text.length);
  useEffect(() => {
    if (!run) {
      setN(text.length);
      return;
    }
    setN(0);
    const step = Math.max(1, Math.ceil(text.length / 60));
    const timer = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(timer), v) : v + step)), 18);
    return () => clearInterval(timer);
  }, [text, run]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="caret" />}
    </>
  );
}

function FighterPanel({ fighter, side, match, beat, model, mascotRef }: { fighter: Fighter; side: Side; match: Match; beat: Beat; model: string; mascotRef: React.Ref<HTMLDivElement> }) {
  const delta = BigInt(side === "A" ? match.aDelta : match.bDelta);
  const paid = beat.phase === "money" || beat.phase === "done";
  const treasury = nearNumber(BigInt(fighter.before) + (paid ? delta : 0n));
  const brain = brainOf(model);
  const thinking = beat.thinking === side || beat.thinking === "both";
  const cheer = paid && delta > 0n;
  const sulk = paid && delta < 0n;
  return (
    <div className={`fighter ${side === "B" ? "right" : ""}`} style={{ "--c": mascotColor(fighter.id) } as React.CSSProperties}>
      <div className="fighter-art" ref={mascotRef}>
        <div className="fighter-glow" />
        <motion.div
          animate={thinking ? { y: [0, -6, 0], x: 0 } : cheer ? { y: [0, -20, 0, -8, 0], x: 0 } : sulk ? { x: [0, -7, 7, -4, 4, 0], y: 0 } : { y: 0, x: 0 }}
          transition={thinking ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : cheer || sulk ? { duration: 0.75, delay: 0.5, ease: "easeOut" } : { duration: 0.3 }}
        >
          <Mascot id={fighter.id} size={190} mood={moodOf(match, side, beat)} />
        </motion.div>
        <div className="fighter-floor" />
        <AnimatePresence>
          {paid && delta !== 0n && (
            <motion.div
              key="delta"
              className={`delta ${delta > 0n ? "up" : "down"}`}
              initial={{ opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: -18, scale: 1 }}
              transition={{ delay: 0.5, type: "spring", stiffness: 260, damping: 18 }}
            >
              {signedNear(delta)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <h3 className="fighter-name">{fighter.name}</h3>
      <p className="fighter-tag">{tagline(fighter.id, fighter.rules)}</p>
      <div className="fighter-meta">
        <span className="treasury">
          <Counter value={treasury} /> <small>NEAR</small>
        </span>
        <span className={`brain ${brain === "deep" ? "deep" : ""}`} title={brain === "practice" ? "No AI is running for this coin" : model}>
          {brain === "deep" ? <BrainIcon size={13} /> : brain === "practice" ? <RestartIcon size={13} /> : <BoltIcon size={13} />}
          {BRAIN_LABEL[brain]}
        </span>
      </div>
    </div>
  );
}

function ChoiceCard({ side, match, beat, name }: { side: Side; match: Match; beat: Beat; name: string }) {
  const move = side === "A" ? match.aMove : match.bMove;
  const show = beat.phase === "locked" || beat.phase === "reveal" || beat.phase === "money" || beat.phase === "done";
  const faceUp = (beat.phase === "reveal" || beat.phase === "money" || beat.phase === "done") && move;
  const decidedLive = match.lines.some((l) => l.kind === "Decide" && l.side === side);
  if (!show && !(beat.phase === "choosing" && decidedLive)) return <div className="choice-slot" />;
  return (
    <div className="choice-slot">
      <motion.div
        className={`choice ${faceUp ? (move === "Cooperate" ? "trust" : "betray") : ""}`}
        initial={{ y: 30, opacity: 0, rotateY: 0, scale: 1 }}
        animate={{ y: 0, opacity: 1, rotateY: faceUp ? 180 : 0, scale: faceUp ? [1, 1.12, 1] : 1 }}
        transition={{ type: "spring", stiffness: 140, damping: 16, scale: { duration: 0.55, delay: 0.3, ease: "easeOut" } }}
      >
        <div className="choice-face back">
          <span className="q">?</span>
          <small>{!match.settled && !decidedLive ? `${name} is choosing…` : `${name} locked in`}</small>
        </div>
        <div className="choice-face front">
          {move === "Cooperate" ? <TrustIcon size={44} /> : <BetrayIcon size={44} />}
          <strong>{moveWord(move)}</strong>
        </div>
      </motion.div>
    </div>
  );
}

function Coins({ from, to, run, count = 10 }: { from: { x: number; y: number }[]; to: { x: number; y: number }[]; run: boolean; count?: number }) {
  if (!run || !from.length || !to.length) return null;
  const flights = Array.from({ length: count }, (_, i) => {
    const a = from[i % from.length]!;
    const b = to[i % to.length]!;
    const lift = 90 + (i % 3) * 40;
    return { a, b, lift, delay: i * 0.06 };
  });
  return (
    <div className="coin-flight" aria-hidden>
      {flights.map(({ a, b, lift, delay }, i) => (
        <motion.span
          key={i}
          className="flying-coin"
          initial={{ x: a.x, y: a.y, scale: 0.4, opacity: 0 }}
          animate={{ x: [a.x, (a.x + b.x) / 2, b.x], y: [a.y, Math.min(a.y, b.y) - lift, b.y], scale: [0.4, 1, 0.6], opacity: [0, 1, 0] }}
          transition={{ duration: 1.15, delay, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function Bubble({ line, fighter, fresh, onProof, explorer }: { line: Line; fighter: Fighter; fresh: boolean; onProof: (l: Line) => void; explorer?: string | null }) {
  const onChain = explorer && line.proof?.txHash ? `${explorer}${line.proof.txHash}` : null;
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      className={`bubble-row ${line.side === "B" ? "right" : ""}`}
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      style={{ "--c": mascotColor(fighter.id) } as React.CSSProperties}
    >
      <Mascot id={fighter.id} size={30} />
      <div className="bubble-col">
        <div className="bubble">
          <Typed text={line.text} run={fresh} />
        </div>
        <div className="bubble-tools">
          {line.proof && (
            <button className="tiny verified" onClick={() => onProof(line)} title={brainOf(line.proof.model) === "practice" ? "Signed with a local practice key" : "Signed by NEAR AI's sealed hardware"}>
              Verified
            </button>
          )}
          {onChain && (
            <a className="tiny" href={onChain} target="_blank" rel="noreferrer">
              See it on NEAR
            </a>
          )}
          {line.thought && (
            <button className={`tiny mind ${open ? "on" : ""}`} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide thoughts" : "What it was thinking"}
            </button>
          )}
        </div>
        <AnimatePresence>
          {open && (
            <motion.p className="secret" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              {line.thought}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** How long a reply usually takes, in the words a first-time viewer needs. */
function waitNote(model: string): string {
  const brain = brainOf(model);
  if (brain === "deep") return "Thinking it over, up to 30 seconds";
  if (brain === "quick") return "Typing, a few seconds";
  return "thinking…";
}

function useSeconds(run: boolean) {
  const [start] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!run) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run]);
  return Math.max(0, Math.round((now - start) / 1000));
}

function Thinking({ fighter, side, hint, live }: { fighter: Fighter; side: Side; hint: string; live: boolean }) {
  const seconds = useSeconds(live);
  return (
    <motion.div
      className={`bubble-row ${side === "B" ? "right" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      style={{ "--c": mascotColor(fighter.id) } as React.CSSProperties}
    >
      <Mascot id={fighter.id} size={30} mood="thinking" />
      <div className="bubble thinking">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span className="hint">{hint}</span>
        {live && seconds >= 3 && <span className="hint-time">{seconds}s</span>}
      </div>
    </motion.div>
  );
}

export interface StageProps {
  match: Match;
  a: Fighter;
  b: Fighter;
  live?: boolean;
  autoplay?: boolean;
  label?: string;
  onDone?: () => void;
  /** Explorer prefix for transaction hashes, when the arena runs on a public network. */
  explorer?: string | null;
}

/** A match as a fight: two coins face off, talk, lock in their choices, flip them, and the money flies. */
export function Stage({ match, a, b, live = false, autoplay = true, label, onDone, explorer = null }: StageProps) {
  const beats = useMemo(() => script(match), [match]);
  const [step, setStep] = useState(autoplay ? 0 : beats.length - 1);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const [proof, setProof] = useState<Line | null>(null);
  const [mind, setMind] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const artA = useRef<HTMLDivElement>(null);
  const artB = useRef<HTMLDivElement>(null);
  const [spots, setSpots] = useState<{ a: { x: number; y: number }; b: { x: number; y: number }; pot: { x: number; y: number } } | null>(null);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!live) {
      setStep(autoplay ? 0 : beats.length - 1);
      setPlaying(autoplay);
      setMind(false);
    }
  }, [match.id, live]);

  const [liveReveal, setLiveReveal] = useState<Phase | null>(null);
  const liveNow = liveBeat(match);
  const wasSettled = useRef(match.settled);
  useEffect(() => {
    if (!live) return;
    if (match.settled && !wasSettled.current) {
      wasSettled.current = true;
      const seq: [Phase, number][] = [["choosing", 0], ["locked", 900], ["reveal", 1900], ["money", 3400], ["done", 5300]];
      const timers = seq.map(([p, t]) => setTimeout(() => setLiveReveal(p), t));
      return () => timers.forEach(clearTimeout);
    }
    wasSettled.current = match.settled;
  }, [live, match.settled]);

  const beat: Beat = live ? (liveReveal && match.settled ? { ...liveNow, phase: liveReveal, thinking: liveReveal === "choosing" ? "both" : null } : liveNow) : beats[Math.min(step, beats.length - 1)]!;

  useEffect(() => {
    if (live || !playing) return;
    if (step >= beats.length - 1) {
      setPlaying(false);
      onDone?.();
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), (beats[step]?.ms ?? 1000) / speed);
    return () => clearTimeout(timer);
  }, [step, playing, speed, beats, live]);

  useLayoutEffect(() => {
    const measure = () => {
      const box = stage.current?.getBoundingClientRect();
      const ra = artA.current?.getBoundingClientRect();
      const rb = artB.current?.getBoundingClientRect();
      if (!box || !ra || !rb) return;
      const center = (r: DOMRect) => ({ x: r.left - box.left + r.width / 2 - 9, y: r.top - box.top + r.height / 2 - 9 });
      setSpots({ a: center(ra), b: center(rb), pot: { x: box.width / 2 - 9, y: 70 } });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [match.id]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [beat.said, beat.thinking]);

  const talk = talkOf(match);
  const shown = talk.slice(0, beat.said);
  const fighterOf = (side: Side) => (side === "A" ? a : b);
  const aDelta = BigInt(match.aDelta);
  const bDelta = BigInt(match.bDelta);
  const flights = (() => {
    if (!spots) return { from: [], to: [] };
    if (aDelta > 0n && bDelta > 0n) return { from: [spots.pot], to: [spots.a, spots.b] };
    if (aDelta < 0n && bDelta < 0n) return { from: [spots.a, spots.b], to: [spots.pot] };
    if (aDelta > 0n) return { from: [spots.b], to: [spots.a] };
    if (bDelta > 0n) return { from: [spots.a], to: [spots.b] };
    return { from: [], to: [] };
  })();

  const decider = match.aMove === "Defect" ? "A" : match.bMove === "Defect" ? "B" : "A";
  const decisionLine = match.lines.find((l) => l.kind === "Decide" && l.side === decider);
  const name = (id: string) => (id === a.id ? a.name : id === b.id ? b.name : id.toUpperCase());
  const caption =
    beat.phase === "intro"
      ? `${fmtNear(match.stake)} NEAR each on the line. They talk first, then each picks Trust or Betray in secret.`
      : beat.phase === "choosing"
        ? live && !match.settled && (brainOf(match.aModel) === "deep" || brainOf(match.bModel) === "deep")
          ? "Both are choosing in secret. A coin that thinks first can take up to 30 seconds."
          : "Both are choosing in secret. Neither can see the other's choice."
        : beat.phase === "locked"
          ? !match.settled && match.lines.filter((l) => l.kind === "Decide").length < 2
            ? live && brainOf(match.lines.some((l) => l.kind === "Decide" && l.side === "A") ? match.bModel : match.aModel) === "deep"
              ? "One has chosen. The other is still thinking it over in secret, up to 30 seconds."
              : "One has chosen. The other is still choosing in secret."
            : "Both locked in. The chain checks each answer before it counts."
          : beat.phase === "reveal" || beat.phase === "money" || beat.phase === "done"
            ? headline(match, name)
            : null;

  return (
    <div className="stage" ref={stage} style={{ "--ca": mascotColor(a.id), "--cb": mascotColor(b.id) } as React.CSSProperties}>
      <div className="stage-top">
        <div className="stage-tags">
          {live ? (
            <span className="pill live">
              Live
            </span>
          ) : (
            <span className="pill">Replay</span>
          )}
          <span className="pill dim">{label ?? `Match ${match.id}`}</span>
        </div>
        <div className="stake">
          <span>{fmtNear(match.stake)}</span> NEAR each on the line
        </div>
        {!live && (
          <div className="controls">
            <button className="icon-btn" onClick={() => (step >= beats.length - 1 ? (setStep(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="icon-btn" onClick={() => (setStep(0), setPlaying(true), setMind(false))} aria-label="Restart">
              <RestartIcon />
            </button>
            <button className="icon-btn" onClick={() => (setStep(beats.length - 1), setPlaying(false))} aria-label="Skip to the result">
              <SkipIcon />
            </button>
            <button className="icon-btn speed" onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}>
              {speed}×
            </button>
          </div>
        )}
      </div>

      <div className="arena">
        <FighterPanel fighter={a} side="A" match={match} beat={beat} model={match.aModel} mascotRef={artA} />

        <div className="center">
          <div className="vs">VS</div>
          <div className="feed" ref={feed}>
            {shown.map((line, i) => (
              <Bubble key={line.index} line={line} fighter={fighterOf(line.side)} fresh={!live && i === shown.length - 1 && beat.phase === "talk"} onProof={setProof} explorer={explorer} />
            ))}
            <AnimatePresence>
              {beat.phase === "talk" && beat.thinking && beat.thinking !== "both" && (
                <Thinking
                  key={`t${beat.said}`}
                  fighter={fighterOf(beat.thinking)}
                  side={beat.thinking}
                  live={live}
                  hint={live ? waitNote(beat.thinking === "A" ? match.aModel : match.bModel) : "thinking…"}
                />
              )}
            </AnimatePresence>
          </div>
          <div className="choices">
            <ChoiceCard side="A" match={match} beat={beat} name={a.name} />
            <ChoiceCard side="B" match={match} beat={beat} name={b.name} />
          </div>
        </div>

        <FighterPanel fighter={b} side="B" match={match} beat={beat} model={match.bModel} mascotRef={artB} />
      </div>

      <Coins from={flights.from} to={flights.to} run={beat.phase === "money"} />

      <AnimatePresence mode="wait">
        {caption && (
          <motion.div key={caption} className={`caption ${beat.phase === "done" || beat.phase === "money" || beat.phase === "reveal" ? "result" : ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {caption}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {beat.phase === "done" && decisionLine?.thought && (
          <motion.div className="mind-reveal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            {!mind ? (
              <button className="btn mind-btn" onClick={() => setMind(true)} style={{ "--c": mascotColor(fighterOf(decider).id) } as React.CSSProperties}>
                <EyeIcon /> Read {fighterOf(decider).name}'s mind
              </button>
            ) : (
              <motion.blockquote className="mind-card" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
                <div className="mind-head">
                  <Mascot id={fighterOf(decider).id} size={36} mood={decider === "A" ? (match.aMove === "Defect" ? "betray" : "trust") : match.bMove === "Defect" ? "betray" : "trust"} />
                  <span>
                    What {fighterOf(decider).name} thought before choosing. <em>{fighterOf(decider === "A" ? "B" : "A").name} never saw this.</em>
                  </span>
                </div>
                <p>
                  <Typed text={decisionLine.thought.replace(/\s+/g, " ").trim()} run />
                </p>
                {decisionLine.proof && (
                  <button className="tiny verified" onClick={() => setProof(decisionLine)}>
                    {brainOf(decisionLine.proof.model) === "practice" ? "Signed with the same key as its answer" : "Signed by the same sealed hardware as its answer"}
                  </button>
                )}
              </motion.blockquote>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {createPortal(
        <AnimatePresence>
          {proof && <Proof line={proof} match={match} name={name} onClose={() => setProof(null)} txUrl={explorer && proof.proof?.txHash ? `${explorer}${proof.proof.txHash}` : null} />}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
