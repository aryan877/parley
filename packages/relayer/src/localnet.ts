import { Account, JsonRpcProvider, KeyPair, type KeyPairString, actions } from "near-api-js";
import { type Config, MINUTE_NS, NETWORKS, near } from "@parley/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "../../..");
const HOME = join(ROOT, ".localnet");
const DEPLOYMENT = join(HOME, "deployment.json");
const WASM = join(ROOT, "target/near/parley_arena/parley_arena.wasm");

export interface Deployment {
  network: "local";
  rpcUrl: string;
  contractId: string;
  accounts: Record<string, { accountId: string; privateKey: string }>;
}

export const DEMO_CONFIG: Config = {
  stake_bps: 200,
  talk_turns: 2,
  max_coins: 64,
  max_constitution_len: 1200,
  max_message_len: 240,
  max_response_bytes: 16_384,
  max_tokens_talk: 200,
  max_tokens_decide: 24,
  min_treasury: near(1).toString(),
  match_timeout_ns: (10n * MINUTE_NS).toString(),
  order_timeout_ns: (10n * MINUTE_NS).toString(),
  vote_period_ns: (2n * MINUTE_NS).toString(),
  timelock_ns: (2n * MINUTE_NS).toString(),
  quorum_bps: 2000,
  proposer_bps: 100,
  signer_delay_ns: (10n * MINUTE_NS).toString(),
};

export function loadDeployment(): Deployment {
  if (!existsSync(DEPLOYMENT)) throw new Error("no local deployment; run `bun run deploy:local` first");
  return JSON.parse(readFileSync(DEPLOYMENT, "utf8")) as Deployment;
}

/** Deploys a fresh arena on the local chain and funds a handful of named accounts. */
export async function deployLocal(signers: { model: string; public_key: string; evidence: string }[], commons = near(200)): Promise<Deployment> {
  const validator = JSON.parse(readFileSync(join(HOME, "validator_key.json"), "utf8")) as { account_id: string; secret_key: string };
  const rpcUrl = NETWORKS.local.rpcUrl;
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const root = new Account(validator.account_id, provider, validator.secret_key as KeyPairString);
  const tag = Date.now().toString(36);
  const accounts: Deployment["accounts"] = {};

  for (const [name, funds] of [["arena", 400], ["relayer", 100], ["alice", 2000], ["bob", 2000], ["carol", 2000]] as const) {
    const key = KeyPair.fromRandom("ed25519");
    const accountId = `${name}-${tag}.${validator.account_id}`;
    await root.createSubAccount({ accountOrPrefix: accountId, publicKey: key.getPublicKey(), nearToTransfer: near(funds) });
    accounts[name] = { accountId, privateKey: key.toString() };
  }

  const arena = new Account(accounts.arena!.accountId, provider, accounts.arena!.privateKey as KeyPairString);
  await arena.signAndSendTransaction({
    receiverId: arena.accountId,
    actions: [
      actions.deployContract(new Uint8Array(readFileSync(WASM))),
      actions.functionCall("new", { config: DEMO_CONFIG, signers }, 100_000_000_000_000n, commons),
    ],
  });

  const deployment: Deployment = { network: "local", rpcUrl, contractId: arena.accountId, accounts };
  mkdirSync(HOME, { recursive: true });
  writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2));
  return deployment;
}
