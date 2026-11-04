use near_sdk::env;
use near_sdk::serde_json::{self, Value};

use crate::types::Move;

pub fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

pub fn from_hex(text: &str) -> Option<Vec<u8>> {
    let text = text.strip_prefix("0x").unwrap_or(text);
    if !text.len().is_multiple_of(2) {
        return None;
    }
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    text.as_bytes()
        .chunks(2)
        .map(|pair| Some(digit(pair[0])? << 4 | digit(pair[1])?))
        .collect()
}

pub fn signed_text(model: &str, request_hash: &str, response_hash: &str) -> String {
    format!("{model}:{request_hash}:{response_hash}")
}

/// True when `signature` is the enclave key's Ed25519 signature over
/// `<model>:<sha256(request)>:<sha256(response)>`, the text a NEAR AI Cloud
/// model enclave signs for a non-streamed completion.
pub fn verify_enclave_signature(
    model: &str,
    request: &[u8],
    response: &[u8],
    signature_hex: &str,
    public_key_hex: &str,
) -> Option<(String, String)> {
    let signature: [u8; 64] = from_hex(signature_hex)?.try_into().ok()?;
    let public_key: [u8; 32] = from_hex(public_key_hex)?.try_into().ok()?;
    let request_hash = to_hex(&env::sha256_array(request));
    let response_hash = to_hex(&env::sha256_array(response));
    let text = signed_text(model, &request_hash, &response_hash);
    env::ed25519_verify(&signature, text.as_bytes(), &public_key).then_some((request_hash, response_hash))
}

/// The assistant text of an OpenAI-style chat completion body.
pub fn completion_text(response: &[u8]) -> Option<String> {
    let body: Value = serde_json::from_slice(response).ok()?;
    let content = body.get("choices")?.get(0)?.get("message")?.get("content")?;
    Some(content.as_str().unwrap_or_default().to_string())
}

/// One line of text: whitespace collapsed, quotes stripped, and anything past
/// `max_chars` cut at the last word that fits, marked with an ellipsis.
pub fn clean_message(raw: &str, max_chars: usize) -> String {
    let mut text = String::new();
    let mut last_space = true;
    for c in raw.chars() {
        if c.is_control() || c.is_whitespace() {
            if !last_space {
                text.push(' ');
                last_space = true;
            }
        } else {
            text.push(c);
            last_space = false;
        }
    }
    let text = text.trim().trim_matches('"').trim();
    if text.is_empty() {
        return "(said nothing)".to_string();
    }
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let head: String = text.chars().take(keep).collect();
    let ends_on_a_word = text.chars().nth(keep) == Some(' ');
    let kept = match head.rfind(' ') {
        Some(at) if !ends_on_a_word => &head[..at],
        _ => head.as_str(),
    };
    format!("{}…", kept.trim_end())
}

/// The first of the two move words in the reply decides. A reply with neither
/// counts as COOPERATE, so a coin whose mind fails carries the cost itself.
pub fn parse_move(raw: &str) -> Move {
    let upper = raw.to_uppercase();
    match (upper.find("DEFECT"), upper.find("COOPERATE")) {
        (Some(d), Some(c)) if d < c => Move::Defect,
        (Some(_), None) => Move::Defect,
        _ => Move::Cooperate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trip() {
        let bytes = [0u8, 1, 15, 16, 255];
        assert_eq!(to_hex(&bytes), "00010f10ff");
        assert_eq!(from_hex("00010F10ff").unwrap(), bytes);
        assert_eq!(from_hex("0x0a").unwrap(), [10]);
        assert!(from_hex("abc").is_none());
        assert!(from_hex("zz").is_none());
    }

    #[test]
    fn reads_completion_text() {
        let body = br#"{"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"Peace?"}}]}"#;
        assert_eq!(completion_text(body).unwrap(), "Peace?");
        let null = br#"{"choices":[{"message":{"content":null}}]}"#;
        assert_eq!(completion_text(null).unwrap(), "");
        assert!(completion_text(b"not json").is_none());
        assert!(completion_text(br#"{"choices":[]}"#).is_none());
    }

    #[test]
    fn cleans_messages() {
        assert_eq!(clean_message("  \"Hello\n\n  there\"  ", 280), "Hello there");
        assert_eq!(clean_message("abcdef", 3), "ab…");
        assert_eq!(clean_message("abc", 3), "abc");
        assert_eq!(clean_message("one two three four", 12), "one two…");
        assert_eq!(clean_message("one two three four", 14), "one two three…");
        assert_eq!(clean_message("héllo wörld again", 12), "héllo wörld…");
        assert_eq!(clean_message(" \n\t ", 10), "(said nothing)");
        assert_eq!(clean_message("tab\there\u{7}", 20), "tab here");
    }

    #[test]
    fn parses_moves() {
        assert_eq!(parse_move("COOPERATE"), Move::Cooperate);
        assert_eq!(parse_move("defect."), Move::Defect);
        assert_eq!(parse_move("I will not cooperate, I DEFECT"), Move::Cooperate);
        assert_eq!(parse_move("DEFECT, not cooperate"), Move::Defect);
        assert_eq!(parse_move("banana"), Move::Cooperate);
        assert_eq!(parse_move(""), Move::Cooperate);
    }
}
