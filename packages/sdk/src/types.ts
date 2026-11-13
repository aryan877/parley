export type Move = "Cooperate" | "Defect";
export type Side = "A" | "B";
export type TurnKind = "Talk" | "Decide";
export type MatchStatus = "Open" | "Settled" | "Void";

export interface Config {
  stake_bps: number;
  talk_turns: number;
  max_coins: number;
  max_constitution_len: number;
  max_message_len: number;
  max_response_bytes: number;
  min_treasury: string;
  match_timeout_ns: string;
  order_timeout_ns: string;
  vote_period_ns: string;
  timelock_ns: string;
  quorum_bps: number;
  proposer_bps: number;
  signer_delay_ns: string;
  rest_ns: string;
  pair_rest_ns: string;
  creation_fee: string;
}

export interface Stats {
  matches: number;
  cooperated: number;
  defected: number;
  was_betrayed: number;
  betrayed_other: number;
}

export interface Coin {
  id: string;
  name: string;
  creator: string;
  house: boolean;
  constitution: string;
  constitution_version: number;
  model: string;
  treasury: string;
  total_shares: string;
  in_match: number | null;
  matches_played: number;
  stats: Stats;
  created_at: string;
  token: string | null;
  idle_since: string;
  amendments: number[];
}

export interface Turn {
  side: Side;
  kind: TurnKind;
  text: string;
  request_hash: string;
  response_hash: string;
  signer: string;
}

export interface Parley {
  id: number;
  a: string;
  b: string;
  a_model: string;
  b_model: string;
  a_constitution_version: number;
  b_constitution_version: number;
  stake: string;
  nonce: string;
  opened_at: string;
  status: MatchStatus;
  turns: Turn[];
  a_move: Move | null;
  b_move: Move | null;
  a_delta: string;
  b_delta: string;
  commons_delta: string;
}

export interface Overview {
  protocol: string;
  owner: string | null;
  commons: string;
  escrow: string;
  coins: number;
  parleys: number;
}

export interface EnclaveSigner {
  public_key: string;
  evidence: string;
  active_from: string;
  retired_from: string | null;
}

/** A model the arena accepts: how the contract asks it, and the enclave keys that may answer for it. */
export interface Model {
  id: string;
  max_tokens_talk: number;
  max_tokens_decide: number;
  options: string;
  signers: EnclaveSigner[];
}

export interface ModelInput {
  id: string;
  max_tokens_talk: number;
  max_tokens_decide: number;
  options: string;
  signers: { public_key: string; evidence: string }[];
}

export interface Order {
  kind: "Mint" | "Redeem";
  amount: string;
  min_out: string;
  placed_at: string;
  epoch: number;
}

export interface Amendment {
  id: number;
  coin: string;
  proposer: string;
  base_version: number;
  constitution: string;
  model: string;
  yes: string;
  no: string;
  ends_at: string;
  enact_after: string;
  status: "Voting" | "Passed";
}

/** One signed reply from a mind: the exact response body and the enclave's signature over it. */
export interface SignedReply {
  response: string;
  signature: string;
  publicKey: string;
}

export interface TokenMetadata {
  spec: string;
  name: string;
  symbol: string;
  icon: string | null;
  decimals: number;
}

export interface StorageBalance {
  total: string;
  available: string;
}
