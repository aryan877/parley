import type { ParleyEvidence } from "@parley/league/src/browser.ts";
import { thoughts } from "@parley/league/src/browser.ts";
import { sinceLaunchPct } from "@parley/sdk/src/chronicle.ts";
import type { Coin, Move, Parley, SignedReply } from "@parley/sdk/src/types.ts";
import { YOCTO, fmtNear, nearNumber } from "@parley/sdk/src/units.ts";

export { fmtNear, nearNumber };

export type Side = "A" | "B";

/** One thing a coin said or chose, with the signed bytes behind it when we have them. */
export interface Line {
  index: number;
  side: Side;
  kind: "Talk" | "Decide";
  text: string;
  thought: string;
  proof?: { model: string; request: string; reply: SignedReply; txHash?: string };
}

export interface Match {
  id: number;
  a: string;
  b: string;
  aModel: string;
  bModel: string;
  stake: string;
  nonce: string;
  settled: boolean;
  void: boolean;
  lines: Line[];
  aMove: Move | null;
  bMove: Move | null;
  aDelta: string;
  bDelta: string;
  potDelta: string;
  /** Each coin's rules version when the match was played. */
  aVersion: number;
  bVersion: number;
}

export interface CoinInfo {
  id: string;
  name: string;
  rules: string;
  model: string;
  treasury: string;
  shares: string;
  house: boolean;
  played: number;
  trusted: number;
  betrayed: number;
  betrayals: number;
  wasBetrayed: number;
  token: string | null;
  version: number;
  creator: string;
}

export function fromParley(parley: Parley, replies: ({ model: string; request: string; reply: SignedReply; txHash?: string } | undefined)[] = []): Match {
  return {
    id: parley.id,
    a: parley.a,
    b: parley.b,
    aModel: parley.a_model,
    bModel: parley.b_model,
    stake: parley.stake,
    nonce: parley.nonce,
    settled: parley.status === "Settled",
    void: parley.status === "Void",
    lines: parley.turns.map((t, i) => {
      const proof = replies[i];
      return { index: i, side: t.side, kind: t.kind, text: t.text, thought: proof ? thoughts(proof.reply.response) : "", proof };
    }),
    aMove: parley.a_move,
    bMove: parley.b_move,
    aDelta: parley.a_delta,
    bDelta: parley.b_delta,
    potDelta: parley.commons_delta,
    aVersion: parley.a_constitution_version ?? 1,
    bVersion: parley.b_constitution_version ?? 1,
  };
}

export function fromEvidence(e: ParleyEvidence): Match {
  return fromParley(
    e.parley,
    e.turns.map((t) => ({ model: t.model, request: t.request, reply: t.reply })),
  );
}

export function fromCoin(c: Coin): CoinInfo {
  return {
    id: c.id,
    name: c.name,
    rules: c.constitution,
    model: c.model,
    treasury: c.treasury,
    shares: c.total_shares,
    house: c.house,
    played: c.stats.matches,
    trusted: c.stats.cooperated,
    betrayed: c.stats.defected,
    betrayals: c.stats.betrayed_other,
    wasBetrayed: c.stats.was_betrayed,
    token: c.token ?? null,
    version: c.constitution_version,
    creator: c.creator,
  };
}

/** A config amount such as a fee: 0.1, 1 or 2.5, with no padding zeros. */
export const plainNear = (yocto: string | bigint) => nearNumber(yocto).toLocaleString("en-US", { maximumFractionDigits: 4 });

export function signedNear(yocto: string | bigint, digits = 2): string {
  const v = BigInt(yocto);
  return `${v > 0n ? "+" : v < 0n ? "−" : ""}${fmtNear(v < 0n ? -v : v, digits)}`;
}

/** NEAR per share. A coin with no shares (a house coin) reports its treasury per 100 NEAR it started with. */
export function sharePrice(c: CoinInfo, start = 100n * YOCTO): number {
  const shares = BigInt(c.shares);
  const treasury = BigInt(c.treasury);
  if (shares > 0n) return Number((treasury * 1_000_000n) / shares) / 1_000_000;
  return Number((treasury * 1_000_000n) / start) / 1_000_000;
}

export const trustRate = (c: CoinInfo) => (c.played ? c.trusted / c.played : 0);

/** Percent change in share price since launch, when every coin's shares start at 1 NEAR each. Null for coins without shares. */
export const sinceLaunch = (c: { treasury: string; shares: string }) => sinceLaunchPct({ treasury: c.treasury, total_shares: c.shares });

export const pctText = (pct: number) => `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
