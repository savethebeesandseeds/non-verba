// SPDX-License-Identifier: AGPL-3.0-only
//! Pinned P-256/SHA-256 contract signatures and salted HMAC commitments.
//!
//! A caller supplies independently trusted role-key bindings. A public key
//! carried by an untrusted action never becomes trusted through this module.
//! Signing uses a caller-owned key; this package provides no custody/reset API.

use crate::encoding::{canonical, validate_digest, validate_domain, validate_id};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use p256::ecdsa::{
    Signature, SigningKey, VerifyingKey,
    signature::{Signer, Verifier},
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

pub const PROTOCOL_VERSION: &str = "2";
pub const SIGNATURE_SUITE: &str = "P256_SHA256_V1";
pub const SIGNATURE_DOMAIN: &str = "NONVERBA:SIGNATURE:v1";
pub const COMMITMENT_DOMAIN: &str = "NONVERBA:DISPUTE-COMMIT:v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyBinding {
    pub role: String,
    pub key_id: String,
    /// Exactly 33-byte compressed SEC1, encoded unpadded base64url.
    pub public_key_sec1_b64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignatureClaims {
    pub protocol_version: String,
    pub deployment_domain: String,
    pub assignment_id: String,
    pub content_hash: String,
    pub role: String,
    pub key_id: String,
    pub purpose: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DetachedSignature {
    pub claims: SignatureClaims,
    /// Exactly 64-byte r||s; low-S required; unpadded base64url.
    pub signature: String,
}

fn validate_role(role: &str) -> Result<(), String> {
    if !matches!(role, "R" | "O" | "M") {
        return Err("SIGNATURE_ROLE: unknown role".into());
    }
    Ok(())
}

impl SignatureClaims {
    pub fn validate(&self) -> Result<(), String> {
        // Version 1 is admitted only for historical signature inspection. The
        // caller must supply the exact expected context; this does not upgrade
        // its policy or permit a v1 authorization on a v2 object.
        if !matches!(self.protocol_version.as_str(), "1" | "2") {
            return Err("VERSION: unsupported signature protocol version".into());
        }
        validate_domain(&self.deployment_domain)?;
        validate_id(&self.assignment_id)?;
        validate_digest(&self.content_hash)?;
        validate_role(&self.role)?;
        validate_id(&self.key_id)?;
        validate_id(&self.purpose)
    }
}

pub fn encode_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn decode_base64url(value: &str, expected_len: usize) -> Result<Vec<u8>, String> {
    if value.len() != expected_len.saturating_mul(8).div_ceil(6)
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
    {
        return Err("BASE64URL: wrong length or noncanonical alphabet/padding".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "BASE64URL: invalid encoding or trailing bits".to_owned())?;
    if bytes.len() != expected_len || encode_base64url(&bytes) != value {
        return Err("BASE64URL: noncanonical encoding".into());
    }
    Ok(bytes)
}

/// Exact bytes for independent/device-owned signers. The suite is fixed by
/// code and included in the statement, never selected by an incoming message.
pub fn signing_bytes(claims: &SignatureClaims) -> Result<Vec<u8>, String> {
    claims.validate()?;
    #[derive(Serialize)]
    struct Statement<'a> {
        domain_separator: &'static str,
        suite: &'static str,
        claims: &'a SignatureClaims,
    }
    canonical(&Statement {
        domain_separator: SIGNATURE_DOMAIN,
        suite: SIGNATURE_SUITE,
        claims,
    })
}

pub fn key_binding(role: &str, key_id: &str, key: &SigningKey) -> KeyBinding {
    KeyBinding {
        role: role.into(),
        key_id: key_id.into(),
        public_key_sec1_b64: encode_base64url(
            key.verifying_key().to_encoded_point(true).as_bytes(),
        ),
    }
}

impl KeyBinding {
    pub fn validate(&self) -> Result<VerifyingKey, String> {
        validate_role(&self.role)?;
        validate_id(&self.key_id)?;
        let bytes = decode_base64url(&self.public_key_sec1_b64, 33)?;
        if !matches!(bytes.first(), Some(2 | 3)) {
            return Err("SIGNATURE_KEY: compressed SEC1 required".into());
        }
        VerifyingKey::from_sec1_bytes(&bytes)
            .map_err(|_| "SIGNATURE_KEY: invalid P-256 point".into())
    }
}

pub fn sign(claims: &SignatureClaims, key: &SigningKey) -> Result<DetachedSignature, String> {
    let signature: Signature = key
        .try_sign(&signing_bytes(claims)?)
        .map_err(|_| "SIGNATURE_SIGN: signing failed".to_owned())?;
    let signature = signature.normalize_s().unwrap_or(signature);
    Ok(DetachedSignature {
        claims: claims.clone(),
        signature: encode_base64url(&signature.to_bytes()),
    })
}

pub fn verify(
    signed: &DetachedSignature,
    expected: &SignatureClaims,
    trusted: &KeyBinding,
) -> Result<(), String> {
    expected.validate()?;
    signed.claims.validate()?;
    if signed.claims != *expected {
        return Err("SIGNATURE_CONTEXT: signature is bound to different content, role, purpose, key, assignment or domain".into());
    }
    if trusted.role != expected.role || trusted.key_id != expected.key_id {
        return Err(
            "SIGNATURE_AUTHORITY: role-key binding is not authorized for this statement".into(),
        );
    }
    let key = trusted.validate()?;
    let raw = decode_base64url(&signed.signature, 64)?;
    let signature = Signature::from_slice(&raw)
        .map_err(|_| "SIGNATURE_ENCODING: invalid P-256 r or s".to_owned())?;
    if signature.normalize_s().is_some() {
        return Err("SIGNATURE_ENCODING: high-S signatures are not canonical".into());
    }
    key.verify(&signing_bytes(expected)?, &signature)
        .map_err(|_| "SIGNATURE_INVALID: signature verification failed".into())
}

/// Keep this context and salt local until reveal. In particular the manifest
/// digest must not be included in the public commitment event before reveal.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommitmentContext {
    pub deployment_domain: String,
    pub assignment_id: String,
    pub agreement_hash: String,
    pub dispute_id: String,
    pub round_id: String,
    pub author_role: String,
    pub manifest_digest: String,
}

pub fn fresh_salt() -> Result<[u8; 32], String> {
    let mut salt = [0u8; 32];
    getrandom::getrandom(&mut salt).map_err(|_| {
        "RANDOMNESS_UNAVAILABLE: cannot generate a fresh commitment salt".to_owned()
    })?;
    Ok(salt)
}

pub fn commitment_message(context: &CommitmentContext) -> Result<Vec<u8>, String> {
    validate_domain(&context.deployment_domain)?;
    validate_id(&context.assignment_id)?;
    validate_digest(&context.agreement_hash)?;
    validate_id(&context.dispute_id)?;
    validate_id(&context.round_id)?;
    validate_role(&context.author_role)?;
    validate_digest(&context.manifest_digest)?;
    canonical(&[
        COMMITMENT_DOMAIN,
        &context.deployment_domain,
        &context.assignment_id,
        &context.agreement_hash,
        &context.dispute_id,
        &context.round_id,
        &context.author_role,
        &context.manifest_digest,
    ])
}

pub fn commitment(context: &CommitmentContext, secret_salt: &[u8; 32]) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret_salt)
        .map_err(|_| "COMMITMENT_KEY: invalid salt".to_owned())?;
    mac.update(&commitment_message(context)?);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

pub fn verify_commitment(
    context: &CommitmentContext,
    secret_salt: &[u8; 32],
    expected: &str,
) -> Result<(), String> {
    validate_digest(expected)?;
    let expected =
        hex::decode(expected).map_err(|_| "COMMITMENT_ENCODING: invalid digest".to_owned())?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret_salt)
        .map_err(|_| "COMMITMENT_KEY: invalid salt".to_owned())?;
    mac.update(&commitment_message(context)?);
    mac.verify_slice(&expected)
        .map_err(|_| "COMMITMENT_OPENING: salt or committed context does not match".into())
}
