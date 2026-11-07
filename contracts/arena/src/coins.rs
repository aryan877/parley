use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require};

use crate::types::*;
use crate::{Arena, ArenaExt, events};

fn valid_id(id: &str) -> bool {
    (2..=20).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn valid_name(name: &str) -> bool {
    (1..=24).contains(&name.len()) && name.bytes().all(|c| c.is_ascii_graphic() || c == b' ') && name.trim() == name
}

#[near]
impl Arena {
    /// Launches a coin. The deposit becomes its treasury and the creator gets the first shares, one per yoctoNEAR.
    #[payable]
    pub fn create_coin(&mut self, id: CoinId, name: String, constitution: String, model: String) {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.config.min_treasury.0, "deposit below min_treasury");
        let creator = env::predecessor_account_id();
        self.insert_coin(id.clone(), name, constitution, model, deposit, false);
        self.set_shares(&id, &creator, deposit);
    }

    /// A house coin has no holders and a constitution that can never change. It gives every coin a fixed opponent.
    #[payable]
    pub fn create_house_coin(&mut self, id: CoinId, name: String, constitution: String, model: String) {
        self.assert_owner();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.config.min_treasury.0, "deposit below min_treasury");
        self.insert_coin(id, name, constitution, model, deposit, true);
    }
}

impl Arena {
    pub(crate) fn assert_constitution(&self, constitution: &str, model: &str) {
        require!(!constitution.trim().is_empty(), "constitution is empty");
        require!(
            constitution.chars().count() <= self.config.max_constitution_len as usize,
            "constitution too long"
        );
        require!(self.models.contains_key(model), "model is not registered");
    }

    fn insert_coin(&mut self, id: CoinId, name: String, constitution: String, model: String, deposit: u128, house: bool) {
        require!(valid_id(&id), "id must be 2-20 characters of a-z and 0-9");
        require!(valid_name(&name), "name must be 1-24 printable ASCII characters");
        require!(self.coins.get(&id).is_none(), "coin id taken");
        require!(self.coins.len() < self.config.max_coins as u32, "arena is full");
        self.assert_constitution(&constitution, &model);
        events::emit(
            "coin_created",
            json!({ "coin": id, "name": name, "house": house, "model": model, "treasury": U128(deposit) }),
        );
        self.coins.insert(
            id.clone(),
            Coin {
                id,
                name,
                creator: env::predecessor_account_id(),
                house,
                constitution,
                constitution_version: 1,
                model,
                treasury: U128(deposit),
                total_shares: U128(if house { 0 } else { deposit }),
                in_match: None,
                matches_played: 0,
                stats: Stats::default(),
                created_at: U64(env::block_timestamp()),
                token: None,
            },
        );
    }
}
