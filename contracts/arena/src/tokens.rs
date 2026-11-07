use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{AccountId, Gas, NearToken, Promise, PromiseError, env, ext_contract, near, require};

use crate::types::*;
use crate::{Arena, ArenaExt, events};

const TOKEN_WASM: &[u8] = include_bytes!("../../token/res/parley_token.wasm");
const TOKEN_DEPOSIT: NearToken = NearToken::from_near(3);
const GAS_FOR_TOKEN_INIT: Gas = Gas::from_tgas(20);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(10);

#[ext_contract(ext_receiver)]
#[allow(dead_code)]
trait SharesReceiver {
    fn on_shares_received(&mut self, coin: CoinId, from: AccountId, shares: U128, msg: String) -> U128;
}

/// Shares live in this contract so they can vote and redeem. These methods let them leave as a
/// standard NEP-141 token and come back: one token contract per coin, deployed by the arena itself.
#[near]
impl Arena {
    /// Deploys the coin's NEP-141 contract at `<coin>.<arena>`. Anyone may pay for it, once.
    #[payable]
    pub fn create_token(&mut self, coin: CoinId) -> Promise {
        let c = self.coin(&coin);
        require!(!c.house, "house coins have no shares");
        require!(c.token.is_none(), "this coin already has a token");
        let deposit = env::attached_deposit();
        require!(deposit >= TOKEN_DEPOSIT, "attach 3 NEAR for the token contract's storage");
        let token: AccountId = format!("{coin}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("token account id is too long"));
        let init = json!({ "arena": env::current_account_id(), "coin": coin, "name": format!("Parley {}", c.name), "symbol": coin.to_uppercase() });
        Promise::new(token.clone())
            .create_account()
            .transfer(deposit)
            .deploy_contract(TOKEN_WASM.to_vec())
            .function_call("new".to_string(), init.to_string().into_bytes(), NearToken::from_near(0), GAS_FOR_TOKEN_INIT)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_CALLBACK).on_token_created(
                coin,
                token,
                env::predecessor_account_id(),
                U128(deposit.as_yoctonear()),
            ))
    }

    #[private]
    pub fn on_token_created(
        &mut self,
        coin: CoinId,
        token: AccountId,
        payer: AccountId,
        deposit: U128,
        #[callback_result] created: Result<(), PromiseError>,
    ) -> Option<AccountId> {
        if created.is_err() {
            Self::pay(payer, deposit.0);
            return None;
        }
        let mut c = self.coin(&coin);
        c.token = Some(token.clone());
        self.save_coin(c);
        events::emit("token_created", json!({ "coin": coin, "token": token }));
        Some(token)
    }

    /// Sends shares to a contract and tells it so, like `ft_transfer_call`. The receiver answers with
    /// the number of shares it did not want, and those go back to the sender. Sending to a coin's
    /// token contract wraps the shares.
    pub fn transfer_shares_call(&mut self, coin: CoinId, to: AccountId, shares: U128, msg: String) -> Promise {
        let from = env::predecessor_account_id();
        self.move_shares(&coin, &from, &to, shares.0);
        ext_receiver::ext(to.clone())
            .with_unused_gas_weight(1)
            .on_shares_received(coin.clone(), from.clone(), shares, msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .with_unused_gas_weight(0)
                    .resolve_shares_call(coin, from, to, shares),
            )
    }

    #[private]
    pub fn resolve_shares_call(&mut self, coin: CoinId, from: AccountId, to: AccountId, shares: U128) -> U128 {
        let unused = env::promise_result_checked(0, 64)
            .ok()
            .and_then(|value| serde_json::from_slice::<U128>(&value).ok())
            .map_or(shares.0, |unused| unused.0.min(shares.0));
        let refund = unused.min(self.shares_of_internal(&coin, &to));
        if refund > 0 {
            self.move_shares(&coin, &to, &from, refund);
        }
        U128(shares.0 - refund)
    }
}

impl Arena {
    pub(crate) fn move_shares(&mut self, coin: &CoinId, from: &AccountId, to: &AccountId, shares: u128) {
        require!(from != to, "cannot send shares to yourself");
        let balance = self.shares_of_internal(coin, from);
        require!(shares > 0 && shares <= balance, "not enough free shares");
        self.set_shares(coin, from, balance - shares);
        let received = self.shares_of_internal(coin, to);
        self.set_shares(coin, to, received + shares);
        events::emit("shares_transferred", json!({ "coin": coin, "from": from, "to": to, "shares": U128(shares) }));
    }
}
