import { Account, JsonRpcProvider, type KeyPairString, PublicKey, actions } from "near-api-js";
import { Arena, NETWORKS, near } from "@parley/sdk";
import {
  DEMO_CONFIG,
  FAST_MODEL,
  THINKERS,
  THINKING_MODEL,
  TESTNET_FILE,
  type PublicDeployment,
  attestedModel,
  fetchAttestation,
  loadConstitutions,
  testnetKey,
} from "@parley/relayer";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WASM = join(ROOT, "contracts/arena/res/parley_arena.wasm");
const CONTRACT = process.env.PARLEY_CONTRACT ?? "parley-arena.testnet";
const OWNER = process.env.PARLEY_OWNER ?? "parley-owner.testnet";
const FAUCET = process.env.PARLEY_FAUCET ?? "parley-faucet.testnet";
const BANKS = (process.env.PARLEY_BANKS ?? "parley-bank1.testnet,parley-bank2.testnet,parley-relay.testnet").split(",").filter(Boolean);
const TREASURY = near(process.env.PARLEY_TREASURY ?? "2");
const COMMONS = near(process.env.PARLEY_COMMONS ?? "4");
const TESTNET_CONFIG = { ...DEMO_CONFIG, min_treasury: near("0.5").toString(), creation_fee: near("0.1").toString() };

const rpcUrl = process.env.PARLEY_RPC_URL ?? NETWORKS.testnet.rpcUrl;
const provider = new JsonRpcProvider({ url: rpcUrl });
const account = (id: string) => {
  const key = testnetKey(id, id === OWNER ? "owner" : id === CONTRACT ? "contract" : id);
  if (!key) throw new Error(`no key for ${id} in ~/.near-credentials/testnet`);
  return new Account(id, provider, key as KeyPairString);
};
const hash = (outcome: { transaction: { hash: string } }) => outcome.transaction.hash;
const transactions: Record<string, string> = {};

if (existsSync(TESTNET_FILE)) {
  const old = JSON.parse(readFileSync(TESTNET_FILE, "utf8")) as PublicDeployment;
  if (old.contractId === CONTRACT) throw new Error(`${CONTRACT} is already deployed and locked; pick a new PARLEY_CONTRACT`);
  renameSync(TESTNET_FILE, `${TESTNET_FILE}.${Date.now()}`);
}

const view = async (id: string) => (await provider.query({ request_type: "view_account", account_id: id, finality: "final" })) as unknown as { amount: string; storage_usage: number; code_hash: string };
for (const bank of BANKS) {
  const from = account(bank);
  const state = await view(bank);
  const balance = BigInt(state.amount) - BigInt(state.storage_usage) * 10n ** 19n;
  const keep = near("0.2");
  if (balance > keep) {
    const sent = await from.signAndSendTransaction({ receiverId: OWNER, actions: [actions.transfer(balance - keep)] });
    console.log(`moved ${(Number((balance - keep) / 10n ** 21n) / 1000).toFixed(2)} NEAR from ${bank} to ${OWNER}`);
    transactions[`fund from ${bank}`] = hash(sent);
  }
}

const nonceText = `parley testnet ${CONTRACT} ${new Date().toISOString()}`;
const attestations = await Promise.all([FAST_MODEL, THINKING_MODEL].map((id) => fetchAttestation(id, nonceText)));
for (const a of attestations) console.log(`${a.model}: enclave key ${a.publicKey.slice(0, 16)}… attested by an Intel TDX quote`);
const evidenceDir = join(dirname(TESTNET_FILE), "testnet-attestation");
if (existsSync(evidenceDir)) renameSync(evidenceDir, `${evidenceDir}.${Date.now()}`);
mkdirSync(evidenceDir, { recursive: true });
for (const a of attestations) writeFileSync(join(evidenceDir, `${a.model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`), `${JSON.stringify(a, null, 2)}\n`);

const contract = account(CONTRACT);
const deployed = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.deployContract(new Uint8Array(readFileSync(WASM)))] });
transactions.deploy = hash(deployed);
console.log(`deployed ${CONTRACT}`);

const arena = new Arena({ rpcUrl, contractId: CONTRACT, signer: { accountId: OWNER, privateKey: testnetKey(OWNER, "owner")! } });
const init = await arena.call("new", { config: TESTNET_CONFIG, models: attestations.map(attestedModel) }, { deposit: COMMONS });
if (!init.ok) throw new Error(`init failed: ${init.error}`);
transactions.init = init.hash;
if ((await arena.view<{ owner: string | null }>("get_overview")).owner !== OWNER) throw new Error("someone else initialised the contract first");
console.log(`initialised by ${OWNER}`);

const thinkers = THINKERS.split(",");
const fee = BigInt(TESTNET_CONFIG.creation_fee);
for (const c of loadConstitutions()) {
  const made = await arena.createCoin({ id: c.id, name: c.name, constitution: c.text, model: thinkers.includes(c.id) ? THINKING_MODEL : FAST_MODEL }, TREASURY + fee);
  if (!made.ok) throw new Error(`create ${c.id}: ${made.error}`);
  transactions[`create ${c.id}`] = made.hash;
  console.log(`created ${c.name}`);
}

const keys = (await provider.query({ request_type: "view_access_key_list", account_id: CONTRACT, finality: "final" })) as unknown as { keys: { public_key: string }[] };
const locked = await contract.signAndSendTransaction({ receiverId: CONTRACT, actions: keys.keys.map((k) => actions.deleteKey(PublicKey.fromString(k.public_key))) });
transactions.lock = hash(locked);
let left = 1;
for (let tries = 0; left && tries < 20; tries++) {
  await Bun.sleep(1500);
  left = ((await provider.query({ request_type: "view_access_key_list", account_id: CONTRACT, finality: "final" })) as unknown as { keys: unknown[] }).keys.length;
}
if (left) throw new Error(`${CONTRACT} still has ${left} access keys`);
console.log(`locked: ${CONTRACT} has no access keys, so its code can never change`);

const state = await view(CONTRACT);
const pub: PublicDeployment = { network: "testnet", rpcUrl: NETWORKS.testnet.rpcUrl, contractId: CONTRACT, owner: OWNER, faucet: FAUCET, deployedAt: new Date().toISOString(), codeHash: state.code_hash, transactions };
mkdirSync(dirname(TESTNET_FILE), { recursive: true });
writeFileSync(TESTNET_FILE, `${JSON.stringify(pub, null, 2)}\n`);
console.log(`wrote ${TESTNET_FILE}`);
