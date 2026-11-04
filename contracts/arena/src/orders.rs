use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{AccountId, env, near, require};

use crate::math::mul_div;
use crate::types::*;
use crate::{Arena, ArenaExt, events};

/// Orders are forward priced: a mint or redeem fills at the share price that
/// holds after the coin's next Parley, never the price at the time it is placed.
/// Knowing how a Parley will end therefore gives a buyer or seller no edge.
#[near]
impl Arena {
    #[payable]
    pub fn place_mint(&mut self, coin: CoinId) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach NEAR to mint");
        self.place_order(coin, OrderKind::Mint, amount);
        self.escrow += amount;
    }

    pub fn place_redeem(&mut self, coin: CoinId, shares: U128) {
        let account = env::predecessor_account_id();
        let balance = self.shares_of_internal(&coin, &account);
        require!(shares.0 > 0 && shares.0 <= balance, "not enough free shares");
        self.set_shares(&coin, &account, balance - shares.0);
        self.place_order(coin, OrderKind::Redeem, shares.0);
    }

    /// Shares move freely between accounts. Shares locked in a vote or an open redeem cannot be sent.
    pub fn transfer_shares(&mut self, coin: CoinId, to: AccountId, shares: U128) {
        let from = env::predecessor_account_id();
        require!(from != to, "cannot send shares to yourself");
        let balance = self.shares_of_internal(&coin, &from);
        require!(shares.0 > 0 && shares.0 <= balance, "not enough free shares");
        self.set_shares(&coin, &from, balance - shares.0);
        let received = self.shares_of_internal(&coin, &to);
        self.set_shares(&coin, &to, received + shares.0);
        events::emit("shares_transferred", json!({ "coin": coin, "from": from, "to": to, "shares": shares }));
    }

    pub fn cancel_order(&mut self, coin: CoinId) {
        let account = env::predecessor_account_id();
        let order = self.take_order(&coin, &account);
        self.refund_order(&coin, &account, &order);
        events::emit("order_cancelled", json!({ "coin": coin, "account": account }));
    }

    /// Anyone may fill a due order. It is due once the coin has finished a Parley
    /// since the order was placed, or after `order_timeout_ns` if no Parley came.
    pub fn fill_order(&mut self, coin: CoinId, account: AccountId) {
        let mut c = self.coin(&coin);
        require!(c.in_match.is_none(), "coin is in a Parley");
        let order = self.take_order(&coin, &account);
        let due = c.matches_played > order.epoch
            || env::block_timestamp() >= order.placed_at.0 + self.config.order_timeout_ns.0;
        require!(due, "order is not due yet");

        let (treasury, total) = (c.treasury.0, c.total_shares.0);
        match order.kind {
            OrderKind::Mint => {
                if total > 0 && treasury == 0 {
                    self.refund_order(&coin, &account, &order);
                    events::emit("order_refunded", json!({ "coin": coin, "account": account }));
                    return;
                }
                let minted = if total == 0 { order.amount.0 } else { mul_div(order.amount.0, total, treasury) };
                self.escrow -= order.amount.0;
                c.treasury = U128(treasury + order.amount.0);
                c.total_shares = U128(total + minted);
                let balance = self.shares_of_internal(&coin, &account);
                self.set_shares(&coin, &account, balance + minted);
                events::emit(
                    "order_filled",
                    json!({ "coin": coin, "account": account, "kind": "mint", "near": order.amount, "shares": U128(minted) }),
                );
            }
            OrderKind::Redeem => {
                let payout = mul_div(order.amount.0, treasury, total);
                c.treasury = U128(treasury - payout);
                c.total_shares = U128(total - order.amount.0);
                Self::pay(account.clone(), payout);
                events::emit(
                    "order_filled",
                    json!({ "coin": coin, "account": account, "kind": "redeem", "near": U128(payout), "shares": order.amount }),
                );
            }
        }
        self.save_coin(c);
    }
}

impl Arena {
    fn place_order(&mut self, coin: CoinId, kind: OrderKind, amount: u128) {
        let c = self.coin(&coin);
        require!(!c.house, "house coins have no shares");
        let account = env::predecessor_account_id();
        let key = (coin.clone(), account.clone());
        require!(self.orders.get(&key).is_none(), "you already have an open order on this coin");
        events::emit(
            "order_placed",
            json!({ "coin": coin, "account": account, "kind": kind, "amount": U128(amount), "epoch": c.matches_played }),
        );
        self.orders.insert(
            key,
            Order { kind, amount: U128(amount), placed_at: U64(env::block_timestamp()), epoch: c.matches_played },
        );
    }

    fn take_order(&mut self, coin: &CoinId, account: &AccountId) -> Order {
        self.orders
            .remove(&(coin.clone(), account.clone()))
            .unwrap_or_else(|| env::panic_str("no open order"))
    }

    fn refund_order(&mut self, coin: &CoinId, account: &AccountId, order: &Order) {
        match order.kind {
            OrderKind::Mint => {
                self.escrow -= order.amount.0;
                Self::pay(account.clone(), order.amount.0);
            }
            OrderKind::Redeem => {
                let balance = self.shares_of_internal(coin, account);
                self.set_shares(coin, account, balance + order.amount.0);
            }
        }
    }
}
