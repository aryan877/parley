use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

use crate::types::*;
use crate::verify::{signed_text, to_hex};
use crate::{Arena, ModelInput, SignerInput};

const NEAR: u128 = 10u128.pow(24);
const MODEL: &str = "z-ai/glm-5.3-flash";
const MINUTE: u64 = 60 * 1_000_000_000;
const TIMELOCK: u64 = 180 * MINUTE;

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
                .account_balance(NearToken::from_near(1_000_000))
                .block_timestamp(self.now)
                .random_seed([self.seed; 32])
                .build()
        );
    }

    /// Enters a callback of the arena itself, with the result of the promise it waited on.
    fn callback(&mut self, result: near_sdk::PromiseResult) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acc("arena.near"))
                .predecessor_account_id(acc("arena.near"))
                .block_timestamp(self.now)
                .build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            vec![result],
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
        min_treasury: U128(NEAR),
        match_timeout_ns: U64(30 * MINUTE),
        order_timeout_ns: U64(60 * MINUTE),
        vote_period_ns: U64(60 * MINUTE),
        timelock_ns: U64(TIMELOCK),
        quorum_bps: 2_000,
        proposer_bps: 100,
        signer_delay_ns: U64(24 * 60 * MINUTE),
        rest_ns: U64(0),
        pair_rest_ns: U64(0),
        creation_fee: U128(0),
    }
}

fn signer(public_key: String) -> SignerInput {
    SignerInput { public_key, evidence: "sha256:test".into() }
}

fn model(id: &str, public_key: String) -> ModelInput {
    ModelInput { id: id.into(), max_tokens_talk: 160, max_tokens_decide: 16, options: String::new(), signers: vec![signer(public_key)] }
}

fn setup() -> (Arena, World) {
    let mut w = World { now: 1_000 * MINUTE, seed: 0, enclave: Enclave::new(7) };
    w.at("owner.near", 40 * NEAR);
    let arena = Arena::new(config(), vec![model(MODEL, w.enclave.public_key())]);
    (arena, w)
}

