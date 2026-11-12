import type { Coin, Config, Model, Overview, Parley, SignedReply } from "@parley/sdk/src/types.ts";
import { ARENA_API } from "./live.ts";

export { ARENA_API };

export interface LiveArena {
  network: string;
  contractId: string;
  treasury: string;
  overview: Overview;
  config: Config;
  models: Model[];
  house: Coin[];
}

export interface LiveTurn {
  index: number;
  model: string;
  request: string;
  reply: SignedReply;
  txHash: string;
}

export type LiveEvent =
  | { type: "queued"; ahead: number }
  | { type: "coin"; coin: Coin }
  | { type: "opened"; parley: Parley }
  | { type: "turn"; parley: Parley; turn: LiveTurn }
  | { type: "done"; coin: Coin }
  | { type: "error"; message: string };

export async function loadArena(): Promise<LiveArena> {
  const res = await fetch(`${ARENA_API}/api/arena`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`arena answered ${res.status}`);
  return (await res.json()) as LiveArena;
}

export async function startChallenge(challenge: { name: string; constitution: string; model: string; opponents: string[] }): Promise<string> {
  const res = await fetch(`${ARENA_API}/api/play`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(challenge) });
  const body = (await res.json()) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? "the arena refused the challenge");
  return body.id;
}

export function watchChallenge(id: string, onEvent: (event: LiveEvent) => void, onClose: () => void): () => void {
  const source = new EventSource(`${ARENA_API}/api/play/${id}/events`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as LiveEvent);
  source.onerror = () => {
    source.close();
    onClose();
  };
  return () => source.close();
}

/** A plain-words label for a registered model, read from the request settings the arena stores for it. */
export function modelLabel(model: Model): string {
  if (model.id.startsWith("local/")) return "Practice mode";
  const name = model.id.split("/").pop() ?? model.id;
  return model.options.includes('"enable_thinking":false') ? `${name}: answers at once` : `${name}: reasons first, and you can read it`;
}
