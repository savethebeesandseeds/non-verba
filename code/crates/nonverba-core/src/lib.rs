// SPDX-License-Identifier: AGPL-3.0-only
//! Non-verba's shared capture protocol. C2PA owns the image binding and COSE format.
//! A challenge proves a signature was made after an unpredictable nonce was known;
//! it does not prove a physical scene was photographed then. Capture timestamps are
//! device claims. The initial identity is software-held and locally certified.

pub mod agent_appraisal;
pub mod android_attestation;
pub mod audio;
pub mod audio_capture;
pub mod audio_signal;
pub mod authentication;
pub mod camera_capture;
pub mod camera_location;
pub mod camera_quality;
pub mod evidence_session;
pub mod face_identity;
pub mod key_enrollment;
pub mod live_session;
pub mod location;
pub mod location_attempt;
pub mod location_proof;
#[cfg(not(target_arch = "wasm32"))]
pub mod native_audio_signing;
#[cfg(not(target_arch = "wasm32"))]
pub mod native_signer;
pub mod registration;
pub mod watermark;
pub mod work_privacy;

pub use authentication::{authentication_assess, authentication_create, authentication_transition};
pub use face_identity::{face_identity_assess, face_identity_enroll};
pub use registration::{registration_assess, registration_prepare};
pub use work_privacy::{work_privacy_assess, work_privacy_transition};

pub use camera_location::{seal_image_with_location_request, verify_image_with_location_proof};

pub use audio::{
    audio_probe, create_audio_demo_request, create_audio_request, create_audio_round,
    decode_audio_pcm, detect_audio_probe, encode_audio_pcm, hash_audio_pcm, seal_audio,
    validate_audio_request, verify_audio,
};

use std::io::Cursor;

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use c2pa::{
    Builder, BuilderIntent, CallbackSigner, Context, DigitalSourceType, Reader, SigningAlg,
    ValidationState,
};
use location::Location;
use p256::{
    ecdsa::{signature::Signer, Signature, SigningKey},
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
};
use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer,
    KeyIdMethod, KeyUsagePurpose, PublicKeyData, PKCS_ECDSA_P256_SHA256,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

