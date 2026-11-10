use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{AccountId, env, near, require};

use crate::math::bps;
use crate::types::*;
use crate::{Arena, ArenaExt, events};

const MAX_OPEN_AMENDMENTS: usize = 16;

/// Holders have one power: replace the coin's constitution and the model that
/// reads it. They can never move the treasury.
#[near]
impl Arena {
    /// Several amendments can be open on a coin at once, so no holder can block the others by
    /// keeping a single slot busy. An account has one open proposal per coin, backed by its stake.
    pub fn propose_amendment(&mut self, coin: CoinId, constitution: String, model: String) -> u32 {
        let mut c = self.coin(&coin);
        require!(!c.house, "a house constitution never changes");
        require!(c.amendments.len() < MAX_OPEN_AMENDMENTS, "too many amendments are open on this coin");
        self.assert_constitution(&constitution, &model);
        let proposer = env::predecessor_account_id();
        let already = c.amendments.iter().filter_map(|id| self.amendments.get(id)).any(|a| a.proposer == proposer);
        require!(!already, "you already have an open amendment on this coin");
        let stake = bps(c.total_shares.0, self.config.proposer_bps).max(1);
        let lock = self.settled_lock(&coin, &proposer);
        require!(self.shares_of_internal(&coin, &proposer) + lock.locked.0 >= stake, "not enough shares to propose");

        self.amendment_count += 1;
        let id = self.amendment_count;
        let ends_at = env::block_timestamp() + self.config.vote_period_ns.0;
        events::emit(
            "amendment_proposed",
            json!({ "coin": coin, "id": id, "proposer": proposer, "model": model, "ends_at": U64(ends_at) }),
        );
        let mut amendment = Amendment {
            id,
            coin: coin.clone(),
            proposer: proposer.clone(),
            base_version: c.constitution_version,
            constitution,
            model,
            yes: U128(0),
            no: U128(0),
            ends_at: U64(ends_at),
            enact_after: U64(0),
            status: AmendmentStatus::Voting,
        };
        self.cast(&mut amendment, &proposer, true, stake);
        self.amendments.insert(id, amendment);
        c.amendments.push(id);
        self.save_coin(c);
        id
    }

    /// The same shares can vote on every open amendment of their coin, once each. They stay
    /// locked until the last of those votes is finalized.
    pub fn vote(&mut self, id: u32, support: bool, shares: U128) {
        let voter = env::predecessor_account_id();
        let mut amendment = self.amendment(id);
        require!(
            amendment.status == AmendmentStatus::Voting && env::block_timestamp() < amendment.ends_at.0,
            "voting is closed"
        );
        self.cast(&mut amendment, &voter, support, shares.0);
        self.amendments.insert(id, amendment);
    }

    /// Closes the vote. A passed amendment then waits `timelock_ns`, time in which any holder who disagrees can redeem.
    pub fn finalize_amendment(&mut self, id: u32) {
        let mut amendment = self.amendment(id);
        require!(amendment.status == AmendmentStatus::Voting, "already finalized");
        require!(env::block_timestamp() >= amendment.ends_at.0, "voting is still open");
        let c = self.coin(&amendment.coin);
        let quorum = bps(c.total_shares.0, self.config.quorum_bps);
        let current = c.constitution_version == amendment.base_version;
        let passed = current && amendment.yes.0 > amendment.no.0 && amendment.yes.0 >= quorum;
        events::emit(
            "amendment_finalized",
            json!({ "coin": amendment.coin, "id": id, "passed": passed, "yes": amendment.yes, "no": amendment.no }),
        );
        if passed {
            amendment.status = AmendmentStatus::Passed;
            amendment.enact_after = U64(env::block_timestamp() + self.config.timelock_ns.0);
            self.amendments.insert(id, amendment);
        } else {
            self.close_amendment(&amendment);
        }
    }