fn two_coins_anywhere() -> (Arena, World) {
    let (mut arena, mut w) = setup();
    coin(&mut arena, &mut w, "alice.near", "saint", 100);
    coin(&mut arena, &mut w, "bob.near", "snake", 50);
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
        Arena::new(config(), vec![model(MODEL, "abcd".into())]);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn only_the_owner_adds_signers() {
        let (mut arena, mut w) = setup();
        w.at("mallory.near", 0);
        arena.propose_signer(MODEL.into(), signer(Enclave::new(9).public_key()));
    }

    #[test]
    #[should_panic(expected = "signer already registered")]
    fn a_key_registers_once() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 0);
        let public_key = w.enclave.public_key();
        arena.propose_signer(MODEL.into(), signer(public_key));
    }

    #[test]
    #[should_panic(expected = "not an active enclave signer for this model")]
    fn a_new_signer_waits_out_the_delay() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        let late = Enclave::new(9);
        w.at("owner.near", 0);
        arena.propose_signer(MODEL.into(), signer(late.public_key()));
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
        arena.propose_signer(MODEL.into(), signer(late.public_key()));
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
    fn model_options_are_appended_to_the_request() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 0);
        let quiet = ModelInput {
            options: r#"{ "chat_template_kwargs": { "enable_thinking": false } }"#.into(),
            max_tokens_talk: 200,
            max_tokens_decide: 24,
            ..model(MODEL, w.enclave.public_key())
        };
        let mut arena = Arena::new(config(), vec![quiet]);
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 50);
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        assert!(request.ends_with(r#""stream":false,"chat_template_kwargs":{"enable_thinking":false}}"#));
        let body: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&request).unwrap();
        assert_eq!(body["chat_template_kwargs"]["enable_thinking"], false);
        assert_eq!(body["max_tokens"], 200);
        assert_eq!(arena.get_models()[0].options, r#"{"chat_template_kwargs":{"enable_thinking":false}}"#);
        answer(&mut arena, &mut w, id, "Peace?");
        assert_eq!(arena.get_parley(id).unwrap().turns.len(), 1);
    }

    #[test]
    #[should_panic(expected = "options cannot replace a field the contract writes")]
    fn options_cannot_override_the_request() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 0);
        Arena::new(config(), vec![ModelInput { options: r#"{"messages":[]}"#.into(), ..model(MODEL, w.enclave.public_key()) }]);
    }

    #[test]
    #[should_panic(expected = "options must be a JSON object")]
    fn options_must_be_an_object() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 0);
        Arena::new(config(), vec![ModelInput { options: "[1]".into(), ..model(MODEL, w.enclave.public_key()) }]);
    }

    #[test]
    #[should_panic(expected = "model already registered")]
    fn a_model_registers_once() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 0);
        arena.propose_model(model(MODEL, Enclave::new(9).public_key()));
    }

    #[test]
    #[should_panic(expected = "model is not registered")]
    fn a_signer_needs_a_registered_model() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 0);
        arena.propose_signer("some/other-model".into(), signer(Enclave::new(9).public_key()));
    }

    #[test]
    #[should_panic(expected = "model has no active enclave key yet")]
    fn a_new_model_waits_out_the_delay() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 0);
        arena.propose_model(model("some/other-model", Enclave::new(9).public_key()));
        w.at("alice.near", 100 * NEAR);
        arena.create_coin("saint".into(), "SAINT".into(), "Be kind.".into(), "some/other-model".into());
    }

    #[test]
    fn a_new_model_counts_after_the_delay() {
        let (mut arena, mut w) = setup();
        let other = Enclave::new(9);
        w.at("owner.near", 0);
        arena.propose_model(model("some/other-model", other.public_key()));
        w.wait(24 * 60 * MINUTE);
        w.at("alice.near", 100 * NEAR);
        arena.create_coin("saint".into(), "SAINT".into(), "Be kind.".into(), "some/other-model".into());
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request = arena.get_turn_request(id).unwrap();
        assert!(request.contains(r#""model":"some/other-model""#));
        let response = completion("hello");
        let signature = other.sign("some/other-model", &request, &response);
        arena.submit_turn(id, response, signature, other.public_key());
        assert_eq!(arena.get_parley(id).unwrap().turns.len(), 1);
    }

    #[test]
    #[should_panic(expected = "not an active enclave signer for this model")]
    fn a_retired_key_stops_counting_after_the_delay() {
        let (mut arena, mut w) = two_coins_anywhere();
        w.at("owner.near", 0);
        arena.retire_signer(MODEL.into(), w.enclave.public_key());
        let id = arena.open_parley_between("saint".into(), "snake".into());
        answer(&mut arena, &mut w, id, "still counts during the delay");
        assert_eq!(arena.get_parley(id).unwrap().turns.len(), 1);
        w.wait(24 * 60 * MINUTE);
        w.at("owner.near", 0);
        arena.void_parley(id);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        answer(&mut arena, &mut w, id, "too late");
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn only_the_owner_retires_signers() {
        let (mut arena, mut w) = setup();
        w.at("mallory.near", 0);
        arena.retire_signer(MODEL.into(), w.enclave.public_key());
    }

    #[test]
    #[should_panic(expected = "timelock_ns must cover vote_period_ns plus twice order_timeout_ns")]
    fn the_exit_window_must_fit_inside_the_timelock() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(1) };
        w.at("owner.near", 0);
        Arena::new(Config { timelock_ns: U64(179 * MINUTE), ..config() }, vec![]);
    }

    #[test]
    fn two_models_can_meet_in_one_parley() {
        let mut w = World { now: 1_000 * MINUTE, seed: 0, enclave: Enclave::new(7) };
        let other = Enclave::new(9);
        w.at("owner.near", 40 * NEAR);
        let thinker = ModelInput { max_tokens_decide: 900, ..model("some/thinker", other.public_key()) };
        let mut arena = Arena::new(config(), vec![model(MODEL, w.enclave.public_key()), thinker]);
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("bob.near", 100 * NEAR);
        arena.create_coin("snake".into(), "SNAKE".into(), "Win.".into(), "some/thinker".into());
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        for (i, line) in ["hello", "hi", "deal?", "deal", "COOPERATE", "DEFECT"].iter().enumerate() {
            let request = arena.get_turn_request(id).unwrap();
            let response = completion(line);
            let (enclave, model_id) = if i % 2 == 0 { (&w.enclave, MODEL) } else { (&other, "some/thinker") };
            assert!(request.contains(&format!(r#""model":"{model_id}""#)));
            if i == 5 {
                assert!(request.contains(r#""max_tokens":900"#));
            }
            let signature = enclave.sign(model_id, &request, &response);
            let key = enclave.public_key();
            w.at("relayer.near", 0);
            arena.submit_turn(id, response, signature, key);
        }
        let p = arena.get_parley(id).unwrap();
        assert_eq!((p.a_move, p.b_move), (Some(Move::Cooperate), Some(Move::Defect)));
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn renouncing_ends_the_owner_role() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 0);
        arena.renounce_ownership();
        assert_eq!(arena.get_overview().owner, None);
        arena.propose_signer(MODEL.into(), signer(Enclave::new(9).public_key()));
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
    #[should_panic(expected = "model is not registered")]
    fn the_model_must_be_registered() {
        let (mut arena, mut w) = setup();
        w.at("alice.near", 10 * NEAR);
        arena.create_coin("saint".into(), "SAINT".into(), "Be kind.".into(), "anthropic/claude".into());
    }

    #[test]
    #[should_panic(expected = "coin name taken")]
    fn names_are_unique_whatever_the_case() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 10);
        w.at("mallory.near", 10 * NEAR);
        arena.create_coin("saint2".into(), "Saint".into(), "Pretend to be the other coin.".into(), MODEL.into());
    }

    #[test]
    fn the_creation_fee_goes_to_the_commons() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 40 * NEAR);
        let mut arena = Arena::new(Config { creation_fee: U128(2 * NEAR), ..config() }, vec![model(MODEL, w.enclave.public_key())]);
        coin(&mut arena, &mut w, "alice.near", "saint", 12);
        let c = arena.get_coin("saint".into()).unwrap();
        assert_eq!(c.treasury.0, 10 * NEAR);
        assert_eq!(c.total_shares.0, 10 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 10 * NEAR);
        assert_eq!(arena.get_overview().commons.0, 42 * NEAR);
        assert_eq!(total_value(&arena), 52 * NEAR);
    }

    #[test]
    #[should_panic(expected = "deposit below min_treasury plus the creation fee")]
    fn the_fee_comes_on_top_of_the_minimum_treasury() {
        let mut w = World { now: 0, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 0);
        let mut arena = Arena::new(Config { creation_fee: U128(2 * NEAR), ..config() }, vec![model(MODEL, w.enclave.public_key())]);
        coin(&mut arena, &mut w, "alice.near", "saint", 2);
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
            vec![model(MODEL, w.enclave.public_key())],
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
        arena.place_mint("saint".into(), None);
        arena.fill_order("saint".into(), acc("carol.near"));
    }

    #[test]
    fn a_mint_fills_at_the_price_after_the_next_parley() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into(), None);
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
        arena.place_mint("snake".into(), None);
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
        arena.place_mint("saint".into(), None);
        w.wait(60 * MINUTE);
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
        arena.place_mint("saint".into(), None);
        w.wait(60 * MINUTE);
        w.at("owner.near", 0);
        arena.open_parley_between("saint".into(), "snake".into());
        arena.fill_order("saint".into(), acc("carol.near"));
    }

    #[test]
    fn cancelling_a_mint_returns_the_deposit() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into(), None);
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
        arena.place_redeem("saint".into(), U128(25 * NEAR), None);
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
        arena.place_redeem("saint".into(), U128(25 * NEAR), None);
        arena.cancel_order("saint".into());
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 100 * NEAR);
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn cannot_redeem_more_than_held() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("alice.near", 0);
        arena.place_redeem("saint".into(), U128(101 * NEAR), None);
    }

    #[test]
    #[should_panic(expected = "you already have an open order on this coin")]
    fn one_open_order_per_account() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", NEAR);
        arena.place_mint("saint".into(), None);
        arena.place_mint("saint".into(), None);
    }

    #[test]
    fn shares_can_be_sent_to_another_account() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("alice.near", 0);
        arena.transfer_shares("saint".into(), acc("bob.near"), U128(30 * NEAR));
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 70 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("bob.near")).0, 30 * NEAR);
        assert_eq!(arena.get_coin("saint".into()).unwrap().total_shares.0, 100 * NEAR);
        w.at("bob.near", 0);
        arena.place_redeem("saint".into(), U128(30 * NEAR), None);
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn cannot_send_more_shares_than_held() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("alice.near", 0);
        arena.transfer_shares("saint".into(), acc("bob.near"), U128(101 * NEAR));
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn shares_locked_in_a_vote_cannot_be_sent() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("alice.near", 0);
        let id = arena.propose_amendment("saint".into(), "Always defect.".into(), MODEL.into());
        arena.vote(id, true, U128(99 * NEAR));
        arena.transfer_shares("saint".into(), acc("bob.near"), U128(NEAR));
    }

    #[test]
    fn a_mint_below_the_buyers_minimum_is_returned() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into(), Some(U128(10 * NEAR)));
        play(&mut arena, &mut w, "saint", "snake", "DEFECT", "COOPERATE");
        w.at("anyone.near", 0);
        arena.fill_order("saint".into(), acc("carol.near"));
        assert_eq!(arena.get_shares("saint".into(), acc("carol.near")).0, 0);
        assert!(arena.get_order("saint".into(), acc("carol.near")).is_none());
        assert_eq!(arena.get_overview().escrow.0, 0);
        assert_eq!(treasury(&arena, "saint"), 102 * NEAR);
    }

    #[test]
    fn a_redeem_below_the_sellers_minimum_is_returned() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("alice.near", 0);
        arena.place_redeem("saint".into(), U128(50 * NEAR), Some(U128(50 * NEAR)));
        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "DEFECT");
        w.at("anyone.near", 0);
        arena.fill_order("saint".into(), acc("alice.near"));
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 100 * NEAR);
        assert_eq!(treasury(&arena, "saint"), 98 * NEAR);
    }

    #[test]
    fn a_mint_that_would_buy_no_share_is_returned() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        play(&mut arena, &mut w, "saint", "snake", "DEFECT", "COOPERATE");
        w.at("dust.near", 1);
        arena.place_mint("saint".into(), None);
        w.wait(60 * MINUTE);
        arena.fill_order("saint".into(), acc("dust.near"));
        assert_eq!(treasury(&arena, "saint"), 102 * NEAR);
        assert_eq!(arena.get_coin("saint".into()).unwrap().total_shares.0, 100 * NEAR);
        assert_eq!(arena.get_overview().escrow.0, 0);
    }

    #[test]
    fn a_redeem_cannot_leave_a_sliver_of_shares() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "mallory.near", "evil", 100);
        w.at("mallory.near", 0);
        arena.place_redeem("evil".into(), U128(100 * NEAR - 1), None);
        w.wait(60 * MINUTE);
        arena.fill_order("evil".into(), acc("mallory.near"));
        assert_eq!(arena.get_coin("evil".into()).unwrap().total_shares.0, crate::MIN_SHARES);
        assert_eq!(arena.get_shares("evil".into(), acc("mallory.near")).0, crate::MIN_SHARES);

        w.at("mallory.near", 0);
        arena.place_redeem("evil".into(), U128(crate::MIN_SHARES), None);
        w.wait(60 * MINUTE);
        arena.fill_order("evil".into(), acc("mallory.near"));
        let c = arena.get_coin("evil".into()).unwrap();
        assert_eq!((c.total_shares.0, c.treasury.0), (0, 0));
    }

    #[test]
    fn a_dust_holder_cannot_bounce_a_full_redeem() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("alice.near", 0);
        arena.transfer_shares("saint".into(), acc("mallory.near"), U128(1));
        arena.place_redeem("saint".into(), U128(100 * NEAR - 1), None);
        w.wait(60 * MINUTE);
        arena.fill_order("saint".into(), acc("alice.near"));
        let c = arena.get_coin("saint".into()).unwrap();
        assert_eq!(c.total_shares.0, crate::MIN_SHARES);
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, crate::MIN_SHARES - 1);
        assert_eq!(c.treasury.0, crate::MIN_SHARES);
    }

    #[test]
    fn the_share_price_cannot_be_inflated_against_a_buyer() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "mallory.near", "evil", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        play(&mut arena, &mut w, "evil", "snake", "DEFECT", "COOPERATE");
        w.at("mallory.near", 0);
        arena.place_redeem("evil".into(), U128(100 * NEAR - 1), None);
        for i in 0..8u32 {
            w.at(&format!("dust{i}.near"), 1 << i);
            arena.place_mint("evil".into(), None);
        }
        w.at("victim.near", 10 * NEAR);
        arena.place_mint("evil".into(), None);
        w.wait(60 * MINUTE);
        arena.fill_order("evil".into(), acc("mallory.near"));
        for i in 0..8u32 {
            arena.fill_order("evil".into(), acc(&format!("dust{i}.near")));
        }
        arena.fill_order("evil".into(), acc("victim.near"));
        let c = arena.get_coin("evil".into()).unwrap();
        let held = arena.get_shares("evil".into(), acc("victim.near")).0;
        let worth = crate::math::mul_div(held, c.treasury.0, c.total_shares.0);
        assert!(worth > 10 * NEAR - 1_000, "the buyer keeps what they paid, got {worth}");
        assert_eq!(arena.get_overview().escrow.0, 0);
    }

    #[test]
    #[should_panic(expected = "house coins have no shares")]
    fn house_coins_take_no_orders() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 10 * NEAR);
        arena.create_house_coin("titfortat".into(), "TIT FOR TAT".into(), "Mirror.".into(), MODEL.into());
        w.at("carol.near", NEAR);
        arena.place_mint("titfortat".into(), None);
    }
}

