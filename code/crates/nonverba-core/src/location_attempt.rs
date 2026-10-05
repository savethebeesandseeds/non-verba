// SPDX-License-Identifier: AGPL-3.0-only
//! Separate GPS failure claims. Integrity is not collection attestation or fault.
use crate::location_proof::{self as location, RawGnssCollectionAction, Trace};
use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(not(target_arch = "wasm32"))]
use coset::CoseSign1Builder;
use coset::{iana, CoseSign1, Header, HeaderBuilder, TaggedCborSerializable};
use p256::{
    ecdsa::{signature::Verifier, Signature, VerifyingKey},
    pkcs8::DecodePublicKey,
};
use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const MAX_ATTEMPT_JSON: usize = 2 * 1024 * 1024;
pub const MAX_ATTEMPT_BYTES: usize = MAX_ATTEMPT_JSON + 16 * 1024;
const DOMAIN: &str = "application/vnd.nonverba.gps-attempt-v1+json";
const AAD: &[u8] = b"org.nonverba.gps-attempt.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Diagnostics {
    pub rejected_fixes: u32,
    pub raw_callback_count: u32,
    pub last_raw_callback_elapsed_ms: Option<u64>,
    pub permission_granted_elapsed_ms: Option<u64>,
    pub first_raw_admitted_elapsed_ms: Option<u64>,
    /// Bounded, collector-owned OS status, source claims only. No verifier verdict.
    pub collector_status_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub attempt_id: String,
    /// Exact UTF-8 bridge request, including its serialization, retained at begin.
    pub original_request_json: String,
    pub stopping_stage: String,
    /// Absent in the original v1 raw-policy reports. Other terminal causes must be explicit.
    #[serde(default, skip_serializing_if = "TerminalTrigger::is_raw_rejection")]
    pub terminal_trigger: TerminalTrigger,
    pub local_timeout_ms: u64,
    pub diagnostics: Diagnostics,
    /// Partial data may violate success policy; never passed to the success signer.
    pub partial_trace: Trace,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalTrigger {
    #[default]
    RawPolicyRejection,
    CollectionTimeout,
    /// Android reported status 0 before any raw measurements were received.
    /// This OS status does not distinguish unsupported hardware from startup failure.
    RawGnssStartupUnavailable,
}
impl TerminalTrigger {
    fn is_raw_rejection(&self) -> bool {
        *self == Self::RawPolicyRejection
    }
    fn outcome(self) -> &'static str {
        match self {
            Self::RawPolicyRejection => "raw-gnss-policy-rejected",
            Self::CollectionTimeout => "raw-gnss-no-callback-timeout",
            Self::RawGnssStartupUnavailable => "raw-gnss-startup-unavailable",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub version: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub sensor: String,
    pub outcome: String,
    pub physical_cause: String,
    pub original_request_sha256: String,
    pub snapshot: Snapshot,
    pub reason_codes: Vec<String>,
    pub sealed_at_ms: u64,
    pub public_spki_der_b64: String,
    pub key_protection_claim: String,
}

#[derive(Debug, Serialize)]
pub struct Verification {
    pub report_verified: bool,
    pub signature_integrity: bool,
    pub request_match: bool,
    pub key_match: bool,
    pub claims_consistent: bool,
    pub acquisition_outcome: String,
    pub measurement_policy_satisfied: bool,
    pub raw_gnss_evaluation: Option<location::RawGnssChecks>,
    pub successful_measurement: bool,
    pub successful_acceptance_eligible: bool,
    pub independent_receipt_verified: bool,
    pub fresh_action_eligible: bool,
    pub collection_attested: bool,
    pub physical_cause_proven: bool,
    pub operator_effort_proven: bool,
    pub operator_fault_proven: bool,
    pub hardware_attested: bool,
    pub clock_trusted: bool,
    pub report: Option<Report>,
    pub errors: Vec<String>,
}

pub fn valid_attempt_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}

