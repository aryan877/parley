import { ARCHIVAL_RPC_URLS, Arena, type CallResult, NearRpc, type ParleyEvent, TX_INDEX_URLS, type TxOutcome, formatNear, functionCall, near, panicMessage, parleyEvents } from "@parley/sdk";
import { TESTNET_FILE, publicTestnet, testnetKey } from "@parley/relayer";
import { KeyPair, type KeyPairString } from "near-api-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const COIN = "mirror";
const RELAY = "parley-relay.testnet";
const BUY = "0.5";
const ADDED = "In talk, keep it short.";
const RETRYABLE = ["coin is in a Parley", "order is not due yet", "voting is still open", "timelock is still running"];

const STEP = {
  mint: "relay places a mint order",
  mintFill: "the mint order fills",
  propose: "owner proposes the amendment",
  no: "relay votes no",
  yes: "owner votes yes",
  finalize: "the vote is finalized",
  release: "relay releases its finished vote",
  redeem: "relay places a redeem order",
  redeemFill: "the redeem order fills",
  enact: "the amendment is enacted",
} as const;

type Who = "owner" | "relay";

interface Sent {
  hash: string;
  signer: string;
  publicKey: string;
  by: string;
  method: string;
  args: Record<string, unknown>;
  deposit: string;
  block: number;
  timestamp: string;
  at: string;
  events: ParleyEvent[];
}

interface Holding {
  near: string;
  freeShares: string;
  lockedShares: string;
}

interface Snapshot {
  at: string;
  block: number;
  coin: { version: number; constitution: string; model: string; treasury: string; totalShares: string; matchesPlayed: number; pricePerShare: string; openAmendments: number[] };
  owner: Holding;
  relay: Holding & { wrappedTokens: string };
}

interface Plan {
  baseVersion: number;
  from: string;
  to: string;
  model: string;
  id: number | null;
}

interface HoldersLog {
  network: "testnet";
  arena: string;
  coin: string;
  owner: string;
  relay: string;
  keys: { owner: string; relay: string };
  startBlock: number;
  buy: string;
  plan: Plan | null;
  before: Snapshot | null;
  transactions: Partial<Record<(typeof STEP)[keyof typeof STEP], Sent>>;
  after: Snapshot | null;
  summary: Record<string, unknown> | null;
}

interface Found {
  hash: string;
  signer: string;
  method: string;
  args: Record<string, unknown>;
  events: ParleyEvent[];
}

interface IndexedTx {
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: (string | Record<string, unknown>)[] };
  execution_outcome: { block_height: number };
  receipts: { execution_outcome: { outcome: { executor_id: string; logs: string[]; status: Record<string, unknown> } } }[];
}

const pub = publicTestnet();
const rpcUrl = process.env.PARLEY_RPC_URL ?? pub.rpcUrl;
const keyOf = (accountId: string, role: string) => {
  const key = testnetKey(accountId, role);
  if (!key) throw new Error(`no key for ${accountId}; set PARLEY_${role.toUpperCase()}_KEY_FILE`);
  return key;
};
const keys = { owner: keyOf(pub.owner, "owner"), relay: keyOf(RELAY, "relay") };
const reader = new Arena({ rpcUrl, contractId: pub.contractId });
const as: Record<Who, Arena> = {
  owner: reader.as({ accountId: pub.owner, privateKey: keys.owner }),
  relay: reader.as({ accountId: RELAY, privateKey: keys.relay }),
};
const account: Record<Who, string> = { owner: pub.owner, relay: RELAY };
const publicKey = (key: string) => KeyPair.fromString(key as KeyPairString).getPublicKey().toString();
const rpc = new NearRpc([rpcUrl, ...ARCHIVAL_RPC_URLS.testnet]);
const block = (id: { finality: "final" } | { block_id: string | number }) =>
  rpc.call<{ header: { height: number; timestamp_nanosec: string } }>("block", id).then((b) => b.header);
const chainNow = async () => BigInt((await block({ finality: "final" })).timestamp_nanosec);
const iso = (ns: string | bigint) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();

const FILE = join(dirname(TESTNET_FILE), "testnet-holders.json");
const log: HoldersLog = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, "utf8")) as HoldersLog)
  : {
      network: "testnet",
      arena: pub.contractId,
      coin: COIN,
      owner: pub.owner,
      relay: RELAY,
      keys: { owner: publicKey(keys.owner), relay: publicKey(keys.relay) },
      startBlock: (await block({ finality: "final" })).height,
      buy: BUY,
      plan: null,
      before: null,
      transactions: {},
      after: null,
      summary: null,
    };
