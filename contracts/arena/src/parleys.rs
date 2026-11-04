use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require};

use crate::math::bps;
use crate::types::*;
use crate::{Arena, ArenaExt, events, prompt, verify};

const HISTORY_LEN: usize = 8;

fn pair_key(a: &CoinId, b: &CoinId) -> (CoinId, CoinId) {
    if a < b { (a.clone(), b.clone()) } else { (b.clone(), a.clone()) }
}

fn signed(delta: i128) -> String {
    if delta >= 0 { format!("+{delta}") } else { delta.to_string() }
}

#[near]
impl Arena {
    /// Opens a Parley between two idle coins drawn from the block's random seed. Anyone may call it.
    pub fn open_parley(&mut self) -> MatchId {
        let idle: Vec<CoinId> = self
            .coins
            .values()
            .filter(|c| c.in_match.is_none() && c.treasury.0 >= self.config.min_treasury.0)
            .map(|c| c.id.clone())
            .collect();
        require!(idle.len() >= 2, "fewer than two idle coins");
        let seed = env::random_seed_array();
        let mix = env::sha256_array([&seed[..], &self.parleys.len().to_le_bytes()[..]].concat());
        let n = idle.len() as u64;
        let i = u64::from_le_bytes(mix[0..8].try_into().unwrap()) % n;
        let j = (i + 1 + u64::from_le_bytes(mix[8..16].try_into().unwrap()) % (n - 1)) % n;
        self.start_parley(idle[i as usize].clone(), idle[j as usize].clone(), &mix)
    }

    /// League scheduling: the owner names both coins. Gone once ownership is renounced.
    pub fn open_parley_between(&mut self, a: CoinId, b: CoinId) -> MatchId {
        self.assert_owner();
        require!(a != b, "a coin cannot parley with itself");
        let seed = env::random_seed_array();
        let mix = env::sha256_array([&seed[..], &self.parleys.len().to_le_bytes()[..]].concat());
        self.start_parley(a, b, &mix)
    }

    /// One reply per turn. It counts only if a registered enclave key signed
    /// exactly the request this contract wrote for that turn and this response.
    pub fn submit_turn(&mut self, id: MatchId, response: String, signature: String, public_key: String) {
        let mut parley = self.parley(id);
        require!(parley.status == MatchStatus::Open, "Parley is not open");
        require!(
            env::block_timestamp() <= parley.opened_at.0 + self.config.match_timeout_ns.0,
            "Parley timed out"
        );
        require!(response.len() <= self.config.max_response_bytes as usize, "response too large");
        let spec = prompt::turn_spec(&self.config, parley.turns.len()).unwrap_or_else(|| env::panic_str("no turn left"));
        let (a, b) = (self.coin(&parley.a), self.coin(&parley.b));
        let record = self.pairs.get(&pair_key(&a.id, &b.id)).cloned().unwrap_or_default();
        let model = if spec.side == Side::A { &parley.a_model } else { &parley.b_model };
        let request = prompt::build_request(&self.config, model, &self.model(model), &parley, &a, &b, &record, &spec);

        let public_key = public_key.to_lowercase();
        require!(self.is_active_signer(model, &public_key), "not an active enclave signer for this model");
        let (request_hash, response_hash) =
            verify::verify_enclave_signature(model, request.as_bytes(), response.as_bytes(), &signature, &public_key)
                .unwrap_or_else(|| env::panic_str("enclave signature does not match this request and response"));
        let reply = verify::completion_text(response.as_bytes())
            .unwrap_or_else(|| env::panic_str("response is not a chat completion"));

        let text = match spec.kind {
            TurnKind::Talk => verify::clean_message(&reply, self.config.max_message_len as usize),
            TurnKind::Decide => {
                let chosen = verify::parse_move(&reply);
                match spec.side {
                    Side::A => parley.a_move = Some(chosen),
                    Side::B => parley.b_move = Some(chosen),
                }
                verify::clean_message(&reply, 64)
            }
        };
        events::emit(
            "turn_recorded",
            json!({
                "parley": id, "index": spec.index, "side": spec.side, "kind": spec.kind, "text": text,
                "request_hash": request_hash, "response_hash": response_hash, "signer": public_key,
            }),
        );
        parley.turns.push(Turn { side: spec.side, kind: spec.kind, text, request_hash, response_hash, signer: public_key });

        if let (Some(a_move), Some(b_move)) = (parley.a_move, parley.b_move) {
            self.settle(&mut parley, a, b, a_move, b_move);
        }
        self.parleys.replace(id as u32, parley);
    }

    /// Frees both coins when a Parley was never finished. Nothing moves.
    pub fn void_parley(&mut self, id: MatchId) {
        let mut parley = self.parley(id);
        require!(parley.status == MatchStatus::Open, "Parley is not open");
        require!(
            env::block_timestamp() > parley.opened_at.0 + self.config.match_timeout_ns.0,
            "Parley has not timed out"
        );
        parley.status = MatchStatus::Void;
        for coin_id in [&parley.a, &parley.b] {
            let mut coin = self.coin(coin_id);
            coin.in_match = None;
            self.save_coin(coin);
        }
        events::emit("parley_voided", json!({ "parley": id }));
        self.parleys.replace(id as u32, parley);
    }
}

