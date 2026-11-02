export interface Network {
  name: "local" | "testnet";
  rpcUrl: string;
  explorerTx?: string;
}

export const NETWORKS: Record<Network["name"], Network> = {
  local: { name: "local", rpcUrl: "http://127.0.0.1:3030" },
  testnet: { name: "testnet", rpcUrl: "https://test.rpc.fastnear.com", explorerTx: "https://testnet.nearblocks.io/txns/" },
};
