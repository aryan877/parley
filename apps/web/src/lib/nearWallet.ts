import { NearConnector } from "@hot-labs/near-connect";
import type { WalletCall } from "@parley/sdk/src/arena.ts";

interface Chain {
  network: string;
  rpcUrl: string;
}

export interface WalletChoice {
  id: string;
  name: string;
  icon: string;
  note: string;
}

export interface Outcome {
  status: { SuccessValue?: string; Failure?: unknown };
  transaction: { hash: string };
}

const NOTES: Record<string, string> = {
  "meteor-wallet": "Extension, or its web wallet in a new window",
  "intear-wallet": "Opens its web wallet in a new window",
  "nightly-wallet": "Browser extension",
  ledger: "Hardware wallet over USB",
  "ethereum-wallets": "Sign with MetaMask or another Ethereum wallet",
  "near-cli": "Sign in your terminal with near-cli-rs",
};

const ORDER = ["meteor-wallet", "intear-wallet", "nightly-wallet", "ethereum-wallets", "ledger", "near-cli"];
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

const BACKUP_RPC: Record<string, string> = { testnet: "https://rpc.testnet.near.org", mainnet: "https://rpc.mainnet.near.org" };

const fail = (name: string, message: string) => Object.assign(new Error(message), { name });
const cancelled = () => fail("Cancelled", "cancelled in the wallet");
const signedOut = () => fail("SignedOut", "Your NEAR wallet is signed out. Connect it again.");

let connector: NearConnector | null = null;
let connectorKey = "";

