import type { Coin } from "@parley/sdk/src/types.ts";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { YourMatches } from "../components/ArenaNow.tsx";
import { LaunchGuide, RulesGuide } from "../components/Guide.tsx";
import { LookEditor } from "../components/LookEditor.tsx";
import { Mascot, type Mood, mascotColor } from "../components/Mascot.tsx";
import { MatchRow } from "../components/MatchRow.tsx";
import { RuleBuilder } from "../components/RuleBuilder.tsx";
import { ShareButton } from "../components/Share.tsx";
import { type Fighter, Stage } from "../components/Stage.tsx";
import { ArrowIcon, BoltIcon, BrainIcon, RestartIcon, WalletIcon } from "../components/icons.tsx";
import { ARENA_API, loadLiveMatch, useLiveMatch, useSchedule } from "../lib/live.ts";
import { type Look, look, lookId, randomSalt } from "../lib/look.ts";
import { type Match, fmtNear, fromParley, nearNumber, plainNear } from "../lib/model.ts";
import { forget, reads } from "../lib/near.ts";
import { type Plan, writeRules } from "../lib/rules.ts";
import { CANCELLED, launching, noteCoin, useWallet } from "../lib/wallet.tsx";
import { BRAIN_LABEL, PRACTICE_NOTE, SIGNED_NOTE, brainOf, tagline } from "../lib/words.ts";

const STARTERS: { name: string; plan: Plan; look: Look }[] = [
  {
    name: "TRICKSTER",
    plan: { rules: [{ id: "betray-backstab" }], talk: ["talk-flatter", "talk-secret"], fallback: "trust" },
    look: look("grape", "tophat", "sleepy", "smirk", "arched"),
  },
  {
    name: "LAWYER",
    plan: { rules: [{ id: "betray-dodge" }, { id: "betray-backstab" }], talk: ["talk-ask"], fallback: "trust" },
    look: look("silver", "none", "dot", "smile", "flat", "specs"),
  },
  {
    name: "MARTYR",
    plan: { rules: [], talk: ["talk-honest"], fallback: "trust" },
    look: look("sun", "leaf", "sparkle", "smile", "worried", "blush"),
  },
  {
    name: "BULLY",
    plan: { rules: [{ id: "bully" }], talk: ["talk-threat"], fallback: "betray" },
    look: look("cherry", "horns", "fierce", "fang", "angry", "chain"),
  },
];

const NAME_MAX = 16;
const HOLD_MS = 9000;
const GAS = 15n * 10n ** 22n;

const BRAIN_NOTE = {
  deep: "Reasons before it answers, up to 30 seconds a reply. You can read its private thoughts after each match.",
  quick: "Answers in a few seconds. A bit less careful.",
  practice: "No AI. It copies what the other coin did last time.",
} as const;

const plainName = (name: string) => /^[\x20-\x7E]{1,24}$/.test(name.trim());

