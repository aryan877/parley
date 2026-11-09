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
    /// keeping a single slot busy. The proposer's stake is locked behind the proposal as yes votes.
    pub fn propose_amendment(&mut self, coin: CoinId, constitution: String, model: String) -> u32 {
        let mut c = self.coin(&coin);
        require!(!c.house, "a house constitution never changes");
        require!(c.amendments.len() < MAX_OPEN_AMENDMENTS, "too many amendments are open on this coin");
        self.assert_constitution(&constitution, &model);
        let proposer = env::predecessor_account_id();
        self.release_finished_vote(&coin, &proposer);
        let stake = bps(c.total_shares.0, self.config.proposer_bps).max(1);
        require!(self.shares_of_internal(&coin, &proposer) >= stake, "not enough shares to propose");

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
            constitution,
            model,
            yes: U128(0),
            no: U128(0),
            ends_at: U64(ends_at),
            enact_after: U64(0),
            status: AmendmentStatus::Voting,
        };
        self.lock_votes(&mut amendment, &proposer, true, stake);
        self.amendments.insert(id, amendment);
        c.amendments.push(id);
        self.save_coin(c);
        id
    }

    /// Voting locks the shares until the vote is closed, so one share cannot vote twice.
    pub fn vote(&mut self, id: u32, support: bool, shares: U128) {
        let voter = env::predecessor_account_id();
        let mut amendment = self.amendment(id);
        require!(
            amendment.status == AmendmentStatus::Voting && env::block_timestamp() < amendment.ends_at.0,
            "voting is closed"
        );
        self.release_finished_vote(&amendment.coin, &voter);
        self.lock_votes(&mut amendment, &voter, support, shares.0);
        self.amendments.insert(id, amendment);
    }

    /// Closes the vote. A passed amendment then waits `timelock_ns`, time in which any holder who disagrees can redeem.
    pub fn finalize_amendment(&mut self, id: u32) {
        let mut amendment = self.amendment(id);
        require!(amendment.status == AmendmentStatus::Voting, "already finalized");
        require!(env::block_timestamp() >= amendment.ends_at.0, "voting is still open");
        let quorum = bps(self.coin(&amendment.coin).total_shares.0, self.config.quorum_bps);
        let passed = amendment.yes.0 > amendment.no.0 && amendment.yes.0 >= quorum;
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

    pub fn enact_amendment(&mut self, id: u32) {
        let amendment = self.amendment(id);
        require!(amendment.status == AmendmentStatus::Passed, "amendment has not passed");
        require!(env::block_timestamp() >= amendment.enact_after.0, "timelock is still running");
        let mut c = self.coin(&amendment.coin);
        require!(c.in_match.is_none(), "coin is in a Parley");
        c.constitution = amendment.constitution.clone();
        c.model = amendment.model.clone();
        c.constitution_version += 1;
        events::emit(
            "amendment_enacted",
            json!({ "coin": amendment.coin, "id": id, "constitution_version": c.constitution_version }),
        );
        self.save_coin(c);
        self.close_amendment(&amendment);
    }

    pub fn release_votes(&mut self, coin: CoinId) {
        let voter = env::predecessor_account_id();
        require!(self.votes.get(&(coin.clone(), voter.clone())).is_some(), "no locked votes");
        require!(self.release_finished_vote(&coin, &voter), "voting is still open");
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

    /// Returns a voter's locked shares once the vote they were locked in is over. True when nothing stays locked.
    fn release_finished_vote(&mut self, coin: &CoinId, voter: &AccountId) -> bool {
        let key = (coin.clone(), voter.clone());
        let Some(lock) = self.votes.get(&key).cloned() else {
            return true;
        };
        if self.amendments.get(&lock.amendment_id).is_some_and(|a| a.status == AmendmentStatus::Voting) {
            return false;
        }
        self.votes.remove(&key);
        let balance = self.shares_of_internal(coin, voter);
        self.set_shares(coin, voter, balance + lock.shares.0);
        true
    }

    fn lock_votes(&mut self, amendment: &mut Amendment, voter: &AccountId, support: bool, shares: u128) {
        let key = (amendment.coin.clone(), voter.clone());
        let mut locked = 0;
        if let Some(lock) = self.votes.get(&key) {
            require!(lock.amendment_id == amendment.id, "your shares are locked in another open vote");
            require!(lock.support == support, "you already voted the other way");
            locked = lock.shares.0;
        }
        let balance = self.shares_of_internal(&amendment.coin, voter);
        require!(shares > 0 && shares <= balance, "not enough free shares");
        self.set_shares(&amendment.coin, voter, balance - shares);
        if support {
            amendment.yes = U128(amendment.yes.0 + shares);
        } else {
            amendment.no = U128(amendment.no.0 + shares);
        }
        events::emit(
            "vote_cast",
            json!({ "coin": amendment.coin, "id": amendment.id, "voter": voter, "support": support, "shares": U128(shares) }),
        );
        self.votes.insert(key, VoteLock { amendment_id: amendment.id, shares: U128(locked + shares), support });
    }
}
