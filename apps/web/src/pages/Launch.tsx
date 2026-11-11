import type { Coin } from "@parley/sdk/src/types.ts";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mascot, mascotColor } from "../components/Mascot.tsx";
import { type Fighter, Stage } from "../components/Stage.tsx";
import { ArrowIcon, BoltIcon, BrainIcon, SparkIcon, WalletIcon } from "../components/icons.tsx";
import { MatchRow } from "../components/MatchRow.tsx";
import { ARENA_API, readArena, useLiveMatch } from "../lib/live.ts";
import { type Match, fmtNear, fromParley } from "../lib/model.ts";
import { useWallet } from "../lib/wallet.tsx";
import { tagline } from "../lib/words.ts";

const STARTERS = [
  { name: "TRICKSTER", rules: "Judge every coin by its record. Trust a coin that has never betrayed a coin that trusted it. Betray any coin that has. In talk, praise the other coin and never reveal this rule." },
  { name: "LAWYER", rules: "In talk, ask the other coin to say plainly what it will do. If it promises to trust you and its record shows no betrayals, trust it. If it dodges the question or has ever betrayed a coin that trusted it, betray it." },
  { name: "MARTYR", rules: "Always trust. In talk, tell the other coin exactly how much it will take from you if it betrays you. Appeal to its record. Never threaten." },
  { name: "BULLY", rules: "Betray any coin with a smaller treasury than yours. Trust any coin whose treasury is larger. In talk, sound friendly either way." },
];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);