const save = () => writeFileSync(FILE, `${JSON.stringify(log, null, 2)}\n`);

const succeeded = (status: Record<string, unknown>) => "SuccessValue" in status || "SuccessReceiptId" in status;
const price = (near: bigint, shares: bigint) => (shares === 0n ? "0" : formatNear((near * 10n ** 24n) / shares, 6));
const event = (sent: Sent | undefined, name: string) => sent?.events.find((e) => e.event === name)?.data;

async function index<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${TX_INDEX_URLS.testnet}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (res?.ok) return (await res.json()) as T;
    if (attempt >= 5) throw new Error(`${TX_INDEX_URLS.testnet}${path} answered ${res?.status ?? "nothing"}`);
    await Bun.sleep(1000 * 2 ** attempt);
  }
}

const scanned = new Map<string, Found>();

/** Successful arena transactions since this scenario began, oldest first, from FastNEAR's transaction index. */
async function arenaTxs(): Promise<Found[]> {
  const rows: { transaction_hash: string; tx_block_height: number }[] = [];
  let resume: string | undefined;
  for (;;) {
    const page = await index<{ account_txs?: typeof rows; resume_token?: string | null }>("/v0/account", {
      account_id: pub.contractId,
      desc: false,
      limit: 200,
      from_tx_block_height: log.startBlock,
      ...(resume ? { resume_token: resume } : {}),
    });
    const got = page.account_txs ?? [];
    rows.push(...got);
    if (got.length < 200 || !page.resume_token) break;
    resume = page.resume_token;
  }
  const settled = Math.max(0, ...rows.map((r) => r.tx_block_height)) - 30;
  const fresh = rows.map((r) => r.transaction_hash).filter((hash) => !scanned.has(hash));
  for (let i = 0; i < fresh.length; i += 20) {
    const { transactions = [] } = await index<{ transactions?: IndexedTx[] }>("/v0/transactions", { tx_hashes: fresh.slice(i, i + 20) });
    for (const t of transactions) {
      const arena = t.receipts.map((r) => r.execution_outcome.outcome).filter((o) => o.executor_id === pub.contractId);
      if (!arena.length || !arena.every((o) => succeeded(o.status))) {
        if (t.execution_outcome.block_height < settled) scanned.set(t.transaction.hash, { hash: t.transaction.hash, signer: "", method: "", args: {}, events: [] });
        continue;
      }
      const call = functionCall(t);
      const found = { hash: t.transaction.hash, signer: t.transaction.signer_id, method: call?.method ?? "", args: call?.args ?? {}, events: parleyEvents(arena.flatMap((o) => o.logs)) };
      if (found.events.length || t.execution_outcome.block_height < settled) scanned.set(found.hash, found);
    }
  }
  return rows.map((r) => scanned.get(r.transaction_hash)).filter((f): f is Found => !!f?.method);
}

const onChain = async (wanted: (tx: Found) => boolean) => (await arenaTxs()).find(wanted) ?? null;
const has = (tx: Found, name: string, data: Record<string, unknown>) =>
  tx.events.some((e) => e.event === name && Object.entries(data).every(([k, v]) => e.data[k] === v));

async function record(label: keyof typeof STEP, hash: string, signer: string): Promise<Sent> {
  const tx = (await rpc.tx(hash, signer)) as TxOutcome & { transaction: { public_key: string } };
  if (!("SuccessValue" in tx.status)) throw new Error(`${STEP[label]}: ${hash} failed: ${JSON.stringify(tx.status)}`);
  const call = functionCall(tx);
  const arena = tx.receipts_outcome.filter((r) => r.outcome.executor_id === pub.contractId);
  const at = await block({ block_id: arena[0]!.block_hash });
  const key = tx.transaction.public_key;
  const sent: Sent = {
    hash,
    signer,
    publicKey: key,
    by: key === log.keys.owner || key === log.keys.relay ? "this script" : signer === pub.owner ? "the live server (owner account, server key)" : signer,
    method: call?.method ?? "",
    args: call?.args ?? {},
    deposit: (tx.transaction.actions[0] as { FunctionCall?: { deposit?: string } }).FunctionCall?.deposit ?? "0",
    block: at.height,
    timestamp: at.timestamp_nanosec,
    at: iso(at.timestamp_nanosec),
    events: parleyEvents(arena.filter((r) => succeeded(r.outcome.status as Record<string, unknown>)).flatMap((r) => r.outcome.logs)),
  };
  log.transactions[STEP[label]] = sent;
  save();
  console.log(`${STEP[label]}: ${hash} (${sent.by})`);
  return sent;
}

