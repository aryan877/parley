use near_sdk::env;
use near_sdk::serde_json::{Value, json};

pub fn emit(event: &str, data: Value) {
    let body = json!({ "standard": "parley", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{body}"));
}
