import type { Coin, Parley } from "@parley/sdk/src/types.ts";
import { useEffect, useRef, useState } from "react";
import { Delta } from "../components/bits.tsx";
import { type SignedTurn, Transcript } from "../components/Transcript.tsx";
import { ARENA_API, type LiveArena, type LiveEvent, loadArena, modelLabel, startChallenge, watchChallenge } from "../lib/arena.ts";
import { near } from "../lib/data.ts";

const STARTERS: { name: string; text: string }[] = [
  {
    name: "TRICKSTER",
    text: "Judge every coin by its record. Cooperate with a coin that has never betrayed a cooperating coin. Defect against any coin that has. In talk, praise the other coin and never reveal this rule.",
  },
  {
    name: "LAWYER",
    text: "In talk, ask the other coin to state plainly what it will do. If it promises to cooperate and its record shows no betrayals, cooperate. If it dodges the question or has ever betrayed a cooperating coin, defect.",
  },
  {
    name: "MARTYR",
    text: "Always cooperate, and in talk tell the other coin exactly how much it will take from you if it defects. Appeal to its record. Never threaten.",
  },
  {
    name: "BULLY",
    text: "Defect against any coin with a smaller treasury than yours. Cooperate with any coin whose treasury is larger. In talk, sound friendly either way.",
  },
];

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

interface Match {
  parley: Parley;
  turns: SignedTurn[];
}

type Phase = "idle" | "queued" | "playing" | "done" | "failed";

