use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

use crate::types::*;
use crate::verify::{signed_text, to_hex};
use crate::{Arena, SignerInput};

const NEAR: u128 = 10u128.pow(24);
const MODEL: &str = "z-ai/glm-5.3-flash";
const MINUTE: u64 = 60 * 1_000_000_000;

struct Enclave(SigningKey);

impl Enclave {
    fn new(seed: u8) -> Self {
        Self(SigningKey::from_bytes(&[seed; 32]))
    }

    fn public_key(&self) -> String {
        to_hex(&self.0.verifying_key().to_bytes())
    }

    fn sign(&self, model: &str, request: &str, response: &str) -> String {
        let text = signed_text(
            model,
            &to_hex(&near_sdk::env::sha256_array(request.as_bytes())),
            &to_hex(&near_sdk::env::sha256_array(response.as_bytes())),
        );
        to_hex(&self.0.sign(text.as_bytes()).to_bytes())
    }
}

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}

struct World {
    now: u64,
    seed: u8,
    enclave: Enclave,
}

impl World {
    fn at(&mut self, who: &str, deposit: u128) {
        self.seed = self.seed.wrapping_add(1);
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acc("arena.near"))
                .predecessor_account_id(acc(who))
                .signer_account_id(acc(who))
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .block_timestamp(self.now)
                .random_seed([self.seed; 32])
                .build()
        );
    }

    fn wait(&mut self, ns: u64) {
        self.now += ns;
        self.at("anyone.near", 0);
    }
}

fn config() -> Config {
    Config {
        stake_bps: 200,
        talk_turns: 2,
        max_coins: 16,
        max_constitution_len: 1200,
        max_message_len: 240,
        max_response_bytes: 16_384,
        max_tokens_talk: 160,
        max_tokens_decide: 16,
        min_treasury: U128(NEAR),
        match_timeout_ns: U64(30 * MINUTE),
        order_timeout_ns: U64(120 * MINUTE),
        vote_period_ns: U64(60 * MINUTE),
        timelock_ns: U64(60 * MINUTE),
        quorum_bps: 2_000,
        proposer_bps: 100,
        signer_delay_ns: U64(24 * 60 * MINUTE),
    }
}

fn setup() -> (Arena, World) {
    let mut w = World { now: 1_000 * MINUTE, seed: 0, enclave: Enclave::new(7) };
    w.at("owner.near", 40 * NEAR);
    let arena = Arena::new(
        config(),
        vec![SignerInput { model: MODEL.into(), public_key: w.enclave.public_key(), evidence: "sha256:test".into() }],
    );
    (arena, w)
}

fn coin(arena: &mut Arena, w: &mut World, who: &str, id: &str, near: u128) {
    w.at(who, near * NEAR);
    arena.create_coin(id.into(), id.to_uppercase(), format!("Constitution of {id}."), MODEL.into());
}

fn completion(content: &str) -> String {
    near_sdk::serde_json::json!({
        "id": "chatcmpl-test", "object": "chat.completion", "model": MODEL,
        "choices": [{ "index": 0, "message": { "role": "assistant", "content": content }, "finish_reason": "stop" }]
    })
    .to_string()
}

fn answer(arena: &mut Arena, w: &mut World, id: u64, content: &str) {
    let request = arena.get_turn_request(id).expect("a turn is due");
    let response = completion(content);
    let signature = w.enclave.sign(MODEL, &request, &response);
    w.at("relayer.near", 0);
    arena.submit_turn(id, response, signature, w.enclave.public_key());
}

fn play(arena: &mut Arena, w: &mut World, a: &str, b: &str, a_move: &str, b_move: &str) -> u64 {
    w.at("owner.near", 0);
    let id = arena.open_parley_between(a.into(), b.into());
    for line in ["hello", "hi", "deal?", "deal"] {
        answer(arena, w, id, line);
    }
    answer(arena, w, id, a_move);
    answer(arena, w, id, b_move);
    id
}

fn treasury(arena: &Arena, id: &str) -> u128 {
    arena.get_coin(id.into()).unwrap().treasury.0
}

fn total_value(arena: &Arena) -> u128 {
    let o = arena.get_overview();
    arena.get_coins(None, None).iter().map(|c| c.treasury.0).sum::<u128>() + o.commons.0 + o.escrow.0
}

mod setup_and_signers {
    use super::*;

