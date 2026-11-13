import { type RefObject, useEffect } from "react";
import { playMoney, playReveal, useSound } from "../lib/sound.ts";
import { SpeakerIcon } from "./icons.tsx";
import "./SoundToggle.css";

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
