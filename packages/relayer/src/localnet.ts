import { Account, JsonRpcProvider, KeyPair, type KeyPairString, actions } from "near-api-js";
import { type Config, MINUTE_NS, type ModelInput, NETWORKS, near } from "@parley/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "../../..");
const HOME = join(ROOT, ".localnet");
const DEPLOYMENT = join(HOME, "deployment.json");
const BUILT_WASM = join(ROOT, "target/near/parley_arena/parley_arena.wasm");
const KEPT_WASM = join(ROOT, "contracts/arena/res/parley_arena.wasm");

export interface Deployment {
  network: "local" | "testnet";
  rpcUrl: string;
  contractId: string;
  accounts: Record<string, { accountId: string; privateKey: string }>;
}

/** What a public deployment records in `deployments/<network>.json`. Keys never go in this file. */
export interface PublicDeployment {
  network: "testnet";
  rpcUrl: string;
  contractId: string;
  owner: string;
  faucet: string;
  deployedAt: string;
  codeHash: string;
  transactions: Record<string, string>;
}

export const TESTNET_FILE = join(ROOT, "deployments", "testnet.json");
const CREDENTIALS = join(process.env.HOME ?? "", ".near-credentials", "testnet");

/** A testnet key from the environment (`PARLEY_<ROLE>_KEY`) or from the near CLI's legacy keychain. */
export function testnetKey(accountId: string, role: string): string | null {
  const env = process.env[`PARLEY_${role.toUpperCase()}_KEY`];
  if (env) return env;
  const file = join(CREDENTIALS, `${accountId}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { private_key: string }).private_key : null;
}

function loadTestnet(): Deployment {
  if (!existsSync(TESTNET_FILE)) throw new Error("no testnet deployment; run `bun scripts/deploy-testnet.ts` first");
  const pub = JSON.parse(readFileSync(TESTNET_FILE, "utf8")) as PublicDeployment;
  const accounts: Deployment["accounts"] = {};
  for (const [role, accountId] of [["arena", pub.owner], ["faucet", pub.faucet]] as const) {
    const privateKey = testnetKey(accountId, role === "arena" ? "owner" : role);
    if (privateKey) accounts[role] = { accountId, privateKey };
  }
  if (!accounts.arena) throw new Error(`no key for ${pub.owner}; set PARLEY_OWNER_KEY`);
  return { network: "testnet", rpcUrl: process.env.PARLEY_RPC_URL ?? pub.rpcUrl, contractId: pub.contractId, accounts };
}

export const DEMO_CONFIG: Config = {
  stake_bps: 200,
  talk_turns: 2,
  max_coins: 256,
  max_constitution_len: 1200,
  max_message_len: 280,
  max_response_bytes: 32_768,
  min_treasury: near(1).toString(),
  match_timeout_ns: (10n * MINUTE_NS).toString(),
  order_timeout_ns: MINUTE_NS.toString(),
  vote_period_ns: (2n * MINUTE_NS).toString(),
  timelock_ns: (4n * MINUTE_NS).toString(),
  quorum_bps: 2000,
  proposer_bps: 100,
  signer_delay_ns: (10n * MINUTE_NS).toString(),
  rest_ns: (MINUTE_NS / 3n).toString(),
  pair_rest_ns: MINUTE_NS.toString(),
  creation_fee: near(1).toString(),
};

/** The local deployment, or the public testnet one when `PARLEY_NETWORK=testnet`. */
export function loadDeployment(): Deployment {
  if (process.env.PARLEY_NETWORK === "testnet") return loadTestnet();
  if (!existsSync(DEPLOYMENT)) throw new Error("no local deployment; run `bun run deploy:local` first");
  return JSON.parse(readFileSync(DEPLOYMENT, "utf8")) as Deployment;
}

/** A new play account for a key someone holds in their browser, funded with test NEAR from the faucet account. */
export async function fundPlayer(deployment: Deployment, publicKey: string): Promise<string> {
  if (deployment.network === "local") return fundLocalAccount(publicKey);
  const faucet = deployment.accounts.faucet;
  if (!faucet) throw new Error("this server has no faucet key");
  const funder = new Account(faucet.accountId, new JsonRpcProvider({ url: deployment.rpcUrl }), faucet.privateKey as KeyPairString);
  const accountId = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${faucet.accountId}`;
  await funder.createSubAccount({ accountOrPrefix: accountId, publicKey, nearToTransfer: PLAY_FUNDS });
  return accountId;
}

export const PLAY_FUNDS = near(1.5);

/** Creates a new local account for a key someone holds, funded with test NEAR. Only for the local chain. */
export async function fundLocalAccount(publicKey: string, amount = near(50)): Promise<string> {
  const validator = JSON.parse(readFileSync(join(HOME, "validator_key.json"), "utf8")) as { account_id: string; secret_key: string };
  const rpcUrl = process.env.LOCALNET_PORT ? `http://127.0.0.1:${process.env.LOCALNET_PORT}` : NETWORKS.local.rpcUrl;
  const root = new Account(validator.account_id, new JsonRpcProvider({ url: rpcUrl }), validator.secret_key as KeyPairString);
  const accountId = `player-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${validator.account_id}`;
  await root.createSubAccount({ accountOrPrefix: accountId, publicKey, nearToTransfer: amount });
  return accountId;
}

/** Deploys a fresh arena on the local chain and funds a handful of named accounts. */
export async function deployLocal(models: ModelInput[], overrides: Partial<Config> = {}, commons = near(200)): Promise<Deployment> {
  const keyFile = join(HOME, "validator_key.json");
  if (!existsSync(keyFile)) throw new Error("the local chain is not set up; run `bun run localnet start` first");
  const validator = JSON.parse(readFileSync(keyFile, "utf8")) as { account_id: string; secret_key: string };
  const rpcUrl = process.env.LOCALNET_PORT ? `http://127.0.0.1:${process.env.LOCALNET_PORT}` : NETWORKS.local.rpcUrl;
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const root = new Account(validator.account_id, provider, validator.secret_key as KeyPairString);
  const tag = Date.now().toString(36);
  const accounts: Deployment["accounts"] = {};

  for (const [name, funds] of [["arena", 2000], ["relayer", 100], ["alice", 2000], ["bob", 2000], ["carol", 2000]] as const) {
    const key = KeyPair.fromRandom("ed25519");
    const accountId = `${name}-${tag}.${validator.account_id}`;
    await root.createSubAccount({ accountOrPrefix: accountId, publicKey: key.getPublicKey(), nearToTransfer: near(funds) });
    accounts[name] = { accountId, privateKey: key.toString() };
  }

  const arena = new Account(accounts.arena!.accountId, provider, accounts.arena!.privateKey as KeyPairString);
  await arena.signAndSendTransaction({
    receiverId: arena.accountId,
    actions: [
      actions.deployContract(new Uint8Array(readFileSync(existsSync(BUILT_WASM) ? BUILT_WASM : KEPT_WASM))),
      actions.functionCall("new", { config: { ...DEMO_CONFIG, ...overrides }, models }, 100_000_000_000_000n, commons),
    ],
  });

  const deployment: Deployment = { network: "local", rpcUrl, contractId: arena.accountId, accounts };
  mkdirSync(HOME, { recursive: true });
  writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2));
  return deployment;
}
