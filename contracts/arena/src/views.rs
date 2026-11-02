use near_sdk::json_types::U128;
use near_sdk::{AccountId, near};

use crate::types::*;
use crate::{Arena, ArenaExt, prompt};

#[near(serializers = [json])]
pub struct Overview {
    pub protocol: String,
    pub owner: Option<AccountId>,
    pub commons: U128,
    pub escrow: U128,
    pub coins: u32,
    pub parleys: u32,
}

#[near(serializers = [json])]
pub struct SignerList {
    pub model: String,
    pub keys: Vec<EnclaveSigner>,
}

#[near]
impl Arena {
    pub fn get_overview(&self) -> Overview {
        Overview {
            protocol: prompt::PROTOCOL.to_string(),
            owner: self.owner.clone(),
            commons: U128(self.commons),
            escrow: U128(self.escrow),
            coins: self.coins.len(),
            parleys: self.parleys.len(),
        }
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_signers(&self) -> Vec<SignerList> {
        self.signers.iter().map(|(model, keys)| SignerList { model: model.clone(), keys: keys.clone() }).collect()
    }

    pub fn get_coin(&self, coin: CoinId) -> Option<Coin> {
        self.coins.get(&coin).cloned()
    }

    pub fn get_coins(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Coin> {
        self.coins
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    pub fn get_parley(&self, id: MatchId) -> Option<Parley> {
        self.parleys.get(id as u32).cloned()
    }

    /// Newest first.
    pub fn get_parleys(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Parley> {
        let total = self.parleys.len();
        let skip = from_index.unwrap_or(0);
        let take = limit.unwrap_or(20).min(50);
        (0..total).rev().skip(skip as usize).take(take as usize).filter_map(|i| self.parleys.get(i).cloned()).collect()
    }

    /// The exact request body an enclave must answer for the Parley's next turn.
    pub fn get_turn_request(&self, id: MatchId) -> Option<String> {
        self.next_request(id)
    }

    pub fn get_shares(&self, coin: CoinId, account: AccountId) -> U128 {
        U128(self.shares_of_internal(&coin, &account))
    }

    pub fn get_order(&self, coin: CoinId, account: AccountId) -> Option<Order> {
        self.orders.get(&(coin, account)).cloned()
    }

    pub fn get_amendment(&self, coin: CoinId) -> Option<Amendment> {
        self.amendments.get(&coin).cloned()
    }

    pub fn get_vote(&self, coin: CoinId, account: AccountId) -> Option<VoteLock> {
        self.votes.get(&(coin, account)).cloned()
    }

    pub fn get_pair_record(&self, a: CoinId, b: CoinId) -> PairRecord {
        let key = if a < b { (a, b) } else { (b, a) };
        self.pairs.get(&key).cloned().unwrap_or_default()
    }
}
