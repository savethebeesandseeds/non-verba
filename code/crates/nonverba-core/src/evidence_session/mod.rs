// SPDX-License-Identifier: AGPL-3.0-only
//! Requester-witnessed delivery for independent or composed sensor evidence.
//! Requests and receipts have separate COSE domains. Retained originals and pins
//! are authority; reports are outputs, and atomic replay/acceptance is external.
mod model;
mod protocol;
mod verify;
pub use model::*;
pub use protocol::{create_evidence_session_request, validate_evidence_session_request};
pub use verify::{seal_evidence_session_receipt, verify_evidence_session_receipt};

use crate::live_session::cose;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{de::DeserializeOwned, Serialize};

pub const MAX_JSON_BYTES: usize = 256 * 1024;
const MAX_CONTEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_RESPONSE_MS: u64 = 180_000;
const MAX_START_DELAY_MS: u64 = 5_000;
const WALL_TOLERANCE_MS: u64 = 1_000;
const MAX_SEAL_DELAY_MS: u64 = 30_000;
const REQUEST_TYPE: &str = "application/vnd.nonverba.evidence-session-request+json";
const RECEIPT_TYPE: &str = "application/vnd.nonverba.evidence-session-receipt+json";

fn parse<T: DeserializeOwned>(text: &str) -> Result<T, String> {
    if text.len() > MAX_JSON_BYTES {
        return Err("Evidence-session JSON exceeds its limit".into());
    }
    serde_json::from_str(text).map_err(crate::err)
}
fn json(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(crate::err)
}
fn millis(seconds: f64) -> Result<u64, String> {
    crate::seconds(seconds)?
        .checked_mul(1000)
        .filter(|n| *n <= MAX_SAFE_INTEGER)
        .ok_or_else(|| "Evidence-session time exceeds safe integer milliseconds".into())
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn binding(bytes: &[u8]) -> ByteBinding {
    ByteBinding {
        sha256: crate::digest(bytes),
        bytes: bytes.len(),
    }
}
fn decode(text: &str) -> Result<Vec<u8>, String> {
    let limit = crate::live_session::MAX_COSE_BYTES;
    if text.len() > limit.div_ceil(3) * 4 {
        return Err("Evidence COSE exceeds its limit".into());
    }
    let bytes = STANDARD.decode(text).map_err(crate::err)?;
    if bytes.len() > limit || STANDARD.encode(&bytes) != text {
        return Err("Noncanonical evidence COSE base64".into());
    }
    Ok(bytes)
}
fn request_bytes(text: &str) -> Result<Vec<u8>, String> {
    let value: RequestEnvelope = parse(text)?;
    if value.version != 1 || value.kind != "nonverba-evidence-session-request" {
        return Err("Unsupported evidence request envelope".into());
    }
    decode(&value.cose_b64)
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_position;