// C2PA serializes version 1 labels without the optional `.v1` suffix.
const ASSERTION_LABEL: &str = "org.nonverba.capture";
const MAX_JSON: usize = 64 * 1024;
const MAX_IMAGE: usize = 32 * 1024 * 1024;
const MAX_LIFETIME: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Challenge {
    pub version: u32,
    pub id: String,
    pub requester: String,
    pub task: String,
    pub nonce: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Identity {
    version: u32,
    private_key_pkcs8_b64: String,
    certificate_pem: String,
    fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureAssertion {
    pub version: u32,
    pub capture_id: String,
    pub challenge: Challenge,
    pub captured_at: u64,
    pub device_fingerprint: String,
    /// Digest of the watermarked JPEG before C2PA embedding. The SDK's hard
    /// binding authenticates the final exported asset, excluding its manifest.
    pub watermarked_jpeg_sha256: String,
    pub watermark_id: String,
    pub watermark_algorithm: String,
    pub key_protection: String,
    pub capture_time_source: String,
    /// Absent only in legacy version 1 captures. Version 2 requires a fresh fix
    /// and matching standard Exif GPS fields, both bound by the C2PA signature.
    #[serde(default)]
    pub location: Option<Location>,
    /// Version 3 binds the exact independently requested location policy. Its
    /// separate COSE proof binds the final C2PA JPEG, avoiding a hash cycle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location_request: Option<Value>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Checks {
    pub c2pa_integrity: bool,
    pub challenge_match: bool,
    pub device_match: bool,
    pub capture_time_in_window: bool,
    pub capture_not_in_future: bool,
    /// None denotes a legacy version 1 capture with no location recorded.
    pub location_metadata_valid: Option<bool>,
    /// Version 3 is incomplete until its separately signed location proof is
    /// supplied and verified against this exact JPEG and requester policy.
    pub location_proof_valid: Option<bool>,
    /// Present only when a native camera acquisition assertion is attached.
    /// This validates application metadata, not attestation of the sensor path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_camera_metadata_valid: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub struct Verification {
    pub verified: bool,
    pub checks: Checks,
    pub certificate_trusted: bool,
    pub hardware_attested: bool,
    pub camera_freshness_proven: bool,
    pub location_authenticity_proven: bool,
    pub device_fingerprint: String,
    /// Parsed from the actual C2PA signer credential; meaningful only after verification.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signer_spki_sha256: String,
    pub capture: Option<CaptureAssertion>,
    pub watermark: Option<Value>,
    pub validation: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location_proof: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_camera: Option<camera_capture::CameraCaptureMetadata>,
    pub errors: Vec<String>,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn digest(bytes: impl AsRef<[u8]>) -> String {
    hex::encode(Sha256::digest(bytes.as_ref()))
}

fn seconds(value: f64) -> Result<u64, String> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > 9_007_199_254_740_991.0
    {
        return Err("Time must be nonnegative integer Unix seconds".into());
    }
    Ok(value as u64)
}

fn parse<T: for<'de> Deserialize<'de>>(value: &str) -> Result<T, String> {
    if value.len() > MAX_JSON {
        return Err("JSON input is too large".into());
    }
    serde_json::from_str(value).map_err(err)
}

fn challenge_shape(challenge: &Challenge) -> Result<(), String> {
    if challenge.version != 1 {
        return Err("Unsupported challenge version".into());
    }
    if challenge.requester.trim().is_empty()
        || challenge.requester.len() > 200
        || challenge.task.trim().is_empty()
        || challenge.task.len() > 2000
    {
        return Err("Challenge requires a requester (1–200 bytes) and task (1–2000 bytes)".into());
    }
    let nonce = URL_SAFE_NO_PAD
        .decode(&challenge.nonce)
        .map_err(|_| "Invalid challenge nonce")?;
    if nonce.len() != 32
        || URL_SAFE_NO_PAD.encode(&nonce) != challenge.nonce
        || hex::encode(&nonce) != challenge.id
    {
        return Err("Challenge must contain a canonical 256-bit nonce and matching ID".into());
    }
    let lifetime = challenge
        .expires_at
        .checked_sub(challenge.issued_at)
        .ok_or("Challenge expiry precedes issue time")?;
    if lifetime == 0 || lifetime > MAX_LIFETIME {
        return Err("Challenge lifetime must be between 1 second and 24 hours".into());
    }
    Ok(())
}

fn challenge_at(challenge: &Challenge, now: u64) -> Result<(), String> {
    challenge_shape(challenge)?;
    if now < challenge.issued_at {
        return Err("Challenge is not valid yet; check the device clock".into());
    }
    if now >= challenge.expires_at {
        return Err("Challenge has expired; request a fresh challenge".into());
    }
    Ok(())
}

fn certificate_fingerprint(certs: &str) -> Result<String, String> {
    let chain = pem::parse_many(certs).map_err(err)?;
    let leaf = chain.first().ok_or("Missing signer certificate")?;
    if leaf.tag() != "CERTIFICATE" {
        return Err("Invalid signer certificate PEM".into());
    }
    Ok(digest(leaf.contents()))
}

fn certificate_spki_fingerprint(certs: &str) -> Result<String, String> {
    use x509_parser::prelude::{FromDer, X509Certificate};
    if certs.len() > 64 * 1024 {
        return Err("Signer certificate chain exceeds its limit".into());
    }
    let chain = pem::parse_many(certs).map_err(err)?;
    let leaf = chain.first().ok_or("Missing signer certificate")?;
    if leaf.tag() != "CERTIFICATE" {
        return Err("Invalid signer certificate PEM".into());
    }
    let (remaining, certificate) = X509Certificate::from_der(leaf.contents()).map_err(err)?;
    if !remaining.is_empty() {
        return Err("Signer certificate has trailing DER data".into());
    }
    Ok(digest(certificate.public_key().raw))
}

// rcgen serializes X.509; the same RustCrypto P-256 implementation signs both
// certificates and C2PA claims. This avoids a C/assembly crypto dependency in WASM.
struct CertificateKey {
    key: SigningKey,
    public: Vec<u8>,
}

impl CertificateKey {
    fn generate() -> Result<Self, String> {
        loop {
            let mut scalar = Zeroizing::new([0u8; 32]);
            getrandom::getrandom(scalar.as_mut()).map_err(err)?;
            if let Ok(key) = SigningKey::from_slice(scalar.as_slice()) {
                let public = key
                    .verifying_key()
                    .to_encoded_point(false)
                    .as_bytes()
                    .to_vec();
                return Ok(Self { key, public });
            }
        }
    }

    fn configure_certificate(&self, params: &mut CertificateParams) {
        let mut serial = Sha256::digest(&self.public)[..20].to_vec();
        serial[0] &= 0x7f;
        params.serial_number = Some(serial.into());
        params.key_identifier_method = KeyIdMethod::PreSpecified(
            Sha256::digest(self.subject_public_key_info())[..20].to_vec(),
        );
    }
}

impl PublicKeyData for CertificateKey {
    fn der_bytes(&self) -> &[u8] {
        &self.public
    }
    fn algorithm(&self) -> &'static rcgen::SignatureAlgorithm {
        &PKCS_ECDSA_P256_SHA256
    }
}

impl rcgen::SigningKey for CertificateKey {
    fn sign(&self, message: &[u8]) -> Result<Vec<u8>, rcgen::Error> {
        let signature: Signature = self.key.sign(message);
        Ok(signature.to_der().as_bytes().to_vec())
    }
}

/// Generate a unique device-local software key and a local, untrusted certificate
/// chain. No common private key is packaged in the application.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_identity() -> Result<String, String> {
    let ca_key = CertificateKey::generate()?;
    let mut ca_params = CertificateParams::default();
    ca_params
        .distinguished_name
        .push(DnType::CommonName, "Non-verba local development issuer");
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    ca_key.configure_certificate(&mut ca_params);
    let ca_cert = ca_params.self_signed(&ca_key).map_err(err)?;
    let issuer = Issuer::new(ca_params, ca_key);
    let key = CertificateKey::generate()?;
    let mut params = CertificateParams::default();
    params.distinguished_name.push(
        DnType::CommonName,
        "Non-verba device-local software identity",
    );
    params.is_ca = IsCa::ExplicitNoCa;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![
        ExtendedKeyUsagePurpose::EmailProtection,
        ExtendedKeyUsagePurpose::Other(vec![1, 3, 6, 1, 4, 1, 62558, 2, 1]),
    ];
    params.use_authority_key_identifier_extension = true;
    key.configure_certificate(&mut params);
    let cert = params.signed_by(&key, &issuer).map_err(err)?;
    let certificate_pem = format!("{}{}", cert.pem(), ca_cert.pem());
    let identity = Identity {
        version: 1,
        private_key_pkcs8_b64: STANDARD.encode(key.key.to_pkcs8_der().map_err(err)?.as_bytes()),
        fingerprint: certificate_fingerprint(&certificate_pem)?,
        certificate_pem,
    };
    serde_json::to_string(&identity).map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn identity_fingerprint(identity_json: &str) -> Result<String, String> {
    let identity: Identity = parse(identity_json)?;
    if identity.version != 1 {
        return Err("Unsupported identity version".into());
    }
    certificate_fingerprint(&identity.certificate_pem)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_challenge(
    requester: &str,
    task: &str,
    now_secs: f64,
    lifetime_secs: u32,
) -> Result<String, String> {
    let now = seconds(now_secs)?;
    let mut nonce = [0u8; 32];
    getrandom::getrandom(&mut nonce).map_err(err)?;
    let challenge = Challenge {
        version: 1,
        id: hex::encode(nonce),
        requester: requester.trim().into(),
        task: task.trim().into(),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        issued_at: now,
        expires_at: now
            .checked_add(lifetime_secs as u64)
            .ok_or("Invalid expiry")?,
    };
    challenge_shape(&challenge)?;
    serde_json::to_string(&challenge).map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_challenge(challenge_json: &str, now_secs: f64) -> Result<String, String> {
    let challenge: Challenge = parse(challenge_json)?;
    challenge_at(&challenge, seconds(now_secs)?)?;
    serde_json::to_string(&challenge).map_err(err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_location(
    location_json: &str,
    challenge_json: &str,
    capture_time_secs: f64,
) -> Result<String, String> {
    let challenge: Challenge = parse(challenge_json)?;
    let location: Location = parse(location_json)?;
    location.validate(&challenge, seconds(capture_time_secs)?)?;
    serde_json::to_string(&location).map_err(err)
}

fn context() -> Result<Context, String> {
    // Local trust is intentionally disabled: integrity and an explicitly pinned
    // leaf fingerprint are the v1 assurance. Do not label this C2PA CA trust.
    Context::new()
        .with_settings(json!({
            "verify": {"verify_after_sign": true, "verify_trust": false},
            "builder": {"thumbnail": {"enabled": false}}
        }))
        .map_err(err)
}

fn local_signer(identity: &Identity) -> Result<CallbackSigner, String> {
    if identity.version != 1
        || certificate_fingerprint(&identity.certificate_pem)? != identity.fingerprint
    {
        return Err("Identity certificate fingerprint mismatch".into());
    }
    let bytes = Zeroizing::new(
        STANDARD
            .decode(&identity.private_key_pkcs8_b64)
            .map_err(err)?,
    );
    let key = SigningKey::from_pkcs8_der(&bytes).map_err(err)?;
    Ok(CallbackSigner::new(
        move |_, data: &[u8]| {
            let signature: Signature = key.sign(data);
            Ok(signature.to_bytes().to_vec())
        },
        SigningAlg::Es256,
        identity.certificate_pem.as_bytes().to_vec(),
    ))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn seal_image(
    image_bytes: &[u8],
    challenge_json: &str,
    identity_json: &str,
    now_secs: f64,
    location_json: &str,
) -> Result<Vec<u8>, String> {
    seal_image_impl(
        image_bytes,
        challenge_json,
        identity_json,
        now_secs,
        location_json,
        None,
    )
    .await
}

async fn seal_image_impl(
    image_bytes: &[u8],
    challenge_json: &str,
    identity_json: &str,
    now_secs: f64,
    location_json: &str,
    location_request: Option<Value>,
) -> Result<Vec<u8>, String> {
    let identity: Identity = parse(identity_json)?;
    let signer = local_signer(&identity)?;
    let (mut builder, mut source) = prepare_image(
        image_bytes,
        challenge_json,
        now_secs,
        location_json,
        location_request,
        ImageSigningIdentity {
            fingerprint: &identity.fingerprint,
            protection: "device-local-software-key",
        },
    )?;
    let mut destination = Cursor::new(Vec::new());
    builder
        .sign_async(&signer, "image/jpeg", &mut source, &mut destination)
        .await
        .map_err(err)?;
    Ok(destination.into_inner())
}

/// Shared preparation keeps native and WASM validation and media transforms identical.
/// The identity describes signing only; it does not assert a sensor acquisition path.
pub(crate) struct ImageSigningIdentity<'a> {
    fingerprint: &'a str,
    protection: &'a str,
}

pub(crate) fn prepare_image(
    image_bytes: &[u8],
    challenge_json: &str,
    now_secs: f64,
    location_json: &str,
    location_request: Option<Value>,
    identity: ImageSigningIdentity<'_>,
) -> Result<(Builder, Cursor<Vec<u8>>), String> {
    if image_bytes.len() > MAX_IMAGE {
        return Err("JPEG exceeds the 32 MiB limit".into());
    }
    let now = seconds(now_secs)?;
    let challenge: Challenge = parse(challenge_json)?;
    challenge_at(&challenge, now)?;
    let location: Location = parse(location_json)?;
    location.validate(&challenge, now)?;
    let challenge_bytes = serde_json::to_vec(&challenge).map_err(err)?;
    let mut capture_hash = Sha256::new();
    capture_hash.update(b"non-verba/capture/v2\0");
    capture_hash.update(challenge_bytes);
    capture_hash.update(Sha256::digest(image_bytes));
    capture_hash.update(identity.fingerprint.as_bytes());
    capture_hash.update(now.to_le_bytes());
    capture_hash.update(serde_json::to_vec(&location).map_err(err)?);
    let capture_digest = capture_hash.finalize();
    let mut watermark_id = [0u8; 8];
    watermark_id.copy_from_slice(&capture_digest[..8]);
    let watermarked = watermark::embed(image_bytes, watermark_id)?;
    // Re-encoding the watermark discards metadata. Add fresh Exif only now,
    // before hashing and C2PA signing so the GPS record is hard-bound as well.
    let watermarked = location::embed(&watermarked, &location)?;
    let capture = CaptureAssertion {
        version: if location_request.is_some() { 3 } else { 2 },
        capture_id: hex::encode(capture_digest),
        challenge,
        captured_at: now,
        device_fingerprint: identity.fingerprint.into(),
        watermarked_jpeg_sha256: digest(&watermarked),
        watermark_id: hex::encode(watermark_id),
        watermark_algorithm: "org.nonverba.dct-qim.v1".into(),
        key_protection: identity.protection.into(),
        capture_time_source: "unattested-device-clock".into(),
        location: Some(location),
        location_request,
    };
    let mut builder = Builder::from_context(context()?)
        .with_definition(json!({
            "title": "Non-verba challenge capture",
            "claim_generator_info": [{"name": "Non-verba", "version": env!("CARGO_PKG_VERSION")}]
        }))
        .map_err(err)?;
    builder.set_intent(BuilderIntent::Create(DigitalSourceType::DigitalCapture));
    builder
        .add_assertion(ASSERTION_LABEL, &capture)
        .map_err(err)?;
    Ok((builder, Cursor::new(watermarked)))
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn extract_watermark(image_bytes: &[u8]) -> Result<String, String> {
    let mark = watermark::extract(image_bytes)?;
    Ok(json!({"id": hex::encode(mark.id), "confidence": mark.confidence, "authenticity_proven": false}).to_string())
}

/// Verification is historical: a challenge may be expired today, as long as the
/// signed capture time was in its window. Requester acceptance/replay tracking is
/// a separate stateful operation and must not use this function alone.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub async fn verify_image(
    image_bytes: &[u8],
    expected_challenge_json: &str,
    expected_device_fingerprint: &str,
    now_secs: f64,
) -> Result<String, String> {
    serde_json::to_string(
        &verify_image_report(
            image_bytes,
            expected_challenge_json,
            expected_device_fingerprint,
            now_secs,
        )
        .await?,
    )
    .map_err(err)
}

/// Typed native result; the JSON/WASM entry point only encodes this report.
pub async fn verify_image_report(
    image_bytes: &[u8],
    expected_challenge_json: &str,
    expected_device_fingerprint: &str,
    now_secs: f64,
) -> Result<Verification, String> {
    if image_bytes.len() > MAX_IMAGE {
        return Err("JPEG exceeds the 32 MiB limit".into());
    }
    let now = seconds(now_secs)?;
    let expected: Challenge = parse(expected_challenge_json)?;
    challenge_shape(&expected)?;
    let mut result = Verification {
        verified: false,
        checks: Checks::default(),
        certificate_trusted: false,
        hardware_attested: false,
        camera_freshness_proven: false,
        location_authenticity_proven: false,
        device_fingerprint: String::new(),
        signer_spki_sha256: String::new(),
        capture: None,
        watermark: None,
        validation: Value::Null,
        location_proof: None,
        native_camera: None,
        errors: Vec::new(),
    };
    if let Ok(mark) = watermark::extract(image_bytes) {
        result.watermark = Some(json!({"id": hex::encode(mark.id), "confidence": mark.confidence}));
    }
    let reader = match Reader::from_context(context()?)
        .with_stream_async("image/jpeg", Cursor::new(image_bytes))
        .await
    {
        Ok(reader) => reader,
        Err(error) => {
            result
                .errors
                .push(format!("C2PA manifest cannot be validated: {error}"));
            return Ok(result);
        }
    };
    result.validation = serde_json::to_value(reader.validation_results()).map_err(err)?;
    result.checks.c2pa_integrity = matches!(
        reader.validation_state(),
        ValidationState::Valid | ValidationState::Trusted
    );
    let manifest = reader.active_manifest().ok_or("No active C2PA manifest")?;
    if let Some(signature) = manifest.signature_info() {
        result.device_fingerprint =
            certificate_fingerprint(signature.cert_chain()).unwrap_or_default();
        result.signer_spki_sha256 =
            certificate_spki_fingerprint(signature.cert_chain()).unwrap_or_default();
    }
    match manifest.find_assertion::<CaptureAssertion>(ASSERTION_LABEL) {
        Ok(capture) => {
            result.checks.challenge_match =
                matches!(capture.version, 1..=3) && capture.challenge == expected;
            result.checks.device_match = !result.device_fingerprint.is_empty()
                && result.device_fingerprint == expected_device_fingerprint
                && capture.device_fingerprint == result.device_fingerprint;
            result.checks.capture_time_in_window =
                challenge_at(&capture.challenge, capture.captured_at).is_ok();
            result.checks.capture_not_in_future = capture.captured_at <= now;
            result.checks.location_metadata_valid = match (capture.version, &capture.location) {
                (1, None) => None,
                (2 | 3, Some(location)) => Some(
                    location
                        .validate(&capture.challenge, capture.captured_at)
                        .and_then(|()| location::matches(image_bytes, location))
                        .map_err(|error| {
                            result
                                .errors
                                .push(format!("Location metadata failed: {error}"))
                        })
                        .is_ok(),
                ),
                _ => Some(false),
            };
            if capture.version == 3 || capture.location_request.is_some() {
                result.checks.location_proof_valid = Some(false);
                result.errors.push(camera_location::PROOF_REQUIRED.into());
            }
            result.capture = Some(capture);
        }
        Err(error) => result.errors.push(format!(
            "Missing or malformed Non-verba capture assertion: {error}"
        )),
    }
    match camera_capture::read_assertion(manifest, result.capture.as_ref(), image_bytes, now) {
        Ok(Some(metadata)) => {
            result.checks.native_camera_metadata_valid = Some(true);
            result.native_camera = Some(metadata);
        }
        Ok(None) => {}
        Err(error) => {
            result.checks.native_camera_metadata_valid = Some(false);
            result
                .errors
                .push(format!("Native camera metadata failed: {error}"));
        }
    }
    let checks = &result.checks;
    result.verified = checks.c2pa_integrity
        && checks.challenge_match
        && checks.device_match
        && checks.capture_time_in_window
        && checks.capture_not_in_future
        && checks.location_metadata_valid != Some(false)
        && checks.native_camera_metadata_valid != Some(false)
        && checks.location_proof_valid != Some(false);
    for (passed, message) in [
        (
            checks.c2pa_integrity,
            "C2PA signature or image binding failed",
        ),
        (
            checks.challenge_match,
            "Signed challenge differs from the expected requester challenge",
        ),
        (
            checks.device_match,
            "Signer certificate does not match the pinned device identity",
        ),
        (
            checks.capture_time_in_window,
            "Claimed capture time is outside the challenge window",
        ),
        (
            checks.capture_not_in_future,
            "Claimed capture time is in the future",
        ),
        (
            checks.location_metadata_valid != Some(false),
            "GPS metadata is missing, invalid, or differs from the signed location",
        ),
    ] {
        if !passed {
            result.errors.push(message.into());
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on;

    const NOW: f64 = 1_790_251_200.0;

    fn location_json() -> String {
        json!({"latitude":47.4979,"longitude":19.0402,"accuracy_m":12.25,
            "altitude_m":-32.75,"altitude_accuracy_m":5.0,
            "timestamp_ms":NOW * 1000.0,"source":"device-geolocation"})
        .to_string()
    }

    fn jpeg() -> Vec<u8> {
        let image = image::RgbImage::from_fn(640, 480, |x, y| {
            image::Rgb([
                (48 + x / 4 % 160) as u8,
                (48 + y / 3 % 160) as u8,
                (64 + (x + y) / 5 % 128) as u8,
            ])
        });
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 95)
            .encode_image(&image)
            .unwrap();
        bytes
    }

    #[test]
    fn challenges_are_unpredictable_and_expiry_is_exclusive() {
        let first = create_challenge("requester", "Inspect the site", NOW, 60).unwrap();
        let second = create_challenge("requester", "Inspect the site", NOW, 60).unwrap();
        assert_ne!(first, second);
        assert!(validate_challenge(&first, NOW + 59.0).is_ok());
        assert!(validate_challenge(&first, NOW + 60.0).is_err());
        assert!(validate_challenge(&first, NOW - 1.0).is_err());
        assert!(create_challenge("", "task", NOW, 60).is_err());
        assert!(create_challenge("r", "task", NOW, 0).is_err());
    }

    #[test]
    fn c2pa_roundtrip_checks_challenge_pin_and_tampering() {
        let identity = create_identity().unwrap();
        let fingerprint = identity_fingerprint(&identity).unwrap();
        let challenge = create_challenge("requester", "Inspect the site", NOW, 60).unwrap();
        let sealed = block_on(seal_image(
            &jpeg(),
            &challenge,
            &identity,
            NOW + 2.0,
            &location_json(),
        ))
        .unwrap();
        let verify = |bytes: &[u8], expected: &str, pin: &str| -> Verification {
            serde_json::from_str(
                &block_on(verify_image(bytes, expected, pin, NOW + 120.0)).unwrap(),
            )
            .unwrap()
        };
        let valid = verify(&sealed, &challenge, &fingerprint);
        assert!(valid.verified, "{}", serde_json::to_string(&valid).unwrap());
        assert!(!valid.certificate_trusted);
        assert!(!valid.hardware_attested);
        assert!(!valid.camera_freshness_proven);
        assert!(!valid.location_authenticity_proven);
        assert_eq!(valid.checks.location_metadata_valid, Some(true));
        let capture = valid.capture.unwrap();
        assert_eq!(capture.version, 2);
        assert_eq!(
            capture.location.unwrap(),
            parse::<Location>(&location_json()).unwrap()
        );
        let exif = exif::Reader::new()
            .read_from_container(&mut Cursor::new(&sealed))
            .unwrap();
        assert!(exif
            .get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY)
            .is_some());
        let different_challenge =
            create_challenge("requester", "Inspect the site", NOW, 60).unwrap();
        assert!(!verify(&sealed, &different_challenge, &fingerprint).verified);
        assert!(!verify(&sealed, &challenge, &"0".repeat(64)).verified);
        assert!(!verify(&sealed, &challenge, "").verified);
        let other_device = create_identity().unwrap();
        let other_sealed = block_on(seal_image(
            &jpeg(),
            &challenge,
            &other_device,
            NOW + 2.0,
            &location_json(),
        ))
        .unwrap();
        assert!(!verify(&other_sealed, &challenge, &fingerprint).verified);
        let mut altered = sealed.clone();
        // JPEG entropy bytes lie after the SOS header. Alter a non-marker byte:
        // the manifest should still parse but C2PA's asset hash must fail.
        let sos = altered.windows(2).position(|w| w == [0xff, 0xda]).unwrap();
        let at = sos + 32;
        altered[at] ^= 1;
        assert!(!verify(&altered, &challenge, &fingerprint).verified);
        assert!(block_on(seal_image(
            &jpeg(),
            &challenge,
            &identity,
            NOW + 60.0,
            &location_json()
        ))
        .is_err());
        let mut changed: Value = serde_json::from_str(&challenge).unwrap();
        changed["task"] = json!("Different purpose");
        assert!(!verify(&sealed, &changed.to_string(), &fingerprint).verified);
    }

    #[test]
    fn malformed_challenges_and_forged_identity_fingerprints_fail() {
        let challenge = create_challenge("r", "task", NOW, 60).unwrap();
        let mut changed: Value = serde_json::from_str(&challenge).unwrap();
        changed["nonce"] = json!("a-short-nonce");
        assert!(validate_challenge(&changed.to_string(), NOW).is_err());
        let mut identity: Value = serde_json::from_str(&create_identity().unwrap()).unwrap();
        identity["fingerprint"] = json!("0".repeat(64));
        assert!(block_on(seal_image(
            &jpeg(),
            &challenge,
            &identity.to_string(),
            NOW,
            &location_json()
        ))
        .is_err());
    }

    #[test]
    fn required_location_is_strict_and_fresh_for_the_current_challenge() {
        let challenge = create_challenge("r", "task", NOW, 120).unwrap();
        let fixture: Value = parse(&location_json()).unwrap();
        for (field, bad) in [
            ("latitude", json!(91)),
            ("longitude", json!(-181)),
            ("accuracy_m", json!(-1)),
            ("altitude_accuracy_m", json!(-1)),
            ("source", json!("manual")),
            ("timestamp_ms", json!(NOW * 1000.0 - 1.0)),
            ("timestamp_ms", json!((NOW + 2.0) * 1000.0 + 1001.0)),
            ("timestamp_ms", json!(NOW * 1000.0 + 0.5)),
            ("unknown", json!(true)),
        ] {
            let mut bad_fix = fixture.clone();
            bad_fix[field] = bad;
            assert!(
                validate_location(&bad_fix.to_string(), &challenge, NOW + 2.0).is_err(),
                "{bad_fix}"
            );
        }
        assert!(validate_location("null", &challenge, NOW).is_err());
        assert!(validate_location("{}", &challenge, NOW).is_err());
        assert!(validate_location(&fixture.to_string(), &challenge, NOW + 30.0).is_ok());
        assert!(validate_location(&fixture.to_string(), &challenge, NOW + 31.0).is_err());
        let mut future = fixture.clone();
        future["timestamp_ms"] = json!((NOW + 3.0) * 1000.0);
        assert!(validate_location(&future.to_string(), &challenge, NOW + 2.0).is_ok());
        let challenge_parsed: Challenge = parse(&challenge).unwrap();
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut invalid: Location = parse(&fixture.to_string()).unwrap();
            invalid.latitude = value;
            assert!(invalid.validate(&challenge_parsed, NOW as u64).is_err());
        }
        let identity = create_identity().unwrap();
        assert!(block_on(seal_image(&jpeg(), &challenge, &identity, NOW, "null")).is_err());
        assert!(block_on(seal_image(
            &jpeg(),
            &challenge,
            &identity,
            NOW + 31.0,
            &fixture.to_string()
        ))
        .is_err());
    }

    #[test]
    fn exif_tampering_and_signed_exif_disagreement_fail_but_legacy_remains_valid() {
        let identity_json = create_identity().unwrap();
        let identity: Identity = parse(&identity_json).unwrap();
        let challenge_json = create_challenge("r", "task", NOW, 60).unwrap();
        let challenge: Challenge = parse(&challenge_json).unwrap();
        let sealed = block_on(seal_image(
            &jpeg(),
            &challenge_json,
            &identity_json,
            NOW,
            &location_json(),
        ))
        .unwrap();
        let verify = |bytes: &[u8]| -> Verification {
            parse(
                &block_on(verify_image(
                    bytes,
                    &challenge_json,
                    &identity.fingerprint,
                    NOW + 120.0,
                ))
                .unwrap(),
            )
            .unwrap()
        };
        let report = verify(&sealed);
        assert!(report.verified);
        // Change the Exif latitude numerator while leaving the JPEG pixels intact.
        let mut altered = sealed.clone();
        let pattern = [
            47u32.to_le_bytes(),
            1u32.to_le_bytes(),
            29u32.to_le_bytes(),
            1u32.to_le_bytes(),
        ]
        .concat();
        let at = altered
            .windows(pattern.len())
            .position(|bytes| bytes == pattern)
            .unwrap();
        altered[at] = 46;
        let tampered = verify(&altered);
        assert!(!tampered.verified);
        assert!(!tampered.checks.c2pa_integrity);
        assert_eq!(tampered.checks.location_metadata_valid, Some(false));

        // A valid signature alone is insufficient when its assertion contradicts
        // ordinary Exif. Deliberately sign a contradictory v2 record to test that.
        let mut capture = report.capture.unwrap();
        let image = location::embed(&jpeg(), &capture.location.clone().unwrap()).unwrap();
        capture.location.as_mut().unwrap().latitude -= 1.0;
        let sign = |source: Vec<u8>, assertion: &Value| -> Vec<u8> {
            let mut builder = Builder::from_context(context().unwrap());
            builder.set_intent(BuilderIntent::Create(DigitalSourceType::DigitalCapture));
            builder.add_assertion(ASSERTION_LABEL, assertion).unwrap();
            let mut destination = Cursor::new(Vec::new());
            block_on(builder.sign_async(
                &local_signer(&identity).unwrap(),
                "image/jpeg",
                &mut Cursor::new(source),
                &mut destination,
            ))
            .unwrap();
            destination.into_inner()
        };
        let contradictory = verify(&sign(image, &serde_json::to_value(&capture).unwrap()));
        assert!(contradictory.checks.c2pa_integrity);
        assert_eq!(contradictory.checks.location_metadata_valid, Some(false));
        assert!(!contradictory.verified);

        // v1 genuinely lacked location. It stays historically verifiable and is
        // explicitly reported as absent, never upgraded to a location assurance.
        let mut legacy = serde_json::to_value(&capture).unwrap();
        legacy["version"] = json!(1);
        legacy["challenge"] = serde_json::to_value(challenge).unwrap();
        legacy.as_object_mut().unwrap().remove("location");
        let legacy_report = verify(&sign(jpeg(), &legacy));
        assert!(legacy_report.verified);
        assert_eq!(legacy_report.checks.location_metadata_valid, None);
        assert!(legacy_report.capture.unwrap().location.is_none());
        legacy["version"] = json!(2);
        let missing = verify(&sign(jpeg(), &legacy));
        assert!(missing.checks.c2pa_integrity);
        assert!(!missing.verified);
        assert_eq!(missing.checks.location_metadata_valid, Some(false));
    }
}
