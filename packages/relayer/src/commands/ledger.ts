import { Arena, type LedgerEntry, formatNear, rulesHistory } from "@parley/sdk";
import { join } from "node:path";
import { Ledger } from "../ledger.ts";
import { ROOT, publicTestnet } from "../localnet.ts";
import { flag } from "./shared.ts";

const line = (e: LedgerEntry) =>
  [
    `#${e.seq}`.padEnd(6),
    new Date(e.at).toISOString().slice(0, 19).replace("T", " "),
    e.kind.padEnd(9),
    e.coins.join(",").padEnd(28),
    (e.account ?? "").padEnd(34),
    `${formatNear(e.near, 4)} NEAR`.padStart(14),
    `${formatNear(e.shares, 4)} sh`.padStart(13),
    e.tx,
  ].join("  ");

const chainTime = (ns: string | null) => (ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().slice(0, 19).replace("T", " ") : "unknown time");

async function history(book: Ledger, arena: Arena, ids: string[]) {
  for (const id of ids) {
    const coin = await arena.coin(id);
    if (!coin) {
      console.log(`${id}: no such coin`);
      continue;
    }
    const { versions, complete } = rulesHistory(coin, book.governance(id));
    console.log(`${id}: ${versions.length} of ${coin.constitution_version} rules versions${complete ? "" : ", some missing"}`);
    for (const v of versions) {
      const vote = v.yes !== null && v.no !== null ? `  for ${formatNear(v.yes, 4)}, against ${formatNear(v.no, 4)}` : "";
      console.log(`  v${v.version}  ${chainTime(v.at)}  ${v.version === 1 ? "by" : "proposed by"} ${v.by ?? "?"}${vote}  ${v.model}  ${v.tx ?? "no transaction"}`);
      console.log(`      ${v.constitution}`);
    }
  }
}

export async function ledger() {
  const deployment = publicTestnet();
  const rpcUrl = process.env.PARLEY_RPC_URL ?? deployment.rpcUrl;
  const book = new Ledger({ dir: join(ROOT, ".testnet"), network: deployment.network, contractId: deployment.contractId, rpcUrl });
  const started = Date.now();
  while (!(await book.pass())) await Bun.sleep(5000);
  const { status, totals, coins, books } = book.summary();
  const n = (v: string) => `${formatNear(v, 4)} NEAR`;
  console.log(`${status.contractId}: ${status.txs} transactions read through block ${status.block}, ${status.entries} entries, ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (status.unread.length) console.log(`unread transactions: ${status.unread.join(", ")}`);
  console.log(`into treasuries ${n(totals.intoTreasuries)} (launches ${n(totals.launched)}, buys ${n(totals.bought)}), out by sells ${n(totals.soldOut)}`);
  console.log(`matches ${totals.matches}, taken by betrayals ${n(totals.taken)}`);
  console.log(`pot in: seed ${n(totals.potIn.seed)}, fees ${n(totals.potIn.fees)}, matches ${n(totals.potIn.matches)}; pot out ${n(totals.potOut)}`);
  console.log(`shares minted ${formatNear(totals.sharesMinted, 4)}, burned ${formatNear(totals.sharesBurned, 4)}; token deposits ${n(totals.tokens)}; sent in directly ${n(totals.received)}`);
  for (const c of coins) console.log(`  ${c.id.padEnd(22)} launched ${n(c.launched)}  bought ${n(c.bought)}  sold ${n(c.sold)}  won ${n(c.won)}  lost ${n(c.lost)}  treasury ${n(c.treasury)}`);
  if (books) {
    console.log(`books at block ${books.block}: balance ${n(books.balance)} = owed ${n(books.owed)} (treasuries ${n(books.treasuries)}, pot ${n(books.pot)}, buy orders ${n(books.escrow)}) + storage ${n(books.storage)} (${books.storageBytes} bytes) + spare ${n(books.spare)}`);
    console.log(`  ${books.balanced ? "balanced" : "SHORT"}; event replay over ${books.replay.entries} entries ${books.replay.matches ? "matches the contract exactly" : "differs:"}`);
    for (const d of books.replay.differences) console.log(`    ${d.what}: events ${d.events}, contract ${d.contract}`);
  }
  const last = Number(flag("last", "15"));
  for (const e of book.entries.slice(-last).reverse()) console.log(line(e));
  const asked = flag("history")?.split(",").filter(Boolean) ?? [];
  if (asked.length) await history(book, new Arena({ rpcUrl, contractId: deployment.contractId }), asked);
}