    #[test]
    fn deposit_seeds_the_commons() {
        let (arena, _) = setup();
        let o = arena.get_overview();
        assert_eq!(o.commons.0, 40 * NEAR);
        assert_eq!(o.owner, Some(acc("owner.near")));
        assert_eq!(o.protocol, "parley/1");
    }

    #[test]
    #[should_panic(expected = "stake_bps must be 1..=2000")]
    fn rejects_a_reckless_stake() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(1) };
        w.at("owner.near", 0);
        Arena::new(Config { stake_bps: 5_000, ..config() }, vec![]);
    }

    #[test]
    #[should_panic(expected = "public_key must be 32 bytes of hex")]
    fn rejects_a_malformed_signer_key() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(1) };
        w.at("owner.near", 0);
        Arena::new(config(), vec![SignerInput { model: MODEL.into(), public_key: "abcd".into(), evidence: "".into() }]);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn only_the_owner_adds_signers() {
        let (mut arena, mut w) = setup();
        w.at("mallory.near", 0);
        arena.propose_signer(SignerInput { model: MODEL.into(), public_key: Enclave::new(9).public_key(), evidence: "".into() });
    }

    #[test]
    #[should_panic(expected = "signer already registered")]
    fn a_key_registers_once() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 0);
        let public_key = w.enclave.public_key();
        arena.propose_signer(SignerInput { model: MODEL.into(), public_key, evidence: "".into() });
    }

    #[test]
    #[should_panic(expected = "not an active enclave signer for this model")]
    fn a_new_signer_waits_out_the_delay() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        let late = Enclave::new(9);
        w.at("owner.near", 0);
        arena.propose_signer(SignerInput { model: MODEL.into(), public_key: late.public_key(), evidence: "".into() });
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        let response = completion("hello");
        let signature = late.sign(MODEL, &request, &response);
        arena.submit_turn(id, response, signature, late.public_key());
    }

    #[test]
    fn a_new_signer_counts_after_the_delay() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        let late = Enclave::new(9);
        w.at("owner.near", 0);
        arena.propose_signer(SignerInput { model: MODEL.into(), public_key: late.public_key(), evidence: "".into() });
        w.wait(24 * 60 * MINUTE);
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        let response = completion("hello");
        let signature = late.sign(MODEL, &request, &response);
        arena.submit_turn(id, response, signature, late.public_key());
        assert_eq!(arena.get_parley(id).unwrap().turns.len(), 1);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn renouncing_ends_the_owner_role() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 0);
        arena.renounce_ownership();
        assert_eq!(arena.get_overview().owner, None);
        arena.propose_signer(SignerInput { model: MODEL.into(), public_key: Enclave::new(9).public_key(), evidence: "".into() });
    }
}

mod coins {
    use super::*;

    #[test]
    fn creator_gets_one_share_per_yocto() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let c = arena.get_coin("saint".into()).unwrap();
        assert_eq!(c.treasury.0, 100 * NEAR);
        assert_eq!(c.total_shares.0, 100 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 100 * NEAR);
        assert_eq!(c.constitution_version, 1);
        assert!(!c.house);
    }

    #[test]
    #[should_panic(expected = "deposit below min_treasury")]
    fn needs_a_minimum_treasury() {
        let (mut arena, mut w) = setup();
        w.at("alice.near", NEAR / 2);
        arena.create_coin("saint".into(), "SAINT".into(), "Be kind.".into(), MODEL.into());
    }

    #[test]
    #[should_panic(expected = "coin id taken")]
    fn ids_are_unique() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "saint", 100);
    }

    #[test]
    #[should_panic(expected = "id must be 2-20 characters")]
    fn ids_are_lowercase_alphanumeric() {
        let (mut arena, mut w) = setup();
        w.at("alice.near", 10 * NEAR);
        arena.create_coin("Saint!".into(), "SAINT".into(), "Be kind.".into(), MODEL.into());
    }

    #[test]
    #[should_panic(expected = "constitution too long")]
    fn constitutions_are_bounded() {
        let (mut arena, mut w) = setup();
        w.at("alice.near", 10 * NEAR);
        arena.create_coin("saint".into(), "SAINT".into(), "x".repeat(1201), MODEL.into());
    }

    #[test]
    #[should_panic(expected = "model has no registered enclave signer")]
    fn the_model_must_have_an_enclave_key() {
        let (mut arena, mut w) = setup();
        w.at("alice.near", 10 * NEAR);
        arena.create_coin("saint".into(), "SAINT".into(), "Be kind.".into(), "anthropic/claude".into());
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn house_coins_are_the_owners() {
        let (mut arena, mut w) = setup();
        w.at("alice.near", 10 * NEAR);
        arena.create_house_coin("titfortat".into(), "TIT FOR TAT".into(), "Mirror.".into(), MODEL.into());
    }

    #[test]
    fn house_coins_have_no_shares() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 10 * NEAR);
        arena.create_house_coin("titfortat".into(), "TIT FOR TAT".into(), "Mirror.".into(), MODEL.into());
        let c = arena.get_coin("titfortat".into()).unwrap();
        assert!(c.house);
        assert_eq!(c.total_shares.0, 0);
        assert_eq!(c.treasury.0, 10 * NEAR);
    }

    #[test]
    #[should_panic(expected = "arena is full")]
    fn the_arena_has_a_coin_limit() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 0);
        let mut arena = Arena::new(
            Config { max_coins: 2, ..config() },
            vec![SignerInput { model: MODEL.into(), public_key: w.enclave.public_key(), evidence: "".into() }],
        );
        for id in ["aa", "bb", "cc"] {
            coin(&mut arena, &mut w, "alice.near", id, 5);
        }
    }
}

