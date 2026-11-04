use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

pub type CoinId = String;
pub type MatchId = u64;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub stake_bps: u16,
    pub talk_turns: u8,
    pub max_coins: u16,
    pub max_constitution_len: u32,
    pub max_message_len: u32,
    pub max_response_bytes: u32,
    pub min_treasury: U128,
    pub match_timeout_ns: U64,
    pub order_timeout_ns: U64,
    pub vote_period_ns: U64,
    pub timelock_ns: U64,
    pub quorum_bps: u16,
    pub proposer_bps: u16,
    pub signer_delay_ns: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnclaveSigner {
    pub public_key: String,
    pub evidence: String,
    pub active_from: U64,
}

/// A model the arena accepts: how the contract asks it, and the enclave keys that may answer for it.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Model {
    pub max_tokens_talk: u32,
    pub max_tokens_decide: u32,
    /// Extra request fields as one JSON object, appended to every request the contract writes for this model.
    pub options: String,
    pub signers: Vec<EnclaveSigner>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub matches: u32,
    pub cooperated: u32,
    pub defected: u32,
    pub was_betrayed: u32,
    pub betrayed_other: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Coin {
    pub id: CoinId,
    pub name: String,
    pub creator: AccountId,
    pub house: bool,
    pub constitution: String,
    pub constitution_version: u32,
    pub model: String,
    pub treasury: U128,
    pub total_shares: U128,
    pub in_match: Option<MatchId>,
    pub matches_played: u64,
    pub stats: Stats,
    pub created_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OrderKind {
    Mint,
    Redeem,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Order {
    pub kind: OrderKind,
    pub amount: U128,
    pub placed_at: U64,
    pub epoch: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Cooperate,
    Defect,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    A,
    B,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnKind {
    Talk,
    Decide,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Turn {
    pub side: Side,
    pub kind: TurnKind,
    pub text: String,
    pub request_hash: String,
    pub response_hash: String,
    pub signer: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchStatus {
    Open,
    Settled,
    Void,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Parley {
    pub id: MatchId,
    pub a: CoinId,
    pub b: CoinId,
    pub a_model: String,
    pub b_model: String,
    pub a_constitution_version: u32,
    pub b_constitution_version: u32,
    pub stake: U128,
    pub nonce: String,
    pub opened_at: U64,
    pub status: MatchStatus,
    pub turns: Vec<Turn>,
    pub a_move: Option<Move>,
    pub b_move: Option<Move>,
    pub a_delta: String,
    pub b_delta: String,
    pub commons_delta: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AmendmentStatus {
    Voting,
    Passed,
    Rejected,
    Enacted,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Amendment {
    pub id: u32,
    pub proposer: AccountId,
    pub constitution: String,
    pub model: String,
    pub yes: U128,
    pub no: U128,
    pub ends_at: U64,
    pub enact_after: U64,
    pub status: AmendmentStatus,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct VoteLock {
    pub amendment_id: u32,
    pub shares: U128,
    pub support: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct PairRecord {
    pub outcomes: Vec<(Move, Move)>,
}
