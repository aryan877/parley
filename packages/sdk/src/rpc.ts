/** Nodes that keep every block, for transactions and state older than a few epochs. */
export const ARCHIVAL_RPC_URLS = {
  testnet: ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"],
};

/** FastNEAR's transaction index: every transaction that touched an account, with its receipts. */
export const TX_INDEX_URLS = { testnet: "https://tx.test.fastnear.com", mainnet: "https://tx.main.fastnear.com" };

export interface RpcOptions {
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** The node understood the call and said no: a contract panic, an unknown account, a bad argument. Another node would say the same. */
export class RpcRefusal extends Error {}

interface RpcErrorBody {
  name?: string;
  code?: number;
  message?: string;
  cause?: { name?: string; info?: unknown };
  data?: unknown;
}

const PASSING = new Set([
  "UNKNOWN_TRANSACTION",
  "UNKNOWN_BLOCK",
  "UNKNOWN_CHUNK",
  "GARBAGE_COLLECTED_BLOCK",
  "TIMEOUT_ERROR",
  "NO_SYNCED_BLOCKS",
  "NOT_SYNCED_YET",
  "INTERNAL_ERROR",
  "REQUEST_TIMEOUT",
]);

const passing = (error: RpcErrorBody) =>
  error.code === -429 || PASSING.has(error.name ?? "") || PASSING.has(error.cause?.name ?? "") || /rate limit|too many requests/i.test(error.message ?? "");

const describe = (error: RpcErrorBody) => {
  const data = typeof error.data === "string" ? error.data : JSON.stringify(error.cause?.info ?? error.data ?? "");
  return [error.cause?.name ?? error.name, data].filter(Boolean).join(": ");
};

export function toBase64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

export function base64Text(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

/** `query` params for a view call, at a block or at a finality. */
export function viewQuery(
  accountId: string,
  method: string,
  args: Record<string, unknown> = {},
  at: { block_id: string | number } | { finality: "final" | "optimistic" } = { finality: "final" },
) {
  return { request_type: "call_function", ...at, account_id: accountId, method_name: method, args_base64: toBase64(JSON.stringify(args)) };
}

export const viewResult = <T>(answer: { result: number[] }): T => JSON.parse(new TextDecoder().decode(Uint8Array.from(answer.result))) as T;

/** What a contract panicked with, read from a NEAR error or a failed outcome. */
export const panicMessage = (error?: string | null): string | null => error?.match(/panicked: ([^"\\]+)/)?.[1] ?? null;

/** The signer had too little NEAR for the deposit or the gas. */
export const lacksBalance = (error?: string | null): boolean => /not enough balance|NotEnoughBalance|LackBalance/i.test(error ?? "");

export type ExecutionStatus = { SuccessValue: string } | { Failure: unknown };

export interface TxOutcome {
  status: ExecutionStatus;
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: (string | Record<string, unknown>)[] };
  receipts_outcome: { id: string; block_hash: string; outcome: { executor_id: string; logs: string[]; status: ExecutionStatus } }[];
}

export function functionCall(tx: Pick<TxOutcome, "transaction">): { method: string; args: Record<string, unknown> } | null {
  const action = tx.transaction.actions[0];
  const call = typeof action === "object" ? (action.FunctionCall as { method_name: string; args: string } | undefined) : undefined;
  if (!call) return null;
  try {
    return { method: call.method_name, args: JSON.parse(base64Text(call.args)) as Record<string, unknown> };
  } catch {
    return { method: call.method_name, args: {} };
  }
}

export interface ParleyEvent {
  event: string;
  data: Record<string, string | number | boolean | null | undefined>;
}

/** The arena's `EVENT_JSON` events in receipt logs, one per data entry. */
export function parleyEvents(logs: string[]): ParleyEvent[] {
  return logs.flatMap((log) => {
    if (!log.startsWith("EVENT_JSON:")) return [];
    try {
      const body = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard?: string; event?: string; data?: unknown };
      if (body.standard !== "parley" || !body.event || !Array.isArray(body.data)) return [];
      return (body.data as ParleyEvent["data"][]).map((data) => ({ event: body.event!, data }));
    } catch {
      return [];
    }
  });
}

/** A busy, failing or forgetful node (HTTP 429, a timeout, a pruned block) hands the call to the next URL; later rounds back off. */
export class NearRpc {
  private readonly attempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly send: NonNullable<RpcOptions["fetch"]>;

  constructor(
    readonly urls: string[],
    options: RpcOptions = {},
  ) {
    if (!urls.length) throw new Error("no RPC URL");
    this.attempts = options.attempts ?? Math.max(6, urls.length * 2);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.backoffMs = options.backoffMs ?? 500;
    this.send = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (attempt >= this.urls.length) await new Promise((resolve) => setTimeout(resolve, this.backoffMs * 2 ** (attempt - this.urls.length)));
      const url = this.urls[attempt % this.urls.length]!;
      try {
        const res = await this.send(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "parley", method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          last = new Error(`${url} answered HTTP ${res.status}`);
          continue;
        }
        const body = (await res.json()) as { result?: T & { error?: string }; error?: RpcErrorBody };
        if (body.error && !passing(body.error)) throw new RpcRefusal(describe(body.error));
        if (body.error) {
          last = new Error(`${url}: ${describe(body.error)}`);
          continue;
        }
        if (typeof body.result?.error === "string") throw new RpcRefusal(body.result.error);
        return body.result as T;
      } catch (error) {
        if (error instanceof RpcRefusal) throw error;
        last = error;
      }
    }
    throw last;
  }

  async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}, blockId?: string | number): Promise<T> {
    return viewResult<T>(await this.call<{ result: number[] }>("query",viewQuery(contractId, method, args, blockId === undefined ? { finality: "final" } : { block_id: blockId })));
  }

  account = (accountId: string) =>
    this.call<{ code_hash: string; amount: string; block_height: number }>("query", { request_type: "view_account", finality: "final", account_id: accountId });

  accessKeys = (accountId: string) =>
    this.call<{ keys: unknown[]; block_height: number }>("query", { request_type: "view_access_key_list", finality: "final", account_id: accountId });

  tx = (hash: string, senderId: string) => this.call<TxOutcome>("tx", { tx_hash: hash, sender_account_id: senderId, wait_until: "FINAL" });

  block = (blockHash: string) => this.call<{ header: { height: number; hash: string; prev_hash: string } }>("block", { block_id: blockHash });
}