type Next = { who: Who; send: () => Promise<CallResult> } | { wait: string };

/**
 * Brings one step about once. A step already in the log is skipped; one already on chain (an earlier run, or the live
 * server's keeper and govern loop) is recorded; otherwise it is sent as soon as `next` says it can be.
 */
async function ensure(label: keyof typeof STEP, wanted: (tx: Found) => boolean, next: () => Promise<Next>, pollMs = 5000): Promise<Sent> {
  const kept = log.transactions[STEP[label]];
  if (kept) {
    console.log(`${STEP[label]}: done before, ${kept.hash}`);
    return kept;
  }
  let said = "";
  for (;;) {
    const found = await onChain(wanted);
    if (found) return record(label, found.hash, found.signer);
    const step = await next();
    if ("wait" in step) {
      if (step.wait !== said) console.log(`${STEP[label]}: waiting, ${(said = step.wait)}`);
    } else {
      const r = await step.send();
      if (r.ok) return record(label, r.hash, account[step.who]);
      const panic = panicMessage(r.error) ?? r.error ?? "refused";
      if (!RETRYABLE.some((p) => panic.includes(p))) {
        await Bun.sleep(15_000);
        const late = await onChain(wanted);
        if (late) return record(label, late.hash, late.signer);
        throw new Error(`${STEP[label]}: ${panic}${r.hash ? ` (${r.hash})` : ""}`);
      }
      console.log(`${STEP[label]}: refused for now, ${panic}`);
    }
    await Bun.sleep(pollMs);
  }
}

const coinNow = async () => {
  const coin = await reader.coin(COIN);
  if (!coin) throw new Error(`no coin ${COIN} on ${pub.contractId}`);
  return coin;
};
const sharesOf = async (who: string) => BigInt(await reader.shares(COIN, who));
const lockOf = async (who: string) => BigInt((await reader.view<{ locked: string } | null>("get_vote", { coin: COIN, account: who }))?.locked ?? "0");
const balanceOf = async (who: string) => (await reader.provider.viewAccount({ accountId: who })).amount.toString();

async function snapshot(): Promise<Snapshot> {
  const head = await block({ finality: "final" });
  const [coin, ownerFree, ownerLocked, ownerNear, relayFree, relayLocked, relayNear, wrapped] = await Promise.all([
    coinNow(),
    sharesOf(pub.owner),
    lockOf(pub.owner),
    balanceOf(pub.owner),
    sharesOf(RELAY),
    lockOf(RELAY),
    balanceOf(RELAY),
    reader.tokenBalance(reader.tokenAccount(COIN), RELAY).catch(() => "0"),
  ]);
  return {
    at: iso(head.timestamp_nanosec),
    block: head.height,
    coin: {
      version: coin.constitution_version,
      constitution: coin.constitution,
      model: coin.model,
      treasury: coin.treasury,
      totalShares: coin.total_shares,
      matchesPlayed: coin.matches_played,
      pricePerShare: price(BigInt(coin.treasury), BigInt(coin.total_shares)),
      openAmendments: coin.amendments ?? [],
    },
    owner: { near: ownerNear, freeShares: ownerFree.toString(), lockedShares: ownerLocked.toString() },
    relay: { near: relayNear, freeShares: relayFree.toString(), lockedShares: relayLocked.toString(), wrappedTokens: wrapped },
  };
}

/** A due order fills on the price after the coin's next settled Parley, or after `order_timeout_ns` if none came. */
async function fillWhenDue(kind: "Mint" | "Redeem"): Promise<Next> {
  const [order, coin, config, now] = await Promise.all([reader.order(COIN, RELAY), coinNow(), reader.config(), chainNow()]);
  if (!order) return { wait: "the order is gone; looking for its fill on chain" };
  if (order.kind !== kind) throw new Error(`the relay's open order on ${COIN} is a ${order.kind}, not a ${kind}`);
  if (coin.in_match !== null) return { wait: `MIRROR is playing Parley ${coin.in_match}` };
  const due = coin.matches_played > order.epoch || now >= BigInt(order.placed_at) + BigInt(config.order_timeout_ns);
  if (!due) return { wait: "the order is not due yet" };
  return { who: "owner", send: () => as.owner.fillOrder(COIN, RELAY) };
}

