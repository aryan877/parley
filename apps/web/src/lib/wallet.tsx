import { Arena, type WalletCall } from "@parley/sdk/src/arena.ts";
import { KeyPair } from "near-api-js";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ARENA_API, type ArenaInfo, useArenaInfo } from "./live.ts";
import { forget, query, reads } from "./near.ts";
import type { WalletChoice } from "./nearWallet.ts";

export type { WalletChoice };

interface Stored {
  accountId: string;
  privateKey: string;
  network: string;
  contractId: string;
}

interface NearStored {
  accountId: string;
  wallet: string;
  network: string;
}

interface Wallet {
  info: ArenaInfo | null;
  accountId: string | null;
  balance: string | null;
  busy: boolean;
  error: string | null;
  /** Which wallet signs: the play key kept here, or the person's own NEAR wallet. */
  kind: "play" | "near" | null;
  /** The NEAR wallet's name, such as Meteor Wallet. */
  walletName: string | null;
  /** This browser keeps a play wallet key, in use or not. */
  hasPlay: boolean;
  /** NEAR Connect works on this arena's network. */
  nearReady: boolean;
  /** Creates a funded play account from the arena's faucet and keeps its key in this browser. */
  connectPlay(): Promise<void>;
  /** Wallets NEAR Connect offers on this network. Loads NEAR Connect on first use. */
  nearWallets(): Promise<WalletChoice[]>;
  connectNear(walletId: string): Promise<boolean>;
  disconnect(): void;
  /** The arena, signing as the connected account. */
  arena(): Arena | null;
  refresh(): void;
  open: boolean;
  setOpen(open: boolean): void;
}

const STORE = "parley.wallet";
const NEAR_STORE = "parley.near";
const LAUNCHING = "parley.launching";

export const CANCELLED = "You cancelled in your wallet.";

const nearKit = () => import("./nearWallet.ts");

const WalletContext = createContext<Wallet | null>(null);

function stored<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function keep(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const viewBalance = (info: ArenaInfo, accountId: string) =>
  query<{ amount: string }>(info, { request_type: "view_account", finality: "optimistic", account_id: accountId }).then(
    (r) => r.amount,
    (e: unknown) => {
      if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(e))) return "0";
      throw e;
    },
  );

interface Launching {
  account: string;
  coin: string;
  rivals: string[];
  at: number;
}

/** Marks a launch as sent, so a reload while the wallet is open still schedules its matches. Pass null once it lands. */
export function launching(next: Launching | null) {
  keep(LAUNCHING, next);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { info } = useArenaInfo();
  const [play, setPlay] = useState<Stored | null>(() => stored<Stored>(STORE));
  const [near, setNear] = useState<NearStored | null>(() => stored<NearStored>(NEAR_STORE));
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpenState] = useState(false);
  const [tick, setTick] = useState(0);

  const nearReady = info?.network === "testnet" || info?.network === "mainnet";
  const playHere = play && info && play.contractId === info.contractId && play.network === info.network ? play : null;
  const nearHere = near && info && nearReady && near.network === info.network ? near : null;
  const accountId = nearHere?.accountId ?? playHere?.accountId ?? null;

  const saveNear = useCallback((next: NearStored | null) => {
    keep(NEAR_STORE, next);
    setNear(next);
  }, []);

  useEffect(() => setBalance(null), [accountId]);

  useEffect(() => {
    if (!accountId || !info) return;
    let live = true;
    const load = () => viewBalance(info, accountId).then((b) => live && setBalance(b), () => {});
    load();
    const timer = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [accountId, info, tick]);

  useEffect(() => {
    if (!nearHere || !info) return;
    let live = true;
    nearKit()
      .then((kit) => kit.restore(info))
      .then((found) => {
        if (!live || found === undefined) return;
        if (found === null) saveNear(null);
        else if (found !== nearHere.accountId) saveNear({ ...nearHere, accountId: found });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [info, nearHere?.accountId]);

  useEffect(() => {
    const left = stored<Launching>(LAUNCHING);
    if (!info || !accountId || !left || left.account !== accountId) return;
    if (Date.now() - left.at > 3_600_000) return launching(null);
    reads.coin(info, left.coin).then(
      (coin) => {
        launching(null);
        if (coin?.creator !== accountId) return;
        noteCoin(accountId, coin.id);
        fetch(`${ARENA_API}/api/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin: coin.id, opponents: left.rivals }) }).catch(() => {});
      },
      () => {},
    );
  }, [info, accountId]);

  const leaveNear = useCallback(() => {
    if (info) nearKit().then((kit) => kit.signOut(info), () => {});
    saveNear(null);
  }, [info, saveNear]);

  const connectPlay = useCallback(async () => {
    if (!info) return setError("The arena is offline.");
    setError(null);
    if (playHere) {
      if (nearHere) leaveNear();
      setOpenState(false);
      return;
    }
    setBusy(true);
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
      keep(STORE, next);
      setPlay(next);
      if (nearHere) leaveNear();
      setOpenState(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [info, playHere, nearHere, leaveNear]);

  const nearWallets = useCallback(async () => {
    if (!info || !nearReady) return [];
    return (await nearKit()).walletChoices(info);
  }, [info, nearReady]);

  const connectNear = useCallback(
    async (walletId: string) => {
      if (!info || !nearReady) return false;
      setError(null);
      try {
        const { accountId, name } = await (await nearKit()).signIn(info, walletId);
        saveNear({ accountId, wallet: name, network: info.network });
        setOpenState(false);
        return true;
      } catch (e) {
        setError(e instanceof Error && e.name === "Cancelled" ? CANCELLED : `Your wallet did not connect: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    },
    [info, nearReady, saveNear],
  );

  const value = useMemo<Wallet>(() => {
    const send = (chain: ArenaInfo, signer: string) => (call: WalletCall) =>
      nearKit()
        .then((kit) => kit.send(chain, signer, call))
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "Cancelled") throw new Error(CANCELLED);
          if (e instanceof Error && e.name === "SignedOut") saveNear(null);
          throw e;
        });
    return {
      info,
      accountId,
      balance,
      busy,
      error,
      kind: nearHere ? "near" : playHere ? "play" : null,
      walletName: nearHere?.wallet ?? null,
      hasPlay: !!playHere,
      nearReady,
      connectPlay,
      nearWallets,
      connectNear,
      disconnect: () => {
        if (nearHere) return leaveNear();
        keep(STORE, null);
        setPlay(null);
      },
      arena: () => {
        if (!info) return null;
        if (nearHere) return new Arena({ rpcUrl: info.rpcUrl, contractId: info.contractId, wallet: { accountId: nearHere.accountId, send: send(info, nearHere.accountId) } });
        if (playHere) return new Arena({ rpcUrl: info.rpcUrl, contractId: info.contractId, signer: { accountId: playHere.accountId, privateKey: playHere.privateKey } });
        return null;
      },
      refresh: () => {
        if (info) forget(info);
        setTick((t) => t + 1);
      },
      open,
      setOpen: (next: boolean) => {
        if (next) setError(null);
        setOpenState(next);
      },
    };
  }, [info, accountId, nearHere, playHere, nearReady, balance, busy, error, connectPlay, nearWallets, connectNear, leaveNear, saveNear, open]);
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