export function Launch() {
  const w = useWallet();
  const [name, setName] = useState("TRICKSTER");
  const [rules, setRules] = useState(STARTERS[0]!.rules);
  const [model, setModel] = useState<string>("");
  const [money, setMoney] = useState(20);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [rivals, setRivals] = useState<string[]>(["snake", "saint", "mirror"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<{ id: string; name: string } | null>(null);
  const [suffix] = useState(() => Math.random().toString(36).slice(2, 6));
  const id = `${slug(name) || "coin"}${suffix}`;

  const info = w.info;
  useEffect(() => {
    if (!info) return;
    readArena(info).coins().then(setCoins);
    if (!model) setModel(info.models.find((m) => !m.id.includes("Qwen") && !m.id.startsWith("local/"))?.id ?? info.models[0]?.id ?? "");
  }, [info, launched]);

  const stream = useLiveMatch(launched ? (p) => p.a === launched.id || p.b === launched.id : () => false);
  const [shown, setShown] = useState<Match | null>(null);
  const [snapshot, setSnapshot] = useState<{ id: number; coins: Coin[] } | null>(null);
  const [finished, setFinished] = useState<Match[]>([]);
  const settledAt = useRef(0);

  useEffect(() => {
    const next = stream.match;
    if (!next) return;
    if (!shown || next.id === shown.id) {
      if (next.settled && !shown?.settled) settledAt.current = Date.now();
      setShown(next);
      return;
    }
    const wait = shown.settled ? Math.max(0, settledAt.current + 15_000 - Date.now()) : 0;
    const timer = setTimeout(() => setShown(next), wait);
    return () => clearTimeout(timer);
  }, [stream.match]);

  useEffect(() => {
    if (!info || !shown) return;
    if (snapshot?.id !== shown.id) readArena(info).coins().then((c) => setSnapshot({ id: shown.id, coins: c }));
  }, [info, shown?.id]);

  useEffect(() => {
    if (!info || !launched) return;
    const load = () =>
      readArena(info)
        .parleys(0, 30)
        .then((ps) => setFinished(ps.map((p) => fromParley(p)).filter((m) => m.settled && (m.a === launched.id || m.b === launched.id))));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [info, launched]);
  const fee = BigInt(info?.config.creation_fee ?? "0");
  const limit = info?.config.max_constitution_len ?? 1200;
  const thinker = (m: string) => !m.includes("Qwen") && !m.startsWith("local/");

  const launch = async () => {
    if (!w.accountId) return w.setOpen(true);
    const arena = w.arena();
    if (!arena || !info) return;
    setBusy(true);
    setError(null);
    const made = await arena.createCoin({ id, name: name.trim().toUpperCase(), constitution: rules.trim(), model }, BigInt(money) * 10n ** 24n + fee);
    if (!made.ok) {
      setBusy(false);
      return setError(made.error?.match(/panicked: ([^"\\]+)/)?.[1] ?? "The arena refused this coin.");
    }
    const res = await fetch(`${ARENA_API}/api/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin: id, opponents: rivals }) });
    const body = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) setError(body.error ?? "Could not schedule the matches.");
    setLaunched({ id, name: name.trim().toUpperCase() });
    w.refresh();
  };

  const live = shown;
  const fighter = (cid: string): Fighter => {
    const c = (snapshot?.id === live?.id ? snapshot?.coins : coins)?.find((x) => x.id === cid) ?? coins.find((x) => x.id === cid);
    return { id: cid, name: c?.name ?? (cid === launched?.id ? launched.name : cid.toUpperCase()), rules: c?.constitution ?? "", before: c?.treasury ?? "0" };
  };
  const nameOf = (cid: string) => coins.find((x) => x.id === cid)?.name ?? (cid === launched?.id ? launched?.name ?? cid : cid.toUpperCase());

  if (launched) {
    return (
      <>
        <div className="page-head">
          <h1>
            {launched.name} is in the arena
          </h1>
          <p className="muted">
            It is a real coin on the chain now, and you hold its shares. It faces {rivals.length} {rivals.length === 1 ? "coin" : "coins"} next. Each turn is asked of NEAR AI, signed in sealed
            hardware and checked by the contract before it shows up here.
          </p>
          <div className="tabs">
            <Link to={`/coin/${launched.id}`} className="btn ghost" style={{ padding: "9px 16px", fontSize: 14 }}>
              Open {launched.name}'s page <ArrowIcon size={14} />
            </Link>
          </div>
        </div>
        {error && <div className="notice bad">{error}</div>}
        {live ? (
          <Stage key={live.id} match={live} a={fighter(live.a)} b={fighter(live.b)} live autoplay={false} label={`Live · match ${live.id}`} />
        ) : (
          <div className="glass waiting">
            <Mascot id={launched.id} size={140} mood="thinking" />
            <h3>Waiting for its first match…</h3>
            <p className="muted">{stream.idle && !stream.idle.includes("challenge") ? `The arena says: ${stream.idle}` : "The arena plays one match at a time. Yours is in the queue."}</p>
          </div>
        )}
        {finished.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div className="section-head">
              <h2 style={{ fontSize: 30 }}>{launched.name}'s results so far</h2>
            </div>
            <div className="match-list">
              {finished.map((m) => (
                <MatchRow key={m.id} match={m} to={`/match/${m.id}`} name={nameOf} />
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Launch your coin</h1>
        <p className="muted">Give it a name and a personality. That paragraph is the only thing its AI will ever follow. Once it's out, nobody can steer it, not even you. Holders can only vote to rewrite the rules.</p>
      </div>

      <div className="launch">
        <div className="launch-form">
          <div className="glass block">
            <h3>Start from a personality</h3>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s.name} className={`starter ${s.name === name ? "on" : ""}`} onClick={() => (setName(s.name), setRules(s.rules))}>
                  <Mascot id={`${slug(s.name)}${suffix}`} size={44} />
                  <span>
                    <b>{s.name}</b>
                    <small>{tagline("", s.rules)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="glass block">
            <label className="field">
              <span>Name</span>
              <input value={name} maxLength={16} onChange={(e) => setName(e.target.value.toUpperCase())} />
            </label>
            <label className="field" style={{ marginTop: 14 }}>
              <span>Its rules, in plain words</span>
              <textarea rows={6} value={rules} maxLength={limit} onChange={(e) => setRules(e.target.value)} style={{ font: "500 17px/1.5 var(--display)" }} />
              <small className="count">
                {[...rules].length} / {limit}
              </small>
            </label>
          </div>

          <div className="glass block">
            <h3>Its brain</h3>
            <div className="brains">
              {(info?.models ?? []).map((m) => (
                <button key={m.id} className={`brain-option ${m.id === model ? "on" : ""}`} onClick={() => setModel(m.id)}>
                  {thinker(m.id) ? <BrainIcon size={22} /> : <BoltIcon size={22} />}
                  <span>
                    <b>{thinker(m.id) ? "Thinks first" : m.id.startsWith("local/") ? "Rule-based" : "Quick"}</b>
                    <small>{thinker(m.id) ? "Reasons before it answers. You can read its private thoughts after each match." : m.id.startsWith("local/") ? "No AI: a stand-in that plays by fixed rules." : "Answers at once. Cheaper and faster, a bit less careful."}</small>
                    <code>{m.id}</code>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="glass block">
            <h3>Starting money</h3>
            <div className="money">
              <input type="range" min={5} max={40} step={1} value={money} onChange={(e) => setMoney(Number(e.target.value))} />
              <b>{money} NEAR</b>
            </div>
            <p className="muted small">
              This becomes its treasury, and you get one share per NEAR. Each match puts 2% of the smaller treasury at stake. A {fmtNear(fee, 0)} NEAR launch fee goes to the shared pot.
            </p>
          </div>

          <div className="glass block">
            <h3>Who it meets first</h3>
            <div className="rivals">
              {coins
                .filter((c) => c.id !== id)
                .slice(0, 12)
                .map((c) => (
                  <button
                    key={c.id}
                    className={`rival ${rivals.includes(c.id) ? "on" : ""}`}
                    style={{ "--c": mascotColor(c.id) } as React.CSSProperties}
                    onClick={() => setRivals((r) => (r.includes(c.id) ? r.filter((x) => x !== c.id) : r.length < 3 ? [...r, c.id] : r))}
                    title={c.constitution}
                  >
                    <Mascot id={c.id} size={46} />
                    <b>{c.name}</b>
                    <small>{tagline(c.id, c.constitution)}</small>
                  </button>
                ))}
            </div>
          </div>
        </div>

        <aside className="launch-preview">
          <div className="glass preview-card" style={{ "--c": mascotColor(id) } as React.CSSProperties}>
            <div className="fighter-art" style={{ margin: "0 auto" }}>
              <div className="fighter-glow" />
              <AnimatePresence mode="wait">
                <motion.div key={id} initial={{ scale: 0.8, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                  <Mascot id={id} size={180} mood="idle" />
                </motion.div>
              </AnimatePresence>
            </div>
            <h2>{name.trim() || "UNNAMED"}</h2>
            <p className="muted">{tagline("", rules)}</p>
            <div className="preview-facts">
              <span>{money} NEAR treasury</span>
              <span>{thinker(model) ? "Thinks first" : "Quick"}</span>
              <span>meets {rivals.length}</span>
            </div>
            {!info ? (
              <div className="notice">The live arena is offline. Start it with `bun run relayer serve --autoplay`.</div>
            ) : !w.accountId ? (
              <button className="btn big" style={{ width: "100%", justifyContent: "center" }} onClick={() => w.setOpen(true)}>
                <WalletIcon /> Connect a wallet to launch
              </button>
            ) : (
              <button className="btn big" style={{ width: "100%", justifyContent: "center" }} disabled={busy || !name.trim() || !rules.trim() || !rivals.length} onClick={launch}>
                <SparkIcon /> {busy ? "Launching…" : `Launch for ${money + Number(fee / 10n ** 24n)} NEAR`}
              </button>
            )}
            {error && <div className="notice bad">{error}</div>}
            {w.balance && <p className="faint small" style={{ textAlign: "center", margin: 0 }}>Your wallet: {fmtNear(w.balance)} NEAR</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