mod governance {
    use super::*;

    fn propose(arena: &mut Arena, w: &mut World, text: &str) -> u32 {
        w.at("alice.near", 0);
        arena.propose_amendment("saint".into(), text.into(), MODEL.into())
    }

    fn with_two_holders() -> (Arena, World) {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        w.at("carol.near", 100 * NEAR);
        arena.place_mint("saint".into(), None);
        w.wait(60 * MINUTE);
        arena.fill_order("saint".into(), acc("carol.near"));
        (arena, w)
    }

    #[test]
    fn a_passed_amendment_replaces_the_constitution_after_the_timelock() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, true, U128(30 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);
        assert_eq!(arena.get_amendment(id).unwrap().status, AmendmentStatus::Passed);
        w.wait(TIMELOCK);
        arena.enact_amendment(id);
        let c = arena.get_coin("saint".into()).unwrap();
        assert_eq!(c.constitution, "Never forgive.");
        assert_eq!(c.constitution_version, 2);
        assert_eq!(c.treasury.0, 100 * NEAR);
        assert!(c.amendments.is_empty());
        assert!(arena.get_amendment(id).is_none());
    }

    #[test]
    fn proposing_locks_the_proposers_stake_as_yes_votes() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        let a = arena.get_amendment(id).unwrap();
        assert_eq!((a.yes.0, a.no.0), (NEAR, 0));
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 99 * NEAR);
        assert_eq!(arena.get_vote("saint".into(), acc("alice.near")).unwrap().locked.0, NEAR);
        assert_eq!(arena.get_amendments("saint".into()).len(), 1);
    }

    #[test]
    #[should_panic(expected = "timelock is still running")]
    fn the_timelock_cannot_be_skipped() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, true, U128(30 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);
        arena.enact_amendment(id);
    }

    #[test]
    fn a_vote_below_quorum_is_rejected_and_forgotten() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, true, U128(18 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);
        assert!(arena.get_amendment(id).is_none());
        assert!(arena.get_coin("saint".into()).unwrap().amendments.is_empty());
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution_version, 1);
    }

    #[test]
    #[should_panic(expected = "no such amendment")]
    fn a_rejected_amendment_cannot_be_enacted() {
        let (mut arena, mut w) = with_two_holders();
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, true, U128(39 * NEAR));
        w.at("carol.near", 0);
        arena.vote(id, false, U128(60 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);
        w.wait(TIMELOCK);
        arena.enact_amendment(id);
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
    fn a_holder_cannot_keep_others_from_proposing() {
        let (mut arena, mut w) = with_two_holders();
        for round in 0..3 {
            let junk = propose(&mut arena, &mut w, &format!("Junk {round}."));
            w.at("carol.near", 0);
            let real = arena.propose_amendment("saint".into(), format!("Mirror, take {round}."), MODEL.into());
            arena.vote(real, true, U128(60 * NEAR));
            w.wait(60 * MINUTE);
            arena.finalize_amendment(junk);
            arena.finalize_amendment(real);
            assert!(arena.get_amendment(junk).is_none());
            assert_eq!(arena.get_amendment(real).unwrap().status, AmendmentStatus::Passed);
            w.wait(TIMELOCK);
            arena.enact_amendment(real);
            w.at("carol.near", 0);
            arena.release_votes("saint".into());
        }
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution, "Mirror, take 2.");
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution_version, 4);
    }

    #[test]
    #[should_panic(expected = "you already have an open amendment on this coin")]
    fn one_open_proposal_per_account() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        propose(&mut arena, &mut w, "Never forgive.");
        propose(&mut arena, &mut w, "Always forgive.");
    }

    #[test]
    #[should_panic(expected = "too many amendments are open on this coin")]
    fn open_amendments_are_bounded() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        for i in 0..17 {
            let holder = format!("holder{i}.near");
            w.at("alice.near", 0);
            arena.transfer_shares("saint".into(), acc(&holder), U128(2 * NEAR));
            w.at(&holder, 0);
            arena.propose_amendment("saint".into(), format!("Rule {i}."), MODEL.into());
        }
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn locked_votes_cannot_be_redeemed() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, true, U128(80 * NEAR));
        arena.place_redeem("saint".into(), U128(30 * NEAR), None);
    }

    #[test]
    #[should_panic(expected = "you already voted the other way")]
    fn a_voter_cannot_back_both_sides() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, false, U128(10 * NEAR));
    }

    #[test]
    #[should_panic(expected = "voting is closed")]
    fn late_votes_do_not_count() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        w.wait(60 * MINUTE);
        w.at("alice.near", 0);
        arena.vote(id, true, U128(10 * NEAR));
    }

    #[test]
    fn votes_unlock_once_the_vote_is_closed() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, true, U128(29 * NEAR));
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 70 * NEAR);
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);
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
        arena.release_votes("saint".into());
    }

    #[test]
    fn a_finished_vote_frees_the_shares_for_the_next_one() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let first = propose(&mut arena, &mut w, "Never forgive.");
        w.wait(60 * MINUTE);
        arena.finalize_amendment(first);
        let second = propose(&mut arena, &mut w, "Always forgive.");
        arena.vote(second, true, U128(50 * NEAR));
        assert_eq!(arena.get_amendment(second).unwrap().yes.0, 51 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 49 * NEAR);
    }

    #[test]
    fn the_same_shares_vote_on_every_open_amendment() {
        let (mut arena, mut w) = with_two_holders();
        let mut hostile = Vec::new();
        for i in 0..4 {
            let proposer = format!("p{i}.near");
            w.at("alice.near", 0);
            arena.transfer_shares("saint".into(), acc(&proposer), U128(2 * NEAR));
            w.at(&proposer, 0);
            hostile.push(arena.propose_amendment("saint".into(), format!("Hostile {i}."), MODEL.into()));
        }
        w.at("alice.near", 0);
        arena.transfer_shares("saint".into(), acc("q.near"), U128(38 * NEAR));
        w.at("carol.near", 0);
        for id in &hostile {
            arena.vote(*id, false, U128(100 * NEAR));
        }
        assert_eq!(arena.get_shares("saint".into(), acc("carol.near")).0, 0);
        assert_eq!(arena.get_vote("saint".into(), acc("carol.near")).unwrap().locked.0, 100 * NEAR);
        w.at("q.near", 0);
        arena.vote(hostile[3], true, U128(38 * NEAR));
        w.wait(60 * MINUTE);
        for id in &hostile {
            arena.finalize_amendment(*id);
            assert!(arena.get_amendment(*id).is_none(), "the majority's no counted on every amendment");
        }
        w.at("carol.near", 0);
        assert_eq!(arena.release_votes("saint".into()).0, 100 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("carol.near")).0, 100 * NEAR);
    }

    #[test]
    fn the_lock_is_the_largest_open_ballot() {
        let (mut arena, mut w) = with_two_holders();
        let first = propose(&mut arena, &mut w, "Never forgive.");
        w.wait(30 * MINUTE);
        w.at("carol.near", 0);
        let second = arena.propose_amendment("saint".into(), "Always forgive.".into(), MODEL.into());
        arena.vote(first, false, U128(70 * NEAR));
        arena.vote(second, true, U128(28 * NEAR));
        assert_eq!(arena.get_vote("saint".into(), acc("carol.near")).unwrap().locked.0, 70 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("carol.near")).0, 30 * NEAR);
        w.wait(30 * MINUTE);
        arena.finalize_amendment(first);
        w.at("carol.near", 0);
        assert_eq!(arena.release_votes("saint".into()).0, 40 * NEAR);
        assert_eq!(arena.get_vote("saint".into(), acc("carol.near")).unwrap().locked.0, 30 * NEAR);
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn a_ballot_cannot_exceed_what_the_voter_owns() {
        let (mut arena, mut w) = with_two_holders();
        let id = propose(&mut arena, &mut w, "Never forgive.");
        w.at("carol.near", 0);
        arena.vote(id, false, U128(60 * NEAR));
        arena.vote(id, false, U128(41 * NEAR));
    }

    #[test]
    fn an_amendment_lapses_when_the_constitution_moved_on() {
        let (mut arena, mut w) = with_two_holders();
        let old = propose(&mut arena, &mut w, "Always cooperate.");
        arena.vote(old, true, U128(90 * NEAR));
        w.at("carol.near", 0);
        let newer = arena.propose_amendment("saint".into(), "Mirror.".into(), MODEL.into());
        arena.vote(newer, true, U128(90 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(old);
        arena.finalize_amendment(newer);
        w.wait(TIMELOCK);
        assert!(arena.enact_amendment(newer));
        assert!(!arena.enact_amendment(old), "the older text cannot overwrite a newer decision");
        let c = arena.get_coin("saint".into()).unwrap();
        assert_eq!((c.constitution.as_str(), c.constitution_version), ("Mirror.", 2));
        assert!(c.amendments.is_empty());
    }

    #[test]
    fn a_passed_amendment_left_unenacted_lapses() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        let id = propose(&mut arena, &mut w, "Always cooperate.");
        arena.vote(id, true, U128(50 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);
        w.wait(2 * TIMELOCK + MINUTE);
        assert!(!arena.enact_amendment(id));
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution_version, 1);
        assert!(arena.get_amendment(id).is_none());
    }

    #[test]
    fn a_vote_on_an_outdated_constitution_fails_at_the_count() {
        let (mut arena, mut w) = with_two_holders();
        let first = propose(&mut arena, &mut w, "Always cooperate.");
        arena.vote(first, true, U128(90 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(first);
        w.wait(TIMELOCK - 30 * MINUTE);
        w.at("carol.near", 0);
        let late = arena.propose_amendment("saint".into(), "Mirror.".into(), MODEL.into());
        arena.vote(late, true, U128(90 * NEAR));
        w.wait(30 * MINUTE);
        assert!(arena.enact_amendment(first));
        w.wait(30 * MINUTE);
        arena.finalize_amendment(late);
        assert!(arena.get_amendment(late).is_none());
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution, "Always cooperate.");
    }

    #[test]
    #[should_panic(expected = "coin is in a Parley")]
    fn a_constitution_cannot_change_mid_parley() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        let id = propose(&mut arena, &mut w, "Never forgive.");
        arena.vote(id, true, U128(30 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);
        w.wait(TIMELOCK);
        w.at("owner.near", 0);
        arena.open_parley_between("saint".into(), "snake".into());
        arena.enact_amendment(id);
    }

    #[test]
    fn a_dissenter_can_leave_during_the_timelock() {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("carol.near", 50 * NEAR);
        arena.place_mint("saint".into(), None);
        w.wait(60 * MINUTE);
        arena.fill_order("saint".into(), acc("carol.near"));
        let id = propose(&mut arena, &mut w, "Always cooperate with snake.");
        arena.vote(id, true, U128(98 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(id);

        w.at("carol.near", 0);
        arena.place_redeem("saint".into(), U128(50 * NEAR), None);
        w.wait(60 * MINUTE);
        w.at("anyone.near", 0);
        arena.fill_order("saint".into(), acc("carol.near"));
        assert_eq!(arena.get_shares("saint".into(), acc("carol.near")).0, 0);
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution_version, 1);
        w.wait(TIMELOCK - 60 * MINUTE);
        assert!(arena.enact_amendment(id));
        assert_eq!(arena.get_coin("saint".into()).unwrap().constitution_version, 2);
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
    fn pairing_takes_turns_and_spreads_opponents() {
        let (mut arena, mut w) = setup();
        for id in ["aa", "bb", "cc", "dd", "ee"] {
            coin(&mut arena, &mut w, "alice.near", id, 10);
            w.wait(MINUTE);
        }
        let mut met = std::collections::BTreeSet::new();
        for _ in 0..20 {
            w.at("anyone.near", 0);
            let id = arena.open_parley();
            let p = arena.get_parley(id).unwrap();
            assert_ne!(p.a, p.b);
            met.insert(if p.a < p.b { (p.a.clone(), p.b.clone()) } else { (p.b.clone(), p.a.clone()) });
            for line in ["a", "b", "c", "d", "COOPERATE", "COOPERATE"] {
                answer(&mut arena, &mut w, id, line);
            }
            w.wait(MINUTE);
        }
        assert_eq!(met.len(), 10, "every pair has met");
        for c in arena.get_coins(None, None) {
            assert!((7..=9).contains(&c.matches_played), "{} played {} of 20", c.id, c.matches_played);
        }
    }

    #[test]
    fn the_coin_that_rested_longest_goes_first() {
        let (mut arena, mut w) = setup();
        for id in ["cc", "aa", "bb"] {
            coin(&mut arena, &mut w, "alice.near", id, 10);
            w.wait(MINUTE);
        }
        w.at("anyone.near", 0);
        let id = arena.open_parley();
        let p = arena.get_parley(id).unwrap();
        assert_eq!((p.a.as_str(), p.b.as_str()), ("cc", "aa"));
    }

    #[test]
    fn voided_coins_go_to_the_back_of_the_line() {
        let (mut arena, mut w) = setup();
        for id in ["aa", "bb", "cc", "dd"] {
            coin(&mut arena, &mut w, "alice.near", id, 10);
        }
        let mut seen = std::collections::BTreeSet::new();
        for _ in 0..12 {
            w.at("anyone.near", 0);
            let id = arena.open_parley();
            let p = arena.get_parley(id).unwrap();
            seen.insert((p.a.clone(), p.b.clone()));
            w.wait(31 * MINUTE);
            arena.void_parley(id);
            for c in ["aa", "bb", "cc", "dd"] {
                assert_eq!(arena.get_coin(c.into()).unwrap().in_match, None);
            }
        }
        assert!(seen.len() > 1, "voided coins go to the back of the line");
    }

    #[test]
    #[should_panic(expected = "no two rested coins are ready to meet")]
    fn a_coin_rests_before_it_can_be_drawn_again() {
        let mut w = World { now: 1_000 * MINUTE, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 40 * NEAR);
        let mut arena = Arena::new(Config { rest_ns: U64(5 * MINUTE), ..config() }, vec![model(MODEL, w.enclave.public_key())]);
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 50);
        w.wait(5 * MINUTE);
        let id = arena.open_parley();
        w.wait(31 * MINUTE);
        arena.void_parley(id);
        w.wait(4 * MINUTE);
        arena.open_parley();
    }

    #[test]
    fn resting_coins_can_fill_orders_and_then_play_again() {
        let mut w = World { now: 1_000 * MINUTE, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 40 * NEAR);
        let mut arena = Arena::new(Config { rest_ns: U64(5 * MINUTE), ..config() }, vec![model(MODEL, w.enclave.public_key())]);
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 50);
        w.at("carol.near", 10 * NEAR);
        arena.place_mint("saint".into(), None);
        w.wait(5 * MINUTE);
        let id = arena.open_parley();
        for line in ["a", "b", "c", "d", "COOPERATE", "COOPERATE"] {
            answer(&mut arena, &mut w, id, line);
        }
        w.at("anyone.near", 0);
        arena.fill_order("saint".into(), acc("carol.near"));
        assert!(arena.get_shares("saint".into(), acc("carol.near")).0 > 0);
        w.wait(5 * MINUTE);
        assert_eq!(arena.open_parley(), id + 1);
    }

    fn paced(rest: u64, pair_rest: u64) -> (Arena, World) {
        let mut w = World { now: 1_000 * MINUTE, seed: 0, enclave: Enclave::new(7) };
        w.at("owner.near", 40 * NEAR);
        let arena = Arena::new(
            Config { rest_ns: U64(rest), pair_rest_ns: U64(pair_rest), ..config() },
            vec![model(MODEL, w.enclave.public_key())],
        );
        (arena, w)
    }

    fn cooperate(arena: &mut Arena, w: &mut World, id: u64) {
        for line in ["a", "b", "c", "d", "COOPERATE", "COOPERATE"] {
            answer(arena, w, id, line);
        }
    }

    #[test]
    #[should_panic(expected = "no two rested coins are ready to meet")]
    fn two_coins_cannot_meet_again_straight_away() {
        let (mut arena, mut w) = paced(MINUTE, 30 * MINUTE);
        coin(&mut arena, &mut w, "mallory.near", "aa", 100);
        coin(&mut arena, &mut w, "mallory.near", "bb", 100);
        w.wait(30 * MINUTE);
        let id = arena.open_parley();
        cooperate(&mut arena, &mut w, id);
        w.wait(29 * MINUTE);
        arena.open_parley();
    }

    #[test]
    fn a_pair_meets_again_once_it_has_waited() {
        let (mut arena, mut w) = paced(MINUTE, 30 * MINUTE);
        coin(&mut arena, &mut w, "mallory.near", "aa", 100);
        coin(&mut arena, &mut w, "mallory.near", "bb", 100);
        w.wait(30 * MINUTE);
        let id = arena.open_parley();
        cooperate(&mut arena, &mut w, id);
        w.wait(30 * MINUTE);
        assert_eq!(arena.open_parley(), id + 1);
    }

    #[test]
    fn a_new_coin_cannot_jump_the_line() {
        let (mut arena, mut w) = paced(MINUTE, 30 * MINUTE);
        for id in ["aa", "bb", "cc"] {
            coin(&mut arena, &mut w, "alice.near", id, 100);
        }
        w.wait(30 * MINUTE);
        coin(&mut arena, &mut w, "mallory.near", "sniper", 100);
        w.wait(2 * MINUTE);
        let id = arena.open_parley();
        let p = arena.get_parley(id).unwrap();
        assert!(p.a != "sniper" && p.b != "sniper");
    }

    #[test]
    fn the_next_coin_in_line_goes_first_when_the_first_has_no_partner() {
        let (mut arena, mut w) = paced(MINUTE, 30 * MINUTE);
        for id in ["aa", "bb", "cc", "dd"] {
            coin(&mut arena, &mut w, "alice.near", id, 100);
        }
        w.wait(30 * MINUTE);
        w.at("owner.near", 0);
        for (a, b) in [("aa", "bb"), ("aa", "cc"), ("aa", "dd")] {
            let id = arena.open_parley_between(a.into(), b.into());
            cooperate(&mut arena, &mut w, id);
            w.at("owner.near", 0);
        }
        w.wait(2 * MINUTE);
        let id = arena.open_parley();
        let p = arena.get_parley(id).unwrap();
        assert!(p.a != "aa" && p.b != "aa", "aa met everyone a moment ago");
    }

    #[test]
    fn a_voided_pair_is_not_drawn_together_again_at_once() {
        let (mut arena, mut w) = paced(MINUTE, 60 * MINUTE);
        for id in ["aa", "bb", "cc"] {
            coin(&mut arena, &mut w, "alice.near", id, 100);
            w.wait(MINUTE);
        }
        w.wait(60 * MINUTE);
        let id = arena.open_parley();
        let first = arena.get_parley(id).unwrap();
        assert_eq!((first.a.as_str(), first.b.as_str()), ("aa", "bb"));
        w.wait(31 * MINUTE);
        arena.void_parley(id);
        w.wait(MINUTE);
        let next = arena.get_parley(arena.get_overview().parleys as u64 - 1).unwrap();
        assert_eq!(next.status, MatchStatus::Void);
        let id = arena.open_parley();
        let second = arena.get_parley(id).unwrap();
        assert_eq!((second.a.as_str(), second.b.as_str()), ("cc", "aa"));
    }

    #[test]
    fn a_coin_whose_model_cannot_answer_is_left_out() {
        let (mut arena, mut w) = setup();
        let other = Enclave::new(9);
        w.at("owner.near", 0);
        arena.propose_model(model("some/other-model", other.public_key()));
        w.wait(24 * 60 * MINUTE);
        w.at("alice.near", 100 * NEAR);
        arena.create_coin("mute".into(), "MUTE".into(), "Be kind.".into(), "some/other-model".into());
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("owner.near", 0);
        arena.retire_signer("some/other-model".into(), other.public_key());
        w.wait(24 * 60 * MINUTE);
        for _ in 0..4 {
            let id = arena.open_parley();
            let p = arena.get_parley(id).unwrap();
            assert!(p.a != "mute" && p.b != "mute");
            cooperate(&mut arena, &mut w, id);
        }
    }

    #[test]
    fn a_coin_that_buys_its_way_back_in_goes_to_the_back_of_the_line() {
        let (mut arena, mut w) = paced(5 * MINUTE, 0);
        coin(&mut arena, &mut w, "mallory.near", "switch", 2);
        w.wait(MINUTE);
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        coin(&mut arena, &mut w, "bob.near", "snake", 100);
        w.at("mallory.near", 0);
        arena.place_redeem("switch".into(), U128(3 * NEAR / 2), None);
        w.at("mallory2.near", 5 * NEAR);
        arena.place_mint("switch".into(), None);
        w.wait(60 * MINUTE);
        arena.fill_order("switch".into(), acc("mallory.near"));
        arena.fill_order("switch".into(), acc("mallory2.near"));
        assert_eq!(arena.get_coin("switch".into()).unwrap().idle_since.0, w.now);
        let id = arena.open_parley();
        let p = arena.get_parley(id).unwrap();
        assert!(p.a != "switch" && p.b != "switch");
    }

    #[test]
    #[should_panic(expected = "no such Parley")]
    fn a_parley_id_cannot_wrap_around() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        arena.open_parley_between("saint".into(), "snake".into());
        w.wait(31 * MINUTE);
        arena.void_parley(4_294_967_296);
    }

    #[test]
    #[should_panic(expected = "no two rested coins are ready to meet")]
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
        assert!(user.ends_with(
            "Write your next public message to SNAKE: one or two short sentences, 34 words at most. \
             Do not draft alternatives. Reply with the message only."
        ));
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
            vec![model(MODEL, w.enclave.public_key())],
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
        let saint_view: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&arena.get_turn_request(id).unwrap()).unwrap();
        let saint_view = saint_view["messages"][1]["content"].as_str().unwrap();
        assert!(saint_view.contains(
            "History between you two, oldest first: you COOPERATE, they DEFECT.\n\
             Your most recent Parley together: you chose COOPERATE, they chose DEFECT. \
             They defected against you in 1 of the 1 Parleys listed.\nMessages so far:"
        ));
        assert_eq!(arena.get_pair_record("snake".into(), "saint".into()).outcomes, vec![(Move::Cooperate, Move::Defect)]);
    }

    #[test]
    fn a_first_meeting_has_no_history() {
        let (mut arena, mut w) = two_coins();
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&arena.get_turn_request(id).unwrap()).unwrap();
        let user = request["messages"][1]["content"].as_str().unwrap();
        assert!(user.contains("History between you two, oldest first: none, this is your first Parley together.\nMessages so far:"));
    }

    #[test]
    fn the_history_summary_counts_betrayals() {
        let (mut arena, mut w) = two_coins();
        play(&mut arena, &mut w, "saint", "snake", "COOPERATE", "DEFECT");
        play(&mut arena, &mut w, "saint", "snake", "DEFECT", "DEFECT");
        play(&mut arena, &mut w, "snake", "saint", "COOPERATE", "DEFECT");
        w.at("owner.near", 0);
        let id = arena.open_parley_between("saint".into(), "snake".into());
        let request: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&arena.get_turn_request(id).unwrap()).unwrap();
        let user = request["messages"][1]["content"].as_str().unwrap();
        assert!(user.contains(
            "oldest first: you COOPERATE, they DEFECT; you DEFECT, they DEFECT; you DEFECT, they COOPERATE.\n\
             Your most recent Parley together: you chose DEFECT, they chose COOPERATE. \
             They defected against you in 2 of the 3 Parleys listed.\n"
        ));
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
        answer(&mut arena, &mut w, id, &format!("  \"line one\nline two {}\"", "word ".repeat(100)));
        let text = arena.get_parley(id).unwrap().turns[0].text.clone();
        assert!(text.starts_with("line one line two word word"));
        assert!(text.ends_with("word…"));
        assert_eq!(text.chars().count(), 238);
        answer(&mut arena, &mut w, id, &"x".repeat(400));
        assert_eq!(arena.get_parley(id).unwrap().turns[1].text, format!("{}…", "x".repeat(239)));
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
        let amendment = arena.propose_amendment("saint".into(), "Never forgive a betrayal.".into(), MODEL.into());
        arena.vote(amendment, true, U128(50 * NEAR));
        w.wait(60 * MINUTE);
        arena.finalize_amendment(amendment);
        w.wait(TIMELOCK);
        arena.enact_amendment(amendment);
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
        arena.place_redeem("third".into(), U128(3 * NEAR / 2), None);
        w.wait(60 * MINUTE);
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

