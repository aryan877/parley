import type { Move } from "./types.ts";

export const U128_MAX = (1n << 128n) - 1n;

/** contracts/arena/src/lib.rs `MIN_SHARES` */
export const MIN_SHARES = 10n ** 18n;

export interface Economics {
  stake_bps: number;
  min_treasury: bigint;
  creation_fee: bigint;
}

/** contracts/arena/src/math.rs `mul_div` */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("division by zero");
  const q = (a * b) / d;
  if (q > U128_MAX) throw new Error("mul_div overflow");
  return q;
}

/** contracts/arena/src/math.rs `bps` */
export function bps(amount: bigint, points: number): bigint {
  return mulDiv(amount, BigInt(points), 10_000n);
}

/** contracts/arena/src/parleys.rs `start_parley` */
export function stakeFor(economics: Pick<Economics, "stake_bps">, a: bigint, b: bigint): bigint {
  return bps(a < b ? a : b, economics.stake_bps);
}

export interface Payoff {
  a: bigint;
  b: bigint;
  commons: bigint;
}

/** contracts/arena/src/parleys.rs `settle` */
export function payoff(stake: bigint, commons: bigint, a: Move, b: Move): Payoff {
  if (a === "Cooperate" && b === "Cooperate") {
    const half = stake / 2n;
    const eighth = commons / 8n;
    const bonus = half < eighth ? half : eighth;
    return { a: bonus, b: bonus, commons: -2n * bonus };
  }
  if (a === "Defect" && b === "Cooperate") return { a: stake, b: -stake, commons: 0n };
  if (a === "Cooperate" && b === "Defect") return { a: -stake, b: stake, commons: 0n };
  const half = stake / 2n;
  return { a: -half, b: -half, commons: 2n * half };
}

/** contracts/arena/src/parleys.rs `signed` */
export function signed(delta: bigint): string {
  return delta >= 0n ? `+${delta}` : delta.toString();
}

export interface Launch {
  treasury: bigint;
  shares: bigint;
  fee: bigint;
}

/** contracts/arena/src/coins.rs `create_coin` */
export function launch(economics: Pick<Economics, "min_treasury" | "creation_fee">, deposit: bigint): Launch {
  const fee = economics.creation_fee;
  if (deposit < economics.min_treasury + fee) throw new Error("deposit below min_treasury plus the creation fee");
  return { treasury: deposit - fee, shares: deposit - fee, fee };
}

export interface Holding {
  treasury: bigint;
  shares: bigint;
}

export type MintFill =
  | { filled: true; minted: bigint; treasury: bigint; shares: bigint; requeued: boolean }
  | { filled: false };

/** contracts/arena/src/orders.rs `fill_order`, Mint branch */
export function fillMint(economics: Pick<Economics, "min_treasury">, coin: Holding, amount: bigint, minShares = 0n): MintFill {
  const { treasury, shares } = coin;
  const minted = shares === 0n ? amount : treasury === 0n ? 0n : mulDiv(amount, shares, treasury);
  if (minted === 0n || minted < minShares || shares + minted < MIN_SHARES) return { filled: false };
  return { filled: true, minted, treasury: treasury + amount, shares: shares + minted, requeued: treasury < economics.min_treasury };
}

export type RedeemFill =
  | { filled: true; payout: bigint; sold: bigint; kept: bigint; treasury: bigint; shares: bigint }
  | { filled: false };

/** contracts/arena/src/orders.rs `fill_order`, Redeem branch */
export function fillRedeem(coin: Holding, amount: bigint, minNear = 0n): RedeemFill {
  const { treasury, shares } = coin;
  const left = shares - amount;
  const kept = left > 0n && left < MIN_SHARES ? MIN_SHARES - left : 0n;
  const sold = amount > kept ? amount - kept : 0n;
  const payout = mulDiv(sold, treasury, shares);
  if (sold === 0n || payout < minNear) return { filled: false };
  return { filled: true, payout, sold, kept, treasury: treasury - payout, shares: shares - sold };
}

export function worth(coin: Holding, shares: bigint): bigint {
  return coin.shares === 0n ? 0n : mulDiv(shares, coin.treasury, coin.shares);
}

/** NEAR per share, where a share minted at launch costs exactly 1. */
export function sharePrice(coin: Holding): number {
  if (coin.shares === 0n) return Number.NaN;
  return Number((coin.treasury * 1_000_000_000n) / coin.shares) / 1e9;
}