    /// Puts a passed amendment into force once its timelock is over. It lapses instead, and this
    /// returns false, if the coin's constitution has changed since it was proposed or if nobody
    /// enacted it within one more timelock.
    pub fn enact_amendment(&mut self, id: u32) -> bool {
        let amendment = self.amendment(id);
        require!(amendment.status == AmendmentStatus::Passed, "amendment has not passed");
        let now = env::block_timestamp();
        require!(now >= amendment.enact_after.0, "timelock is still running");
        let mut c = self.coin(&amendment.coin);
        require!(c.in_match.is_none(), "coin is in a Parley");
        let lapsed = c.constitution_version != amendment.base_version || now > amendment.enact_after.0 + self.config.timelock_ns.0;
        if lapsed {
            events::emit("amendment_lapsed", json!({ "coin": amendment.coin, "id": id }));
        } else {
            c.constitution = amendment.constitution.clone();
            c.model = amendment.model.clone();
            c.constitution_version += 1;
            events::emit(
                "amendment_enacted",
                json!({ "coin": amendment.coin, "id": id, "constitution_version": c.constitution_version }),
            );
            self.save_coin(c);
        }
        self.close_amendment(&amendment);
        !lapsed
    }

    /// Returns the shares that no open vote holds any more.
    pub fn release_votes(&mut self, coin: CoinId) -> U128 {
        let voter = env::predecessor_account_id();
        let before = self.votes.get(&(coin.clone(), voter.clone())).map(|lock| lock.locked.0);
        let before = before.unwrap_or_else(|| env::panic_str("no locked votes"));
        let after = self.settled_lock(&coin, &voter).locked.0;
        require!(after < before, "voting is still open");
        U128(before - after)
    }
}

impl Arena {
    fn amendment(&self, id: u32) -> Amendment {
        self.amendments.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such amendment"))
    }

    fn close_amendment(&mut self, amendment: &Amendment) {
        self.amendments.remove(&amendment.id);
        let mut c = self.coin(&amendment.coin);
        c.amendments.retain(|open| *open != amendment.id);
        self.save_coin(c);
    }

    /// Drops a voter's ballots on votes that are over, shrinks the lock to the largest ballot
    /// still open and returns the difference to the voter's free shares.
    fn settled_lock(&mut self, coin: &CoinId, voter: &AccountId) -> VoteLock {
        let key = (coin.clone(), voter.clone());
        let mut lock = self.votes.get(&key).cloned().unwrap_or_default();
        lock.ballots.retain(|b| self.amendments.get(&b.amendment_id).is_some_and(|a| a.status == AmendmentStatus::Voting));
        self.relock(key, lock)
    }

    fn relock(&mut self, key: (CoinId, AccountId), mut lock: VoteLock) -> VoteLock {
        let needed = lock.ballots.iter().map(|b| b.shares.0).max().unwrap_or(0);
        let owned = self.shares_of_internal(&key.0, &key.1) + lock.locked.0;
        require!(needed <= owned, "not enough free shares");
        self.set_shares(&key.0, &key.1, owned - needed);
        lock.locked = U128(needed);
        if lock.ballots.is_empty() {
            self.votes.remove(&key);
        } else {
            self.votes.insert(key, lock.clone());
        }
        lock
    }

    fn cast(&mut self, amendment: &mut Amendment, voter: &AccountId, support: bool, shares: u128) {
        require!(shares > 0, "not enough free shares");
        let mut lock = self.settled_lock(&amendment.coin, voter);
        match lock.ballots.iter_mut().find(|b| b.amendment_id == amendment.id) {
            Some(ballot) => {
                require!(ballot.support == support, "you already voted the other way");
                ballot.shares = U128(ballot.shares.0 + shares);
            }
            None => lock.ballots.push(Ballot { amendment_id: amendment.id, shares: U128(shares), support }),
        }
        self.relock((amendment.coin.clone(), voter.clone()), lock);
        if support {
            amendment.yes = U128(amendment.yes.0 + shares);
        } else {
            amendment.no = U128(amendment.no.0 + shares);
        }
        events::emit(
            "vote_cast",
            json!({ "coin": amendment.coin, "id": amendment.id, "voter": voter, "support": support, "shares": U128(shares) }),
        );
    }
}