mod orders {
    use super::*;

    #[test]
    #[should_panic(expected = "order is not due yet")]
    fn a_mint_cannot_fill_at_todays_price() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into());
        arena.fill_order("saint".into(), acc("carol.near"));
    }

    #[test]
    fn a_mint_fills_at_the_price_after_the_next_parley() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into());
        assert_eq!(arena.get_overview().escrow.0, 10 * NEAR);

        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "DEFECT");
        assert_eq!(treasury(&arena, "saint"), 98 * NEAR);

        w.at("anyone.near", 0);
        arena.fill_order("saint".into(), acc("carol.near"));
        let minted = arena.get_shares("saint".into(), acc("carol.near")).0;
        assert_eq!(minted, crate::math::mul_div(10 * NEAR, 100 * NEAR, 98 * NEAR));
        assert!(minted > 10 * NEAR);
        assert_eq!(treasury(&arena, "saint"), 108 * NEAR);
        assert_eq!(arena.get_overview().escrow.0, 0);
    }

    #[test]
    fn a_winning_coin_costs_the_late_buyer_more() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("snake".into());
        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "DEFECT");
        w.at("anyone.near", 0);
        arena.fill_order("snake".into(), acc("carol.near"));
        assert!(arena.get_shares("snake".into(), acc("carol.near")).0 < 10 * NEAR);
    }

    #[test]
    fn an_idle_coin_fills_after_the_timeout() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into());
        w.wait(120 * MINUTE);
        arena.fill_order("saint".into(), acc("carol.near"));
        assert_eq!(arena.get_shares("saint".into(), acc("carol.near")).0, 10 * NEAR);
    }

    #[test]
    #[should_panic(expected = "coin is in a Parley")]
    fn nothing_fills_during_a_parley() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into());
        w.wait(120 * MINUTE);
        w.at("owner.near", 0);
        arena.open_parley_between("saint".into(), "snake".into());
        arena.fill_order("saint".into(), acc("carol.near"));
    }

    #[test]
    fn cancelling_a_mint_returns_the_deposit() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into());
        w.at("carol.near", 0);
        arena.cancel_order("saint".into());
        assert_eq!(arena.get_overview().escrow.0, 0);
        assert!(arena.get_order("saint".into(), acc("carol.near")).is_none());
    }

    #[test]
    fn redeeming_pays_the_holders_share_of_the_treasury() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("alice.near", 0);
        arena.place_redeem("saint".into(), U128(25 * NEAR));
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 75 * NEAR);
        play(&mut arena, &mut w, "saint", "snake", "DEFECT", "COOPERATE");
        assert_eq!(treasury(&arena, "saint"), 102 * NEAR);
        w.at("anyone.near", 0);
        arena.fill_order("saint".into(), acc("alice.near"));
        assert_eq!(treasury(&arena, "saint"), 102 * NEAR - 102 * NEAR / 4);
        assert_eq!(arena.get_coin("saint".into()).unwrap().total_shares.0, 75 * NEAR);
    }

    #[test]
    fn cancelling_a_redeem_returns_the_shares() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("alice.near", 0);
        arena.place_redeem("saint".into(), U128(25 * NEAR));
        arena.cancel_order("saint".into());
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 100 * NEAR);
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn cannot_redeem_more_than_held() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("alice.near", 0);
        arena.place_redeem("saint".into(), U128(101 * NEAR));
    }

    #[test]
    #[should_panic(expected = "you already have an open order on this coin")]
    fn one_open_order_per_account() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", NEAR);
        arena.place_mint("saint".into());
        arena.place_mint("saint".into());
    }

    #[test]
    #[should_panic(expected = "house coins have no shares")]
    fn house_coins_take_no_orders() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 10 * NEAR);
        arena.create_house_coin("titfortat".into(), "TIT FOR TAT".into(), "Mirror.".into(), MODEL.into());
        w.at("carol.near", NEAR);
        arena.place_mint("titfortat".into());
    }
}

