// SPDX-License-Identifier: AGPL-3.0-only
//! RFC 9052 COSE_Sign1 via coset. No custom signature framing or ambiguous
//! algorithm negotiation. The attached payload is strict UTF-8 JSON; its exact
//! bytes are signed. New payloads serialize the fixed Evidence struct in order.
use super::{model::*, parse_json, validation};
use base64::{engine::general_purpose::STANDARD, Engine};
use coset::{iana, CoseSign1, CoseSign1Builder, Header, HeaderBuilder, TaggedCborSerializable};
use p256::{
    ecdsa::{signature::Verifier, Signature, VerifyingKey},
    pkcs8::{DecodePublicKey, EncodePublicKey},
};

const CONTENT_TYPE: &str = "application/vnd.nonverba.location-proof+json";
pub const MAX_PROOF_BYTES: usize = super::MAX_TRACE_JSON_BYTES + 16 * 1024;

fn key_from_spki(bytes: &[u8]) -> Result<VerifyingKey, String> {
    if bytes.len() > 256 {
        return Err("Location public key is too large".into());
    }
    let key = VerifyingKey::from_public_key_der(bytes).map_err(crate::err)?;
    if key.to_public_key_der().map_err(crate::err)?.as_bytes() != bytes {
        return Err("Location public key must use canonical P-256 DER SPKI".into());
    }
    Ok(key)
}

pub fn fingerprint_spki(bytes: &[u8]) -> Result<String, String> {
    key_from_spki(bytes)?;
    Ok(crate::digest(bytes))
}

fn header(spki: &[u8]) -> Header {
    HeaderBuilder::new()
        .algorithm(iana::Algorithm::ES256)
        .content_type(CONTENT_TYPE.into())
        .key_id(sha2::Sha256::digest(spki).to_vec())
        .build()
}
use sha2::Digest;

pub(super) fn make_evidence(
    trace: &Trace,
    spki: &[u8],
    asset: Option<AssetBinding>,
    now_ms: u64,
) -> Result<Evidence, String> {
    validation::validate_trace(trace, now_ms)?;
    key_from_spki(spki)?;
    if let Some(asset) = &asset {
        validation::validate_asset(asset)?;
    }
    let mut trace = trace.clone();
    trace.capture_correlation = if asset.is_some() {
        "application-submission-interval"
    } else {
        "none"
    }
    .into();
    let key_protection = if trace.profile == "native-android" {
        "android-keystore"
    } else {
        "software"
    }
    .into();
    Ok(Evidence {
        version: 1,
        kind: "nonverba-location-evidence".into(),
        trace,
        sealed_at_ms: now_ms,
        public_spki_der_b64: STANDARD.encode(spki),
        key_protection,
        asset,
    })
}

pub(super) fn sign_evidence<F>(evidence: &Evidence, signer: F) -> Result<Vec<u8>, String>
where
    F: FnOnce(&[u8]) -> Result<Vec<u8>, String>,
{
    let spki = STANDARD
        .decode(&evidence.public_spki_der_b64)
        .map_err(crate::err)?;
    let key = key_from_spki(&spki)?;
    let payload = serde_json::to_vec(evidence).map_err(crate::err)?;
    if payload.len() > super::MAX_JSON {
        return Err("Location evidence is too large".into());
    }
    let mut message = CoseSign1Builder::new()
        .protected(header(&spki))
        .payload(payload)
        .build();
    let bytes_to_sign = message.tbs_data(&[]);
    // Android SHA256withECDSA returns ASN.1 DER; Rust/browser returns raw r||s.
    // Only the standardized fixed-width 64-byte ES256 encoding goes on the wire.
    let signed = signer(&bytes_to_sign)?;
    let signature = if signed.len() == 64 {
        Signature::from_slice(&signed)
    } else {
        Signature::from_der(&signed)
    }
    .map_err(crate::err)?;
    let signature = signature.normalize_s().unwrap_or(signature);
    key.verify(&bytes_to_sign, &signature)
        .map_err(|_| "Location signing callback returned an invalid signature".to_owned())?;
    message.signature = signature.to_bytes().to_vec();
    let proof = message.to_tagged_vec().map_err(crate::err)?;
    if proof.len() > MAX_PROOF_BYTES {
        return Err("Location proof is too large".into());
    }
    Ok(proof)
}

pub(super) fn read_message(bytes: &[u8]) -> Result<(Evidence, String, bool), String> {
    if bytes.len() > MAX_PROOF_BYTES {
        return Err("Location proof is too large".into());
    }
    let message = CoseSign1::from_tagged_slice(bytes).map_err(crate::err)?;
    if !message.unprotected.is_empty() {
        return Err("Unprotected location proof headers are forbidden".into());
    }
    let payload = message
        .payload
        .as_ref()
        .ok_or("Location proof requires an attached payload")?;
    let evidence: Evidence = parse_json(std::str::from_utf8(payload).map_err(crate::err)?)?;
    if evidence.version != 1 || evidence.kind != "nonverba-location-evidence" {
        return Err("Unsupported location evidence".into());
    }
    let spki = STANDARD
        .decode(&evidence.public_spki_der_b64)
        .map_err(crate::err)?;
    if STANDARD.encode(&spki) != evidence.public_spki_der_b64 {
        return Err("Noncanonical public key encoding".into());
    }
    let key = key_from_spki(&spki)?;
    if message.protected.header != header(&spki) {
        return Err("Unsupported or mismatched protected location proof headers".into());
    }
    if evidence.key_protection
        != if evidence.trace.profile == "native-android" {
            "android-keystore"
        } else {
            "software"
        }
    {
        return Err("Inconsistent key-protection source claim".into());
    }
    if evidence.trace.capture_correlation
        != if evidence.asset.is_some() {
            "application-submission-interval"
        } else {
            "none"
        }
    {
        return Err("Inconsistent asset-submission correlation claim".into());
    }
    if let Some(asset) = &evidence.asset {
        validation::validate_asset(asset)?;
    }
    let signature_valid = message
        .verify_signature(&[], |signature, data| {
            let signature = Signature::from_slice(signature)?;
            key.verify(data, &signature)
        })
        .is_ok();
    Ok((evidence, crate::digest(&spki), signature_valid))
}
