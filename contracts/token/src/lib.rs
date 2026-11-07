use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, env, ext_contract, near, require};

const GAS_FOR_RELEASE: Gas = Gas::from_tgas(15);
const GAS_FOR_SETTLE: Gas = Gas::from_tgas(10);

#[ext_contract(ext_arena)]
#[allow(dead_code)]
trait Arena {
    fn transfer_shares(&mut self, coin: String, to: AccountId, shares: U128);
}

/// One coin's shares as a NEP-141 token. Every token is backed by one share that this contract
/// holds in the arena. Wrapped shares trade like any token; to vote or redeem, unwrap them.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ShareToken {
    token: FungibleToken,
    arena: AccountId,
    coin: String,
    name: String,
    symbol: String,
}

#[near]
impl ShareToken {
    #[init]
    pub fn new(arena: AccountId, coin: String, name: String, symbol: String) -> Self {
        Self { token: FungibleToken::new(b"t"), arena, coin, name, symbol }
    }

    /// The arena calls this after it has moved `shares` of the coin to this contract. The sender gets the same number of tokens.
    #[allow(unused_variables)]
    pub fn on_shares_received(&mut self, coin: String, from: AccountId, shares: U128, msg: String) -> U128 {
        require!(env::predecessor_account_id() == self.arena, "only the arena can wrap shares");
        require!(coin == self.coin, "these are another coin's shares");
        if !self.token.accounts.contains_key(&from) {
            self.token.internal_register_account(&from);
        }
        self.token.internal_deposit(&from, shares.0);
        FtMint { owner_id: &from, amount: shares, memo: Some("wrap") }.emit();
        U128(0)
    }

    /// Burns tokens and sends the same number of shares back to the caller in the arena.
    pub fn unwrap(&mut self, amount: U128) -> Promise {
        let account = env::predecessor_account_id();
        require!(amount.0 > 0, "nothing to unwrap");
        self.token.internal_withdraw(&account, amount.0);
        FtBurn { owner_id: &account, amount, memo: Some("unwrap") }.emit();
        ext_arena::ext(self.arena.clone())
            .with_static_gas(GAS_FOR_RELEASE)
            .transfer_shares(self.coin.clone(), account.clone(), amount)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_SETTLE).on_unwrapped(account, amount))
    }

    #[private]
    pub fn on_unwrapped(&mut self, account: AccountId, amount: U128, #[callback_result] released: Result<(), PromiseError>) -> bool {
        if released.is_ok() {
            return true;
        }
        self.token.internal_deposit(&account, amount.0);
        FtMint { owner_id: &account, amount, memo: Some("unwrap failed") }.emit();
        false
    }

    pub fn get_backing(&self) -> (AccountId, String) {
        (self.arena.clone(), self.coin.clone())
    }
}

#[near]
impl FungibleTokenCore for ShareToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for ShareToken {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            FtBurn { owner_id: &sender_id, amount: U128(burned), memo: Some("sender closed its account") }.emit();
        }
        used.into()
    }
}

#[near]
impl StorageManagement for ShareToken {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        require!(force != Some(true), "unwrap or send your tokens before closing the account");
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for ShareToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 24,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn at(who: &str, deposit: u128) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acc("saint.arena.near"))
                .predecessor_account_id(acc(who))
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .build()
        );
    }

    fn token() -> ShareToken {
        at("arena.near", 0);
        ShareToken::new(acc("arena.near"), "saint".into(), "Parley SAINT".into(), "SAINT".into())
    }

    #[test]
    fn wrapping_mints_one_token_per_share() {
        let mut t = token();
        assert_eq!(t.on_shares_received("saint".into(), acc("alice.near"), U128(40), String::new()).0, 0);
        t.on_shares_received("saint".into(), acc("alice.near"), U128(2), String::new());
        assert_eq!(t.ft_balance_of(acc("alice.near")).0, 42);
        assert_eq!(t.ft_total_supply().0, 42);
        assert_eq!(t.ft_metadata().symbol, "SAINT");
        assert_eq!(t.ft_metadata().decimals, 24);
    }

    #[test]
    #[should_panic(expected = "only the arena can wrap shares")]
    fn nobody_else_can_mint() {
        let mut t = token();
        at("mallory.near", 0);
        t.on_shares_received("saint".into(), acc("mallory.near"), U128(40), String::new());
    }

    #[test]
    #[should_panic(expected = "these are another coin's shares")]
    fn another_coins_shares_are_refused() {
        let mut t = token();
        t.on_shares_received("snake".into(), acc("alice.near"), U128(40), String::new());
    }

    #[test]
    fn tokens_move_between_registered_accounts() {
        let mut t = token();
        t.on_shares_received("saint".into(), acc("alice.near"), U128(40), String::new());
        at("bob.near", t.storage_balance_bounds().min.as_yoctonear());
        t.storage_deposit(None, None);
        at("alice.near", 1);
        t.ft_transfer(acc("bob.near"), U128(15), None);
        assert_eq!(t.ft_balance_of(acc("alice.near")).0, 25);
        assert_eq!(t.ft_balance_of(acc("bob.near")).0, 15);
    }

    #[test]
    fn unwrapping_burns_first_and_restores_on_failure() {
        let mut t = token();
        t.on_shares_received("saint".into(), acc("alice.near"), U128(40), String::new());
        at("alice.near", 0);
        let _ = t.unwrap(U128(30));
        assert_eq!(t.ft_balance_of(acc("alice.near")).0, 10);
        assert_eq!(t.ft_total_supply().0, 10);
        at("saint.arena.near", 0);
        assert!(!t.on_unwrapped(acc("alice.near"), U128(30), Err(PromiseError::Failed)));
        assert_eq!(t.ft_balance_of(acc("alice.near")).0, 40);
        assert!(t.on_unwrapped(acc("alice.near"), U128(30), Ok(())));
        assert_eq!(t.ft_total_supply().0, 40);
    }

    #[test]
    #[should_panic(expected = "The account doesn't have enough balance")]
    fn cannot_unwrap_more_than_held() {
        let mut t = token();
        t.on_shares_received("saint".into(), acc("alice.near"), U128(40), String::new());
        at("alice.near", 0);
        let _ = t.unwrap(U128(41));
    }
}