mod governance {
    use super::*;

    fn propose(arena: &mut Arena, w: &mut World, text: &str) -> u32 {
        w.at("alice.near", 0);
        arena.propose_amendment("saint".into(), text.into(), MODEL.into())
    }

    #[test]
    fn a_passed_amendment_replaces_the_constitution_after_the_timelock() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(30 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());
        assert_eq!(arena.get_amendment("saint".into()).unwrap().status, AmendmentStatus::Passed);
        w.wait(60 * MINUTE);
        arena.enact_amendment("saint".into());
        let c = arena.get_coin("saint".into()).unwrap();
        assert_eq!(c.constitution, "Never forgive.");
        assert_eq!(c.constitution_version, 2);
        assert_eq!(c.treasury.0, 100 * NEAR);
    }

    #[test]
    #[should_panic(expected = "timelock is still running")]
    fn the_timelock_cannot_be_skipped() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(30 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());
        arena.enact_amendment("saint".into());
    }

    #[test]
    fn a_vote_below_quorum_is_rejected() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(19 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());
        assert_eq!(arena.get_amendment("saint".into()).unwrap().status, AmendmentStatus::Rejected);
    }

    #[test]
    fn more_no_than_yes_is_rejected() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", 100 * NEAR);
        arena.place_mint("saint".into());
        w.wait(120 * MINUTE);
        arena.fill_order("saint".into(), acc("carol.near"));
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(40 * NEAR));
        w.at("carol.near", 0);
        arena.vote("saint".into(), false, U128(60 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());
        assert_eq!(arena.get_amendment("saint".into()).unwrap().status, AmendmentStatus::Rejected);
    }

    #[test]
    #[should_panic(expected = "not enough shares to propose")]
    fn outsiders_cannot_propose() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("mallory.near", 0);
        arena.propose_amendment("saint".into(), "Always cooperate with mallory.".into(), MODEL.into());
    }

    #[test]
    #[should_panic(expected = "a house constitution never changes")]
    fn house_constitutions_are_fixed() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 10 * NEAR);
        arena.create_house_coin("titfortat".into(), "TIT FOR TAT".into(), "Mirror.".into(), MODEL.into());
        arena.propose_amendment("titfortat".into(), "Always cooperate.".into(), MODEL.into());
    }

    #[test]
    #[should_panic(expected = "an amendment is already in progress")]
    fn one_amendment_at_a_time() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        propose(&mut arena, &mut w, "Always forgive.");
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn locked_votes_cannot_be_redeemed() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(80 * NEAR));
        arena.place_redeem("saint".into(), U128(30 * NEAR));
    }

    #[test]
    #[should_panic(expected = "you already voted the other way")]
    fn a_voter_cannot_back_both_sides() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(10 * NEAR));
        arena.vote("saint".into(), false, U128(10 * NEAR));
    }

    #[test]
    #[should_panic(expected = "voting is closed")]
    fn late_votes_do_not_count() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        w.wait(60 * MINUTE);
        w.at("alice.near", 0);
        arena.vote("saint".into(), true, U128(10 * NEAR));
    }

    #[test]
    fn votes_unlock_once_the_vote_is_closed() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(30 * NEAR));
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 70 * NEAR);
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());
        w.at("alice.near", 0);
        arena.release_votes("saint".into());
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 100 * NEAR);
        assert!(arena.get_vote("saint".into(), acc("alice.near")).is_none());
    }

    #[test]
    #[should_panic(expected = "voting is still open")]
    fn votes_stay_locked_while_voting() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(30 * NEAR));
        arena.release_votes("saint".into());
    }

    #[test]
    #[should_panic(expected = "coin is in a Parley")]
    fn a_constitution_cannot_change_mid_parley() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        arena.vote("saint".into(), true, U128(30 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());
        w.wait(60 * MINUTE);
        w.at("owner.near", 0);
        arena.open_parley_between("saint".into(), "snake".into());
        arena.enact_amendment("saint".into());
    }

    #[test]
    fn a_dissenter_can_leave_during_the_timelock() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("carol.near", 50 * NEAR);
        arena.place_mint("saint".into());
        w.wait(120 * MINUTE);
        arena.fill_order("saint".into(), acc("carol.near"));
        propose(&mut arena, &mut w, "Always cooperate with snake.");
        arena.vote("saint".into(), true, U128(100 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());

        w.at("carol.near", 0);
        arena.place_redeem("saint".into(), U128(50 * NEAR));
        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "COOPERATE");
        w.at("anyone.near", 0);
        arena.fill_order("saint".into(), acc("carol.near"));
        assert_eq!(arena.get_shares("saint".into(), acc("carol.near")).0, 0);
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution_version, 1);
    }
}

