/** Amounts are yoctoNEAR strings; `treasury`, `pot`, `escrow` and `wallets` are signed changes. */
export interface LedgerEntry {
  seq: number;
  /** Unix milliseconds of the block that ran the receipt. */
  at: number;
  block: number;
  tx: string;
  kind: LedgerKind;
  coins: string[];
  account: string | null;
  /** Who received shares, or the token contract that received a token deposit. */
  to?: string;
  near: string;
  shares: string;
  side?: "buy" | "sell";
  parley?: number;
  moves?: [string, string];
  fee?: string;
  treasury: Record<string, string>;
  pot: string;
  escrow: string;
  /** NEAR that came in from accounts (positive) or was paid out to them (negative). */
  wallets: string;
}

export type LedgerKind = "seeded" | "launched" | "buy" | "sell" | "bought" | "sold" | "cancelled" | "returned" | "match" | "shares" | "token" | "received";

export interface LedgerPage {
  entries: LedgerEntry[];
  /** Pass as `before` for the next, older page. */
  next: number | null;
  status: LedgerStatus;
}

export interface LedgerStatus {
  contractId: string;
  network: string;
  /** Every transaction up to this block has been read. */
  block: number;
  at: number;
  txs: number;
  entries: number;
  caughtUp: boolean;
  /** Transactions the source never returned. Their events, if any, are missing from the ledger. */
  unread: string[];
  error: string | null;
}

export interface CoinMoney {
  id: string;
  launched: string;
  bought: string;
  sold: string;
  won: string;
  lost: string;
  sharesMinted: string;
  sharesBurned: string;
  matches: number;
  treasury: string;
  shares: string;
}

export interface LedgerTotals {
  intoTreasuries: string;
  launched: string;
  bought: string;
  soldOut: string;
  fees: string;
  taken: string;
  potIn: { seed: string; fees: string; matches: string };
  potOut: string;
  escrowIn: string;
  escrowFilled: string;
  escrowRefunded: string;
  tokens: string;
  received: string;
  sharesMinted: string;
  sharesBurned: string;
  matches: number;
}

export interface Books {
  block: number;
  at: number;
  balance: string;
  storageBytes: number;
  storage: string;
  treasuries: string;
  pot: string;
  escrow: string;
  owed: string;
  /** Balance minus what it owes and its storage. Never negative when the books balance. */
  spare: string;
  balanced: boolean;
  replay: { matches: boolean; entries: number; differences: { what: string; events: string; contract: string }[] };
}

export interface LedgerSummary {
  status: LedgerStatus;
  totals: LedgerTotals;
  coins: CoinMoney[];
  books: Books | null;
}