const ts = (sent: Sent) => BigInt(sent.timestamp);
const relayOrder = (kind: "Mint" | "Redeem") => (tx: Found) => has(tx, "order_placed", { coin: COIN, account: RELAY, kind });
const relayFill = (kind: "mint" | "redeem") => (tx: Found) => has(tx, "order_filled", { coin: COIN, account: RELAY, kind });

if (!log.before) {
  log.before = await snapshot();
  save();
}

const placedMint = await ensure("mint", relayOrder("Mint"), async () => {
  if (await reader.order(COIN, RELAY)) return { wait: "the relay already has an open order on MIRROR" };
  return { who: "relay", send: () => as.relay.placeMint(COIN, near(BUY)) };
});
const filledMint = await ensure("mintFill", relayFill("mint"), () => fillWhenDue("Mint"));

if (!log.plan) {
  const coin = await coinNow();
  if (coin.constitution.includes(ADDED)) throw new Error(`MIRROR's rules already say "${ADDED}"`);
  log.plan = { baseVersion: coin.constitution_version, from: coin.constitution, to: `${coin.constitution} ${ADDED}`, model: coin.model, id: null };
  save();
}
const plan = log.plan;
const proposed = await ensure(
  "propose",
  (tx) => tx.method === "propose_amendment" && has(tx, "amendment_proposed", { coin: COIN, proposer: pub.owner }) && tx.args.constitution === plan.to,
  async () => {
    const coin = await coinNow();
    if (coin.constitution_version !== plan.baseVersion) throw new Error(`MIRROR moved to rules v${coin.constitution_version} before the proposal`);
    return { who: "owner", send: () => as.owner.proposeAmendment(COIN, plan.to, plan.model) };
  },
);
plan.id = Number(event(proposed, "amendment_proposed")?.id);
save();
const id = plan.id;

const votable = async () => {
  const a = await reader.amendment(id);
  if (!a || a.status !== "Voting" || (await chainNow()) >= BigInt(a.ends_at)) throw new Error(`amendment ${id} is no longer open for votes`);
};
const ballot = (voter: string, support: boolean) => (tx: Found) =>
  tx.method === "vote" && tx.hash !== proposed.hash && has(tx, "vote_cast", { id, voter, support });

await ensure("no", ballot(RELAY, false), async () => {
  await votable();
  const shares = await sharesOf(RELAY);
  if (shares === 0n) throw new Error(`${RELAY} holds no free MIRROR shares to vote with`);
  return { who: "relay", send: () => as.relay.vote(id, false, shares) };
});
await ensure("yes", ballot(pub.owner, true), async () => {
  await votable();
  const shares = await sharesOf(pub.owner);
  if (shares === 0n) throw new Error(`${pub.owner} holds no free MIRROR shares to vote with`);
  return { who: "owner", send: () => as.owner.vote(id, true, shares) };
});

const finalized = await ensure("finalize", (tx) => has(tx, "amendment_finalized", { id }), async () => {
  const a = await reader.amendment(id);
  if (!a || a.status !== "Voting") return { wait: "the vote is closed; looking for the finalize call on chain" };
  if ((await chainNow()) < BigInt(a.ends_at)) return { wait: `the vote runs until ${iso(a.ends_at)}` };
  return { who: "owner", send: () => as.owner.finalizeAmendment(id) };
});
if (event(finalized, "amendment_finalized")?.passed !== true) throw new Error(`amendment ${id} did not pass; see ${finalized.hash}`);

await ensure("release", (tx) => tx.method === "release_votes" && tx.signer === RELAY && tx.args.coin === COIN, async () => {
  if ((await lockOf(RELAY)) === 0n) return { wait: "the relay has no vote lock; looking for its release on chain" };
  return { who: "relay", send: () => as.relay.releaseVotes(COIN) };
});
const placedRedeem = await ensure("redeem", relayOrder("Redeem"), async () => {
  if (await reader.order(COIN, RELAY)) return { wait: "the relay already has an open order on MIRROR" };
  const shares = await sharesOf(RELAY);
  if (shares === 0n) throw new Error(`${RELAY} has no free MIRROR shares to sell`);
  return { who: "relay", send: () => as.relay.placeRedeem(COIN, shares) };
});
const filledRedeem = await ensure("redeemFill", relayFill("redeem"), () => fillWhenDue("Redeem"), 2000);

