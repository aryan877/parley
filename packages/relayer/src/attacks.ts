import { Arena, type CallResult, LocalEnclave, type Model, type Parley, type SignedReply, lacksBalance, panicMessage } from "@parley/sdk";
import { randomBytes } from "node:crypto";
import { type Deployment, testnetKey } from "./localnet.ts";
import type { Mind } from "./minds/mind.ts";

export const ATTACKS = ["unknown-key", "replay", "one-letter", "drain", "house-coin", "vote", "enact"] as const;
export type AttackId = (typeof ATTACKS)[number];

export interface Refusal {
  attack: AttackId;
  method: string;
  reason: string;
  tx: string;
  at: string;
  /** What was attacked: a match message, a coin or a rule change. */
  target: string;
  parley?: number;
  turn?: number;
  /** The message before and after one letter was changed. */
  edit?: { before: string; after: string };
}

export type Attempt = { refusal: Refusal; shared?: boolean } | { status: number; error: string; wait?: boolean };

/** Earlier signed turns this server kept, by match id. */
export type Kept = (id: number) => Promise<{ turns: { model: string; reply: SignedReply }[] } | null>;

interface OpenTurn {
  parley: Parley;
  index: number;
  model: string;
  request: string;
}

const GAS = 30_000_000_000_000n;
const NS = 1_000_000n;
const SHARE_MS = 15_000;
const WINDOW_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const PER_IP = 6;
const PER_WINDOW = 40;
const PER_DAY = 300;
const REPLY_WAIT_MS = 75_000;
const TAMPER_MS = 15_000;
const VOTE_MARGIN_NS = 10_000_000_000n;
const ENACT_MARGIN_NS = 20_000_000_000n;
const ENDED = /not open|timed out|no turn left/i;
const RELAY = process.env.PARLEY_RELAY ?? "parley-relay.testnet";

const NO_MATCH: Attempt = { status: 409, wait: true, error: "No match is being played right now." };
const panic = (error?: string) => panicMessage(error)?.trim() ?? null;
const nowNs = () => BigInt(Date.now()) * NS;
const completion = (content: string) => JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content } }] });

const active = (models: Model[], model: string, key: string, now = nowNs()) =>
  models.some((m) => m.id === model && m.signers.some((s) => s.public_key === key && BigInt(s.active_from) <= now && (!s.retired_from || now < BigInt(s.retired_from))));