fn reasons(snapshot: &Snapshot) -> Result<Vec<String>, String> {
    let trace = &snapshot.partial_trace;
    let original = location::parse_request(&snapshot.original_request_json)?;
    location::validate_request(&original, trace.started_at_ms)?;
    let d = &snapshot.diagnostics;
    if snapshot.version != 1
        || snapshot.kind != "nonverba-gps-attempt-snapshot"
        || !valid_attempt_id(&snapshot.attempt_id)
        || snapshot.stopping_stage != "collecting"
        || snapshot.local_timeout_ms != 60_000
        || trace.request != original
        || trace.request.policy.raw_gnss.is_none()
        || trace.profile != "native-android"
        || trace.version != 1
        || trace.kind != "nonverba-location-trace"
        || trace.permission_precision != "fine"
        || trace.uncertainty_semantics != "android-68-percent"
        || trace.capture_correlation != "none"
        || trace.samples.len() > 128
        || trace.elapsed_ms > 120_000
        || trace.ended_at_ms < trace.started_at_ms
        || trace.ended_at_ms > 9_007_199_254_740_991
        || d.rejected_fixes > 8192
        || d.raw_callback_count > 8192
        || d.collector_status_json.len() > 16 * 1024
    {
        return Err("Unsupported or unbounded GPS attempt snapshot".into());
    }
    let status: serde_json::Value =
        serde_json::from_str(&d.collector_status_json).map_err(crate::err)?;
    if !status.is_object() {
        return Err("Collector status must be an object".into());
    }
    for time in [
        d.last_raw_callback_elapsed_ms,
        d.permission_granted_elapsed_ms,
        d.first_raw_admitted_elapsed_ms,
    ]
    .into_iter()
    .flatten()
    {
        if time > trace.elapsed_ms {
            return Err("Diagnostic time is after terminal time".into());
        }
    }
    if (d.raw_callback_count == 0) != d.last_raw_callback_elapsed_ms.is_none() {
        return Err("Raw callback count and time disagree".into());
    }
    let raw = trace.raw_gnss.as_ref().ok_or("Missing partial raw GNSS")?;
    if raw.epochs.len() > location::MAX_RAW_GNSS_EPOCHS
        || raw.rejected_epoch_count > 4096
        || raw.epochs.iter().any(|e| {
            e.measurements.len() > location::MAX_RAW_GNSS_MEASUREMENTS
                || e.observed_elapsed_ms > trace.elapsed_ms
        })
        || trace
            .samples
            .iter()
            .any(|s| s.observed_elapsed_ms > trace.elapsed_ms)
        || d.raw_callback_count < raw.epochs.len() as u32
    {
        return Err("Partial observations exceed terminal bounds".into());
    }
    if snapshot.terminal_trigger == TerminalTrigger::CollectionTimeout {
        if trace.elapsed_ms < snapshot.local_timeout_ms
            || d.raw_callback_count != 0
            || d.first_raw_admitted_elapsed_ms.is_some()
            || d.permission_granted_elapsed_ms.is_none()
            || !raw.epochs.is_empty()
            || raw.rejected_epoch_count != 0
            || !trace.samples.is_empty()
            || raw.version != 1
            || raw.kind != "android-raw-gnss"
            || raw.collection_interval_ms != 1000
            || !raw
                .anchor_elapsed_realtime_ns
                .parse::<u64>()
                .is_ok_and(|v| v > 0)
        {
            return Err(
                "Snapshot does not show a bounded no-raw-callback collection timeout".into(),
            );
        }
        return Ok(vec![
            "COLLECTION_TIMEOUT".into(),
            "RAW_GNSS_NO_CALLBACKS".into(),
        ]);
    }
    if snapshot.terminal_trigger == TerminalTrigger::RawGnssStartupUnavailable {
        // Read collector-owned fields from the immutable native status snapshot.
        // Neither empty data alone nor a caller's prose is a terminal OS trigger.
        let diagnostic = &status["raw_gnss_diagnostics"];
        if d.raw_callback_count != 0
            || d.first_raw_admitted_elapsed_ms.is_some()
            || d.permission_granted_elapsed_ms.is_none()
            || !raw.epochs.is_empty()
            || raw.rejected_epoch_count != 0
            || !trace.samples.is_empty()
            || raw.version != 1
            || raw.kind != "android-raw-gnss"
            || raw.collection_interval_ms != 1000
            || !raw
                .anchor_elapsed_realtime_ns
                .parse::<u64>()
                .is_ok_and(|v| v > 0)
            || diagnostic["registration"].as_str() != Some("registered")
            || diagnostic["receiver_status"].as_str() != Some("not-supported")
            || diagnostic["receiver_status_code"].as_i64() != Some(0)
            || diagnostic["callback_count"].as_u64() != Some(0)
            || diagnostic.get("last_callback_elapsed_ms") != Some(&serde_json::Value::Null)
            || diagnostic["cadence_skipped"].as_u64() != Some(0)
            || !diagnostic["warmup_reasons"]
                .as_object()
                .is_some_and(serde_json::Map::is_empty)
        {
            return Err("Snapshot does not show a raw GNSS startup-unavailable status before callbacks".into());
        }
        return Ok(vec![
            "RAW_GNSS_STARTUP_UNAVAILABLE".into(),
            "RAW_GNSS_NO_CALLBACKS".into(),
        ]);
    }
    if raw.epochs.is_empty() {
        return Err("Snapshot does not show a raw GNSS policy rejection".into());
    }
    let progress = location::evaluate_raw_gnss_collection(trace);
    if progress.collection_action != RawGnssCollectionAction::Reject
        || progress.checks.error_codes.is_empty()
    {
        return Err("Snapshot does not show a raw GNSS policy rejection".into());
    }
    Ok(progress.checks.error_codes)
}