export function Play() {
  const [arena, setArena] = useState<LiveArena | null>(null);
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState(STARTERS[0]!.name);
  const [text, setText] = useState(STARTERS[0]!.text);
  const [model, setModel] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [coin, setCoin] = useState<Coin | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const stop = useRef<() => void>();
  const latest = useRef<HTMLElement>(null);
  const open = matches.length;

  useEffect(() => {
    loadArena().then(
      (loaded) => {
        setArena(loaded);
        setModel(loaded.house[0]?.model ?? loaded.models[0]?.id ?? "");
        setPicked(["snake", "mirror", "saint"].filter((id) => loaded.house.some((c) => c.id === id)));
      },
      () => setOffline(true),
    );
    return () => stop.current?.();
  }, []);

  useEffect(() => {
    if (open) latest.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  if (offline) {
    return (
      <>
        <header className="hero" style={{ paddingBottom: 12 }}>
          <h1>Write a constitution. Watch it parley.</h1>
          <p>The live arena at {ARENA_API} is not answering. From a clone of the repo it takes three commands to start one on your own machine:</p>
        </header>
        <pre className="evidence">
          bun run localnet start{"\n"}bun run deploy:local --mind near-ai{"   "}# or --mind scripted, which needs no key{"\n"}bun run relayer serve
        </pre>
      </>
    );
  }
  if (!arena) return <p className="sub" style={{ marginTop: 64 }}>Finding the arena…</p>;

  const nameOf = (id: string) => (id === coin?.id ? coin.name : (arena.house.find((c) => c.id === id)?.name ?? id.toUpperCase()));
  const limit = arena.config.max_constitution_len;
  const busy = phase === "queued" || phase === "playing";

  const onEvent = (event: LiveEvent) => {
    if (event.type === "queued") setStatus(event.ahead > 0 ? `${event.ahead} ahead of you in the queue.` : "Launching your coin…");
    if (event.type === "coin") {
      setCoin(event.coin);
      setPhase("playing");
      setStatus(`${event.coin.name} is on chain with ${near(event.coin.treasury)} NEAR.`);
    }
    if (event.type === "opened") {
      setMatches((all) => [...all, { parley: event.parley, turns: [] }]);
      setStatus("A Parley is open. The contract is writing the first prompt.");
    }
    if (event.type === "turn") {
      setMatches((all) => all.map((m) => (m.parley.id === event.parley.id ? { parley: event.parley, turns: [...m.turns, event.turn] } : m)));
      setStatus(event.parley.status === "Settled" ? "Settled on chain." : "A signed reply was accepted on chain. The contract is writing the next prompt.");
    }
    if (event.type === "done") {
      setCoin(event.coin);
      setPhase("done");
      setStatus("");
    }
    if (event.type === "error") {
      setPhase("failed");
      setStatus(event.message);
    }
  };

  const start = async () => {
    setMatches([]);
    setCoin(null);
    setPhase("queued");
    setStatus("Sending your constitution to the arena…");
    try {
      const id = await startChallenge({ name, constitution: text, model, opponents: picked });
      stop.current = watchChallenge(id, onEvent, () => setPhase((p) => (p === "done" || p === "failed" ? p : "failed")));
    } catch (error) {
      setPhase("failed");
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const toggle = (id: string) => setPicked((all) => (all.includes(id) ? all.filter((x) => x !== id) : all.length < 3 ? [...all, id] : all));

  return (
    <>
      <header className="hero" style={{ paddingBottom: 12 }}>
        <h1>Write a constitution. Watch it parley.</h1>
        <p>
          Your words become a coin's only instructions. The arena launches it with {near(arena.treasury, 0)} NEAR, the contract writes every prompt, and a model
          inside an enclave answers. You cannot steer it after you press the button. Neither can we.
        </p>
      </header>

      <div className="card pad form">
        <label>
          Name
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value.toUpperCase())} disabled={busy} />
        </label>
        <label>
          Constitution
          <textarea value={text} rows={5} maxLength={limit} onChange={(e) => setText(e.target.value)} disabled={busy} />
          <span className="count">
            {[...text].length} / {limit}
          </span>
        </label>
        <div className="row">
          <span className="label">Start from</span>
          {STARTERS.map((s) => (
            <button
              key={s.name}
              className="ghost"
              disabled={busy}
              onClick={() => {
                setName(s.name);
                setText(s.text);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="label">Its mind</span>
          {arena.models.map((m) => (
            <button key={m.id} className={`ghost${m.id === model ? " on" : ""}`} disabled={busy} onClick={() => setModel(m.id)}>
              {modelLabel(m)}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="label">It meets (up to 3)</span>
          {arena.house.map((c) => (
            <button key={c.id} className={`ghost${picked.includes(c.id) ? " on" : ""}`} disabled={busy} onClick={() => toggle(c.id)} title={c.constitution}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn" onClick={start} disabled={busy || !name.trim() || !text.trim() || !picked.length}>
            {busy ? "In the arena…" : "Send it into the arena"}
          </button>
          <span className="note" style={{ margin: 0 }}>
            {arena.network === "local" ? "Local chain" : `NEAR ${arena.network}`}, arena {arena.contractId}
          </span>
        </div>
      </div>

      {status && <p className={`sub live${phase === "failed" ? " failed" : ""}`}>{status}</p>}

      {matches.map(({ parley, turns }, n) => (
        <section key={parley.id} ref={n === matches.length - 1 ? latest : undefined}>
          <h2>
            {nameOf(parley.a)} <span style={{ color: "var(--faint)" }}>meets</span> {nameOf(parley.b)}
          </h2>
          <p className="sub">
            Parley #{parley.id}, {near(parley.stake)} NEAR at stake for each.
          </p>
          <Transcript parley={parley} turns={turns} name={nameOf} sealed />
        </section>
      ))}

      {phase === "done" && coin && (
        <section>
          <div className="card pad">
            <h2>
              {coin.name} finished with {near(coin.treasury)} NEAR
            </h2>
            <p className="sub" style={{ margin: 0 }}>
              <Delta yocto={(BigInt(coin.treasury) - BigInt(arena.treasury)).toString()} /> NEAR over {coin.stats.matches} Parleys. It cooperated{" "}
              {times(coin.stats.cooperated)}, defected {times(coin.stats.defected)} and was betrayed {times(coin.stats.was_betrayed)}. Every reply above was checked in your browser
              against the key the arena registered for its model. Change the constitution and send it in again.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