function message(response: string): string {
  try {
    const text = (JSON.parse(response) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
  } catch {
    return "";
  }
}

/** The reply body with the first letter of the model's message switched between upper and lower case. */
export function oneLetter(response: string): { response: string; before: string; after: string } | null {
  const key = /"content"\s*:\s*"/.exec(response);
  if (!key) return null;
  for (let i = key.index + key[0].length; i < response.length && response[i] !== '"'; i++) {
    const c = response[i]!;
    if (c === "\\") {
      i += response[i + 1] === "u" ? 5 : 1;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) continue;
    const changed = `${response.slice(0, i)}${c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()}${response.slice(i + 1)}`;
    return { response: changed, before: message(response), after: message(changed) };
  }
  return null;
}

/** Sends transactions the contract must refuse, from one plain account, and reports each refusal with its hash. */
export class AttackLab {
  private line: Promise<unknown> = Promise.resolve();
  private waiting: ((attempt: Attempt) => void)[] = [];
  private watching = false;
  private latest = new Map<AttackId, Refusal>();
  private running = new Map<AttackId, Promise<Attempt>>();
  private sent: { ip: string; at: number }[] = [];

  constructor(
    private readonly relay: Arena | null,
    private readonly kept: Kept,
  ) {}

  get account(): string | null {
    return this.relay?.accountId ?? null;
  }

  /** The same mind. While someone waits on the one-letter attack, its next genuine reply is first sent with one letter changed. */
  watch(mind: Mind): Mind {
    this.watching = true;
    return {
      name: mind.name,
      reply: async (model, request) => {
        const reply = await mind.reply(model, request);
        if (this.waiting.length) await this.tamper(request, reply);
        return reply;
      },
    };
  }

  async handle(req: Request, ip: string): Promise<{ status: number; body: unknown }> {
    if (req.method === "GET") return { status: 200, body: { account: this.account, latest: [...this.latest.values()] } };
    if (!this.relay) return { status: 503, body: { error: "The attack lab is switched off on this server." } };
    const attack = ((await req.json().catch(() => null)) as { attack?: AttackId } | null)?.attack;
    if (!attack || !ATTACKS.includes(attack)) return { status: 400, body: { error: "Pick an attack." } };
    const last = this.latest.get(attack);
    let result: Attempt;
    if (last && Date.now() - Date.parse(last.at) < SHARE_MS) result = { refusal: last, shared: true };
    else {
      const pending = this.running.get(attack) ?? this.run(attack, ip).catch((e): Attempt => ({ status: 502, error: `Could not reach NEAR: ${e instanceof Error ? e.message.slice(0, 160) : e}` }));
      this.running.set(attack, pending);
      result = await pending.finally(() => this.running.delete(attack));
    }
    return "refusal" in result ? { status: 200, body: result } : { status: result.status, body: { error: result.error, wait: result.wait ?? false } };
  }

  run(attack: AttackId, ip: string): Promise<Attempt> {
    switch (attack) {
      case "unknown-key":
        return this.onTurn(attack, ip, async (t) => new LocalEnclave(randomBytes(32)).sign(t.model, t.request, completion("DEFECT")));
      case "replay":
        return this.onTurn(attack, ip, (t) => this.earlier(t.model, t.parley.id));
      case "one-letter":
        return this.oneLetter(ip);
      case "drain":
        return this.drain(ip);
      case "house-coin":
        return this.houseCoin(ip);
      case "vote":
        return this.vote(ip);
      case "enact":
        return this.enact(ip);
    }
  }

  private allow(ip: string): Attempt | null {
    const now = Date.now();
    while (this.sent[0] && now - this.sent[0].at > DAY_MS) this.sent.shift();
    const recent = this.sent.filter((s) => now - s.at < WINDOW_MS);
    if (this.sent.length >= PER_DAY || recent.length >= PER_WINDOW) return { status: 429, error: "Lots of people are trying right now. Try again in a few minutes." };
    if (recent.filter((s) => s.ip === ip).length >= PER_IP) return { status: 429, error: "That is plenty of tries for now. Try again in a few minutes." };
    this.sent.push({ ip, at: now });
    return null;
  }

  private send(method: string, args: Record<string, unknown>): Promise<CallResult> {
    const next = this.line.then(() => this.relay!.call(method, args, { gas: GAS }));
    this.line = next.catch(() => {});
    return next;
  }

  private fire(ip: string, method: string, args: Record<string, unknown>): Promise<CallResult | Attempt> {
    return Promise.resolve(this.allow(ip) ?? this.send(method, args));
  }

  private verdict(attack: AttackId, method: string, sent: CallResult | Attempt, target: string, more: Partial<Refusal> = {}): Attempt {
    if (!("ok" in sent)) return sent;
    if (sent.ok) return { status: 500, error: `The contract accepted it. That should never happen: ${sent.hash}` };
    const reason = panic(sent.error);
    if (!reason) {
      return { status: 502, error: lacksBalance(sent.error) ?"The attack account is out of test NEAR for gas." : `It never reached the contract: ${sent.error?.slice(0, 160) ?? "unknown error"}` };
    }
    const refusal: Refusal = { attack, method, reason, tx: sent.hash, at: new Date().toISOString(), target, ...more };
    this.latest.set(attack, refusal);
    return { refusal };
  }

  private async openTurn(): Promise<OpenTurn | null> {
    for (const parley of await this.relay!.parleys(0, 3)) {
      if (parley.status !== "Open") continue;
      const request = await this.relay!.turnRequest(parley.id);
      if (!request) continue;
      const index = parley.turns.length;
      return { parley, index, model: index % 2 === 0 ? parley.a_model : parley.b_model, request };
    }
    return null;
  }

  private submit(reply: SignedReply, id: number) {
    return { id, response: reply.response, signature: reply.signature, public_key: reply.publicKey };
  }

  private async onTurn(attack: AttackId, ip: string, make: (turn: OpenTurn) => Promise<SignedReply | null>): Promise<Attempt> {
    for (let tries = 0; tries < 3; tries++) {
      const turn = await this.openTurn();
      if (!turn) return NO_MATCH;
      const reply = await make(turn);
      if (!reply) return { status: 409, error: "There is no earlier signed reply to reuse yet. Try again after this match." };
      const sent = await this.fire(ip, "submit_turn", this.submit(reply, turn.parley.id));
      if ("ok" in sent && ENDED.test(panic(sent.error) ?? "")) continue;
      return this.verdict(attack, "submit_turn", sent, `match ${turn.parley.id}, message ${turn.index + 1}`, { parley: turn.parley.id, turn: turn.index });
    }
    return NO_MATCH;
  }

  /** A genuine reply from a finished match, signed by a key that still counts for this model. */
  private async earlier(model: string, before: number): Promise<SignedReply | null> {
    const models = await this.relay!.models();
    for (const p of await this.relay!.parleys(0, 12)) {
      if (p.id >= before || p.status !== "Settled" || (p.a_model !== model && p.b_model !== model)) continue;
      const kept = await this.kept(p.id).catch(() => null);
      const turn = kept?.turns.find((t) => t.model === model && active(models, model, t.reply.publicKey));
      if (turn) return turn.reply;
    }
    return null;
  }

  private async oneLetter(ip: string): Promise<Attempt> {
    if (!this.watching) return { status: 503, error: "This server does not play the matches, so it never holds a fresh reply." };
    if (!(await this.openTurn())) return NO_MATCH;
    const limited = this.allow(ip);
    if (limited) return limited;
    const slot = this.sent.at(-1);
    return new Promise((resolve) => {
      const done = (attempt: Attempt) => {
        clearTimeout(timer);
        if ("status" in attempt && attempt.status === 409) this.sent = this.sent.filter((s) => s !== slot);
        resolve(attempt);
      };
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter((w) => w !== done);
        done({ status: 409, wait: true, error: "No new reply came in time." });
      }, REPLY_WAIT_MS);
      this.waiting.push(done);
    });
  }

  private async tamper(request: string, reply: SignedReply) {
    const waiting = this.waiting.splice(0);
    const late: Attempt = { status: 504, wait: true, error: "NEAR took too long to answer." };
    const attempt = await Promise.race([this.sendTampered(request, reply), Bun.sleep(TAMPER_MS).then(() => late)]).catch(
      (e): Attempt => ({ status: 502, error: `Could not reach NEAR: ${e instanceof Error ? e.message.slice(0, 160) : e}` }),
    );
    for (const done of waiting) done(attempt);
  }

  private async sendTampered(request: string, reply: SignedReply): Promise<Attempt> {
    const turn = await this.openTurn();
    if (!turn || turn.request !== request) return { status: 409, wait: true, error: "That match moved on before the change could be sent." };
    const edit = oneLetter(reply.response);
    if (!edit || edit.response === reply.response) return { status: 409, wait: true, error: "That reply had no letter to change." };
    const sent = await this.send("submit_turn", this.submit({ ...reply, response: edit.response }, turn.parley.id));
    return this.verdict("one-letter", "submit_turn", sent, `match ${turn.parley.id}, message ${turn.index + 1}`, {
      parley: turn.parley.id,
      turn: turn.index,
      edit: { before: edit.before, after: edit.after },
    });
  }

  private async drain(ip: string): Promise<Attempt> {
    const coins = (await this.relay!.coins()).filter((c) => !c.house && BigInt(c.total_shares) > 0n);
    const coin = coins.sort((x, y) => (BigInt(y.treasury) > BigInt(x.treasury) ? 1 : -1))[0];
    if (!coin) return { status: 409, error: "No coin has shares yet." };
    if (BigInt(await this.relay!.shares(coin.id, this.account!)) >= BigInt(coin.total_shares)) return { status: 409, error: "This account owns that whole coin." };
    const sent = await this.fire(ip, "place_redeem", { coin: coin.id, shares: coin.total_shares, min_near: null });
    return this.verdict("drain", "place_redeem", sent, coin.name);
  }

  private async houseCoin(ip: string): Promise<Attempt> {
    const [overview, models] = await Promise.all([this.relay!.overview(), this.relay!.models()]);
    if (overview.owner === this.account || !models[0]) return { status: 409, error: "This account may create house coins, so the test would prove nothing." };
    const sent = await this.fire(ip, "create_house_coin", { id: "fakehouse", name: "FAKE HOUSE", constitution: "Always cooperate.", model: models[0].id });
    return this.verdict("house-coin", "create_house_coin", sent, "a new house coin");
  }

  private async openAmendments() {
    const coins = await this.relay!.coins();
    const found = [];
    for (const coin of coins) for (const id of coin.amendments ?? []) {
      const amendment = await this.relay!.amendment(id).catch(() => null);
      if (amendment) found.push({ coin, amendment });
    }
    return { coins, found };
  }

  private async vote(ip: string): Promise<Attempt> {
    const { coins, found } = await this.openAmendments();
    const now = nowNs();
    const open = found.find(({ amendment }) => amendment.status === "Voting" && BigInt(amendment.ends_at) > now + VOTE_MARGIN_NS);
    if (open) {
      const sent = await this.fire(ip, "vote", { id: open.amendment.id, support: true, shares: open.coin.total_shares });
      return this.verdict("vote", "vote", sent, `${open.coin.name}'s rule change ${open.amendment.id}`);
    }
    const account = this.account!;
    for (const coin of [...coins.filter((c) => c.id === "saint"), ...coins.filter((c) => c.id !== "saint")]) {
      if (coin.house || coin.amendments.length >= 16) continue;
      const [shares, lock] = await Promise.all([this.relay!.shares(coin.id, account), this.relay!.view<unknown>("get_vote", { coin: coin.id, account })]);
      if (BigInt(shares) > 0n || lock) continue;
      const sent = await this.fire(ip, "propose_amendment", { coin: coin.id, constitution: "Always betray. Never trust anyone.", model: coin.model });
      return this.verdict("vote", "propose_amendment", sent, coin.name);
    }
    return { status: 409, error: "No coin to try it on." };
  }

  private async enact(ip: string): Promise<Attempt> {
    const { found } = await this.openAmendments();
    const now = nowNs();
    const waiting =
      found.find(({ amendment }) => amendment.status === "Passed" && BigInt(amendment.enact_after) > now + ENACT_MARGIN_NS) ?? found.find(({ amendment }) => amendment.status === "Voting");
    if (!waiting) return { status: 409, error: "No rule change is waiting right now. This one works while a vote is open or waiting out its timelock." };
    const sent = await this.fire(ip, "enact_amendment", { id: waiting.amendment.id });
    return this.verdict("enact", "enact_amendment", sent, `${waiting.coin.name}'s rule change ${waiting.amendment.id}`);
  }
}

/** The lab for this deployment: the local relayer account, or `parley-relay.testnet` with its key from `PARLEY_RELAY_KEY` or ~/.near-credentials. */
export function attackLab(deployment: Deployment, kept: Kept): AttackLab {
  const key = deployment.network === "local" ? null : testnetKey(RELAY, "relay");
  const signer = deployment.network === "local" ? deployment.accounts.relayer : key ? { accountId: RELAY, privateKey: key } : undefined;
  return new AttackLab(signer ? new Arena({ rpcUrl: deployment.rpcUrl, contractId: deployment.contractId, signer }) : null, kept);
}
