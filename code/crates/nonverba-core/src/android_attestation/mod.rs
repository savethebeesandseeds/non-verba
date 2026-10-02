// SPDX-License-Identifier: AGPL-3.0-only
//! Portable, deliberately restricted Android key-enrollment attestation verifier.
//!
//! Expectations and roots/revocation state belong to the independent verifier.
//! This module never fetches trust material, accepts an operator's verdict, changes
//! a device identity, or equates enrollment state with later sensor authenticity.
use base64::{engine::general_purpose::STANDARD, Engine};
use c2pa_raw_crypto::{oids::*, validator_for_sig_and_hash_algs};
use p256::pkcs8::DecodePublicKey;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashSet};
use x509_parser::{extensions::ParsedExtension, prelude::*, public_key::PublicKey};
mod der;
mod extension;
#[cfg(test)]
pub(crate) mod tests;

const ATTESTATION: &str = "1.3.6.1.4.1.11129.2.1.17";
const PROVISIONING: &str = "1.3.6.1.4.1.11129.2.1.30";
// Independently obtained from https://android.googleapis.com/attestation/root,
// 2026-09-27. SPKI hashes cover RSA factory roots and the 2026 P-384 RKP root.
const GOOGLE_ROOTS: [&str; 2] = [
    "feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae",
    "3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Chain {
    version: u32,
    certificates_der_b64: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Expected {
    version: u32,
    challenge_b64: String,
    challenge_issued_at: u64,
    challenge_expires_at: u64,
    response_received_at: u64,
    max_enrollment_age_secs: u64,
    expected_spki_sha256: String,
    package_name: String,
    min_version_code: u64,
    signing_certificate_sha256: Vec<String>,
    minimum_security_level: String,
    minimum_os_version: u64,
    minimum_os_patch_level: u64,
    minimum_vendor_patch_level: u64,
    minimum_boot_patch_level: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Trust {
    version: u32,
    profile: String,
    root_spki_sha256: Vec<String>,
    revocation: Revocation,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revocation {
    fetched_at: u64,
    valid_until: u64,
    entries: BTreeMap<String, Revoked>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revoked {
    status: String,
    #[serde(default)]
    expires: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    comment: Option<String>,
}

/// Verify a leaf-first DER chain against independently retained enrollment inputs.
/// Every error fails closed. Success with `private-test` roots never claims Google
/// hardware attestation. The caller still owns nonce consumption and trust updates.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn verify_key_attestation(
    chain_json: &str,
    expected_json: &str,
    trust_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    if chain_json.len() > 160 * 1024
        || expected_json.len() > 16 * 1024
        || trust_json.len() > 2 * 1024 * 1024
    {
        return Err("Attestation input exceeds its bound".into());
    }
    let chain: Chain = serde_json::from_str(chain_json).map_err(crate::err)?;
    let expected: Expected = serde_json::from_str(expected_json).map_err(crate::err)?;
    let trust: Trust = serde_json::from_str(trust_json).map_err(crate::err)?;
    let now = crate::seconds(now_secs)?;
    let challenge = inputs(&expected, &trust, now)?;
    if chain.version != 1 || !(2..=8).contains(&chain.certificates_der_b64.len()) {
        return Err("Unsupported attestation chain size or version".into());
    }
    let mut seen = HashSet::new();
    let encoded: Vec<Vec<u8>> = chain
        .certificates_der_b64
        .iter()
        .map(|cert| {
            let bytes = decode(cert, 32 * 1024)?;
            if !seen.insert(crate::digest(&bytes)) {
                return Err("Duplicate attestation certificate".into());
            }
            der::canonical(&bytes)?;
            Ok(bytes)
        })
        .collect::<Result<_, String>>()?;
    if encoded.iter().map(Vec::len).sum::<usize>() > 96 * 1024 {
        return Err("Attestation chain DER exceeds its bound".into());
    }
    let certificates: Vec<X509Certificate<'_>> = encoded
        .iter()
        .map(|bytes| {
            let (remaining, cert) = X509Certificate::from_der(bytes).map_err(crate::err)?;
            if !remaining.is_empty() {
                return Err("Trailing certificate DER".into());
            }
            Ok(cert)
        })
        .collect::<Result<_, String>>()?;
    let root = certificates.last().unwrap();
    let root_pin = crate::digest(root.public_key().raw);
    if !trust.root_spki_sha256.contains(&root_pin)
        || (trust.profile == "google-hardware-attestation"
            && !GOOGLE_ROOTS.contains(&root_pin.as_str()))
    {
        return Err("Attestation root is outside the independently pinned trust profile".into());
    }
    let time =
        ASN1Time::from_timestamp(i64::try_from(now).map_err(crate::err)?).map_err(crate::err)?;
    let mut attestation_indices = Vec::new();
    let mut provisioning_indices = Vec::new();
    for (index, cert) in certificates.iter().enumerate() {
        if cert.version() != X509Version::V3 || !cert.validity().is_valid_at(time) {
            return Err("Attestation certificate is expired, future-dated or not X.509v3".into());
        }
        if cert.signature_algorithm != cert.tbs_certificate.signature
            || cert.signature_value.unused_bits != 0
            || cert.public_key().subject_public_key.unused_bits != 0
        {
            return Err("Inconsistent certificate signature encoding".into());
        }
        public_key(cert, index == 0)?;
        extensions(cert)?;
        let serial = serial(cert.raw_serial())?;
        if trust.revocation.entries.contains_key(&serial) {
            return Err("Attestation certificate is revoked or suspended".into());
        }
        if cert
            .extensions()
            .iter()
            .any(|e| e.oid.to_id_string() == ATTESTATION)
        {
            attestation_indices.push(index);
        }
        if cert
            .extensions()
            .iter()
            .any(|e| e.oid.to_id_string() == PROVISIONING)
        {
            provisioning_indices.push(index);
        }
        if index == 0 {
            if cert
                .basic_constraints()
                .map_err(crate::err)?
                .is_some_and(|bc| bc.value.ca)
            {
                return Err("Attested signing key must not be a certificate authority".into());
            }
            let usage = cert
                .key_usage()
                .map_err(crate::err)?
                .ok_or("Attested key is missing digital-signature usage")?;
            if usage.value.flags != 1 {
                return Err("Attested leaf key usage is not a signing-only profile".into());
            }
        } else {
            let bc = cert
                .basic_constraints()
                .map_err(crate::err)?
                .ok_or("Attestation issuer is missing CA constraints")?;
            if !bc.value.ca
                || bc
                    .value
                    .path_len_constraint
                    .is_some_and(|limit| index - 1 > limit as usize)
            {
                return Err("Attestation issuer violates CA/path-length constraints".into());
            }
            if cert
                .key_usage()
                .map_err(crate::err)?
                .is_none_or(|ku| !ku.value.key_cert_sign())
            {
                return Err("Attestation issuer cannot sign certificates".into());
            }
        }
        let issuer = &certificates[(index + 1).min(certificates.len() - 1)];
        if cert.issuer() != issuer.subject() {
            return Err("Attestation certificate issuer order is invalid".into());
        }
        if let Some(aki) = cert
            .extensions()
            .iter()
            .find_map(|e| match e.parsed_extension() {
                ParsedExtension::AuthorityKeyIdentifier(a) => Some(a),
                _ => None,
            })
        {
            if let Some(id) = &aki.key_identifier {
                if let Some(ski) =
                    issuer
                        .extensions()
                        .iter()
                        .find_map(|e| match e.parsed_extension() {
                            ParsedExtension::SubjectKeyIdentifier(id) => Some(id),
                            _ => None,
                        })
                {
                    if id.0 != ski.0 {
                        return Err(
                            "Attestation authority-key identifier differs from issuer".into()
                        );
                    }
                }
            }
            if aki.authority_cert_issuer.is_some() || aki.authority_cert_serial.is_some() {
                return Err("Unsupported authority certificate identifier constraints".into());
            }
        }
        verify_edge(cert, issuer)?;
    }
    // Select from the trusted-root direction. This narrow profile requires the
    // first/only attestation to cover the actual leaf; appended leaves fail.
    if attestation_indices != [0]
        || !(provisioning_indices.is_empty() || provisioning_indices == [1])
    {
        return Err(
            "Attestation extension is duplicated, appended or not bound to the leaf key".into(),
        );
    }
    let leaf = &certificates[0];
    let spki_pin = crate::digest(leaf.public_key().raw);
    if spki_pin != expected.expected_spki_sha256 {
        return Err("Attestation SPKI differs from the verifier's expected evidence key".into());
    }
    let data = leaf
        .extensions()
        .iter()
        .find(|e| e.oid.to_id_string() == ATTESTATION)
        .unwrap()
        .value;
    let claims = extension::claims(data, &expected, &challenge)?;
    if !provisioning_indices.is_empty() {
        let value = certificates[1]
            .extensions()
            .iter()
            .find(|e| e.oid.to_id_string() == PROVISIONING)
            .unwrap()
            .value;
        extension::provisioning(value, &claims)?;
    }
    let hardware = trust.profile == "google-hardware-attestation";
    serde_json::to_string(&json!({
        "version":1,"type":"nonverba-key-attestation-verification","verified":true,
        "trust_profile":trust.profile,"key_enrollment_attested":hardware,
        "root_spki_sha256":root_pin,"attested_spki_sha256":spki_pin,"claims":claims,
        "state_scope":"at-key-generation","enrollment_response_received_at":expected.response_received_at,
        "enrollment_age_secs":now-expected.response_received_at,"revocation_fetched_at":trust.revocation.fetched_at,
        "revocation_valid_until":trust.revocation.valid_until,"verification_time":now,
        "certificate_validity_policy":"strict-current-validity-no-factory-expiry-exception",
        "trust_material_origin":"verifier-retained-input","trust_material_transport_authenticated":false,
        "possession_proven":false,"current_app_state_attested":false,"sensor_origin_proven":false,
        "measurement_freshness_proven":false,"clock_trusted":false,"replay_checked":false
    })).map_err(crate::err)
}

fn inputs(e: &Expected, t: &Trust, now: u64) -> Result<Vec<u8>, String> {
    if e.version != 1
        || t.version != 1
        || !matches!(
            t.profile.as_str(),
            "google-hardware-attestation" | "private-test"
        )
        || e.challenge_expires_at <= e.challenge_issued_at
        || e.challenge_expires_at - e.challenge_issued_at > 600
        || e.response_received_at < e.challenge_issued_at
        || e.response_received_at >= e.challenge_expires_at
        || e.response_received_at > now
        || !(1..=30 * 86400).contains(&e.max_enrollment_age_secs)
        || now - e.response_received_at > e.max_enrollment_age_secs
        || !hash(&e.expected_spki_sha256)
        || e.package_name.is_empty()
        || e.package_name.len() > 255
        || !e
            .package_name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_'))
        || e.min_version_code == 0
        || e.min_version_code > i64::MAX as u64
        || !matches!(
            e.minimum_security_level.as_str(),
            "trusted-environment" | "strongbox"
        )
        || !(1..=8).contains(&e.signing_certificate_sha256.len())
        || e.signing_certificate_sha256.iter().any(|h| !hash(h))
        || e.signing_certificate_sha256
            .iter()
            .collect::<HashSet<_>>()
            .len()
            != e.signing_certificate_sha256.len()
        || !(1..=8).contains(&t.root_spki_sha256.len())
        || t.root_spki_sha256.iter().any(|h| !hash(h))
        || t.root_spki_sha256.iter().collect::<HashSet<_>>().len() != t.root_spki_sha256.len()
    {
        return Err("Invalid verifier-retained attestation expectations or trust policy".into());
    }
    patch(e.minimum_os_patch_level, false)?;
    patch(e.minimum_vendor_patch_level, true)?;
    patch(e.minimum_boot_patch_level, true)?;
    if e.minimum_os_version < 10000 || e.minimum_os_version > 999999 {
        return Err("Invalid minimum Android OS version".into());
    }
    let r = &t.revocation;
    if r.fetched_at > now
        || r.valid_until <= r.fetched_at
        || r.valid_until - r.fetched_at > 86400
        || now >= r.valid_until
        || now - r.fetched_at > 86400
        || r.entries.len() > 50_000
    {
        return Err("Revocation snapshot is stale, future-dated or out of bounds".into());
    }
    for (serial, status) in &r.entries {
        if serial.is_empty()
            || serial.len() > 40
            || serial.starts_with('0')
            || !serial
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !matches!(status.status.as_str(), "REVOKED" | "SUSPENDED")
            || status.reason.as_ref().is_some_and(|s| s.len() > 256)
            || status.comment.as_ref().is_some_and(|s| s.len() > 4096)
            || status
                .expires
                .as_ref()
                .is_some_and(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_err())
        {
            return Err("Malformed revocation snapshot entry".into());
        }
    }
    let challenge = decode(&e.challenge_b64, 128)?;
    if challenge.len() < 32 {
        return Err("Attestation challenge must contain at least 32 bytes".into());
    }
    Ok(challenge)
}
fn decode(value: &str, max: usize) -> Result<Vec<u8>, String> {
    if value.is_empty() || value.len() > max.div_ceil(3) * 4 {
        return Err("Base64 attestation input exceeds bound".into());
    }
    let bytes = STANDARD.decode(value).map_err(crate::err)?;
    if bytes.len() > max || STANDARD.encode(&bytes) != value {
        return Err("Attestation base64 is not canonical".into());
    }
    Ok(bytes)
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn serial(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > 21 || bytes[0] & 128 != 0 {
        return Err("Invalid attestation certificate serial".into());
    }
    let result = hex::encode(bytes).trim_start_matches('0').to_string();
    if result.is_empty() {
        return Err("Zero certificate serial is unsupported".into());
    }
    Ok(result)
}
fn patch(value: u64, day: bool) -> Result<(), String> {
    let (year, month, d) = if day {
        (value / 10000, (value / 100) % 100, value % 100)
    } else {
        (value / 100, value % 100, 1)
    };
    if !(2000..=9999).contains(&year)
        || chrono::NaiveDate::from_ymd_opt(year as i32, month as u32, d as u32).is_none()
    {
        return Err("Invalid Android patch level".into());
    }
    Ok(())
}
fn public_key(cert: &X509Certificate<'_>, leaf: bool) -> Result<(), String> {
    let key = cert.public_key();
    if leaf {
        p256::PublicKey::from_public_key_der(key.raw).map_err(crate::err)?;
        return Ok(());
    }
    match key.parsed().map_err(crate::err)? {
        PublicKey::RSA(rsa) => {
            let first = rsa
                .modulus
                .iter()
                .position(|b| *b != 0)
                .ok_or("Zero RSA modulus")?;
            let bits =
                (rsa.modulus.len() - first) * 8 - rsa.modulus[first].leading_zeros() as usize;
            if !(2048..=8192).contains(&bits) || rsa.try_exponent().map_err(crate::err)? != 65537 {
                return Err("Unsupported RSA attestation issuer key".into());
            }
            if key.algorithm.algorithm.to_id_string() != "1.2.840.113549.1.1.1" {
                return Err("Unsupported RSA issuer algorithm".into());
            }
        }
        PublicKey::EC(_) => {
            let curve = key
                .algorithm
                .parameters
                .as_ref()
                .ok_or("Missing issuer EC curve")?
                .as_oid()
                .map_err(crate::err)?
                .to_id_string();
            if !matches!(curve.as_str(), "1.2.840.10045.3.1.7" | "1.3.132.0.34") {
                return Err("Unsupported attestation issuer EC curve".into());
            }
        }
        _ => return Err("Unsupported attestation certificate public key".into()),
    }
    Ok(())
}
fn extensions(cert: &X509Certificate<'_>) -> Result<(), String> {
    let mut seen = HashSet::new();
    for ext in cert.extensions() {
        let oid = ext.oid.to_id_string();
        if !seen.insert(oid.clone()) || ext.parsed_extension().error().is_some() {
            return Err("Duplicate or malformed certificate extension".into());
        }
        if ext.critical && !matches!(oid.as_str(), "2.5.29.19" | "2.5.29.15") {
            return Err("Unsupported critical certificate extension".into());
        }
        if matches!(
            oid.as_str(),
            "2.5.29.30" | "2.5.29.32" | "2.5.29.33" | "2.5.29.36" | "2.5.29.37" | "2.5.29.54"
        ) {
            return Err("Unsupported certificate path or purpose constraint".into());
        }
    }
    Ok(())
}
fn verify_edge(cert: &X509Certificate<'_>, issuer: &X509Certificate<'_>) -> Result<(), String> {
    let algorithm = &cert.signature_algorithm;
    let oid = algorithm.algorithm.to_id_string();
    let (sig, hash) = match oid.as_str() {
        "1.2.840.113549.1.1.11" => (RSA_OID, SHA256_OID),
        "1.2.840.113549.1.1.12" => (RSA_OID, SHA384_OID),
        "1.2.840.113549.1.1.13" => (RSA_OID, SHA512_OID),
        "1.2.840.10045.4.3.2" => (EC_PUBLICKEY_OID, SHA256_OID),
        "1.2.840.10045.4.3.3" => (EC_PUBLICKEY_OID, SHA384_OID),
        _ => return Err("Unsupported attestation certificate signature algorithm".into()),
    };
    if sig == EC_PUBLICKEY_OID {
        if algorithm.parameters.is_some() {
            return Err("ECDSA certificate parameters must be absent".into());
        }
        der::canonical(cert.signature_value.data.as_ref())?;
        let integers = der::one(cert.signature_value.data.as_ref())?.children(16)?;
        if integers.len() != 2
            || integers.iter().any(|n| {
                n.class != 0
                    || n.tag != 2
                    || n.constructed
                    || n.body.is_empty()
                    || n.body[0] & 128 != 0
            })
        {
            return Err("Certificate ECDSA signature is not DER".into());
        }
    } else if algorithm
        .parameters
        .as_ref()
        .is_some_and(|p| p.tag().0 != 5 || !p.data.is_empty())
    {
        return Err("Unsupported RSA signature parameters".into());
    }
    validator_for_sig_and_hash_algs(&sig, &hash)
        .ok_or("Certificate signature verifier unavailable")?
        .validate(
            cert.signature_value.data.as_ref(),
            cert.tbs_certificate.as_ref(),
            issuer.public_key().raw,
        )
        .map_err(crate::err)
}
