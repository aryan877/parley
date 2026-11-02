import { type Arena, type Parley, type SignedReply, verifyReply } from "@parley/sdk";
import type { Mind } from "./minds/mind.ts";

export interface TurnRecord {
  parley: number;
  index: number;
  model: string;
  request: string;
  reply: SignedReply;
  txHash: string;
}

export interface PlayResult {
  parley: Parley;
  turns: TurnRecord[];
}

/** Plays every remaining turn of an open Parley: fetch the contract's request, get the signed reply, submit it. */
export async function playParley(arena: Arena, mind: Mind, id: number, onTurn?: (turn: TurnRecord) => void): Promise<PlayResult> {
  const turns: TurnRecord[] = [];
  for (;;) {
    const parley = await arena.parley(id);
    if (!parley) throw new Error(`no Parley ${id}`);
    const request = await arena.turnRequest(id);
    if (parley.status !== "Open" || request === null) return { parley, turns };

    const index = parley.turns.length;
    const model = index % 2 === 0 ? parley.a_model : parley.b_model;
    const reply = await mind.reply(model, request);
    if (!verifyReply(model, request, reply)) throw new Error(`mind ${mind.name} returned a reply that does not verify`);
    const sent = await arena.submitTurn(id, reply);
    if (!sent.ok) throw new Error(`submit_turn failed for Parley ${id} turn ${index}: ${sent.error}`);
    const record = { parley: id, index, model, request, reply, txHash: sent.hash };
    turns.push(record);
    onTurn?.(record);
  }
}

export async function openAndPlay(arena: Arena, mind: Mind, pair?: [string, string], onTurn?: (turn: TurnRecord) => void): Promise<PlayResult> {
  const opened = pair ? await arena.openParleyBetween(pair[0], pair[1]) : await arena.openParley();
  if (!opened.ok) throw new Error(`could not open a Parley: ${opened.error}`);
  return playParley(arena, mind, opened.value as number, onTurn);
}