function connectorFor(chain: Chain): NearConnector {
  const network = chain.network === "mainnet" ? "mainnet" : "testnet";
  const key = `${network} ${chain.rpcUrl}`;
  if (!connector || connectorKey !== key) {
    connector = new NearConnector({
      network,
      features: { signAndSendTransaction: true },
      providers: { mainnet: network === "mainnet" ? [chain.rpcUrl] : [], testnet: network === "testnet" ? [chain.rpcUrl] : [] },
      footerBranding: null,
    });
    connectorKey = key;
  }
  return connector;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Wallets NEAR Connect offers on this network, the quickest to set up first. */
export async function walletChoices(chain: Chain): Promise<WalletChoice[]> {
  const c = connectorFor(chain);
  await c.whenManifestLoaded;
  return c.availableWallets
    .map(({ manifest: m }) => ({ id: m.id, name: m.name, icon: m.icon, note: NOTES[m.id] ?? host(m.website) }))
    .sort((a, b) => rank(a.id) - rank(b.id));
}

const text = (e: unknown): string => {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
};

const CANCEL = /user (rejected|cancel+ed|closed|denied|aborted)|rejected by (the )?user|wallet closed|cancel+ed|denied by|closed the (modal|window|popup)|^rejected$/i;
const CHAIN_ERROR = /panicked|ExecutionError|ActionError|FunctionCallError|InvalidTxError/;
const isCancel = (e: unknown) => {
  const t = text(e);
  return CANCEL.test(t) && !CHAIN_ERROR.test(t);
};

/** Signs in with one wallet and returns the account it chose. */
export async function signIn(chain: Chain, walletId: string): Promise<{ accountId: string; name: string }> {
  const c = connectorFor(chain);
  let picked: string | undefined;
  const heard = (e: { accounts: { accountId: string }[] }) => (picked ??= e.accounts[0]?.accountId);
  c.on("wallet:signIn", heard);
  try {
    const wallet = await c.connect({ walletId });
    picked ??= (await wallet.getAccounts())[0]?.accountId;
    if (!picked) throw cancelled();
    return { accountId: picked, name: wallet.manifest.name };
  } catch (e) {
    if (e instanceof Error && e.name === "Cancelled") throw e;
    if (isCancel(e) || /Failed to sign in/.test(text(e))) throw cancelled();
    throw new Error(text(e));
  } finally {
    c.off("wallet:signIn", heard);
  }
}

/** The account NEAR Connect still holds from an earlier visit. `null` when it holds none, `undefined` when unsure. */
export async function restore(chain: Chain): Promise<string | null | undefined> {
  const c = connectorFor(chain);
  await c.whenManifestLoaded;
  if (!c.manifest.wallets.length) return undefined;
  try {
    const { accounts } = await c.getConnectedWallet();
    return accounts[0]?.accountId ?? null;
  } catch (e) {
    return /No wallet selected|No accounts found/.test(text(e)) ? null : undefined;
  }
}

export async function signOut(chain: Chain): Promise<void> {
  await connectorFor(chain)
    .disconnect()
    .catch(() => {});
}

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

function field(value: unknown, ...path: string[]): unknown {
  let at = value;
  for (const key of path) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** Finds a transaction hash in whatever a wallet handed back, success or error. */
function hashIn(value: unknown): string | undefined {
  if (typeof value === "string") return HASH.test(value) ? value : undefined;
  const found = [
    field(value, "transaction", "hash"),
    field(value, "transaction_outcome", "id"),
    field(value, "final_execution_outcome", "transaction", "hash"),
    field(value, "transactionHash"),
    field(value, "txHash"),
    field(value, "hash"),
    field(value, "context", "transactionHash"),
    field(value, "transactionResult", "transaction", "hash"),
  ].find((h) => typeof h === "string" && HASH.test(h));
  return found as string | undefined;
}

/** The outcome if the wallet already returned a finished one, as near-api-js does. */
function finished(value: unknown): Outcome | null {
  const outcome = field(value, "final_execution_outcome") ?? value;
  const status = field(outcome, "status");
  const hash = hashIn(outcome);
  if (!hash || !status || typeof status !== "object") return null;
  if (!("SuccessValue" in status) && !("Failure" in status)) return null;
  return { status: status as Outcome["status"], transaction: { hash } };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads the final result of a sent transaction from the chain. */
async function settle(chain: Chain, signer: string, hash: string): Promise<Outcome> {
  const urls = [chain.rpcUrl, BACKUP_RPC[chain.network]].filter((u): u is string => !!u);
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt) await wait(Math.min(1000 * attempt, 4000));
    try {
      const res = await fetch(urls[attempt % urls.length]!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "parley", method: "tx", params: { tx_hash: hash, sender_account_id: signer, wait_until: "EXECUTED_OPTIMISTIC" } }),
        signal: AbortSignal.timeout(15_000),
      });
      const done = finished(((await res.json()) as { result?: unknown }).result);
      if (done) return done;
    } catch {}
  }
  throw new Error("Your wallet sent it, but the result did not arrive in time. Check My coins in a minute.");
}

/** Signs and sends one function call with the connected wallet and returns the outcome in near-api-js shape. */
export async function send(chain: Chain, signer: string, call: WalletCall): Promise<Outcome> {
  const c = connectorFor(chain);
  const wallet = await c.wallet().catch(() => {
    throw c.manifest.wallets.length ? signedOut() : new Error("Could not reach your wallet. Try again in a moment.");
  });
  let raw: unknown;
  try {
    raw = await wallet.signAndSendTransaction({
      signerId: signer,
      receiverId: call.receiverId,
      actions: [{ type: "FunctionCall", params: { methodName: call.methodName, args: call.args, gas: call.gas.toString(), deposit: call.deposit.toString() } }],
    });
  } catch (e) {
    const hash = hashIn(e);
    if (hash) return finished(e) ?? settle(chain, signer, hash);
    if (isCancel(e)) throw cancelled();
    if (/not signed in|No accounts found/i.test(text(e))) throw signedOut();
    throw new Error(text(e));
  }
  if (raw === null || raw === undefined) throw cancelled();
  const one = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const done = finished(one);
  if (done) return done;
  const hash = hashIn(one);
  if (!hash) throw new Error("Your wallet sent it but did not say how it went. Check My coins in a minute.");
  return settle(chain, signer, hash);
}
