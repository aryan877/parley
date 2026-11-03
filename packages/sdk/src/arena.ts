import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import type { Amendment, Coin, Config, Order, Overview, Parley, SignedReply, SignerList } from "./types.ts";

const TGAS = 1_000_000_000_000n;

export interface ArenaOptions {
  rpcUrl: string;
  contractId: string;
  signer?: { accountId: string; privateKey: string };
}

export interface CallResult {
  ok: boolean;
  hash: string;
  error?: string;
  value?: unknown;
}

export class Arena {
  readonly provider: JsonRpcProvider;
  readonly contractId: string;
  readonly rpcUrl: string;
  private readonly account?: Account;

  constructor(options: ArenaOptions) {
    this.rpcUrl = options.rpcUrl;
    this.provider = new JsonRpcProvider({ url: options.rpcUrl });
    this.contractId = options.contractId;
    if (options.signer) {
      this.account = new Account(options.signer.accountId, this.provider, options.signer.privateKey as KeyPairString);
    }
  }

  as(signer: { accountId: string; privateKey: string }): Arena {
    return new Arena({ rpcUrl: this.rpcUrl, contractId: this.contractId, signer });
  }

  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.provider.callFunction({ contractId: this.contractId, method, args })) as T;
  }

  async call(method: string, args: Record<string, unknown> = {}, options: { deposit?: bigint; gas?: bigint } = {}): Promise<CallResult> {
    if (!this.account) throw new Error("this Arena client has no signer");
    try {
      const outcome = await this.account.callFunctionRaw({
        contractId: this.contractId,
        methodName: method,
        args,
        deposit: options.deposit ?? 0n,
        gas: options.gas ?? 100n * TGAS,
        waitUntil: "EXECUTED_OPTIMISTIC",
      });
      const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
      const hash = outcome.transaction.hash as string;
      if (status.SuccessValue === undefined) return { ok: false, hash, error: JSON.stringify(status.Failure ?? status) };
      const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
      return { ok: true, hash, value: raw ? JSON.parse(raw) : undefined };
    } catch (error) {
      return { ok: false, hash: "", error: error instanceof Error ? error.message : String(error) };
    }
  }

  overview = () => this.view<Overview>("get_overview");
  config = () => this.view<Config>("get_config");
  signers = () => this.view<SignerList[]>("get_signers");
  coin = (coin: string) => this.view<Coin | null>("get_coin", { coin });
  coins = () => this.view<Coin[]>("get_coins", { limit: 100 });
  parley = (id: number) => this.view<Parley | null>("get_parley", { id });
  parleys = (from_index = 0, limit = 50) => this.view<Parley[]>("get_parleys", { from_index, limit });
  turnRequest = (id: number) => this.view<string | null>("get_turn_request", { id });
  shares = (coin: string, account: string) => this.view<string>("get_shares", { coin, account });
  order = (coin: string, account: string) => this.view<Order | null>("get_order", { coin, account });
  amendment = (coin: string) => this.view<Amendment | null>("get_amendment", { coin });

  createCoin = (coin: { id: string; name: string; constitution: string; model: string }, deposit: bigint, house = false) =>
    this.call(house ? "create_house_coin" : "create_coin", coin, { deposit });
  openParley = () => this.call("open_parley");
  openParleyBetween = (a: string, b: string) => this.call("open_parley_between", { a, b });
  submitTurn = (id: number, reply: SignedReply) =>
    this.call("submit_turn", { id, response: reply.response, signature: reply.signature, public_key: reply.publicKey }, { gas: 150n * TGAS });
  voidParley = (id: number) => this.call("void_parley", { id });
  placeMint = (coin: string, deposit: bigint) => this.call("place_mint", { coin }, { deposit });
  placeRedeem = (coin: string, shares: bigint) => this.call("place_redeem", { coin, shares: shares.toString() });
  fillOrder = (coin: string, account: string) => this.call("fill_order", { coin, account });
  proposeAmendment = (coin: string, constitution: string, model: string) => this.call("propose_amendment", { coin, constitution, model });
  vote = (coin: string, support: boolean, shares: bigint) => this.call("vote", { coin, support, shares: shares.toString() });
  finalizeAmendment = (coin: string) => this.call("finalize_amendment", { coin });
  enactAmendment = (coin: string) => this.call("enact_amendment", { coin });
}
