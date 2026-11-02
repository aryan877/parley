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
    pub model: String,
    pub public_key: String,
    pub evidence: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    owner: Option<AccountId>,
    config: Config,
    signers: IterableMap<String, Vec<EnclaveSigner>>,
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
    pub fn new(config: Config, signers: Vec<SignerInput>) -> Self {
        require!(config.stake_bps > 0 && config.stake_bps <= 2_000, "stake_bps must be 1..=2000");
        require!(config.talk_turns >= 1 && config.talk_turns <= 4, "talk_turns must be 1..=4");
        require!(config.max_coins >= 2 && config.max_coins <= 256, "max_coins must be 2..=256");
        require!(config.quorum_bps <= 10_000 && config.proposer_bps <= 10_000, "bps above 10000");
        let mut arena = Self {
            owner: Some(env::predecessor_account_id()),
            config,
            signers: IterableMap::new(b"s"),
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
        for signer in signers {
            arena.add_signer(signer, env::block_timestamp());
        }
        arena
    }

    /// A new enclave key only starts to count after `signer_delay_ns`, so holders can see it coming.
    pub fn propose_signer(&mut self, signer: SignerInput) {
        self.assert_owner();
        let active_from = env::block_timestamp() + self.config.signer_delay_ns.0;
        self.add_signer(signer, active_from);
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

    fn add_signer(&mut self, signer: SignerInput, active_from: u64) {
        let key = verify::from_hex(&signer.public_key).unwrap_or_default();
        require!(key.len() == 32, "public_key must be 32 bytes of hex");
        require!(!signer.model.is_empty() && signer.model.len() <= 128, "bad model id");
        require!(signer.evidence.len() <= 256, "evidence too long");
        let public_key = verify::to_hex(&key);
        let mut keys = self.signers.get(&signer.model).cloned().unwrap_or_default();
        require!(keys.iter().all(|k| k.public_key != public_key), "signer already registered");
        require!(keys.len() < 8, "too many signers for this model");
        events::emit(
            "signer_registered",
            near_sdk::serde_json::json!({
                "model": signer.model, "public_key": public_key,
                "evidence": signer.evidence, "active_from": U64(active_from),
            }),
        );
        keys.push(EnclaveSigner { public_key, evidence: signer.evidence, active_from: U64(active_from) });
        self.signers.insert(signer.model, keys);
    }

    pub(crate) fn is_active_signer(&self, model: &str, public_key: &str) -> bool {
        let now = env::block_timestamp();
        self.signers
            .get(model)
            .is_some_and(|keys| keys.iter().any(|k| k.public_key == public_key && k.active_from.0 <= now))
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
