use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require};

use crate::math::bps;
use crate::types::*;
use crate::{Arena, ArenaExt, events};

/// Holders have one power: replace the coin's constitution and the model that
/// reads it. They can never move the treasury.
#[near]
impl Arena {
    pub fn propose_amendment(&mut self, coin: CoinId, constitution: String, model: String) -> u32 {
        let c = self.coin(&coin);
        require!(!c.house, "a house constitution never changes");
        let proposer = env::predecessor_account_id();
        let held = self.shares_of_internal(&coin, &proposer);
        require!(
            held > 0 && held >= bps(c.total_shares.0, self.config.proposer_bps),
            "not enough shares to propose"
        );
        if let Some(current) = self.amendments.get(&coin) {
            require!(
                matches!(current.status, AmendmentStatus::Rejected | AmendmentStatus::Enacted),
                "an amendment is already in progress"
            );
        }
        self.assert_constitution(&constitution, &model);
        self.amendment_count += 1;
        let id = self.amendment_count;
        let ends_at = env::block_timestamp() + self.config.vote_period_ns.0;
        events::emit(
            "amendment_proposed",
            json!({ "coin": coin, "id": id, "proposer": proposer, "model": model, "ends_at": U64(ends_at) }),
        );
        self.amendments.insert(
            coin,
            Amendment {
                id,
                proposer,
                constitution,
                model,
                yes: U128(0),
                no: U128(0),
                ends_at: U64(ends_at),
                enact_after: U64(0),
                status: AmendmentStatus::Voting,
            },
        );
        id
    }

    /// Voting locks the shares until the vote is over, so one share cannot vote twice.
    pub fn vote(&mut self, coin: CoinId, support: bool, shares: U128) {
        let voter = env::predecessor_account_id();
        let mut amendment = self.amendments.get(&coin).cloned().unwrap_or_else(|| env::panic_str("no amendment"));
        require!(
            amendment.status == AmendmentStatus::Voting && env::block_timestamp() < amendment.ends_at.0,
            "voting is closed"
        );
        let key = (coin.clone(), voter.clone());
        let mut locked = 0;
        if let Some(lock) = self.votes.get(&key).cloned() {
            if lock.amendment_id == amendment.id {
                require!(lock.support == support, "you already voted the other way");
                locked = lock.shares.0;
            } else {
                let balance = self.shares_of_internal(&coin, &voter);
                self.set_shares(&coin, &voter, balance + lock.shares.0);
            }
        }
        let balance = self.shares_of_internal(&coin, &voter);
        require!(shares.0 > 0 && shares.0 <= balance, "not enough free shares");
        self.set_shares(&coin, &voter, balance - shares.0);
        if support {
            amendment.yes = U128(amendment.yes.0 + shares.0);
        } else {
            amendment.no = U128(amendment.no.0 + shares.0);
        }
        events::emit(
            "vote_cast",
            json!({ "coin": coin, "id": amendment.id, "voter": voter, "support": support, "shares": shares }),
        );
        self.votes.insert(key, VoteLock { amendment_id: amendment.id, shares: U128(locked + shares.0), support });
        self.amendments.insert(coin, amendment);
    }

    /// Closes the vote. A passed amendment then waits `timelock_ns`, time in which any holder who disagrees can redeem.
    pub fn finalize_amendment(&mut self, coin: CoinId) {
        let c = self.coin(&coin);
        let mut amendment = self.amendments.get(&coin).cloned().unwrap_or_else(|| env::panic_str("no amendment"));
        require!(amendment.status == AmendmentStatus::Voting, "already finalized");
        require!(env::block_timestamp() >= amendment.ends_at.0, "voting is still open");
        let quorum = bps(c.total_shares.0, self.config.quorum_bps);
        let passed = amendment.yes.0 > amendment.no.0 && amendment.yes.0 >= quorum;
        if passed {
            amendment.status = AmendmentStatus::Passed;
            amendment.enact_after = U64(env::block_timestamp() + self.config.timelock_ns.0);
        } else {
            amendment.status = AmendmentStatus::Rejected;
        }
        events::emit(
            "amendment_finalized",
            json!({ "coin": coin, "id": amendment.id, "passed": passed, "yes": amendment.yes, "no": amendment.no }),
        );
        self.amendments.insert(coin, amendment);
    }

    pub fn enact_amendment(&mut self, coin: CoinId) {
        let mut c = self.coin(&coin);
        let mut amendment = self.amendments.get(&coin).cloned().unwrap_or_else(|| env::panic_str("no amendment"));
        require!(amendment.status == AmendmentStatus::Passed, "amendment has not passed");
        require!(env::block_timestamp() >= amendment.enact_after.0, "timelock is still running");
        require!(c.in_match.is_none(), "coin is in a Parley");
        c.constitution = amendment.constitution.clone();
        c.model = amendment.model.clone();
        c.constitution_version += 1;
        amendment.status = AmendmentStatus::Enacted;
        events::emit(
            "amendment_enacted",
            json!({ "coin": coin, "id": amendment.id, "constitution_version": c.constitution_version }),
        );
        self.save_coin(c);
        self.amendments.insert(coin, amendment);
    }

    pub fn release_votes(&mut self, coin: CoinId) {
        let voter = env::predecessor_account_id();
        let key = (coin.clone(), voter.clone());
        let lock = self.votes.get(&key).cloned().unwrap_or_else(|| env::panic_str("no locked votes"));
        let still_voting = self
            .amendments
            .get(&coin)
            .is_some_and(|a| a.id == lock.amendment_id && a.status == AmendmentStatus::Voting);
        require!(!still_voting, "voting is still open");
        self.votes.remove(&key);
        let balance = self.shares_of_internal(&coin, &voter);
        self.set_shares(&coin, &voter, balance + lock.shares.0);
    }
}
