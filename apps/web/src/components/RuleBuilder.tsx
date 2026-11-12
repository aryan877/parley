import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BLOCKS, EMPTY_PLAN, FALLBACKS, GROUPS, type Plan, isOn, readRules, sentences, toggle, writeRules } from "../lib/rules.ts";
import { BetrayIcon, ShuffleIcon, TrustIcon } from "./icons.tsx";

const length = (text: string) => [...text].length;

/** Writes a coin's constitution from tapped blocks, with a plain text editor for anything the blocks can't say. */
export function RuleBuilder({ value, onChange, limit, children }: { value: string; onChange: (text: string) => void; limit: number; children?: ReactNode }) {
  const [plan, setPlan] = useState<Plan>(() => readRules(value) ?? EMPTY_PLAN);
  const [mode, setMode] = useState<"blocks" | "text">(() => (readRules(value) || !value.trim() ? "blocks" : "text"));
  const [fresh, setFresh] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const read = readRules(value);
    if (read) {
      setPlan(read);
      setMode("blocks");
    } else setMode("text");
  }, [value]);

  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(null), 1400);
    return () => clearTimeout(timer);
  }, [fresh]);

  const emit = (text: string) => {
    emitted.current = text;
    onChange(text);
  };
  const apply = (next: Plan, touched?: string) => {
    setPlan(next);
    if (touched && (touched === "fallback" || isOn(next, touched))) setFresh(touched);
    emit(writeRules(next));
  };

  const used = length(value);
  const fits = (next: Plan) => length(writeRules(next)) <= limit;
  const toBlocks = () => {
    const read = readRules(value);
    if (!read && !replace) return setReplace(true);
    const next = read ?? plan;
    setPlan(next);
    setMode("blocks");
    setReplace(false);
    emit(writeRules(next));
  };

  if (mode === "text") {
    return (
      <div className="rb">
        <div className="rb-paper editing">
          <textarea rows={6} value={value} onChange={(e) => emit(e.target.value)} placeholder="Say how it talks and when it trusts or betrays." aria-label="Its rules" />
          <div className="rb-foot">
            <span className={`rb-count ${used > limit ? "over" : ""}`}>
              {used} / {limit}
            </span>
            <button className="tiny" onClick={toBlocks}>
              {replace ? "Replace my text with blocks" : "Use blocks"}
            </button>
          </div>
        </div>
        {replace && <p className="faint small rb-note">Your own wording can't be turned back into blocks. Tap again to start from blocks.</p>}
        <p className="faint small rb-note">Write COOPERATE for Trust and DEFECT for Betray. That is what its AI is asked to pick.</p>
      </div>
    );
  }

  const said = sentences(plan);
  const ruleCount = plan.rules.length;
  return (
    <div className="rb">
      {children}
      <div className="rb-paper">
        <p className="rb-text">
          {said.map((s) => (
            <span key={s.id} className={`rb-s ${s.lean} ${fresh === s.id ? "fresh" : ""}`}>
              {s.text}{" "}
            </span>
          ))}
        </p>
        <div className="rb-foot">
          <span className={`rb-count ${used > limit ? "over" : ""}`}>
            {used} / {limit}
          </span>
          <button className="tiny" onClick={() => setMode("text")}>
            Edit as text
          </button>
        </div>
      </div>
      <p className="faint small rb-note">This is exactly what its AI reads. Rules are checked in the order you tap them.</p>

      {GROUPS.map((g) => (
        <div key={g.id} className="rb-group">
          <h4>{g.label}</h4>
          <div className="rb-chips">
            {BLOCKS.filter((b) => b.group === g.id).map((b) => {
              const on = isOn(plan, b.id);
              const next = toggle(plan, b.id);
              const n = plan.rules.find((r) => r.id === b.id)?.n ?? 2;
              return (
                <span key={b.id} className={`rb-chip ${b.lean} ${on ? "on" : ""}`}>
                  <button className="rb-main" disabled={!on && !fits(next)} onClick={() => apply(next, b.id)} aria-pressed={on} title={!on && !fits(next) ? "This would make the rules too long" : undefined}>
                    {b.count ? `Grudge after ${n} ${n === 1 ? "betrayal" : "betrayals"}` : b.label}
                  </button>
                  {b.count && on && (
                    <span className="rb-steps" role="radiogroup" aria-label="How many betrayals">
                      {[1, 2, 3].map((k) => (
                        <button
                          key={k}
                          role="radio"
                          aria-checked={k === n}
                          className={k === n ? "on" : ""}
                          onClick={() => apply({ ...plan, rules: plan.rules.map((r) => (r.id === b.id ? { ...r, n: k } : r)) }, b.id)}
                        >
                          {k}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rb-group">
        <h4>{ruleCount ? "When no rule fits" : "Its move, every time"}</h4>
        <div className="rb-fallback" role="radiogroup">
          {FALLBACKS.map((f) => (
            <button key={f.id} role="radio" aria-checked={plan.fallback === f.id} className={`${f.id} ${plan.fallback === f.id ? "on" : ""}`} onClick={() => apply({ ...plan, fallback: f.id }, "fallback")}>
              {f.id === "trust" ? <TrustIcon size={15} /> : f.id === "betray" ? <BetrayIcon size={15} /> : <ShuffleIcon size={15} />}
              {f.label}
            </button>
          ))}
        </div>
        <AnimatePresence initial={false}>
          {plan.fallback === "flip" && (
            <motion.p className="faint small rb-note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              Each match has a random code from the chain. Its last character decides, so nobody can guess the move.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
