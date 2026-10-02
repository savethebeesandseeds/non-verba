// SPDX-License-Identifier: AGPL-3.0-only
//! Requester-owned Android key enrollment, separate from sensor capture.
#[cfg(test)]
#[path = "key_enrollment_tests.rs"]
pub(crate) mod integration_tests;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    #[serde(rename = "type")]
    kind: String,
    purpose: String,
    nonce_b64: String,
    challenge_b64: String,
    issued_at: u64,
    expires_at: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Response {
    version: u32,
    #[serde(rename = "type")]
    kind: String,
    purpose: String,
    challenge_b64: String,
    public_spki_der_b64: String,
    spki_sha256: String,
    fingerprint: String,
    chain: Value,
    key_profile: String,
    security_level: String,
    #[serde(default)]
    strongbox_requested: bool,
    #[serde(default)]
    strongbox_fallback: bool,
    hardware_attested: bool,
    certificate_pem: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    version: u32,
    max_enrollment_age_secs: u64,
    package_name: String,
    min_version_code: u64,
    signing_certificate_sha256: Vec<String>,
    minimum_security_level: String,
    minimum_os_version: u64,
    minimum_os_patch_level: u64,
    minimum_vendor_patch_level: u64,
    minimum_boot_patch_level: u64,
}

fn bounded<T: for<'de> Deserialize<'de>>(text: &str, maximum: usize) -> Result<T, String> {
    if text.len() > maximum {
        return Err("Enrollment input exceeds its bound".into());
    }
    serde_json::from_str(text).map_err(crate::err)
}
fn shape(request: &Request) -> Result<(), String> {
    let nonce = STANDARD.decode(&request.nonce_b64).map_err(crate::err)?;
    if request.version != 1
        || request.kind != "nonverba-key-enrollment-request"
        || !matches!(request.purpose.as_str(), "media" | "location")
        || nonce.len() != 32
        || STANDARD.encode(&nonce) != request.nonce_b64
        || enrollment_challenge(request, &nonce) != request.challenge_b64
        || request.issued_at >= request.expires_at
        || request.expires_at - request.issued_at > 600
        || request.expires_at > 9_007_199_254_740_991
    {
        return Err("Invalid key enrollment request".into());
    }
    Ok(())
}
fn enrollment_challenge(request: &Request, nonce: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"nonverba-key-enrollment-request-v1\0");
    hash.update(request.purpose.as_bytes());
    hash.update([0]);
    hash.update(request.issued_at.to_be_bytes());
    hash.update(request.expires_at.to_be_bytes());
    hash.update(nonce);
    STANDARD.encode(hash.finalize())
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn create_key_enrollment_request(purpose: &str, now_secs: f64) -> Result<String, String> {
    let now = crate::seconds(now_secs)?;
    let mut random = [0u8; 32];
    getrandom::getrandom(&mut random).map_err(crate::err)?;
    let mut request = Request {
        version: 1,
        kind: "nonverba-key-enrollment-request".into(),
        purpose: purpose.into(),
        nonce_b64: STANDARD.encode(random),
        challenge_b64: String::new(),
        issued_at: now,
        expires_at: now.checked_add(600).ok_or("Invalid enrollment expiry")?,
    };
    request.challenge_b64 = enrollment_challenge(&request, &random);
    shape(&request)?;
    serde_json::to_string(&request).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn validate_key_enrollment_request(
    request_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let request: Request = bounded(request_json, 4096)?;
    shape(&request)?;
    let now = crate::seconds(now_secs)?;
    if now < request.issued_at || now >= request.expires_at {
        return Err("Enrollment request is outside its window".into());
    }
    serde_json::to_string(&request).map_err(crate::err)
}

/// The requester retains the request, policy, authenticated trust snapshot and
/// its own response-arrival time. Operator timestamps never establish arrival.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn verify_key_enrollment(
    response_json: &str,
    request_json: &str,
    policy_json: &str,
    trust_json: &str,
    response_received_at: f64,
    now_secs: f64,
) -> Result<String, String> {
    let request: Request = bounded(request_json, 4096)?;
    shape(&request)?;
    let response: Response = bounded(response_json, 256 * 1024)?;
    let policy: Policy = bounded(policy_json, 16 * 1024)?;
    if policy.version != 1
        || response.version != 1
        || response.kind != "nonverba-key-enrollment"
        || response.purpose != request.purpose
        || response.challenge_b64 != request.challenge_b64
        || response.key_profile != "attested"
        || response.hardware_attested
        || !matches!(
            response.security_level.as_str(),
            "strongbox" | "trusted-environment" | "hardware-unspecified" | "software" | "unknown"
        )
        || (response.strongbox_fallback && !response.strongbox_requested)
    {
        return Err(
            "Enrollment response does not match the original request or supported profile".into(),
        );
    }
    let spki = STANDARD
        .decode(&response.public_spki_der_b64)
        .map_err(crate::err)?;
    if spki.len() > 4096
        || STANDARD.encode(&spki) != response.public_spki_der_b64
        || crate::digest(&spki) != response.spki_sha256
    {
        return Err("Enrollment public key encoding or fingerprint is invalid".into());
    }
    let fingerprint = match request.purpose.as_str() {
        "location" => {
            if response.certificate_pem.is_some() {
                return Err("Location enrollment uses an SPKI pin, not a media certificate".into());
            }
            crate::location_proof::fingerprint_spki(&spki)?
        }
        "media" => {
            let certificate = response
                .certificate_pem
                .as_ref()
                .ok_or("Media enrollment requires its stable C2PA certificate")?;
            if crate::certificate_spki_fingerprint(certificate)? != response.spki_sha256 {
                return Err("Media certificate does not contain the enrolled key".into());
            }
            crate::certificate_fingerprint(certificate)?
        }
        _ => unreachable!(),
    };
    if fingerprint != response.fingerprint {
        return Err("Enrollment identity pin does not match its actual credential".into());
    }
    let mut expected = serde_json::to_value(&policy).map_err(crate::err)?;
    expected["challenge_b64"] = json!(request.challenge_b64);
    expected["challenge_issued_at"] = json!(request.issued_at);
    expected["challenge_expires_at"] = json!(request.expires_at);
    expected["response_received_at"] = json!(crate::seconds(response_received_at)?);
    expected["expected_spki_sha256"] = json!(response.spki_sha256);
    let attestation: Value =
        serde_json::from_str(&crate::android_attestation::verify_key_attestation(
            &response.chain.to_string(),
            &expected.to_string(),
            trust_json,
            now_secs,
        )?)
        .map_err(crate::err)?;
    Ok(json!({"version":1,"type":"nonverba-key-enrollment-verification",
        "verified":attestation["verified"],"key_enrollment_attested":attestation["key_enrollment_attested"],
        "purpose":request.purpose,"fingerprint":fingerprint,"spki_sha256":response.spki_sha256,
        "original_request":request,"expected":expected,"attestation":attestation,
        "possession_proven":false,"sensor_origin_proven":false,"acceptance_recorded":false,
        "local_replay_checked":false,"global_replay_checked":false}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enrollment_challenges_are_unpredictable_bounded_and_typed() {
        let first = create_key_enrollment_request("location", 2_000_000_000.0).unwrap();
        let second = create_key_enrollment_request("location", 2_000_000_000.0).unwrap();
        assert_ne!(first, second);
        assert!(validate_key_enrollment_request(&first, 2_000_000_599.0).is_ok());
        assert!(validate_key_enrollment_request(&first, 2_000_000_600.0).is_err());
        assert!(validate_key_enrollment_request(&first, 1_999_999_999.0).is_err());
        assert!(create_key_enrollment_request("unrestricted-signer", 2_000_000_000.0).is_err());
        let mut request: Value = serde_json::from_str(&first).unwrap();
        request["trusted"] = json!(true);
        assert!(validate_key_enrollment_request(&request.to_string(), 2_000_000_000.0).is_err());
    }
}
