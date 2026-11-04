use near_sdk::json_types::U64;
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, env, near, require};

mod coins;
mod events;
mod governance;
pub mod math;
mod orders;
mod parleys;
pub mod prompt;
pub mod types;
pub mod verify;
mod views;

use types::*;

#[near(serializers = [json])]
pub struct SignerInput {
    pub public_key: String,
    pub evidence: String,
}

#[near(serializers = [json])]
pub struct ModelInput {
    pub id: String,
    pub max_tokens_talk: u32,
    pub max_tokens_decide: u32,
    pub options: String,
    pub signers: Vec<SignerInput>,
}

const RESERVED_FIELDS: [&str; 6] = ["model", "messages", "temperature", "seed", "max_tokens", "stream"];

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    owner: Option<AccountId>,
    config: Config,
    models: IterableMap<String, Model>,
    coins: IterableMap<CoinId, Coin>,
    shares: LookupMap<(CoinId, AccountId), u128>,
    orders: LookupMap<(CoinId, AccountId), Order>,
    amendments: LookupMap<CoinId, Amendment>,
    amendment_count: u32,
    votes: LookupMap<(CoinId, AccountId), VoteLock>,
    parleys: Vector<Parley>,
    pairs: LookupMap<(CoinId, CoinId), PairRecord>,
    commons: u128,
    escrow: u128,
}

#[near]
impl Arena {
    /// The attached deposit seeds the commons, the pool that pays the bonus when both coins cooperate.
    #[init]
    #[payable]
    pub fn new(config: Config, models: Vec<ModelInput>) -> Self {
        require!(config.stake_bps > 0 && config.stake_bps <= 2_000, "stake_bps must be 1..=2000");
        require!(config.talk_turns >= 1 && config.talk_turns <= 4, "talk_turns must be 1..=4");
        require!(config.max_coins >= 2 && config.max_coins <= 256, "max_coins must be 2..=256");
        require!(config.quorum_bps <= 10_000 && config.proposer_bps <= 10_000, "bps above 10000");
        let mut arena = Self {
            owner: Some(env::predecessor_account_id()),
            config,
            models: IterableMap::new(b"m"),
            coins: IterableMap::new(b"c"),
            shares: LookupMap::new(b"h"),
            orders: LookupMap::new(b"o"),
            amendments: LookupMap::new(b"a"),
            amendment_count: 0,
            votes: LookupMap::new(b"v"),
            parleys: Vector::new(b"p"),
            pairs: LookupMap::new(b"r"),
            commons: env::attached_deposit().as_yoctonear(),
            escrow: 0,
        };
        for model in models {
            arena.add_model(model, env::block_timestamp());
        }
        arena
    }

    /// A new model, with its enclave keys, only starts to count after `signer_delay_ns`. Its request settings never change.
    pub fn propose_model(&mut self, model: ModelInput) {
        self.assert_owner();
        let active_from = env::block_timestamp() + self.config.signer_delay_ns.0;
        self.add_model(model, active_from);
    }

    /// A new enclave key only starts to count after `signer_delay_ns`, so holders can see it coming.
    pub fn propose_signer(&mut self, model: String, signer: SignerInput) {
        self.assert_owner();
        let active_from = env::block_timestamp() + self.config.signer_delay_ns.0;
        self.add_signer(&model, signer, active_from);
    }

    /// Gives up the owner role for good: no new enclave keys, no house coins, no scheduled pairings.
    pub fn renounce_ownership(&mut self) {
        self.assert_owner();
        self.owner = None;
        events::emit("ownership_renounced", near_sdk::serde_json::json!({}));
    }
}

impl Arena {
    pub(crate) fn assert_owner(&self) {
        require!(self.owner.as_ref() == Some(&env::predecessor_account_id()), "owner only");
    }

