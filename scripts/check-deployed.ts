import { ARCHIVAL_RPC_URLS, NearRpc } from "@parley/sdk";
import { committedCodeHash, publicTestnet } from "@parley/relayer";

/** The committed arena wasm is the code running on testnet: its sha256 must equal the deployed code hash. */
const deployment = publicTestnet();
const local = committedCodeHash();
const onChain = process.argv.includes("--live")
  ? (await new NearRpc([deployment.rpcUrl, ...ARCHIVAL_RPC_URLS.testnet]).account(deployment.contractId)).code_hash
  : null;
const expected = onChain ?? deployment.codeHash;
console.log(`${deployment.contractId}: ${onChain ? "on chain" : "recorded"} ${expected}, committed wasm ${local}`);
if (local !== expected) {
  console.error("the committed wasm is not the deployed code");
  process.exit(1);
}
