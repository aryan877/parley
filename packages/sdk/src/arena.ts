import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { base64Text } from "./rpc.ts";
import type { Amendment, Coin, Config, Model, Order, Overview, Parley, SignedReply, StorageBalance, TokenMetadata } from "./types.ts";
import { YOCTO } from "./units.ts";

const TGAS = 1_000_000_000_000n;

export const TOKEN_DEPOSIT = 3n * YOCTO;
/** More than one registration costs. The token returns the rest. */
export const TOKEN_STORAGE = 10n ** 22n;

const limited = (error: unknown) => /-429|Rate limits exceeded|Too Many Requests|\b429\b/i.test(error instanceof Error ? error.message : String(error));

/** Public RPCs rate-limit by address. Waits and tries again instead of failing a whole match on one busy second. */
async function patient<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!limited(error) || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

/** A function call for a browser wallet to sign and send. It returns the final outcome, as near-api-js does. */
export interface WalletCall {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  deposit: bigint;
  gas: bigint;
}

export interface ArenaOptions {
  rpcUrl: string;
  contractId: string;
  signer?: { accountId: string; privateKey: string };
  /** Signs with someone's own wallet (NEAR Connect and similar) instead of a key held here. */
  wallet?: { accountId: string; send: (call: WalletCall) => Promise<unknown> };
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
  private readonly signer?: ArenaOptions["signer"];
  private readonly wallet?: ArenaOptions["wallet"];

  constructor(options: ArenaOptions) {
    this.signer = options.signer;
    this.wallet = options.wallet;
    this.rpcUrl = options.rpcUrl;
    this.provider = new JsonRpcProvider({ url: options.rpcUrl });
    this.contractId = options.contractId;
    if (options.signer) {
      this.account = new Account(options.signer.accountId, this.provider, options.signer.privateKey as KeyPairString);
    }
  }

  get accountId(): string | undefined {
    return this.signer?.accountId ?? this.wallet?.accountId;
  }

  as(signer: { accountId: string; privateKey: string }): Arena {
    return new Arena({ rpcUrl: this.rpcUrl, contractId: this.contractId, signer });
  }

  async view<T>(method: string, args: Record<string, unknown> = {}, contractId = this.contractId): Promise<T> {
    return (await patient(() => this.provider.callFunction({ contractId, method, args }))) as T;
  }

  async call(method: string, args: Record<string, unknown> = {}, options: { deposit?: bigint; gas?: bigint; contractId?: string } = {}): Promise<CallResult> {
    if (!this.account && !this.wallet) throw new Error("this Arena client has no signer");
    try {
      const request = { contractId: options.contractId ?? this.contractId, methodName: method, args, deposit: options.deposit ?? 0n, gas: options.gas ?? 100n * TGAS };
      const outcome = (this.wallet
        ? await this.wallet.send({ receiverId: request.contractId, methodName: method, args, deposit: request.deposit, gas: request.gas })
        : await patient(() => this.account!.callFunctionRaw({ ...request, waitUntil: "EXECUTED_OPTIMISTIC" }))) as {
        status: unknown;
        transaction: { hash: string };
      };
      const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
      const hash = outcome.transaction.hash as string;
      if (status.SuccessValue === undefined) return { ok: false, hash, error: JSON.stringify(status.Failure ?? status) };
      const raw = status.SuccessValue ? base64Text(status.SuccessValue) : "";
      return { ok: true, hash, value: raw ? JSON.parse(raw) : undefined };
    } catch (error) {
      const hash = (error as { transactionResult?: { transaction?: { hash?: string } } }).transactionResult?.transaction?.hash ?? "";
      return { ok: false, hash, error: error instanceof Error ? error.message : String(error) };
    }
  }