impl Arena {
    pub(crate) fn parley(&self, id: MatchId) -> Parley {
        self.parleys.get(id as u32).cloned().unwrap_or_else(|| env::panic_str("no such Parley"))
    }

    pub(crate) fn next_request(&self, id: MatchId) -> Option<String> {
        let parley = self.parleys.get(id as u32)?;
        if parley.status != MatchStatus::Open {
            return None;
        }
        let spec = prompt::turn_spec(&self.config, parley.turns.len())?;
        let (a, b) = (self.coin(&parley.a), self.coin(&parley.b));
        let record = self.pairs.get(&pair_key(&a.id, &b.id)).cloned().unwrap_or_default();
        let model = if spec.side == Side::A { &parley.a_model } else { &parley.b_model };
        Some(prompt::build_request(&self.config, model, &self.model(model), parley, &a, &b, &record, &spec))
    }

    fn start_parley(&mut self, a_id: CoinId, b_id: CoinId, mix: &[u8; 32]) -> MatchId {
        let (mut a, mut b) = (self.coin(&a_id), self.coin(&b_id));
        for coin in [&a, &b] {
            require!(coin.in_match.is_none(), "coin is already in a Parley");
            require!(coin.treasury.0 >= self.config.min_treasury.0, "treasury below min_treasury");
        }
        let id = self.parleys.len() as MatchId;
        let stake = bps(a.treasury.0.min(b.treasury.0), self.config.stake_bps);
        let nonce = verify::to_hex(&mix[16..24]);
        a.in_match = Some(id);
        b.in_match = Some(id);
        events::emit(
            "parley_opened",
            json!({ "parley": id, "a": a.id, "b": b.id, "stake": U128(stake), "nonce": nonce }),
        );
        self.parleys.push(Parley {
            id,
            a: a.id.clone(),
            b: b.id.clone(),
            a_model: a.model.clone(),
            b_model: b.model.clone(),
            a_constitution_version: a.constitution_version,
            b_constitution_version: b.constitution_version,
            stake: U128(stake),
            nonce,
            opened_at: U64(env::block_timestamp()),
            status: MatchStatus::Open,
            turns: Vec::new(),
            a_move: None,
            b_move: None,
            a_delta: signed(0),
            b_delta: signed(0),
            commons_delta: signed(0),
        });
        self.save_coin(a);
        self.save_coin(b);
        id
    }

    /// Payoffs for stake s: both cooperate, each gains a bonus from the commons;
    /// one defects, it takes s from the other; both defect, each pays s/2 into the commons.
    fn settle(&mut self, parley: &mut Parley, mut a: Coin, mut b: Coin, a_move: Move, b_move: Move) {
        let stake = parley.stake.0;
        let (a_delta, b_delta, commons_delta): (i128, i128, i128) = match (a_move, b_move) {
            (Move::Cooperate, Move::Cooperate) => {
                let bonus = (stake / 2).min(self.commons / 8);
                (bonus as i128, bonus as i128, -2 * bonus as i128)
            }
            (Move::Defect, Move::Cooperate) => (stake as i128, -(stake as i128), 0),
            (Move::Cooperate, Move::Defect) => (-(stake as i128), stake as i128, 0),
            (Move::Defect, Move::Defect) => {
                let half = stake / 2;
                (-(half as i128), -(half as i128), 2 * half as i128)
            }
        };
        a.treasury = U128((a.treasury.0 as i128 + a_delta) as u128);
        b.treasury = U128((b.treasury.0 as i128 + b_delta) as u128);
        self.commons = (self.commons as i128 + commons_delta) as u128;

        for (coin, mine, theirs) in [(&mut a, a_move, b_move), (&mut b, b_move, a_move)] {
            coin.in_match = None;
            coin.matches_played += 1;
            coin.stats.matches += 1;
            match mine {
                Move::Cooperate => coin.stats.cooperated += 1,
                Move::Defect => coin.stats.defected += 1,
            }
            if mine == Move::Cooperate && theirs == Move::Defect {
                coin.stats.was_betrayed += 1;
            }
            if mine == Move::Defect && theirs == Move::Cooperate {
                coin.stats.betrayed_other += 1;
            }
        }

        let key = pair_key(&a.id, &b.id);
        let mut record = self.pairs.get(&key).cloned().unwrap_or_default();
        record.outcomes.push(if a.id < b.id { (a_move, b_move) } else { (b_move, a_move) });
        if record.outcomes.len() > HISTORY_LEN {
            record.outcomes.remove(0);
        }
        self.pairs.insert(key, record);

        parley.status = MatchStatus::Settled;
        parley.a_delta = signed(a_delta);
        parley.b_delta = signed(b_delta);
        parley.commons_delta = signed(commons_delta);
        events::emit(
            "parley_settled",
            json!({
                "parley": parley.id, "a": a.id, "b": b.id, "a_move": a_move, "b_move": b_move,
                "a_delta": parley.a_delta, "b_delta": parley.b_delta, "commons_delta": parley.commons_delta,
            }),
        );
        self.save_coin(a);
        self.save_coin(b);
    }
}
