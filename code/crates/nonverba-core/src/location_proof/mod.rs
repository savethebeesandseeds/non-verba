// SPDX-License-Identifier: AGPL-3.0-only
//! Independently requestable location evidence, composable with a media digest.
//! RFC 9052 COSE_Sign1/ES256 authenticates the exact payload. All location, clock,
//! Android-provider and Keystore profile claims remain unauthenticated sensor
//! claims unless a future, separately verified attestation scheme supplies trust.
mod cose;
mod model;
pub mod position;
mod raw_gnss;
mod validation;

pub use cose::{fingerprint_spki, MAX_PROOF_BYTES};
pub use model::{
    AssetBinding, Checks, Context, Evidence, Policy, Request, Sample, Trace, Verification,
};
pub use raw_gnss::{
    evaluate_raw_gnss, evaluate_raw_gnss_collection, RawGnssChecks, RawGnssClock,
    RawGnssCollectionAction, RawGnssCollectionProgress, RawGnssEpoch, RawGnssMeasurement,
    RawGnssPolicy, RawGnssTrace, MAX_RAW_GNSS_EPOCHS, MAX_RAW_GNSS_MEASUREMENTS,
    RAW_GNSS_INTERVAL_MS,
};
pub use validation::{validate_asset, validate_policy, validate_request, validate_trace};

use base64::{engine::general_purpose::STANDARD, Engine};
use p256::{
    ecdsa::{signature::Signer, Signature, SigningKey},
    pkcs8::{DecodePrivateKey, EncodePublicKey},
};
use serde::{de::DeserializeOwned, Serialize};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

pub const MAX_REQUEST_JSON_BYTES: usize = 64 * 1024;
pub const MAX_TRACE_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_JSON: usize = MAX_TRACE_JSON_BYTES;