  overview = () => this.view<Overview>("get_overview");
  config = () => this.view<Config>("get_config");
  models = () => this.view<Model[]>("get_models");
  coin = (coin: string) => this.view<Coin | null>("get_coin", { coin });
  coins = () => this.view<Coin[]>("get_coins", { limit: 100 });
  parley = (id: number) => this.view<Parley | null>("get_parley", { id });
  parleys = (from_index = 0, limit = 50) => this.view<Parley[]>("get_parleys", { from_index, limit });
  turnRequest = (id: number) => this.view<string | null>("get_turn_request", { id });
  shares = (coin: string, account: string) => this.view<string>("get_shares", { coin, account });
  order = (coin: string, account: string) => this.view<Order | null>("get_order", { coin, account });
  amendment = (id: number) => this.view<Amendment | null>("get_amendment", { id });
  amendments = (coin: string) => this.view<Amendment[]>("get_amendments", { coin });

  createCoin = (coin: { id: string; name: string; constitution: string; model: string }, deposit: bigint, house = false) =>
    this.call(house ? "create_house_coin" : "create_coin", coin, { deposit });
  openParley = () => this.call("open_parley");
  openParleyBetween = (a: string, b: string) => this.call("open_parley_between", { a, b });
  submitTurn = (id: number, reply: SignedReply) =>
    this.call("submit_turn", { id, response: reply.response, signature: reply.signature, public_key: reply.publicKey }, { gas: 150n * TGAS });
  voidParley = (id: number) => this.call("void_parley", { id });
  placeMint = (coin: string, deposit: bigint, minShares?: bigint) => this.call("place_mint", { coin, min_shares: minShares?.toString() ?? null }, { deposit });
  placeRedeem = (coin: string, shares: bigint, minNear?: bigint) =>
    this.call("place_redeem", { coin, shares: shares.toString(), min_near: minNear?.toString() ?? null });
  fillOrder = (coin: string, account: string) => this.call("fill_order", { coin, account });
  cancelOrder = (coin: string) => this.call("cancel_order", { coin });
  transferShares = (coin: string, to: string, shares: bigint) => this.call("transfer_shares", { coin, to, shares: shares.toString() });
  proposeAmendment = (coin: string, constitution: string, model: string) => this.call("propose_amendment", { coin, constitution, model });
  vote = (id: number, support: boolean, shares: bigint) => this.call("vote", { id, support, shares: shares.toString() });
  finalizeAmendment = (id: number) => this.call("finalize_amendment", { id });
  enactAmendment = (id: number) => this.call("enact_amendment", { id });
  releaseVotes = (coin: string) => this.call("release_votes", { coin });

  tokenAccount = (coin: string) => `${coin}.${this.contractId}`;
  createToken = (coin: string) =>
    landed(this.call("create_token", { coin }, { deposit: TOKEN_DEPOSIT, gas: 200n * TGAS }), (token) => typeof token === "string", "the token contract was not created, and the deposit went back");
  wrapShares = (coin: string, shares: bigint) =>
    landed(
      this.call("transfer_shares_call", { coin, to: this.tokenAccount(coin), shares: shares.toString(), msg: "" }),
      (used) => used === shares.toString(),
      "the token did not take the shares, so they went back",
    );
  unwrap = (token: string, amount: bigint) =>
    landed(this.call("unwrap", { amount: amount.toString() }, { contractId: token }), (released) => released === true, "the arena did not release the shares, so the tokens were restored");
  sendTokens = (token: string, to: string, amount: bigint) => this.call("ft_transfer", { receiver_id: to, amount: amount.toString() }, { deposit: 1n, contractId: token });
  registerForToken = (token: string, account?: string, deposit = TOKEN_STORAGE) =>
    this.call("storage_deposit", { account_id: account ?? null, registration_only: true }, { deposit, contractId: token });

  tokenBalance = (token: string, account: string) => this.view<string>("ft_balance_of", { account_id: account }, token);
  tokenSupply = (token: string) => this.view<string>("ft_total_supply", {}, token);
  tokenMetadata = (token: string) => this.view<TokenMetadata>("ft_metadata", {}, token);
  tokenStorage = (token: string, account: string) => this.view<StorageBalance | null>("storage_balance_of", { account_id: account }, token);
}

/** The transaction can succeed while a callback undoes the work, so the returned value decides. */
async function landed(pending: Promise<CallResult>, done: (value: unknown) => boolean, undone: string): Promise<CallResult> {
  const result = await pending;
  return result.ok && !done(result.value) ? { ...result, ok: false, error: undone } : result;
}