fn header(spki: &[u8]) -> Header {
    HeaderBuilder::new()
        .algorithm(iana::Algorithm::ES256)
        .content_type(DOMAIN.into())
        .key_id(crate::digest(spki).into_bytes())
        .build()
}

pub fn parse_snapshot(json: &str) -> Result<Snapshot, String> {
    if json.len() > MAX_ATTEMPT_JSON {
        return Err("GPS attempt exceeds size limit".into());
    }
    serde_json::from_str(json).map_err(crate::err)
}

/// Internal native entry only; Android must provide its own frozen collector snapshot.
#[cfg(not(target_arch = "wasm32"))]
pub fn seal_with_signer<F>(
    snapshot: Snapshot,
    spki: &[u8],
    sealed_at_ms: u64,
    signer: F,
) -> Result<Vec<u8>, String>
where
    F: FnOnce(&[u8]) -> Result<Vec<u8>, String>,
{
    location::fingerprint_spki(spki)?;
    let reason_codes = reasons(&snapshot)?;
    if sealed_at_ms < snapshot.partial_trace.ended_at_ms || sealed_at_ms > 9_007_199_254_740_991 {
        return Err("Invalid GPS report sealing time".into());
    }
    let report = Report {
        version: 1,
        kind: "nonverba-gps-attempt-report".into(),
        sensor: "gps".into(),
        outcome: snapshot.terminal_trigger.outcome().into(),
        physical_cause: "unknown".into(),
        original_request_sha256: crate::digest(snapshot.original_request_json.as_bytes()),
        snapshot,
        reason_codes,
        sealed_at_ms,
        public_spki_der_b64: STANDARD.encode(spki),
        key_protection_claim: "android-keystore".into(),
    };
    let payload = serde_json::to_vec(&report).map_err(crate::err)?;
    if payload.len() > MAX_ATTEMPT_JSON {
        return Err("GPS report exceeds size limit".into());
    }
    let mut message = CoseSign1Builder::new()
        .protected(header(spki))
        .payload(payload)
        .build();
    let tbs = message.tbs_data(AAD);
    let signed = signer(&tbs)?;
    let signature = if signed.len() == 64 {
        Signature::from_slice(&signed)
    } else {
        Signature::from_der(&signed)
    }
    .map_err(crate::err)?;
    let signature = signature.normalize_s().unwrap_or(signature);
    VerifyingKey::from_public_key_der(spki)
        .map_err(crate::err)?
        .verify(&tbs, &signature)
        .map_err(|_| "GPS attempt signer returned invalid signature".to_owned())?;
    message.signature = signature.to_bytes().to_vec();
    let bytes = message.to_tagged_vec().map_err(crate::err)?;
    if bytes.len() > MAX_ATTEMPT_BYTES {
        return Err("GPS report exceeds size limit".into());
    }
    Ok(bytes)
}

