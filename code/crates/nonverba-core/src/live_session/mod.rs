// SPDX-License-Identifier: AGPL-3.0-only
//! One-round requester-observed delivery for independently verifiable location.
//! Signatures authenticate assertions and exact bytes, not physical freshness.
pub(crate) mod cose;
mod model;
pub(crate) use model::RequesterKey;
pub use model::{
    ByteBinding, KeyPin, PinKind, ReceiptEnvelope, ReceiptTiming, RequestEnvelope, SessionChecks,
    SessionReceipt, SessionRequest, SessionVerification,
};

use crate::location_proof;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{de::DeserializeOwned, Serialize};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const MAX_PAYLOAD_BYTES: usize = 64 * 1024;
pub const MAX_COSE_BYTES: usize = 80 * 1024;
pub const MAX_ENVELOPE_JSON_BYTES: usize = 256 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_RESPONSE_MS: u64 = 180_000;
const WALL_TOLERANCE_MS: u64 = 1000;
const MAX_SEAL_DELAY_MS: u64 = 30_000;

fn parse<T: DeserializeOwned>(text: &str) -> Result<T, String> {
    if text.len() > MAX_ENVELOPE_JSON_BYTES {
        return Err("Live-session JSON exceeds its limit".into());
    }
    serde_json::from_str(text).map_err(crate::err)
}
fn json(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(crate::err)
}
fn millis(seconds: f64) -> Result<u64, String> {
    crate::seconds(seconds)?
        .checked_mul(1000)
        .filter(|v| *v <= MAX_SAFE_INTEGER)
        .ok_or_else(|| "Live-session time exceeds safe integer milliseconds".into())
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
fn location_binding(request: &location_proof::Request) -> Result<ByteBinding, String> {
    Ok(binding(&serde_json::to_vec(request).map_err(crate::err)?))
}
fn location_pin(pin: &KeyPin) -> Result<(), String> {
    if pin.kind != PinKind::OperatorLocationSpkiSha256 || !hash(&pin.sha256) {
        return Err("An explicitly typed operator location SPKI pin is required".into());
    }
    Ok(())
}
pub(super) fn decode_base64(text: &str, limit: usize) -> Result<Vec<u8>, String> {
    if text.len() > limit.div_ceil(3) * 4 {
        return Err("Live-session base64 exceeds its limit".into());
    }
    let bytes = STANDARD.decode(text).map_err(crate::err)?;
    if bytes.len() > limit || STANDARD.encode(&bytes) != text {
        return Err("Noncanonical live-session base64".into());
    }
    Ok(bytes)
}
fn request_bytes(text: &str) -> Result<Vec<u8>, String> {
    let envelope: RequestEnvelope = parse(text)?;
    if envelope.version != 1 || envelope.kind != "nonverba-live-session-request" {
        return Err("Unsupported live-session request envelope".into());
    }
    decode_base64(&envelope.cose_b64, MAX_COSE_BYTES)
}
fn request_shape(request: &SessionRequest) -> Result<(), String> {
    if request.version != 1
        || request.kind != "nonverba-live-location-request"
        || !hash(&request.session_id)
        || request.created_at_ms > MAX_SAFE_INTEGER
    {
        return Err("Unsupported live-session request".into());
    }
    location_pin(&request.operator_pin)?;
    if request.requester_pin.kind != PinKind::RequesterSpkiSha256
        || !hash(&request.requester_pin.sha256)
        || request.requester_pin.sha256 == request.operator_pin.sha256
    {
        return Err(
            "Requester and location operator require distinct, correctly typed keys".into(),
        );
    }
    location_proof::validate_request(&request.location_request, request.created_at_ms)?;
    if request.location_request_binding != location_binding(&request.location_request)?
        || request.min_response_ms != request.location_request.policy.duration_ms
        || request.max_response_ms < request.min_response_ms.saturating_add(1000)
        || request.max_response_ms > MAX_RESPONSE_MS
        || request
            .created_at_ms
            .saturating_add(request.max_response_ms)
            > request.location_request.challenge.expires_at * 1000
    {
        return Err("Live-session request digest, duration or deadline is invalid".into());
    }
    Ok(())
}
fn authenticate_request(
    bytes: &[u8],
    expected_requester_pin: &str,
    expected_operator_pin: &KeyPin,
) -> Result<SessionRequest, String> {
    if !hash(expected_requester_pin) {
        return Err("An independently retained requester SPKI pin is required".into());
    }
    location_pin(expected_operator_pin)?;
    let signed = cose::read::<SessionRequest>(bytes, cose::REQUEST_TYPE)?;
    request_shape(&signed.payload)?;
    if !signed.signature_valid
        || signed.pin != expected_requester_pin
        || signed.payload.requester_pin.sha256 != expected_requester_pin
        || signed.payload.operator_pin != *expected_operator_pin
    {
        return Err(
            "Live-session request signature or independently supplied pins do not match".into(),
        );
    }
    Ok(signed.payload)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn live_requester_identity(identity_json: &str) -> Result<String, String> {
    let signer = cose::RequesterIdentity::load(identity_json)?;
    json(
        &serde_json::json!({"pin":KeyPin{kind:PinKind::RequesterSpkiSha256,sha256:signer.pin},
        "public_spki_der_b64":STANDARD.encode(&signer.spki),"key_protection":"software"}),
    )
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_live_session_request(
    location_request_json: &str,
    requester_identity_json: &str,
    operator_pin_json: &str,
    now_secs: f64,
    max_response_ms: u32,
) -> Result<String, String> {
    let location_request = location_proof::parse_request(location_request_json)?;
    let now_ms = millis(now_secs)?;
    location_proof::validate_request(&location_request, now_ms)?;
    let signer = cose::RequesterIdentity::load(requester_identity_json)?;
    let mut nonce = [0u8; 32];
    getrandom::getrandom(&mut nonce).map_err(crate::err)?;
    let request = SessionRequest {
        version: 1,
        kind: "nonverba-live-location-request".into(),
        session_id: hex::encode(nonce),
        created_at_ms: now_ms,
        requester_pin: KeyPin {
            kind: PinKind::RequesterSpkiSha256,
            sha256: signer.pin.clone(),
        },
        operator_pin: parse(operator_pin_json)?,
        requester_public_spki_der_b64: STANDARD.encode(&signer.spki),
        location_request_binding: location_binding(&location_request)?,
        min_response_ms: location_request.policy.duration_ms,
        max_response_ms: u64::from(max_response_ms),
        location_request,
    };
    request_shape(&request)?;
    json(&RequestEnvelope {
        version: 1,
        kind: "nonverba-live-session-request".into(),
        cose_b64: STANDARD.encode(cose::sign(&request, &signer, cose::REQUEST_TYPE)?),
    })
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_live_session_request(
    request_envelope_json: &str,
    expected_requester_pin: &str,
    expected_operator_pin_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let request = authenticate_request(
        &request_bytes(request_envelope_json)?,
        expected_requester_pin,
        &parse(expected_operator_pin_json)?,
    )?;
    let now_ms = millis(now_secs)?;
    location_proof::validate_request(&request.location_request, now_ms)?;
    if request.created_at_ms > now_ms.saturating_add(WALL_TOLERANCE_MS)
        || now_ms.saturating_add(request.max_response_ms)
            > request.location_request.challenge.expires_at * 1000
    {
        return Err(
            "Live-session request has insufficient remaining validity or is future-dated".into(),
        );
    }
    json(&request)
}

fn timing_checks(
    request: &SessionRequest,
    timing: &ReceiptTiming,
    sealed_at_ms: u64,
    now_ms: u64,
    checks: &mut SessionChecks,
) {
    let valid_integers = timing.sent_at_ms <= MAX_SAFE_INTEGER
        && timing.received_at_ms <= MAX_SAFE_INTEGER
        && timing.elapsed_ms <= MAX_RESPONSE_MS
        && sealed_at_ms <= MAX_SAFE_INTEGER;
    checks.timing_consistent = valid_integers
        && timing.received_at_ms >= timing.sent_at_ms
        && timing
            .received_at_ms
            .saturating_sub(timing.sent_at_ms)
            .abs_diff(timing.elapsed_ms)
            <= WALL_TOLERANCE_MS;
    checks.response_deadline_met = valid_integers && timing.elapsed_ms <= request.max_response_ms;
    checks.minimum_interval_met = valid_integers && timing.elapsed_ms >= request.min_response_ms;
    checks.recorded_window_valid = valid_integers
        && timing.sent_at_ms >= request.created_at_ms
        && matches!((request.location_request.challenge.issued_at.checked_mul(1000),
            request.location_request.challenge.expires_at.checked_mul(1000)), (Some(issued),Some(expiry))
            if timing.sent_at_ms >= issued && timing.received_at_ms < expiry
                && timing.sent_at_ms.saturating_add(request.max_response_ms) <= expiry);
    checks.sealing_time_valid = valid_integers
        && sealed_at_ms.saturating_add(WALL_TOLERANCE_MS) >= timing.received_at_ms
        && sealed_at_ms <= timing.received_at_ms.saturating_add(MAX_SEAL_DELAY_MS);
    checks.not_future = [
        request.created_at_ms,
        timing.sent_at_ms,
        timing.received_at_ms,
        sealed_at_ms,
    ]
    .iter()
    .all(|v| *v <= now_ms.saturating_add(WALL_TOLERANCE_MS));
}
fn timing_valid(checks: &SessionChecks) -> bool {
    checks.timing_consistent
        && checks.response_deadline_met
        && checks.minimum_interval_met
        && checks.recorded_window_valid
        && checks.sealing_time_valid
        && checks.not_future
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn seal_live_session_receipt(
    request_envelope_json: &str,
    artifact_bytes: &[u8],
    timing_json: &str,
    requester_identity_json: &str,
    expected_requester_pin: &str,
    now_secs: f64,
) -> Result<String, String> {
    let bytes = request_bytes(request_envelope_json)?;
    // Extracting the operator pin here is safe only because the exact request is
    // authenticated to the separately supplied requester key immediately below.
    let parsed = cose::read::<SessionRequest>(&bytes, cose::REQUEST_TYPE)?;
    let request =
        authenticate_request(&bytes, expected_requester_pin, &parsed.payload.operator_pin)?;
    let signer = cose::RequesterIdentity::load(requester_identity_json)?;
    if signer.pin != expected_requester_pin
        || STANDARD.encode(&signer.spki) != request.requester_public_spki_der_b64
    {
        return Err("Receipt signer differs from the enrolled requester key".into());
    }
    if artifact_bytes.is_empty() || artifact_bytes.len() > location_proof::MAX_PROOF_BYTES {
        return Err("Location artifact is empty or exceeds its limit".into());
    }
    let timing: ReceiptTiming = parse(timing_json)?;
    let now_ms = millis(now_secs)?;
    let mut checks = SessionChecks::default();
    timing_checks(&request, &timing, now_ms, now_ms, &mut checks);
    if !timing_valid(&checks) {
        return Err("Requester observation timing violates the live-session policy".into());
    }
    let location = location_proof::verify(
        artifact_bytes,
        &request.location_request,
        &request.operator_pin.sha256,
        None,
        timing.received_at_ms,
    )?;
    if !location.verified {
        return Err(format!(
            "Location artifact failed independent verification: {}",
            location.errors.join("; ")
        ));
    }
    let receipt = SessionReceipt {
        version: 1,
        kind: "nonverba-live-location-receipt".into(),
        session_id: request.session_id,
        request_binding: binding(&bytes),
        location_request_binding: request.location_request_binding,
        artifact_binding: binding(artifact_bytes),
        operator_pin: request.operator_pin,
        requester_pin: request.requester_pin,
        requester_public_spki_der_b64: request.requester_public_spki_der_b64,
        timing,
        sealed_at_ms: now_ms,
        demo: request.location_request.demo,
    };
    json(&ReceiptEnvelope {
        version: 1,
        kind: "nonverba-live-session-receipt".into(),
        request_cose_b64: STANDARD.encode(bytes),
        receipt_cose_b64: STANDARD.encode(cose::sign(&receipt, &signer, cose::RECEIPT_TYPE)?),
    })
}

fn empty_report() -> SessionVerification {
    SessionVerification {
        verified: false,
        fresh_action_eligible: false,
        demo: false,
        checks: SessionChecks::default(),
        request: None,
        receipt: None,
        location_verification: None,
        requester_clock_trusted: false,
        physical_freshness_proven: false,
        independent_requester_proven: false,
        global_replay_checked: false,
        replay_status: "not-checked".into(),
        acceptance_requires_local_replay_check: true,
        acceptance_recorded: false,
        errors: Vec::new(),
    }
}

pub fn verify_receipt(
    receipt_envelope_json: &str,
    original_request_envelope_json: &str,
    artifact_bytes: &[u8],
    expected_requester_pin: &str,
    expected_operator_pin: &KeyPin,
    now_ms: u64,
) -> Result<SessionVerification, String> {
    if !hash(expected_requester_pin) || now_ms > MAX_SAFE_INTEGER {
        return Err("Expected requester pin or verification time is invalid".into());
    }
    location_pin(expected_operator_pin)?;
    let mut report = empty_report();
    if artifact_bytes.is_empty() || artifact_bytes.len() > location_proof::MAX_PROOF_BYTES {
        report.errors.push("LIVE_ARTIFACT_SIZE".into());
        return Ok(report);
    }
    let parsed = (|| {
        let original = request_bytes(original_request_envelope_json)?;
        let request = cose::read::<SessionRequest>(&original, cose::REQUEST_TYPE)?;
        let envelope: ReceiptEnvelope = parse(receipt_envelope_json)?;
        if envelope.version != 1 || envelope.kind != "nonverba-live-session-receipt" {
            return Err("Unsupported live-session receipt envelope".to_owned());
        }
        let included = decode_base64(&envelope.request_cose_b64, MAX_COSE_BYTES)?;
        let receipt = cose::read::<SessionReceipt>(
            &decode_base64(&envelope.receipt_cose_b64, MAX_COSE_BYTES)?,
            cose::RECEIPT_TYPE,
        )?;
        Ok((original, included, request, receipt))
    })();
    let (original, included, signed_request, signed_receipt) = match parsed {
        Ok(values) => values,
        Err(error) => {
            report.errors.push(error);
            return Ok(report);
        }
    };
    let request = signed_request.payload;
    let receipt = signed_receipt.payload;
    let checks = &mut report.checks;
    checks.request_signature_integrity = signed_request.signature_valid;
    checks.receipt_signature_integrity = signed_receipt.signature_valid;
    checks.requester_pin_match = signed_request.pin == expected_requester_pin
        && signed_receipt.pin == expected_requester_pin
        && request.requester_pin.kind == PinKind::RequesterSpkiSha256
        && request.requester_pin.sha256 == expected_requester_pin
        && receipt.requester_pin == request.requester_pin;
    checks.operator_pin_match = request.operator_pin == *expected_operator_pin
        && receipt.operator_pin == *expected_operator_pin;
    checks.key_roles_separated = request.requester_pin.sha256 != request.operator_pin.sha256;
    checks.original_request_match = original == included;
    checks.session_binding = receipt.version == 1
        && receipt.kind == "nonverba-live-location-receipt"
        && receipt.session_id == request.session_id
        && receipt.request_binding == binding(&original)
        && receipt.location_request_binding == request.location_request_binding;
    checks.artifact_binding = receipt.artifact_binding == binding(artifact_bytes);
    checks.request_policy_valid = request_shape(&request).is_ok();
    checks.demo_marker_valid = receipt.demo == request.location_request.demo;
    timing_checks(
        &request,
        &receipt.timing,
        receipt.sealed_at_ms,
        now_ms,
        checks,
    );
    // Independently inspect the actual artifact even when a requester signs its
    // hash. A requester signature is never a substitute for operator verification.
    if checks.request_policy_valid && checks.operator_pin_match {
        match location_proof::verify(
            artifact_bytes,
            &request.location_request,
            &expected_operator_pin.sha256,
            None,
            receipt.timing.received_at_ms,
        ) {
            Ok(location) => {
                checks.location_proof_valid = location.verified;
                report.location_verification = Some(location);
            }
            Err(error) => report.errors.push(error),
        }
    }
    for (passed, code) in [
        (checks.request_signature_integrity, "LIVE_REQUEST_SIGNATURE"),
        (checks.receipt_signature_integrity, "LIVE_RECEIPT_SIGNATURE"),
        (checks.requester_pin_match, "LIVE_REQUESTER_PIN"),
        (checks.operator_pin_match, "LIVE_OPERATOR_PIN"),
        (checks.key_roles_separated, "LIVE_KEY_ROLES"),
        (checks.original_request_match, "LIVE_ORIGINAL_REQUEST"),
        (checks.session_binding, "LIVE_SESSION_BINDING"),
        (checks.artifact_binding, "LIVE_ARTIFACT_BINDING"),
        (checks.request_policy_valid, "LIVE_REQUEST_POLICY"),
        (checks.timing_consistent, "LIVE_TIMING"),
        (checks.response_deadline_met, "LIVE_DEADLINE"),
        (checks.minimum_interval_met, "LIVE_MINIMUM_INTERVAL"),
        (checks.recorded_window_valid, "LIVE_RECORDED_WINDOW"),
        (checks.sealing_time_valid, "LIVE_SEALING_TIME"),
        (checks.not_future, "LIVE_FUTURE_TIME"),
        (checks.location_proof_valid, "LIVE_LOCATION_PROOF"),
        (checks.demo_marker_valid, "LIVE_DEMO_MARKER"),
    ] {
        if !passed {
            report.errors.push(code.into());
        }
    }
    report.verified = report.errors.is_empty();
    report.demo = request.location_request.demo;
    report.fresh_action_eligible = report.verified
        && !report.demo
        && now_ms >= request.location_request.challenge.issued_at * 1000
        && now_ms < request.location_request.challenge.expires_at * 1000;
    report.request = Some(request);
    report.receipt = Some(receipt);
    Ok(report)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn verify_live_session_receipt(
    receipt_envelope_json: &str,
    original_request_envelope_json: &str,
    artifact_bytes: &[u8],
    expected_requester_pin: &str,
    expected_operator_pin_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    json(&verify_receipt(
        receipt_envelope_json,
        original_request_envelope_json,
        artifact_bytes,
        expected_requester_pin,
        &parse(expected_operator_pin_json)?,
        millis(now_secs)?,
    )?)
}

#[cfg(test)]
mod tests;
