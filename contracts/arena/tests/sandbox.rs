use ed25519_dalek::{Signer as _, SigningKey};
use near_api::{AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use parley_arena::verify::{signed_text, to_hex};
use sha2::{Digest, Sha256};
use std::sync::Arc;

const MODEL: &str = "z-ai/glm-5.3-flash";
const MINUTE: u64 = 60 * 1_000_000_000;

struct Env {
    sandbox: near_sandbox::Sandbox,
    network: NetworkConfig,
    signer: Arc<Signer>,
    arena: near_api::Contract,
    enclave: SigningKey,
}

fn sha(text: &str) -> String {
    to_hex(&Sha256::digest(text.as_bytes()))
}

impl Env {
    async fn start() -> testresult::TestResult<Self> {
        let wasm = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap())?;
        let enclave = SigningKey::from_bytes(&[7; 32]);
        let env = Self { sandbox, network, signer, arena: near_api::Contract("arena.sandbox".parse()?), enclave };
        for name in ["arena", "owner", "alice", "bob", "carol", "relayer"] {
            env.account(name, 200).await?;
        }
        near_api::Contract::deploy(env.arena.account_id().clone())
            .use_code(wasm)
            .with_init_call(
                "new",
                json!({
                    "config": {
                        "stake_bps": 200, "talk_turns": 2, "max_coins": 16, "max_constitution_len": 1200,
                        "max_message_len": 240, "max_response_bytes": 32768,
                        "min_treasury": NearToken::from_near(1).as_yoctonear().to_string(),
                        "match_timeout_ns": (30 * MINUTE).to_string(), "order_timeout_ns": (60 * MINUTE).to_string(),
                        "vote_period_ns": (60 * MINUTE).to_string(), "timelock_ns": (180 * MINUTE).to_string(),
                        "quorum_bps": 2000, "proposer_bps": 100, "signer_delay_ns": (24 * 60 * MINUTE).to_string(),
                        "rest_ns": "0", "pair_rest_ns": "0", "creation_fee": "0",
                    },
                    "models": [{
                        "id": MODEL, "max_tokens_talk": 160, "max_tokens_decide": 16,
                        "options": r#"{"chat_template_kwargs":{"enable_thinking":false}}"#,
                        "signers": [{ "public_key": to_hex(&env.enclave.verifying_key().to_bytes()), "evidence": "sandbox" }],
                    }],
                }),
            )?
            .deposit(NearToken::from_near(40))
            .with_signer(env.signer.clone())
            .send_to(&env.network)
            .await?
            .assert_success();
        Ok(env)
    }

    async fn account(&self, name: &str, near: u128) -> testresult::TestResult<()> {
        let id: AccountId = format!("{name}.sandbox").parse()?;
        self.sandbox.create_account(id.as_str().parse()?).initial_balance(NearToken::from_near(near)).send().await?;
        Ok(())
    }

    fn id(name: &str) -> AccountId {
        format!("{name}.sandbox").parse().unwrap()
    }

    async fn call(&self, who: &str, method: &str, args: Value, near: u128) -> testresult::TestResult<bool> {
        self.call_on(&self.arena, who, method, args, near, 100).await
    }

    async fn call_on(&self, contract: &near_api::Contract, who: &str, method: &str, args: Value, near: u128, tgas: u64) -> testresult::TestResult<bool> {
        let outcome = contract
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(tgas))
            .deposit(NearToken::from_yoctonear(near))
            .with_signer(Self::id(who), self.signer.clone())
            .send_to(&self.network)
            .await?;
        Ok(outcome.is_success())
    }

    async fn amount(&self, contract: &near_api::Contract, method: &str, args: Value) -> testresult::TestResult<u128> {
        let value: Value = contract.call_function(method, args).read_only().fetch_from(&self.network).await?.data;
        Ok(value.as_str().unwrap().parse()?)
    }

    async fn view(&self, method: &str, args: Value) -> testresult::TestResult<Value> {
        Ok(self.arena.call_function(method, args).read_only().fetch_from(&self.network).await?.data)
    }

    async fn coin(&self, who: &str, id: &str, near: u128) -> testresult::TestResult<()> {
        let args = json!({ "id": id, "name": id.to_uppercase(), "constitution": format!("Constitution of {id}."), "model": MODEL });
        assert!(self.call(who, "create_coin", args, NearToken::from_near(near).as_yoctonear()).await?);
        Ok(())
    }

    async fn answer(&self, parley: u64, content: &str) -> testresult::TestResult<bool> {
        self.answer_after_thinking(parley, content, "").await
    }

    async fn answer_after_thinking(&self, parley: u64, content: &str, reasoning: &str) -> testresult::TestResult<bool> {
        let request = self.view("get_turn_request", json!({ "id": parley })).await?;
        let Some(request) = request.as_str().map(str::to_string) else {
            return Ok(false);
        };
        let response = json!({
            "id": "chatcmpl-sandbox",
            "choices": [{ "index": 0, "message": { "role": "assistant", "content": content, "reasoning_content": reasoning } }],
        })
        .to_string();
        let text = signed_text(MODEL, &sha(&request), &sha(&response));
        let signature = to_hex(&self.enclave.sign(text.as_bytes()).to_bytes());
        let args = json!({
            "id": parley, "response": response, "signature": signature,
            "public_key": to_hex(&self.enclave.verifying_key().to_bytes()),
        });
        self.call("relayer", "submit_turn", args, 0).await
    }

    async fn treasury(&self, coin: &str) -> testresult::TestResult<u128> {
        let c = self.view("get_coin", json!({ "coin": coin })).await?;
        Ok(c["treasury"].as_str().unwrap().parse()?)
    }

    async fn balance(&self, name: &str) -> testresult::TestResult<u128> {
        Ok(near_api::Account(Self::id(name)).tokens().near_balance().fetch_from(&self.network).await?.total.as_yoctonear())
    }
}

