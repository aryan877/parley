import { type RefObject, useEffect } from "react";
import { playMoney, playReveal, useSound } from "../lib/sound.ts";
import "./sound.css";

const SpeakerIcon = ({ on, size = 18 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M3 9.6A1.6 1.6 0 0 1 4.6 8H7.2l4-3.5A1 1 0 0 1 12.9 5.3v13.4a1 1 0 0 1-1.7.8l-4-3.5H4.6A1.6 1.6 0 0 1 3 14.4Z" />
    {on ? (
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M16 9.2a4 4 0 0 1 0 5.6" />
        <path opacity=".45" d="M18.6 6.6a7.6 7.6 0 0 1 0 10.8" />
      </g>
    ) : (
      <path opacity=".5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M16.6 9.6l4.8 4.8M21.4 9.6l-4.8 4.8" />
    )}
  </svg>
);

function inView(el: HTMLElement | null | undefined): boolean {
  if (!el || document.visibilityState !== "visible") return false;
  const box = el.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight;
}

/** A speaker button for the match stage. With sound on, the reveal and the money each get a short cue. */
export function SoundToggle({ phase, aMove, bMove, moved, stage }: { phase: string; aMove: string | null; bMove: string | null; moved: boolean; stage: RefObject<HTMLElement> }) {
  const [on, setOn] = useSound();
  useEffect(() => {
    if (!on || !inView(stage.current)) return;
    if (phase === "reveal") playReveal(aMove, bMove);
    else if (phase === "money" && moved) playMoney();
  }, [phase]);
  return (
    <button className={`icon-btn sound-toggle ${on ? "on" : ""}`} onClick={() => setOn(!on)} aria-pressed={on} aria-label={on ? "Turn sound off" : "Turn sound on"} title={on ? "Sound on" : "Sound off"}>
      <SpeakerIcon on={on} />
    </button>
  );
}
