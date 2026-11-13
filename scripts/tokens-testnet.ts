import { Arena, type CallResult, TOKEN_DEPOSIT, formatNear, near } from "@parley/sdk";
import { TESTNET_FILE, type PublicDeployment, testnetKey } from "@parley/relayer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const COINS = ["saint", "mirror", "diplomat"];
const TRIP = { coin: "mirror", wrap: "1", send: "0.25", to: "parley-relay.testnet", unwrap: "0.5" };
const KEEP = near(10);

interface TokenLog {
  network: "testnet";
  arena: string;
  payer: string;
  tokens: Record<string, string>;
  roundTrip: typeof TRIP & { token: string; holder: string };
  transactions: Record<string, string>;
}

const pub = JSON.parse(readFileSync(TESTNET_FILE, "utf8")) as PublicDeployment;
const key = testnetKey(pub.owner, "owner");
if (!key) throw new Error(`no key for ${pub.owner}; set PARLEY_OWNER_KEY_FILE`);
const arena = new Arena({ rpcUrl: process.env.PARLEY_RPC_URL ?? pub.rpcUrl, contractId: pub.contractId, signer: { accountId: pub.owner, privateKey: key } });
const FILE = join(dirname(TESTNET_FILE), "testnet-tokens.json");
const old = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as TokenLog) : null;
const log: TokenLog = {
  network: "testnet",
  arena: pub.contractId,
  payer: pub.owner,
  tokens: old?.tokens ?? {},
  roundTrip: { ...TRIP, token: arena.tokenAccount(TRIP.coin), holder: pub.owner },
  transactions: old?.transactions ?? {},
};
const save = () => writeFileSync(FILE, `${JSON.stringify(log, null, 2)}\n`);

async function step(label: string, send: () => Promise<CallResult>) {
  if (log.transactions[label]) return console.log(`${label}: done before, ${log.transactions[label]}`);
  const r = await send();
  if (!r.ok) throw new Error(`${label}: ${r.error}${r.hash ? ` (${r.hash})` : ""}`);
  log.transactions[label] = r.hash;
  save();
  console.log(`${label}: ${r.hash}`);
}

for (const id of COINS) {
  const coin = await arena.coin(id);
  if (!coin || coin.house) throw new Error(`${id} is not a community coin on ${pub.contractId}`);
  const label = `create ${id} token`;
  if (!coin.token && !log.transactions[label]) {
    const { amount } = await arena.provider.viewAccount({ accountId: pub.owner });
    if (amount - TOKEN_DEPOSIT < KEEP) throw new Error(`${pub.owner} would drop under ${formatNear(KEEP)} NEAR, which the live arena needs for gas`);
  }
  if (!coin.token) await step(label, () => arena.createToken(id));
  log.tokens[id] = (await arena.coin(id))?.token ?? arena.tokenAccount(id);
  save();
}

const { coin, token, to } = log.roundTrip;
const symbol = (await arena.tokenMetadata(token)).symbol;
await step(`wrap ${TRIP.wrap} ${symbol}`,() => arena.wrapShares(coin, near(TRIP.wrap)));
if (!log.transactions[`register ${to}`] && (await arena.tokenStorage(token, to))) console.log(`${to} was already registered on ${token}`);
else await step(`register ${to}`, () => arena.registerForToken(token, to));
await step(`send ${TRIP.send} ${symbol} to ${to}`, () => arena.sendTokens(token, to, near(TRIP.send)));
await step(`unwrap ${TRIP.unwrap} ${symbol}`, () => arena.unwrap(token, near(TRIP.unwrap)));

const [shares, mine, theirs, supply] = await Promise.all([arena.shares(coin, pub.owner), arena.tokenBalance(token, pub.owner), arena.tokenBalance(token, to), arena.tokenSupply(token)]);
console.log(`${pub.owner}: ${formatNear(shares)} ${symbol} shares in the arena, ${formatNear(mine)} ${symbol} tokens`);
console.log(`${to}: ${formatNear(theirs)} ${symbol} tokens; ${formatNear(supply)} ${symbol} wrapped in all`);