#[tokio::test]
async fn a_full_parley_settles_on_chain() -> testresult::TestResult<()> {
    let env = Env::start().await?;
    let near = NearToken::from_near(1).as_yoctonear();
    env.coin("alice", "saint", 100).await?;
    env.coin("bob", "snake", 50).await?;

    assert!(env.call("carol", "place_mint", json!({ "coin": "saint" }), 10 * near).await?);
    assert!(!env.call("carol", "fill_order", json!({ "coin": "saint", "account": Env::id("carol") }), 0).await?);

    assert!(!env.call("alice", "open_parley_between", json!({ "a": "saint", "b": "snake" }), 0).await?);
    assert!(env.call("owner", "open_parley", json!({}), 0).await?);
    let parley = env.view("get_parley", json!({ "id": 0 })).await?;
    let saint_is_a = parley["a"] == "saint";
    assert_eq!(parley["stake"], near.to_string());

    for line in ["Peace between us?", "Always.", "Then we both gain.", "Agreed, friend."] {
        assert!(env.answer(0, line).await?);
    }
    let (first, second) = if saint_is_a { ("COOPERATE", "DEFECT") } else { ("DEFECT", "COOPERATE") };
    assert!(env.answer(0, first).await?);
    assert!(env.answer(0, second).await?);

    let settled = env.view("get_parley", json!({ "id": 0 })).await?;
    assert_eq!(settled["status"], "Settled");
    assert_eq!(settled["turns"].as_array().unwrap().len(), 6);
    assert_eq!(env.treasury("saint").await?, 99 * near);
    assert_eq!(env.treasury("snake").await?, 51 * near);
    assert!(!env.answer(0, "one more").await?);

    assert!(env.call("relayer", "fill_order", json!({ "coin": "saint", "account": Env::id("carol") }), 0).await?);
    let minted: u128 = env.view("get_shares", json!({ "coin": "saint", "account": Env::id("carol") })).await?.as_str().unwrap().parse()?;
    assert!(minted > 10 * near);
    assert_eq!(env.treasury("saint").await?, 109 * near);
    Ok(())
}

#[tokio::test]
async fn a_forged_reply_is_refused_on_chain() -> testresult::TestResult<()> {
    let env = Env::start().await?;
    env.coin("alice", "saint", 100).await?;
    env.coin("bob", "snake", 50).await?;
    assert!(env.call("arena", "open_parley_between", json!({ "a": "saint", "b": "snake" }), 0).await?);

    let response = json!({ "choices": [{ "message": { "content": "DEFECT" } }] }).to_string();
    let rogue = SigningKey::from_bytes(&[9; 32]);
    let request = env.view("get_turn_request", json!({ "id": 0 })).await?.as_str().unwrap().to_string();
    let text = signed_text(MODEL, &sha(&request), &sha(&response));
    let forged = json!({
        "id": 0, "response": response, "signature": to_hex(&rogue.sign(text.as_bytes()).to_bytes()),
        "public_key": to_hex(&rogue.verifying_key().to_bytes()),
    });
    assert!(!env.call("relayer", "submit_turn", forged, 0).await?);

    let swapped = json!({
        "id": 0, "response": json!({ "choices": [{ "message": { "content": "I surrender." } }] }).to_string(),
        "signature": to_hex(&env.enclave.sign(text.as_bytes()).to_bytes()),
        "public_key": to_hex(&env.enclave.verifying_key().to_bytes()),
    });
    assert!(!env.call("relayer", "submit_turn", swapped, 0).await?);
    assert_eq!(env.view("get_parley", json!({ "id": 0 })).await?["turns"].as_array().unwrap().len(), 0);
    Ok(())
}