const enacted = await ensure("enact", (tx) => has(tx, "amendment_enacted", { id }) || has(tx, "amendment_lapsed", { id }), async () => {
  const a = await reader.amendment(id);
  if (!a) return { wait: "the amendment is closed; looking for the enact call on chain" };
  const coin = await coinNow();
  if ((await chainNow()) < BigInt(a.enact_after)) return { wait: `the timelock runs until ${iso(a.enact_after)}` };
  if (coin.in_match !== null) return { wait: `MIRROR is playing Parley ${coin.in_match}` };
  return { who: "owner", send: () => as.owner.enactAmendment(id) };
});

log.after = await snapshot();
save();

const coinAt = async (sent: Sent) => (await rpc.view<{ constitution_version: number; matches_played: number }>(pub.contractId, "get_coin", { coin: COIN }, sent.block))!;
const dueBy = async (placed: Sent, filled: Sent) => {
  const epoch = Number(event(placed, "order_placed")?.epoch);
  const played = (await coinAt(filled)).matches_played - epoch;
  return played > 0 ? `MIRROR settled ${played} Parley${played > 1 ? "s" : ""} after the order was placed` : "no MIRROR Parley came, so the 60 second order timeout made it due";
};
const mint = event(filledMint, "order_filled")!;
const tally = event(finalized, "amendment_finalized")!;
const sale = event(filledRedeem, "order_filled")!;
const enactedVersion = event(enacted, "amendment_enacted")?.constitution_version;
const saleVersion = (await coinAt(filledRedeem)).constitution_version;
const before = log.before!;
const after = log.after;
const gap = Number((ts(enacted) - ts(filledRedeem)) / 1_000_000_000n);

const summary = {
  mint: {
    paid: String(mint.near),
    shares: String(mint.shares),
    pricePerShare: price(BigInt(String(mint.near)), BigInt(String(mint.shares))),
    placedAt: placedMint.at,
    filledAt: filledMint.at,
    dueBecause: await dueBy(placedMint, filledMint),
  },
  vote: {
    amendment: id,
    yes: String(tally.yes),
    no: String(tally.no),
    passed: tally.passed,
    quorum: "20% of total shares",
    proposedAt: proposed.at,
    finalizedAt: finalized.at,
  },
  sale: {
    shares: String(sale.shares),
    payout: String(sale.near),
    pricePerShare: price(BigInt(String(sale.near)), BigInt(String(sale.shares))),
    placedAt: placedRedeem.at,
    filledAt: filledRedeem.at,
    dueBecause: await dueBy(placedRedeem, filledRedeem),
    rulesAtFill: saleVersion,
    enactedAt: enacted.at,
    filledBeforeEnactment: ts(filledRedeem) < ts(enacted),
    secondsFromSaleToEnactment: gap,
  },
  versions: { before: before.coin.version, after: after.coin.version, enacted: enactedVersion ?? null },
  relayNetNear: formatNear(BigInt(after.relay.near) - BigInt(before.relay.near), 6),
};
log.summary = summary;
save();

const n = (yocto: unknown, digits = 4) => formatNear(String(yocto), digits);
console.log(`
MIRROR holders on ${pub.contractId}

1. ${RELAY} paid ${n(mint.near)} NEAR for ${n(mint.shares, 6)} MIRROR shares, ${summary.mint.pricePerShare} NEAR a share; ${summary.mint.dueBecause}.
2. ${pub.owner} proposed amendment ${id}: add "${ADDED}" to MIRROR's rules.
3. Vote: yes ${n(tally.yes, 6)} shares (${pub.owner}), no ${n(tally.no, 6)} shares (${RELAY}). Passed: ${tally.passed}.
4. ${RELAY} sold ${n(sale.shares, 6)} shares for ${n(sale.near, 6)} NEAR, ${summary.sale.pricePerShare} NEAR a share, at ${filledRedeem.at} under rules v${saleVersion}; ${summary.sale.dueBecause}.
   The amendment was enacted at ${enacted.at}, ${Math.abs(gap)}s ${gap >= 0 ? "after" : "before"} the sale.
5. MIRROR rules v${before.coin.version} -> v${after.coin.version}: ${after.coin.constitution}
   ${RELAY} NEAR change over the whole run, gas included: ${summary.relayNetNear}

Record: ${FILE}`);