pub(super) fn parse_json<T: DeserializeOwned>(text: &str) -> Result<T, String> {
    if text.len() > MAX_JSON {
        return Err("Location JSON exceeds the size limit".into());
    }
    serde_json::from_str(text).map_err(crate::err)
}
pub fn parse_request(text: &str) -> Result<Request, String> {
    if text.len() > MAX_REQUEST_JSON_BYTES {
        return Err("Location request exceeds the size limit".into());
    }
    parse_json(text)
}
pub fn parse_trace(text: &str) -> Result<Trace, String> {
    parse_json(text)
}
fn json(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(crate::err)
}
fn millis(seconds: f64) -> Result<u64, String> {
    let value = crate::seconds(seconds)?
        .checked_mul(1000)
        .ok_or("Invalid location time")?;
    if value > validation::MAX_SAFE_INTEGER {
        return Err("Location time exceeds safe integer range".into());
    }
    Ok(value)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_location_request(
    requester: &str,
    task: &str,
    now_secs: f64,
    lifetime_secs: u32,
    policy_json: &str,
    context_json: &str,
) -> Result<String, String> {
    let policy: Option<Policy> = parse_json(policy_json)?;
    let request = Request {
        version: 1,
        kind: "nonverba-location-request".into(),
        challenge: crate::parse(&crate::create_challenge(
            requester,
            task,
            now_secs,
            lifetime_secs,
        )?)?,
        demo: false,
        policy: policy.unwrap_or_default(),
        context: parse_json(context_json)?,
    };
    validate_request(&request, millis(now_secs)?)?;
    json(&request)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_location_demo_request(now_secs: f64) -> Result<String, String> {
    let mut request = parse_request(&create_location_request(
        "Local demo — same device",
        "DEMO ONLY: device-reported location collection. No independent requester.",
        now_secs,
        900,
        "null",
        "null",
    )?)?;
    request.policy.max_finalization_delay_ms = Some(30_000);
    request.demo = true;
    request.context = Some(Context {
        camera_timing: None,
        session_id: request.challenge.id.clone(),
        purpose: "standalone".into(),
    });
    json(&request)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_location_request(request_json: &str, now_secs: f64) -> Result<String, String> {
    let request = parse_request(request_json)?;
    validate_request(&request, millis(now_secs)?)?;
    json(&request)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_location_trace(trace_json: &str, now_secs: f64) -> Result<String, String> {
    let trace = parse_trace(trace_json)?;
    validate_trace(&trace, millis(now_secs)?)?;
    json(&trace)
}

fn software_key(identity_json: &str) -> Result<SigningKey, String> {
    let identity: crate::Identity = crate::parse(identity_json)?;
    if identity.version != 1 {
        return Err("Unsupported software signing identity".into());
    }
    let bytes = Zeroizing::new(
        STANDARD
            .decode(&identity.private_key_pkcs8_b64)
            .map_err(crate::err)?,
    );
    SigningKey::from_pkcs8_der(&bytes).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn location_identity(identity_json: &str) -> Result<String, String> {
    let key = software_key(identity_json)?;
    let public = key
        .verifying_key()
        .to_public_key_der()
        .map_err(crate::err)?;
    json(
        &serde_json::json!({"public_spki_der_b64":STANDARD.encode(public.as_bytes()),"fingerprint":fingerprint_spki(public.as_bytes())?,"profile":"software-browser"}),
    )
}

pub fn asset_from_jpeg(bytes: &[u8]) -> Result<AssetBinding, String> {
    if bytes.len() < 4 || bytes.len() > crate::MAX_IMAGE || !bytes.starts_with(&[0xff, 0xd8, 0xff])
    {
        return Err("Location media binding requires bounded JPEG bytes".into());
    }
    // This binds bytes; JPEG decoding and the image's own provenance validation
    // belong to the camera verifier, rather than this reusable proof layer.
    Ok(AssetBinding {
        kind: "image/jpeg".into(),
        sha256: crate::digest(bytes),
    })
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn location_asset(image_bytes: &[u8]) -> Result<String, String> {
    json(&asset_from_jpeg(image_bytes)?)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn seal_location_proof(
    trace_json: &str,
    identity_json: &str,
    asset_json: &str,
    now_secs: f64,
) -> Result<Vec<u8>, String> {
    let trace = parse_trace(trace_json)?;
    if trace.profile != "software-browser" {
        return Err("The browser signer only creates software-browser location claims".into());
    }
    let key = software_key(identity_json)?;
    let public = key
        .verifying_key()
        .to_public_key_der()
        .map_err(crate::err)?;
    let evidence = cose::make_evidence(
        &trace,
        public.as_bytes(),
        parse_json(asset_json)?,
        millis(now_secs)?,
    )?;
    cose::sign_evidence(&evidence, |bytes| {
        let signature: Signature = key.sign(bytes);
        Ok(signature.to_bytes().to_vec())
    })
}

/// Native-only entry: the adapter must construct the trace itself from native
/// callbacks. The callback signs the full COSE Sig_structure using SHA256withECDSA
/// and may return DER (Android) or fixed-width r||s. No private key is exported.
/// The resulting android-keystore/source claim is not remote attestation.
#[cfg(not(target_arch = "wasm32"))]
pub fn seal_with_signer<F>(
    trace: &Trace,
    public_spki_der: &[u8],
    asset: Option<AssetBinding>,
    now_ms: u64,
    signer: F,
) -> Result<Vec<u8>, String>
where
    F: FnOnce(&[u8]) -> Result<Vec<u8>, String>,
{
    if trace.profile != "native-android" {
        return Err("Native signing requires a native-android trace".into());
    }
    let evidence = cose::make_evidence(trace, public_spki_der, asset, now_ms)?;
    cose::sign_evidence(&evidence, signer)
}

/// Verify against separately retained expected values. Historical verification
/// does not expire evidence: sample age is evaluated at collection/sealing time.
/// A media proof requires the caller to provide the independently computed asset
/// binding; passing null accepts standalone evidence only.
pub fn verify(
    proof: &[u8],
    expected_request: &Request,
    expected_pin: &str,
    expected_asset: Option<&AssetBinding>,
    now_ms: u64,
) -> Result<Verification, String> {
    validation::request_shape(expected_request)?;
    if !validation::canonical_hash(expected_pin) {
        return Err("Expected location key must be a lowercase SHA-256 SPKI fingerprint".into());
    }
    if let Some(asset) = expected_asset {
        validate_asset(asset)?;
    }
    if now_ms > validation::MAX_SAFE_INTEGER {
        return Err("Invalid verification time".into());
    }
    let mut report = Verification {
        verified: false,
        checks: Checks::default(),
        profile: String::new(),
        demo: false,
        key_protection: String::new(),
        device_fingerprint: String::new(),
        selected_location: None,
        evidence: None,
        hardware_attested: false,
        collection_attested: false,
        location_authenticity_proven: false,
        clock_trusted: false,
        raw_gnss: None,
        errors: Vec::new(),
    };
    let (evidence, pin, signature_valid) = match cose::read_message(proof) {
        Ok(value) => value,
        Err(error) => {
            report.errors.push(error);
            return Ok(report);
        }
    };
    let (mut checks, mut errors) =
        validation::evaluate(&evidence.trace, evidence.sealed_at_ms, now_ms);
    checks.signature_integrity = signature_valid;
    checks.device_match = pin == expected_pin;
    checks.request_match = evidence.trace.request == *expected_request;
    checks.asset_binding = evidence.asset.as_ref() == expected_asset;
    for (passed, message) in [
        (
            checks.signature_integrity,
            "Location COSE signature is invalid",
        ),
        (
            checks.device_match,
            "Location key does not match the pinned operator SPKI fingerprint",
        ),
        (
            checks.request_match,
            "Location request does not match the independently retained request",
        ),
        (
            checks.asset_binding,
            "Location proof is bound to a different media asset or context",
        ),
    ] {
        if !passed {
            errors.push(message.into());
        }
    }
    report.verified = errors.is_empty();
    report.checks = checks;
    report.profile = evidence.trace.profile.clone();
    report.demo = evidence.trace.request.demo;
    report.key_protection = evidence.key_protection.clone();
    report.device_fingerprint = pin;
    report.selected_location = evidence.trace.samples.last().cloned();
    if evidence.trace.request.policy.raw_gnss.is_some() || evidence.trace.raw_gnss.is_some() {
        report.raw_gnss = Some(raw_gnss::evaluate_at(
            &evidence.trace,
            evidence.sealed_at_ms,
        ));
    }
    report.evidence = Some(evidence);
    report.errors = errors;
    Ok(report)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn verify_location_proof(
    proof_bytes: &[u8],
    expected_request_json: &str,
    expected_pin: &str,
    expected_asset_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let request = parse_request(expected_request_json)?;
    let asset: Option<AssetBinding> = parse_json(expected_asset_json)?;
    json(&verify(
        proof_bytes,
        &request,
        expected_pin,
        asset.as_ref(),
        millis(now_secs)?,
    )?)
}

#[cfg(test)]
mod raw_gnss_tests;
#[cfg(test)]
mod tests;
