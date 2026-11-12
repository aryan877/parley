import { Arena } from "@parley/sdk/src/arena.ts";
import { KeyPair } from "near-api-js";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ARENA_API, type ArenaInfo, useArenaInfo } from "./live.ts";
import { forget, query } from "./near.ts";

interface Stored {
  accountId: string;
  privateKey: string;
  network: string;
  contractId: string;
}

interface Wallet {
  info: ArenaInfo | null;
  accountId: string | null;
  balance: string | null;
  busy: boolean;
  error: string | null;
  /** Creates a funded play account from the arena's faucet and keeps its key in this browser. */
  connectPlay(): Promise<void>;
  disconnect(): void;
  /** The arena, signing as the connected account. */
  arena(): Arena | null;
  refresh(): void;
  open: boolean;
  setOpen(open: boolean): void;
}

const STORE = "parley.wallet";
const WalletContext = createContext<Wallet | null>(null);

const viewBalance = (info: ArenaInfo, accountId: string) =>
  query<{ amount: string }>(info, { request_type: "view_account", finality: "optimistic", account_id: accountId }).then((r) => r.amount);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { info } = useArenaInfo();
  const [stored, setStored] = useState<Stored | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? "null") as Stored | null;
    } catch {
      return null;
    }
  });
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const current = stored && info && stored.contractId === info.contractId && stored.network === info.network ? stored : null;

  useEffect(() => setBalance(null), [current?.accountId]);

  useEffect(() => {
    if (!current || !info) return;
    let live = true;
    const load = () => viewBalance(info, current.accountId).then((b) => live && setBalance(b), () => {});
    load();
    const timer = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [current?.accountId, info, tick]);

  const connectPlay = useCallback(async () => {
    if (!info) return setError("The arena is offline.");
    setBusy(true);
    setError(null);
    try {
      const key = KeyPair.fromRandom("ed25519");
      const res = await fetch(`${ARENA_API}/api/faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey: key.getPublicKey().toString() }),
      });
      const body = (await res.json()) as { accountId?: string; error?: string };
      if (!body.accountId) throw new Error(body.error ?? "could not create a play wallet");
      const next = { accountId: body.accountId, privateKey: key.toString(), network: info.network, contractId: info.contractId };
      localStorage.setItem(STORE, JSON.stringify(next));
      setStored(next);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [info]);

  const value = useMemo<Wallet>(
    () => ({
      info,
      accountId: current?.accountId ?? null,
      balance,
      busy,
      error,
      connectPlay,
      disconnect: () => {
        localStorage.removeItem(STORE);
        setStored(null);
      },
      arena: () => (current && info ? new Arena({ rpcUrl: info.rpcUrl, contractId: info.contractId, signer: { accountId: current.accountId, privateKey: current.privateKey } }) : null),
      refresh: () => {
        if (info) forget(info);
        setTick((t) => t + 1);
      },
      open,
      setOpen,
    }),
    [info, current, balance, busy, error, connectPlay, open],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet outside WalletProvider");
  return wallet;
}

const NOTED = "parley.coins.";

/** Coins this browser's wallet bought, voted on or launched, so My coins knows where to look first. */
export function notedCoins(account: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTED + account) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function noteCoin(account: string | null, coin: string) {
  if (!account) return;
  const coins = notedCoins(account);
  if (coins.has(coin)) return;
  coins.add(coin);
  try {
    localStorage.setItem(NOTED + account, JSON.stringify([...coins]));
  } catch {}
}

/** Short form of a NEAR account for display: player-abc12.test.near → player-abc12 */
export const shortAccount = (id: string) => (id.length > 22 ? `${id.split(".")[0]!.slice(0, 18)}…` : id.split(".")[0] ?? id);