    fn add_model(&mut self, input: ModelInput, active_from: u64) {
        require!(!input.id.is_empty() && input.id.len() <= 128, "bad model id");
        require!(self.models.get(&input.id).is_none(), "model already registered");
        require!(self.models.len() < 32, "too many models");
        for max in [input.max_tokens_talk, input.max_tokens_decide] {
            require!((1..=4096).contains(&max), "max_tokens must be 1..=4096");
        }
        require!(input.options.len() <= 256, "options too long");
        let text = if input.options.trim().is_empty() { "{}" } else { input.options.as_str() };
        let options: near_sdk::serde_json::Map<String, near_sdk::serde_json::Value> =
            near_sdk::serde_json::from_str(text).unwrap_or_else(|_| env::panic_str("options must be a JSON object"));
        require!(
            RESERVED_FIELDS.iter().all(|field| !options.contains_key(*field)),
            "options cannot replace a field the contract writes"
        );
        let options = near_sdk::serde_json::Value::Object(options).to_string();
        require!(!input.signers.is_empty(), "a model needs an enclave signer");
        events::emit(
            "model_registered",
            near_sdk::serde_json::json!({
                "model": input.id, "max_tokens_talk": input.max_tokens_talk,
                "max_tokens_decide": input.max_tokens_decide, "options": options,
            }),
        );
        self.models.insert(
            input.id.clone(),
            Model {
                max_tokens_talk: input.max_tokens_talk,
                max_tokens_decide: input.max_tokens_decide,
                options,
                signers: Vec::new(),
            },
        );
        for signer in input.signers {
            self.add_signer(&input.id, signer, active_from);
        }
    }

    fn add_signer(&mut self, model_id: &str, signer: SignerInput, active_from: u64) {
        let key = verify::from_hex(&signer.public_key).unwrap_or_default();
        require!(key.len() == 32, "public_key must be 32 bytes of hex");
        require!(signer.evidence.len() <= 256, "evidence too long");
        let public_key = verify::to_hex(&key);
        let mut model = self.model(model_id);
        require!(model.signers.iter().all(|k| k.public_key != public_key), "signer already registered");
        require!(model.signers.len() < 8, "too many signers for this model");
        events::emit(
            "signer_registered",
            near_sdk::serde_json::json!({
                "model": model_id, "public_key": public_key,
                "evidence": signer.evidence, "active_from": U64(active_from),
            }),
        );
        model.signers.push(EnclaveSigner { public_key, evidence: signer.evidence, active_from: U64(active_from) });
        self.models.insert(model_id.to_string(), model);
    }

    pub(crate) fn model(&self, id: &str) -> Model {
        self.models.get(id).cloned().unwrap_or_else(|| env::panic_str("model is not registered"))
    }

    pub(crate) fn is_active_signer(&self, model: &str, public_key: &str) -> bool {
        let now = env::block_timestamp();
        self.models
            .get(model)
            .is_some_and(|m| m.signers.iter().any(|k| k.public_key == public_key && k.active_from.0 <= now))
    }

    pub(crate) fn coin(&self, id: &CoinId) -> Coin {
        self.coins.get(id).cloned().unwrap_or_else(|| env::panic_str("no such coin"))
    }

    pub(crate) fn save_coin(&mut self, coin: Coin) {
        self.coins.insert(coin.id.clone(), coin);
    }

    pub(crate) fn shares_of_internal(&self, coin: &CoinId, account: &AccountId) -> u128 {
        self.shares.get(&(coin.clone(), account.clone())).copied().unwrap_or(0)
    }

    pub(crate) fn set_shares(&mut self, coin: &CoinId, account: &AccountId, amount: u128) {
        let key = (coin.clone(), account.clone());
        if amount == 0 {
            self.shares.remove(&key);
        } else {
            self.shares.insert(key, amount);
        }
    }

    pub(crate) fn pay(account: AccountId, amount: u128) {
        if amount > 0 {
            Promise::new(account).transfer(NearToken::from_yoctonear(amount)).detach();
        }
    }
}

#[cfg(test)]
mod tests;