mod tokens {
    use super::*;
    use near_sdk::{PromiseError, PromiseResult};

    fn token() -> AccountId {
        acc("saint.arena.near")
    }

    fn with_coin() -> (Arena, World) {
        let (mut arena, mut w) = setup();
        coin(&mut arena, &mut w, "alice.near", "saint", 100);
        (arena, w)
    }

    #[test]
    fn a_created_token_is_recorded_on_the_coin() {
        let (mut arena, mut w) = with_coin();
        w.at("bob.near", 3 * NEAR);
        let _ = arena.create_token("saint".into());
        assert_eq!(arena.get_coin("saint".into()).unwrap().token, None);
        w.callback(PromiseResult::Successful(vec![]));
        let made = arena.on_token_created("saint".into(), token(), acc("bob.near"), U128(3 * NEAR), Ok(()));
        assert_eq!(made, Some(token()));
        assert_eq!(arena.get_coin("saint".into()).unwrap().token, Some(token()));
    }

    #[test]
    fn a_failed_deployment_records_nothing() {
        let (mut arena, mut w) = with_coin();
        w.callback(PromiseResult::Failed);
        let made = arena.on_token_created("saint".into(), token(), acc("bob.near"), U128(3 * NEAR), Err(PromiseError::Failed));
        assert_eq!(made, None);
        assert_eq!(arena.get_coin("saint".into()).unwrap().token, None);
    }