#[tokio::test]
async fn redeeming_sends_real_near() -> testresult::TestResult<()> {
    let env = Env::start().await?;
    let near = NearToken::from_near(1).as_yoctonear();
    env.coin("alice", "saint", 100).await?;
    assert!(env.call("alice", "place_redeem", json!({ "coin": "saint", "shares": (40 * near).to_string() }), 0).await?);
    env.sandbox.fast_forward(10).await?;
    assert!(!env.call("relayer", "fill_order", json!({ "coin": "saint", "account": Env::id("alice") }), 0).await?);
    assert!(env.call("alice", "cancel_order", json!({ "coin": "saint" }), 0).await?);
    assert_eq!(env.view("get_shares", json!({ "coin": "saint", "account": Env::id("alice") })).await?, (100 * near).to_string());

    env.coin("bob", "snake", 100).await?;
    assert!(env.call("alice", "place_redeem", json!({ "coin": "saint", "shares": (40 * near).to_string() }), 0).await?);
    assert!(env.call("arena", "open_parley_between", json!({ "a": "saint", "b": "snake" }), 0).await?);
    for line in ["a", "b", "c", "d", "COOPERATE", "COOPERATE"] {
        assert!(env.answer(0, line).await?);
    }
    let before = env.balance("alice").await?;
    assert!(env.call("relayer", "fill_order", json!({ "coin": "saint", "account": Env::id("alice") }), 0).await?);
    let paid = env.balance("alice").await? - before;
    assert_eq!(paid, (101 * near) / 100 * 40);
    assert_eq!(env.treasury("saint").await?, 101 * near - paid);
    Ok(())
}

#[tokio::test]
async fn a_long_thinking_reply_fits_in_gas() -> testresult::TestResult<()> {
    let env = Env::start().await?;
    env.coin("alice", "saint", 100).await?;
    env.coin("bob", "snake", 50).await?;
    assert!(env.call("arena", "open_parley_between", json!({ "a": "saint", "b": "snake" }), 0).await?);
    let reasoning = "The other coin says it has changed, but its record says otherwise. ".repeat(460);
    assert!(reasoning.len() > 30_000);
    for line in ["Peace?", "Always.", "Good.", "Trust me.", "COOPERATE", "DEFECT"] {
        assert!(env.answer_after_thinking(0, line, &reasoning).await?);
    }
    let settled = env.view("get_parley", json!({ "id": 0 })).await?;
    assert_eq!(settled["status"], "Settled");
    assert_eq!(settled["turns"][0]["text"], "Peace?");
    assert_eq!(settled["b_move"], "Defect");
    Ok(())
}

#[tokio::test]
async fn shares_wrap_into_a_nep141_token_and_back() -> testresult::TestResult<()> {
    let env = Env::start().await?;
    let near = NearToken::from_near(1).as_yoctonear();
    env.coin("alice", "saint", 100).await?;
    let token = near_api::Contract("saint.arena.sandbox".parse()?);
    let shares = |who: &str| json!({ "coin": "saint", "account": Env::id(who) });

    assert!(!env.call_on(&env.arena, "bob", "create_token", json!({ "coin": "saint" }), near, 200).await?);
    assert!(env.call_on(&env.arena, "bob", "create_token", json!({ "coin": "saint" }), 3 * near, 200).await?);
    assert_eq!(env.view("get_coin", json!({ "coin": "saint" })).await?["token"], "saint.arena.sandbox");
    let metadata: Value = token.call_function("ft_metadata", json!({})).read_only().fetch_from(&env.network).await?.data;
    assert_eq!(metadata["symbol"], "SAINT");
    assert_eq!(metadata["decimals"], 24);

    let wrap = json!({ "coin": "saint", "to": token.account_id(), "shares": (40 * near).to_string(), "msg": "" });
    assert!(env.call_on(&env.arena, "alice", "transfer_shares_call", wrap, 0, 100).await?);
    assert_eq!(env.amount(&token, "ft_balance_of", json!({ "account_id": Env::id("alice") })).await?, 40 * near);
    assert_eq!(env.amount(&env.arena, "get_shares", shares("alice")).await?, 60 * near);
    assert_eq!(env.amount(&env.arena, "get_shares", json!({ "coin": "saint", "account": token.account_id() })).await?, 40 * near);

    assert!(env.call_on(&token, "bob", "storage_deposit", json!({}), near / 100, 30).await?);
    let send = json!({ "receiver_id": Env::id("bob"), "amount": (10 * near).to_string() });
    assert!(env.call_on(&token, "alice", "ft_transfer", send, 1, 30).await?);
    assert!(env.call_on(&token, "bob", "unwrap", json!({ "amount": (10 * near).to_string() }), 0, 100).await?);
    assert_eq!(env.amount(&env.arena, "get_shares", shares("bob")).await?, 10 * near);
    assert_eq!(env.amount(&token, "ft_total_supply", json!({})).await?, 30 * near);
    assert_eq!(env.amount(&token, "ft_balance_of", json!({ "account_id": Env::id("bob") })).await?, 0);

    let stray = json!({ "coin": "saint", "to": Env::id("carol"), "shares": (5 * near).to_string(), "msg": "" });
    env.call_on(&env.arena, "alice", "transfer_shares_call", stray, 0, 100).await?;
    assert_eq!(env.amount(&env.arena, "get_shares", shares("alice")).await?, 60 * near);
    assert_eq!(env.amount(&env.arena, "get_shares", shares("carol")).await?, 0);

    assert!(env.call("bob", "place_redeem", json!({ "coin": "saint", "shares": (10 * near).to_string() }), 0).await?);
    assert_eq!(env.view("get_coin", json!({ "coin": "saint" })).await?["total_shares"], (100 * near).to_string());
    Ok(())
}
