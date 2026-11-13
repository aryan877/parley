import { useEffect, useState } from "react";

export type Cue = "sting" | "chime" | "thud" | "clink";

const KEY = "parley:sound";
const listeners = new Set<(on: boolean) => void>();
let on = (() => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
})();
let ctx: AudioContext | null = null;
let out: GainNode | null = null;

/** Only ever called from a click or key press, so the browser lets the sound start. */
function unlock() {
  if (!ctx) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    const squash = ctx.createDynamicsCompressor();
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(squash).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

if (on && typeof window !== "undefined") {
  const first = () => {
    unlock();
    window.removeEventListener("pointerdown", first);
    window.removeEventListener("keydown", first);
  };
  window.addEventListener("pointerdown", first);
  window.addEventListener("keydown", first);
}

export function setSound(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {}
  if (next) {
    unlock();
    play("clink");
  }
  for (const l of listeners) l(next);
}

export function useSound(): [boolean, (on: boolean) => void] {
  const [value, setValue] = useState(on);
  useEffect(() => {
    listeners.add(setValue);
    return () => void listeners.delete(setValue);
  }, []);
  return [value, setSound];
}

function tone(c: AudioContext, dest: AudioNode, { type = "sine", freq, to, at, attack = 0.005, decay, gain }: { type?: OscillatorType; freq: number; to?: number; at: number; attack?: number; decay: number; gain: number }) {
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + decay);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  osc.connect(env).connect(dest);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

function noise(c: AudioContext, dest: AudioNode, { at, decay, gain, filter, freq }: { at: number; decay: number; gain: number; filter: BiquadFilterType; freq: number }) {
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * (decay + 0.05)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  const band = c.createBiquadFilter();
  const env = c.createGain();
  src.buffer = buffer;
  band.type = filter;
  band.frequency.value = freq;
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(band).connect(env).connect(dest);
  src.start(at);
}

const CUES: Record<Cue, (c: AudioContext, dest: AudioNode, at: number) => void> = {
  sting(c, dest, at) {
    const low = c.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(3200, at);
    low.frequency.exponentialRampToValueAtTime(500, at + 0.7);
    low.connect(dest);
    for (const freq of [220, 233.1, 311.1]) tone(c, low, { type: "sawtooth", freq, to: freq * 0.94, at, decay: 0.75, gain: 0.12 });
    tone(c, dest, { type: "square", freq: 880, to: 415, at, decay: 0.22, gain: 0.05 });
    noise(c, dest, { at, decay: 0.12, gain: 0.12, filter: "highpass", freq: 2500 });
  },
  chime(c, dest, at) {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      tone(c, dest, { type: "triangle", freq, at: at + i * 0.075, decay: 0.9, gain: 0.16 });
      tone(c, dest, { freq: freq * 2.76, at: at + i * 0.075, decay: 0.35, gain: 0.025 });
    });
  },
  thud(c, dest, at) {
    tone(c, dest, { freq: 92, to: 38, at, attack: 0.004, decay: 0.45, gain: 0.55 });
    tone(c, dest, { type: "triangle", freq: 146.8, to: 98, at, decay: 0.3, gain: 0.12 });
    noise(c, dest, { at, decay: 0.2, gain: 0.25, filter: "lowpass", freq: 260 });
  },
  clink(c, dest, at) {
    const pitch = 1 + (Math.random() - 0.5) * 0.08;
    tone(c, dest, { freq: 2637 * pitch, at, attack: 0.002, decay: 0.22, gain: 0.09 });
    tone(c, dest, { freq: 3951 * pitch, at, attack: 0.002, decay: 0.12, gain: 0.05 });
    tone(c, dest, { freq: 6100 * pitch, at: at + 0.004, attack: 0.001, decay: 0.06, gain: 0.03 });
    noise(c, dest, { at, decay: 0.03, gain: 0.05, filter: "highpass", freq: 6000 });
  },
};

/** Plays a cue if sound is on and the browser has let it start. Never starts audio by itself. */
export function play(cue: Cue, delay = 0) {
  if (!on || !ctx || !out || ctx.state !== "running") return;
  CUES[cue](ctx, out, ctx.currentTime + 0.01 + delay);
}

/** The reveal's cue, then coins clinking while the money flies. */
export function playReveal(aMove: string | null, bMove: string | null) {
  if (!aMove || !bMove) return;
  play(aMove === "Cooperate" && bMove === "Cooperate" ? "chime" : aMove === "Defect" && bMove === "Defect" ? "thud" : "sting");
}

export function playMoney(count = 4) {
  for (let i = 0; i < count; i++) play("clink", 0.12 + i * 0.16 + Math.random() * 0.05);
}