    #[test]
    #[should_panic(expected = "attach 3 NEAR for the token contract's storage")]
    fn a_token_needs_its_storage_paid() {
        let (mut arena, mut w) = with_coin();
        w.at("bob.near", NEAR);
        let _ = arena.create_token("saint".into());
    }

    #[test]
    #[should_panic(expected = "this coin already has a token")]
    fn a_coin_gets_one_token() {
        let (mut arena, mut w) = with_coin();
        w.callback(PromiseResult::Successful(vec![]));
        arena.on_token_created("saint".into(), token(), acc("bob.near"), U128(3 * NEAR), Ok(()));
        w.at("bob.near", 3 * NEAR);
        let _ = arena.create_token("saint".into());
    }

    #[test]
    #[should_panic(expected = "house coins have no shares")]
    fn house_coins_get_no_token() {
        let (mut arena, mut w) = setup();
        w.at("owner.near", 10 * NEAR);
        arena.create_house_coin("mirror".into(), "MIRROR".into(), "Mirror.".into(), MODEL.into());
        w.at("bob.near", 3 * NEAR);
        let _ = arena.create_token("mirror".into());
    }

    #[test]
    fn shares_sent_to_a_contract_stay_when_it_keeps_them() {
        let (mut arena, mut w) = with_coin();
        w.at("alice.near", 0);
        let _ = arena.transfer_shares_call("saint".into(), token(), U128(40 * NEAR), String::new());
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 60 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), token()).0, 40 * NEAR);
        w.callback(PromiseResult::Successful(b"\"0\"".to_vec()));
        let kept = arena.resolve_shares_call("saint".into(), acc("alice.near"), token(), U128(40 * NEAR));
        assert_eq!(kept.0, 40 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), token()).0, 40 * NEAR);
        assert_eq!(arena.get_coin("saint".into()).unwrap().total_shares.0, 100 * NEAR);
    }

    #[test]
    fn shares_come_back_when_the_receiver_fails() {
        let (mut arena, mut w) = with_coin();
        w.at("alice.near", 0);
        let _ = arena.transfer_shares_call("saint".into(), acc("nobody.near"), U128(40 * NEAR), String::new());
        w.callback(PromiseResult::Failed);
        let kept = arena.resolve_shares_call("saint".into(), acc("alice.near"), acc("nobody.near"), U128(40 * NEAR));
        assert_eq!(kept.0, 0);
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 100 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("nobody.near")).0, 0);
    }

    #[test]
    fn a_receiver_can_return_part() {
        let (mut arena, mut w) = with_coin();
        w.at("alice.near", 0);
        let _ = arena.transfer_shares_call("saint".into(), token(), U128(40 * NEAR), String::new());
        w.callback(PromiseResult::Successful(format!("\"{}\"", 15 * NEAR).into_bytes()));
        let kept = arena.resolve_shares_call("saint".into(), acc("alice.near"), token(), U128(40 * NEAR));
        assert_eq!(kept.0, 25 * NEAR);
        assert_eq!(arena.get_shares("saint".into(), acc("alice.near")).0, 75 * NEAR);
    }

    #[test]
    #[should_panic(expected = "not enough free shares")]
    fn cannot_wrap_more_than_held() {
        let (mut arena, mut w) = with_coin();
        w.at("alice.near", 0);
        let _ = arena.transfer_shares_call("saint".into(), token(), U128(101 * NEAR), String::new());
    }
}