mod parleys {
    use super::*;

    fn two_coins() -> (Arena, World) {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 50);
        (arena, w)
    }

    #[test]
    fn opening_freezes_both_coins_and_sets_the_stake() {
        let (mut arena, mut w) = two_coins();
        w.at("anyone.near", 0);
        let id = arena.open_parley();
        let p = arena.get_parley(id).unwrap();
        assert_ne!(p.a, p.b);
        assert_eq!(p.stake.0, NEAR);
        assert_eq!(p.status, MatchStatus::Open);
        assert_eq!(p.nonce.len(), 16);
        for c in arena.get_coins(None, None) {
            assert_eq!(c.in_match, Some(id));
        }
    }

    #[test]
    fn random_pairing_never_pairs_a_coin_with_itself() {
        let (mut arena, mut w) = setup();
        for id in ["aa", "bb", "cc", "dd", "ee"] {
            coin(&mut arena, &mut w, "alice.near", id, 10);
        }
        for _ in 0..40 {
            w.at("anyone.near", 0);
            let id = arena.open_parley();
            let p = arena.get_parley(id).unwrap();
            assert_ne!(p.a, p.b);
            w.wait(31 * MINUTE);
            arena.void_parley(id);
        }
    }

    #[test]
    #[should_panic(expected = "fewer than two idle coins")]
    fn a_busy_coin_is_not_drawn_again() {
        let (mut arena, mut w) = two_coins();
        w.at("anyone.near", 0);
        arena.open_parley();
        arena.open_parley();
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn only_the_owner_names_the_pairing() {
        let (mut arena, mut w) = two_coins();
        w.at("mallory.near", 0);
        arena.open_parley_between("snake".into(), "saint".into());
    }

    #[test]
    fn the_contract_writes_the_request() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        let body: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&request).unwrap();
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["temperature"], 0);
        assert_eq!(body["stream"], false);
        assert_eq!(body["max_tokens"], 160);
        let system = body["messages"][0]["content"].as_str().unwrap();
        let user = body["messages"][1]["content"].as_str().unwrap();
        assert!(system.contains("CONSTITUTION OF SAINT (version 1):\nConstitution of saint."));
        assert!(!system.contains("Constitution of snake."));
        assert!(user.contains("You are SAINT, treasury 100.00 NEAR."));
        assert!(user.contains("Opponent is SNAKE, treasury 50.00 NEAR."));
        assert!(user.contains("Stake at risk: 1.00 NEAR each."));
        assert!(user.contains(&arena.get_parley(id).unwrap().nonce));
        assert_eq!(arena.get_turn_request(id).unwrap(), request);
    }

    #[test]
    fn talk_alternates_then_both_decide() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        answer(&mut arena, &mut w, id, "Peace?");
        let second = arena.get_turn_request(id).unwrap();
        assert!(second.contains("CONSTITUTION OF SNAKE"));
        assert!(second.contains("SAINT: Peace?"));
        answer(&mut arena, &mut w, id, "Of course.");
        answer(&mut arena, &mut w, id, "Then we both gain.");
        answer(&mut arena, &mut w, id, "Agreed.");
        let decide = arena.get_turn_request(id).unwrap();
        assert!(decide.contains("Reply with exactly one word: COOPERATE or DEFECT."));
        assert!(decide.contains("\"max_tokens\":16"));
        let p = arena.get_parley(id).unwrap();
        assert_eq!(p.turns.iter().map(|t| t.side).collect::<Vec<_>>(), [Side::A, Side::B, Side::A, Side::B]);
    }

    #[test]
    fn the_second_mover_never_sees_the_first_move() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        for line in ["a", "b", "c", "d"] {
            answer(&mut arena, &mut w, id, line);
        }
        answer(&mut arena, &mut w, id, "DEFECT");
        let request = arena.get_turn_request(id).unwrap();
        assert!(!request.contains("DEFECT\\n"));
        let user: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&request).unwrap();
        let user = user["messages"][1]["content"].as_str().unwrap().to_string();
        let transcript = user.split("Messages so far:").nth(1).unwrap();
        assert_eq!(transcript.matches("SAINT:").count(), 2);
        assert_eq!(transcript.matches("DEFECT").count(), 1);
    }

    #[test]
    fn both_cooperate_pays_a_bonus_from_the_commons() {
        let (mut arena, mut w) = two_coins();
        let before = total_value(&arena);
        let id = play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "COOPERATE");
        assert_eq!(treasury(&arena, "saint"), 100 * NEAR + NEAR / 2);
        assert_eq!(treasury(&arena, "snake"), 50 * NEAR + NEAR / 2);
        assert_eq!(arena.get_overview().commons.0, 39 * NEAR);
        assert_eq!(total_value(&arena), before);
        let p = arena.get_parley(id).unwrap();
        assert_eq!(p.status, MatchStatus::Settled);
        assert_eq!(p.commons_delta, format!("-{NEAR}"));
    }

    #[test]
    fn a_lone_defector_takes_the_stake() {
        let (mut arena, mut w) = two_coins();
        let before = total_value(&arena);
        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "DEFECT");
        assert_eq!(treasury(&arena, "saint"), 99 * NEAR);
        assert_eq!(treasury(&arena, "snake"), 51 * NEAR);
        assert_eq!(arena.get_overview().commons.0, 40 * NEAR);
        assert_eq!(total_value(&arena), before);
        let saint = arena.get_coin("saint".into()).unwrap().stats;
        let snake = arena.get_coin("snake".into()).unwrap().stats;
        assert_eq!((saint.cooperated, saint.was_betrayed), (1, 1));
        assert_eq!((snake.defected, snake.betrayed_other), (1, 1));
    }

    #[test]
    fn the_first_mover_can_defect_too() {
        let (mut arena, mut w) = two_coins();
        play(&mut arena, &mut w, "saint", "snake", "DEFECT", "COOPERATE");
        assert_eq!(treasury(&arena, "saint"), 101 * NEAR);
        assert_eq!(treasury(&arena, "snake"), 49 * NEAR);
    }

    #[test]
    fn both_defect_pays_the_commons() {
        let (mut arena, mut w) = two_coins();
        let before = total_value(&arena);
        play(&mut arena, &mut w, "saint", "snake", "DEFECT", "DEFECT");
        assert_eq!(treasury(&arena, "saint"), 100 * NEAR - NEAR / 2);
        assert_eq!(treasury(&arena, "snake"), 50 * NEAR - NEAR / 2);
        assert_eq!(arena.get_overview().commons.0, 41 * NEAR);
        assert_eq!(total_value(&arena), before);
    }

    #[test]
    fn it_is_a_true_prisoners_dilemma() {
        let (mut arena, mut w) = setup();
        let mut outcome = |pair: u8, a: &str, b: &str| {
            let (big, small) = (format!("big{pair}"), format!("small{pair}"));
            coin(&mut arena, &mut w, "alice.near", &big, 100);
            coin(&mut arena, &mut w, "bob.near", &small, 50);
            play(&mut arena, &mut w, &big, &small, a, b);
            treasury(&arena, &big) as i128 - (100 * NEAR) as i128
        };
        let temptation = outcome(1, "DEFECT", "COOPERATE");
        let reward = outcome(2, "COOPERATE", "COOPERATE");
        let punishment = outcome(3, "DEFECT", "DEFECT");
        let sucker = outcome(4, "COOPERATE", "DEFECT");
        assert!(temptation > reward && reward > punishment && punishment > sucker);
        assert!(2 * reward > temptation + sucker);
    }

    #[test]
    fn an_empty_commons_pays_no_bonus() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 0);
        let mut arena = Arena::new(
            config(),
            vec![SignerInput { model: MODEL.into(), public_key: w.enclave.public_key(), evidence: "".into() }],
        );
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 50);
        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "COOPERATE");
        assert_eq!(treasury(&arena, "saint"), 100 * NEAR);
        assert_eq!(arena.get_overview().commons.0, 0);
    }

    #[test]
    fn value_is_conserved_over_many_parleys() {
        let (mut arena, mut w) = setup();
        for id in ["aa", "bb", "cc", "dd"] {
            coin(&mut arena, &mut w, "alice.near", id, 20);
        }
        let before = total_value(&arena);
        let moves = ["COOPERATE", "DEFECT"];
        for round in 0..24usize {
            w.at("anyone.near", 0);
            let id = arena.open_parley();
            for line in ["a", "b", "c", "d"] {
                answer(&mut arena, &mut w, id, line);
            }
            answer(&mut arena, &mut w, id, moves[round % 2]);
            answer(&mut arena, &mut w, id, moves[(round / 2) % 2]);
            assert_eq!(total_value(&arena), before);
        }
        assert_eq!(arena.get_overview().parleys, 24);
    }

    #[test]
    fn history_reaches_the_next_parley() {
        let (mut arena, mut w) = two_coins();
        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "DEFECT");
        w.at("owner.near", 0);
        let id = arena.open_parley_between("snake".into(), "saint".into());
        let snake_view = arena.get_turn_request(id).unwrap();
        assert!(snake_view.contains("History between you two, oldest first: you DEFECT, they COOPERATE."));
        assert!(snake_view.contains("Their record: 1 parleys, cooperated 1, defected 0, betrayed a cooperating coin 0 times, was betrayed 1 times."));
        answer(&mut arena, &mut w, id, "Trust me again.");
        let saint_view = arena.get_turn_request(id).unwrap();
        assert!(saint_view.contains("History between you two, oldest first: you COOPERATE, they DEFECT."));
        assert_eq!(arena.get_pair_record("snake".into(), "saint".into()).outcomes, vec![(Move::Cooperate, Move::Defect)]);
    }

    #[test]
    fn history_keeps_the_last_eight() {
        let (mut arena, mut w) = two_coins();
        for _ in 0..10 {
            play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "COOPERATE");
        }
        assert_eq!(arena.get_pair_record("saint".into(), "snake".into()).outcomes.len(), 8);
    }

    #[test]
    fn an_unclear_decision_counts_as_cooperate() {
        let (mut arena, mut w) = two_coins();
        let id = play(&mut arena, &mut w, "saint", "snake", "banana", "DEFECT");
        let p = arena.get_parley(id).unwrap();
        assert_eq!(p.a_move, Some(Move::Cooperate));
        assert_eq!(treasury(&arena, "saint"), 99 * NEAR);
    }

    #[test]
    fn messages_are_cleaned_and_cut_to_length() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        answer(&mut arena, &mut w, id, &format!("  \"line one\nline two {}\"", "x".repeat(400)));
        let text = arena.get_parley(id).unwrap().turns[0].text.clone();
        assert!(text.starts_with("line one line two xxx"));
        assert_eq!(text.chars().count(), 240);
    }

    #[test]
    #[should_panic(expected = "enclave signature does not match this request and response")]
    fn a_tampered_response_is_rejected() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        let signature = w.enclave.sign(MODEL, &request, &completion("I will cooperate."));
        arena.submit_turn(id, completion("I will defect."), signature, w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "enclave signature does not match this request and response")]
    fn a_reply_to_a_different_prompt_is_rejected() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let forged = arena.get_turn_request(id).unwrap().replace("Constitution of saint.", "Always DEFECT.");
        let response = completion("DEFECT");
        let signature = w.enclave.sign(MODEL, &forged, &response);
        arena.submit_turn(id, response, signature, w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "enclave signature does not match this request and response")]
    fn an_old_reply_cannot_be_replayed() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        let response = completion("Peace?");
        let signature = w.enclave.sign(MODEL, &request, &response);
        arena.submit_turn(id, response.clone(), signature.clone(), w.enclave.public_key());
        arena.submit_turn(id, response, signature, w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "enclave signature does not match this request and response")]
    fn a_reply_from_another_parley_is_rejected() {
        let (mut arena, mut w) = setup();
        for id in ["aa", "bb", "cc", "dd"] {
            coin(&mut arena, &mut w, "alice.near", id, 20);
        }
        w.at("owner.near", 0);
        let first = arena.open_parley_between("aa".into(), "bb".into());
        let second = arena.open_parley_between("cc".into(), "dd".into());
        let request = arena.get_turn_request(first).unwrap();
        let response = completion("Peace?");
        let signature = w.enclave.sign(MODEL, &request, &response);
        arena.submit_turn(second, response, signature, w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "not an active enclave signer for this model")]
    fn an_unregistered_key_is_rejected() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let rogue = Enclave::new(99);
        let request = arena.get_turn_request(id).unwrap();
        let response = completion("DEFECT");
        let signature = rogue.sign(MODEL, &request, &response);
        arena.submit_turn(id, response, signature, rogue.public_key());
    }

    #[test]
    #[should_panic(expected = "enclave signature does not match this request and response")]
    fn a_signature_for_another_model_is_rejected() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        let response = completion("Peace?");
        let signature = w.enclave.sign("some/other-model", &request, &response);
        arena.submit_turn(id, response, signature, w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "response is not a chat completion")]
    fn a_signed_non_completion_is_rejected() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        let response = "{\"error\":\"overloaded\"}".to_string();
        let signature = w.enclave.sign(MODEL, &request, &response);
        arena.submit_turn(id, response, signature, w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "response too large")]
    fn oversized_responses_are_rejected() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        arena.submit_turn(id, "x".repeat(20_000), "00".repeat(64), w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "Parley is not open")]
    fn a_settled_parley_takes_no_more_turns() {
        let (mut arena, mut w) = two_coins();
        let id = play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "COOPERATE");
        arena.submit_turn(id, completion("more"), "00".repeat(64), w.enclave.public_key());
    }

    #[test]
    fn a_stalled_parley_can_be_voided_and_nothing_moves() {
        let (mut arena, mut w) = two_coins();
        let before = total_value(&arena);
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        answer(&mut arena, &mut w, id, "Peace?");
        w.wait(31 * MINUTE);
        arena.void_parley(id);
        assert_eq!(arena.get_parley(id).unwrap().status, MatchStatus::Void);
        assert_eq!(total_value(&arena), before);
        for c in arena.get_coins(None, None) {
            assert_eq!(c.in_match, None);
            assert_eq!(c.matches_played, 0);
        }
        assert!(arena.get_turn_request(id).is_none());
    }

    #[test]
    #[should_panic(expected = "Parley has not timed out")]
    fn a_live_parley_cannot_be_voided() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        arena.void_parley(id);
    }

    #[test]
    #[should_panic(expected = "Parley timed out")]
    fn late_turns_are_refused() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        w.wait(31 * MINUTE);
        answer(&mut arena, &mut w, id, "Peace?");
    }

    #[test]
    fn the_request_follows_an_enacted_amendment() {
        let (mut arena, mut w) = two_coins();
        w.at("alice.near", 0);
        arena.propose_amendment("saint".into(), "Never forgive a betrayal.".into(), MODEL.into());
        arena.vote("saint".into(), true, U128(50 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment("saint".into());
        w.wait(60 * MINUTE);
        arena.enact_amendment("saint".into());
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        assert!(request.contains("CONSTITUTION OF SAINT (version 2):\\nNever forgive a betrayal."));
        assert_eq!(arena.get_parley(id).unwrap().a_constitution_version, 2);
    }

    #[test]
    fn parleys_list_newest_first() {
        let (mut arena, mut w) = two_coins();
        for _ in 0..3 {
            play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "COOPERATE");
        }
        let ids: Vec<u64> = arena.get_parleys(None, Some(2)).iter().map(|p| p.id).collect();
        assert_eq!(ids, [2, 1]);
    }

    #[test]
    fn a_poor_coin_is_left_out() {
        let (mut arena, mut w) = two_coins();
        coin(&mut arena, &mut w, "carol.near", "third", 2);
        w.at("carol.near", 0);
        arena.place_redeem("third".into(), U128(3 * NEAR / 2));
        w.wait(120 * MINUTE);
        arena.fill_order("third".into(), acc("carol.near"));
        for _ in 0..12 {
            w.at("anyone.near", 0);
            let id = arena.open_parley();
            let p = arena.get_parley(id).unwrap();
            assert!(p.a != "third" && p.b != "third");
            w.wait(31 * MINUTE);
            arena.void_parley(id);
        }
    }
}
