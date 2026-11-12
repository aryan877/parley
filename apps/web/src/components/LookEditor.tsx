import { motion } from "motion/react";
import { useState } from "react";
import { LOOK_COUNT, type Look, TRAITS, type Trait, lookId, randomLook } from "../lib/look.ts";
import { Mascot, type Mood } from "./Mascot.tsx";
import { ShuffleIcon } from "./icons.tsx";

export const MOODS: { id: Mood; label: string }[] = [
  { id: "idle", label: "Calm" },
  { id: "thinking", label: "Thinking" },
  { id: "trust", label: "Trusts" },
  { id: "betray", label: "Betrays" },
  { id: "win", label: "Wins" },
  { id: "lose", label: "Loses" },
];

const FACE_TRAITS: Trait[] = ["eyes", "mouth", "brows", "extra"];

/** Pick a coin's face trait by trait. Every thumbnail is the coin itself with that one option swapped in. */
export function LookEditor({ name, look, salt, mood, onChange, onMood }: { name: string; look: Look; salt: string; mood: Mood; onChange: (look: Look) => void; onMood: (mood: Mood) => void }) {
  const [trait, setTrait] = useState<Trait>("color");
  const options = TRAITS.find((t) => t.key === trait)!.options;
  const id = lookId(name, look, salt);
  return (
    <div className="look-editor">
      <div className="look-mobile-preview">
        <motion.div key={id} initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
          <Mascot id={id} size={128} mood={mood} title={name} />
        </motion.div>
      </div>
      <div className="look-bar">
        <div className="look-tabs" role="tablist">
          {TRAITS.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === trait} className={t.key === trait ? "on" : ""} onClick={() => setTrait(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn ghost small-btn look-random" onClick={() => onChange(randomLook())}>
          <ShuffleIcon size={16} /> Randomise
        </button>
      </div>
      <div className={`look-grid ${FACE_TRAITS.includes(trait) ? "zoom" : ""}`} role="radiogroup" aria-label={TRAITS.find((t) => t.key === trait)!.label}>
        {options.map((o, i) => {
          const on = look[trait] === i;
          return (
            <button key={o.key} role="radio" aria-checked={on} className={`look-opt ${on ? "on" : ""}`} onClick={() => onChange({ ...look, [trait]: i })}>
              <span className="look-thumb">
                <Mascot id={lookId(name, { ...look, [trait]: i }, salt)} size={56} title={o.label} />
              </span>
              <small>{o.label}</small>
            </button>
          );
        })}
      </div>
      <div className="look-foot">
        <div className="look-moods" role="radiogroup" aria-label="Try a mood">
          {MOODS.map((m) => (
            <button key={m.id} role="radio" aria-checked={mood === m.id} className={mood === m.id ? "on" : ""} onClick={() => onMood(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="faint small">{LOOK_COUNT.toLocaleString("en-US")} faces to pick from. Yours is saved on chain with the coin.</span>
      </div>
    </div>
  );
}