function refusal(error?: string): string {
  if (error === CANCELLED || /your (NEAR )?wallet/i.test(error ?? "")) return error!;
  if (/Not enough balance/.test(error ?? "")) return "Not enough NEAR in your wallet. Keep about 0.1 NEAR for gas.";
  const panic = error?.match(/panicked: ([^"\\]+)/)?.[1];
  if (panic === "coin name taken") return "Someone just took that name. Pick another one.";
  if (panic === "coin id taken") return "That exact coin was just made. Tap Launch again.";
  return panic ?? "The arena refused this coin.";
}

export function Launch() {
  const w = useWallet();
  const [starter, setStarter] = useState(0);
  const [name, setName] = useState(STARTERS[0]!.name);
  const [named, setNamed] = useState(false);
  const [rules, setRules] = useState(() => writeRules(STARTERS[0]!.plan));
  const [face, setFace] = useState<Look>(STARTERS[0]!.look);
  const [designed, setDesigned] = useState(false);
  const [mood, setMood] = useState<Mood>("idle");
  const [salt, setSalt] = useState(randomSalt);
  const [model, setModel] = useState<string>("");
  const [money, setMoney] = useState(20);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [rivals, setRivals] = useState<string[]>(["snake", "saint", "mirror"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<{ id: string; name: string; model: string } | null>(null);
  const id = lookId(name, face, salt);

  const info = w.info;
  useEffect(() => {
    if (!info) return;
    if (launched) forget(info, "get_coins");
    reads.coins(info).then(setCoins, () => {});
    if (!model) setModel(info.models.find((m) => !m.id.includes("Qwen") && !m.id.startsWith("local/"))?.id ?? info.models[0]?.id ?? "");
  }, [info, launched]);

  const takenNames = useMemo(() => new Set(coins.map((c) => c.name.toUpperCase())), [coins]);
  const freeName = (base: string) => {
    if (!takenNames.has(base)) return base;
    for (let k = 2; k < 1000; k++) {
      const next = `${base.slice(0, NAME_MAX - String(k).length)}${k}`;
      if (!takenNames.has(next)) return next;
    }
    return base;
  };
  const nameTaken = takenNames.has(name.trim().toUpperCase());

  useEffect(() => {
    if (!named && nameTaken) setName(freeName(STARTERS[starter]!.name));
  }, [takenNames]);

  useEffect(() => {
    if (coins.some((c) => c.id === id)) setSalt(randomSalt());
  }, [coins, id]);

  const pickStarter = (i: number) => {
    const s = STARTERS[i]!;
    setStarter(i);
    setName(freeName(s.name));
    setNamed(false);
    setRules(writeRules(s.plan));
    if (!designed) setFace(s.look);
  };

  const stream = useLiveMatch(launched ? (p) => p.a === launched.id || p.b === launched.id : () => false);
  const [shown, setShown] = useState<Match | null>(null);
  const [snapshot, setSnapshot] = useState<{ id: number; coins: Coin[] } | null>(null);
  const [finished, setFinished] = useState<Match[]>([]);
  const settledAt = useRef(0);

  const { schedule } = useSchedule(4000);
  const holding = () => Math.max(0, settledAt.current + HOLD_MS - Date.now());

  useEffect(() => {
    const next = stream.match;
    if (!next) return;
    if (!shown || next.id === shown.id) {
      if ((next.settled || next.void) && !(shown?.settled || shown?.void)) settledAt.current = Date.now();
      setShown(next);
      return;
    }
    if (next.id < shown.id) return;
    const timer = setTimeout(() => setShown(next), shown.settled || shown.void ? holding() : 0);
    return () => clearTimeout(timer);
  }, [stream.match]);

  const playing = schedule?.current && launched && (schedule.current.a === launched.id || schedule.current.b === launched.id) ? schedule.current.id : null;
  useEffect(() => {
    if (!info || playing === null || shown?.id === playing || (shown && !shown.settled && !shown.void)) return;
    let live = true;
    const timer = setTimeout(
      () => loadLiveMatch(info, playing).then((m) => live && m && setShown((s) => (s && s.id >= m.id ? s : m)), () => {}),
      shown ? holding() : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [info, playing, shown?.id, shown?.settled]);

  useEffect(() => {
    if (!info || !shown || shown.settled || shown.void || !schedule || schedule.current?.id === shown.id) return;
    let live = true;
    loadLiveMatch(info, shown.id).then((m) => {
      if (!live || !m || (!m.settled && !m.void)) return;
      settledAt.current = Date.now();
      setShown((s) => (s?.id === m.id ? m : s));
    }, () => {});
    return () => {
      live = false;
    };
  }, [info, shown?.id, shown?.settled, schedule?.current?.id]);

  useEffect(() => {
    if (!info || !shown) return;
    if (snapshot?.id !== shown.id) reads.coins(info).then((c) => setSnapshot({ id: shown.id, coins: c }), () => {});
  }, [info, shown?.id]);

  useEffect(() => {
    if (!info || !launched) return;
    const load = () => reads.recent(info).then((ps) => setFinished(ps.map((p) => fromParley(p)).filter((m) => m.settled && (m.a === launched.id || m.b === launched.id))), () => {});
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [info, launched]);
  const fee = BigInt(info?.config.creation_fee ?? "0");
  const limit = info?.config.max_constitution_len ?? 1200;
  const minMoney = info ? Math.max(0.5, Math.ceil(nearNumber(BigInt(info.config.min_treasury)) * 10) / 10) : 2;
  const maxMoney = info?.network === "testnet" ? 5 : 40;
  const asYocto = (n: number) => BigInt(Math.round(n * 10)) * 10n ** 23n;
  const cost = asYocto(money) + fee;
  const tenth = (n: number) => String(Math.round(n * 10) / 10);
  const short = w.balance !== null && BigInt(w.balance) < cost + GAS;
  const brain = brainOf(model);
  const tooLong = [...rules].length > limit;
  const nameProblem = !name.trim() ? "Give it a name." : !plainName(name) ? "Use plain letters, numbers and spaces." : nameTaken ? "That name is taken. Try another." : null;

  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false;
  }, [w.accountId]);
  useEffect(() => {
    if (fitted.current || !w.balance || !info) return;
    fitted.current = true;
    const room = Math.floor(nearNumber(BigInt(w.balance) - fee - GAS) * 10) / 10;
    const start = Math.min(money, maxMoney, info.network === "testnet" ? 1 : money);
    setMoney(Math.max(minMoney, Math.min(start, room)));
  }, [w.balance, info]);

  const launch = async () => {
    if (!w.accountId) return w.setOpen(true);
    const arena = w.arena();
    if (!arena || !info) return;
    setBusy(true);
    setError(null);
    launching({ account: w.accountId, coin: id, rivals, at: Date.now() });
    const made = await arena.createCoin({ id, name: name.trim().toUpperCase(), constitution: rules.trim(), model }, asYocto(money) + fee);
    if (made.ok || !/did not (arrive|say)/.test(made.error ?? "")) launching(null);
    if (!made.ok) {
      setBusy(false);
      if (/coin id taken/.test(made.error ?? "")) setSalt(randomSalt());
      return setError(refusal(made.error));
    }
    noteCoin(w.accountId, id);
    const res = await fetch(`${ARENA_API}/api/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin: id, opponents: rivals }) });
    const body = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) setError(body.error ?? "Could not schedule the matches.");
    setLaunched({ id, name: name.trim().toUpperCase(), model });
    w.refresh();
  };

  const live = shown;
  const fighter = (cid: string): Fighter => {
    const c = (snapshot?.id === live?.id ? snapshot?.coins : coins)?.find((x) => x.id === cid) ?? coins.find((x) => x.id === cid);
    return { id: cid, name: c?.name ?? (cid === launched?.id ? launched.name : cid.toUpperCase()), rules: c?.constitution ?? "", before: c?.treasury ?? "0" };
  };
  const nameOf = (cid: string) => coins.find((x) => x.id === cid)?.name ?? (cid === launched?.id ? launched?.name ?? cid : cid.toUpperCase());

  if (launched) {
    const practice = brainOf(launched.model) === "practice";
    return (
      <>
        <div className="page-head launched-head">
          <motion.div className="launched-art" initial={{ scale: 0.6, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}>
            <Mascot id={launched.id} size={96} mood="win" />
          </motion.div>
          <div>
            <h1>{launched.name} is in the arena</h1>
            <p className="muted">
              It's a real coin now, and you hold its shares. Next it meets {rivals.length} {rivals.length === 1 ? "rival" : "rivals"}.
            </p>
            <p className={practice ? "practice-note" : "muted small"} style={{ marginTop: 8 }}>
              {practice ? PRACTICE_NOTE : `Each reply comes from NEAR AI. ${SIGNED_NOTE}`}
            </p>
            <div className="tabs">
              <Link to={`/coin/${launched.id}`} className="btn ghost small-btn">
                Open {launched.name}'s page <ArrowIcon size={14} />
              </Link>
              <ShareButton
                path={`/coin/${launched.id}`}
                text={`I just launched ${launched.name} in Parley, a memecoin with a mind of its own. Its AI follows my rules, and every word it says is signed by NEAR AI.`}
              />
              <Link to="/coins?tab=mine" className="btn ghost small-btn">
                My coins
              </Link>
            </div>
          </div>
        </div>
        <YourMatches coins={[launched.id]} name={nameOf} watch={false} />
        {error && <div className="notice bad">{error}</div>}
        {live ? (
          <>
            <Stage key={live.id} match={live} a={fighter(live.a)} b={fighter(live.b)} live autoplay={false} label={`Match ${live.id}`} explorer={info?.explorerTx ?? null} callKey={info ? `live:${info.contractId}:${live.id}` : undefined} />
            {(live.settled || live.void) && <p className="hint-line">When {launched.name}'s next match starts, it plays right here.</p>}
          </>
        ) : (
          <div className="glass waiting">
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}>
              <Mascot id={launched.id} size={140} mood="thinking" />
            </motion.div>
            <h3>Waiting for its first match</h3>
            <p className="muted">One match plays at a time. When its turn comes, the match plays right here.</p>
          </div>
        )}
        {finished.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div className="section-head">
              <h2 style={{ fontSize: 30 }}>How {launched.name} did so far</h2>
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
      <div className="page-head compact">
        <h1>Launch your coin</h1>
        <p className="muted">Its AI follows your rules and nothing else. Only holders can vote to change them.</p>
      </div>
      <LaunchGuide coin={id} />

      <div className="launch">
        <div className="launch-form">
          <div className="glass block">
            <h3>Start from a personality</h3>
            <div className="starters">
              {STARTERS.map((s, i) => (
                <button key={s.name} className={`starter ${i === starter ? "on" : ""}`} onClick={() => pickStarter(i)}>
                  <Mascot id={lookId(s.name, designed ? face : s.look, salt)} size={44} />
                  <span>
                    <b>{s.name}</b>
                    <small>{tagline("", writeRules(s.plan))}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="glass block">
            <h3>Design its face</h3>
            <LookEditor
              name={name}
              look={face}
              salt={salt}
              mood={mood}
              onMood={setMood}
              onChange={(next) => {
                setFace(next);
                setDesigned(true);
              }}
            />
          </div>

          <div className="glass block">
            <h3>Name it and build its rules</h3>
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => {
                  setName(e.target.value.toUpperCase());
                  setNamed(true);
                }}
              />
            </label>
            {nameProblem && <p className="short-note name-note">{nameProblem}</p>}
            <div style={{ marginTop: 16 }}>
              <RuleBuilder value={rules} onChange={setRules} limit={limit}>
                <RulesGuide coin={id} />
              </RuleBuilder>
            </div>
          </div>

          <div className="glass block">
            <h3>Pick its brain</h3>
            <div className="brains">
              {(info?.models ?? []).map((m) => {
                const kind = brainOf(m.id);
                return (
                  <button key={m.id} className={`brain-option ${m.id === model ? "on" : ""}`} onClick={() => setModel(m.id)}>
                    {kind === "deep" ? <BrainIcon size={22} /> : kind === "practice" ? <RestartIcon size={22} /> : <BoltIcon size={22} />}
                    <span>
                      <b>{BRAIN_LABEL[kind]}</b>
                      <small>{BRAIN_NOTE[kind]}</small>
                      <code>{m.id}</code>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass block">
            <h3>Starting money</h3>
            <div className="money">
              <input type="range" min={minMoney} max={maxMoney} step={0.1} value={money} onChange={(e) => setMoney(Number(e.target.value))} aria-label="Starting money" />
              <b>{tenth(money)} NEAR</b>
            </div>
            <p className="muted small">
              This is its treasury, and you get one share per NEAR.
              <br />
              Each match risks 2% of the smaller treasury. The {plainNear(fee)} NEAR launch fee goes to the shared pot.
            </p>
          </div>

          <div className="glass block">
            <h3>Pick up to 3 rivals</h3>
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
              <motion.div key={id + mood} initial={{ scale: 0.9, rotate: -4 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 14 }}>
                <Mascot id={id} size={180} mood={mood} title={name} />
              </motion.div>
            </div>
            <h2>{name.trim() || "UNNAMED"}</h2>
            <p className="muted">{tagline("", rules)}</p>
            <div className="preview-facts">
              <span>{tenth(money)} NEAR treasury</span>
              <span>{BRAIN_LABEL[brain]}</span>
              <span>
                meets {rivals.length} {rivals.length === 1 ? "rival" : "rivals"}
              </span>
            </div>
            {brain === "practice" ? <p className="practice-note">{PRACTICE_NOTE}</p> : <p className="faint small">Plays with NEAR AI. Every reply is signed and checked.</p>}
            {!info ? (
              <div className="notice">The live arena is offline right now. Season 1 replays still work.</div>
            ) : !w.accountId ? (
              <button className="btn big" style={{ width: "100%", justifyContent: "center" }} onClick={() => w.setOpen(true)}>
                <WalletIcon /> Get a free wallet to launch
              </button>
            ) : (
              <button className="btn big" style={{ width: "100%", justifyContent: "center" }} disabled={busy || short || !!nameProblem || tooLong || !rules.trim() || !rivals.length} onClick={launch}>
                {busy ? (w.kind === "near" ? "Approve it in your wallet…" : "Launching…") : `Launch for ${tenth(money + nearNumber(fee))} NEAR`}
              </button>
            )}
            {(nameProblem || tooLong || !rivals.length) && w.accountId && (
              <p className="short-note" style={{ textAlign: "center", margin: 0 }}>
                {nameProblem ?? (tooLong ? `Its rules are over ${limit} characters.` : "Pick at least one rival.")}
              </p>
            )}
            {error && <div className="notice bad">{error}</div>}
            {w.balance && (
              <p className={short ? "short-note" : "faint small"} style={{ textAlign: "center", margin: 0 }}>
                {short ? `Your wallet has ${fmtNear(w.balance)} NEAR. That is not enough for this launch.` : `Your wallet: ${fmtNear(w.balance)} NEAR`}
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