pub fn verify(bytes: &[u8], original: &str, pin: &str) -> Result<Verification, String> {
    let expected_request = location::parse_request(original)?;
    if pin.len() != 64
        || !pin
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Supply an independently trusted location SPKI pin".into());
    }
    let mut v = Verification {
        report_verified: false,
        signature_integrity: false,
        request_match: false,
        key_match: false,
        claims_consistent: false,
        acquisition_outcome: "unverified".into(),
        measurement_policy_satisfied: false,
        raw_gnss_evaluation: None,
        successful_measurement: false,
        successful_acceptance_eligible: false,
        independent_receipt_verified: false,
        fresh_action_eligible: false,
        collection_attested: false,
        physical_cause_proven: false,
        operator_effort_proven: false,
        operator_fault_proven: false,
        hardware_attested: false,
        clock_trusted: false,
        report: None,
        errors: Vec::new(),
    };
    let read = || -> Result<(Report, String, bool), String> {
        if bytes.len() > MAX_ATTEMPT_BYTES {
            return Err("GPS report exceeds size limit".into());
        }
        let message = CoseSign1::from_tagged_slice(bytes).map_err(crate::err)?;
        if !message.unprotected.is_empty() {
            return Err("Unprotected GPS report headers forbidden".into());
        }
        let payload = message
            .payload
            .as_ref()
            .ok_or("Missing GPS report payload")?;
        if payload.len() > MAX_ATTEMPT_JSON {
            return Err("GPS report exceeds size limit".into());
        }
        let r: Report = serde_json::from_slice(payload).map_err(crate::err)?;
        let spki = STANDARD
            .decode(&r.public_spki_der_b64)
            .map_err(crate::err)?;
        let actual_pin = location::fingerprint_spki(&spki)?;
        if STANDARD.encode(&spki) != r.public_spki_der_b64
            || message.protected.header != header(&spki)
        {
            return Err("Wrong GPS report signing domain or key encoding".into());
        }
        let key = VerifyingKey::from_public_key_der(&spki).map_err(crate::err)?;
        let signed = message
            .verify_signature(AAD, |s, tbs| key.verify(tbs, &Signature::from_slice(s)?))
            .is_ok();
        Ok((r, actual_pin, signed))
    };
    let (r, actual_pin, signed) = match read() {
        Ok(r) => r,
        Err(e) => {
            v.errors.push(e);
            return Ok(v);
        }
    };
    v.signature_integrity = signed;
    v.key_match = actual_pin == pin;
    // JSON whitespace/key ordering do not change the original protocol request.
    // Every typed field (including policy and context) must still match exactly.
    v.request_match = location::parse_request(&r.snapshot.original_request_json)
        .is_ok_and(|request| request == expected_request);
    v.claims_consistent = r.version == 1
        && r.kind == "nonverba-gps-attempt-report"
        && r.sensor == "gps"
        && r.outcome == r.snapshot.terminal_trigger.outcome()
        && r.physical_cause == "unknown"
        && r.key_protection_claim == "android-keystore"
        && r.original_request_sha256 == crate::digest(r.snapshot.original_request_json.as_bytes())
        && r.sealed_at_ms >= r.snapshot.partial_trace.ended_at_ms
        && r.sealed_at_ms <= 9_007_199_254_740_991
        && reasons(&r.snapshot).is_ok_and(|codes| codes == r.reason_codes);
    for (ok, e) in [
        (v.signature_integrity, "GPS report signature invalid"),
        (v.key_match, "GPS report key mismatch"),
        (v.request_match, "GPS report original request mismatch"),
        (v.claims_consistent, "GPS report claims inconsistent"),
    ] {
        if !ok {
            v.errors.push(e.into());
        }
    }
    v.report_verified = v.errors.is_empty();
    if v.report_verified {
        v.acquisition_outcome = r.outcome.clone();
        if r.snapshot.terminal_trigger == TerminalTrigger::RawPolicyRejection {
            v.raw_gnss_evaluation = Some(location::evaluate_raw_gnss(&r.snapshot.partial_trace));
        }
    }
    v.report = Some(r);
    Ok(v)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn verify_gps_attempt_report(
    bytes: &[u8],
    original_request_json: &str,
    expected_pin: &str,
) -> Result<String, String> {
    serde_json::to_string(&verify(bytes, original_request_json, expected_pin)?).map_err(crate::err)
}

#[cfg(test)]
#[path = "location_attempt_tests.rs"]
mod tests;
